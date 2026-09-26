"use client"

import { useCallback, useEffect, useRef, useState } from "react"
import {
  inspectOffer,
  pairFromOffer,
  TunnelClientError,
  type PairCredential,
  type PairedDaemon,
  type PendingPairing,
} from "@agentproto/pair-client"
import { Fingerprint, HowToPair, PairButton, PairShell } from "@/components/pair-shell"
import { statusPath } from "@/lib/pair"
import {
  forgetPairing,
  pairStore,
  postToWorker,
  registerPairingWorker,
  serviceWorkersSupported,
} from "@/lib/pair-worker"

type Phase =
  | { kind: "loading" }
  | { kind: "home"; pairings: PairCredential[] }
  | { kind: "pairing"; fingerprint: string | null }
  | { kind: "confirm"; daemon: PairedDaemon }
  | { kind: "saving"; daemon: PairedDaemon }
  | { kind: "cancelled"; daemon: PairedDaemon }
  | { kind: "error"; title: string; message: string }
  | { kind: "unsupported" }

/**
 * Read the offer out of the fragment (`/pair#v=1&rv=…`, what `agentproto pair
 * offer --qr` links to) and wipe it from the address bar and history right
 * away, before anything else runs. The fragment is the query string of an
 * `agentproto://pair?…` offer; it never reached a server.
 */
function takeOfferFromFragment(): string | null {
  const fragment = window.location.hash.replace(/^#/, "")
  if (!fragment) return null
  window.history.replaceState(window.history.state, "", window.location.pathname + window.location.search)
  return `agentproto://pair?${fragment}`
}

/** How this phone is listed on the daemon (`agentproto pair ls`). */
function deviceName(): string {
  const ua = navigator.userAgent
  const device = /iPhone/.test(ua)
    ? "iPhone"
    : /iPad/.test(ua)
      ? "iPad"
      : /Android/.test(ua)
        ? "Android"
        : /Macintosh/.test(ua)
          ? "Mac"
          : /Windows/.test(ua)
            ? "Windows"
            : /Linux/.test(ua)
              ? "Linux"
              : null
  return device ? `${device} browser (${window.location.host})` : `browser@${window.location.host}`
}

function describeError(err: unknown): { title: string; message: string } {
  const message = err instanceof Error ? err.message : String(err)
  if (err instanceof TunnelClientError) {
    if (err.code === "invalid_offer") {
      return { title: "This pairing link is invalid or expired", message }
    }
    if (err.code === "pairing_failed") {
      return { title: "Pairing failed", message }
    }
  }
  return { title: "Something went wrong", message }
}

export default function PairPage(): React.ReactElement {
  const [phase, setPhase] = useState<Phase>({ kind: "loading" })
  const pendingRef = useRef<PendingPairing | null>(null)
  const startedRef = useRef(false)

  const loadHome = useCallback(async () => {
    const pairings = await pairStore().list()
    const launch = new URLSearchParams(window.location.search).get("launch") === "1"
    // Home-screen launch with a single daemon: straight to it.
    if (launch && pairings.length === 1) {
      window.location.replace(statusPath(pairings[0]!.id))
      return
    }
    setPhase({ kind: "home", pairings })
  }, [])

  useEffect(() => {
    // Runs once: the offer is single-use, so a second handshake (StrictMode
    // re-running this effect) would only fail against the spent offer.
    if (startedRef.current) return
    startedRef.current = true

    const offer = takeOfferFromFragment()
    if (!serviceWorkersSupported()) {
      setPhase({ kind: "unsupported" })
      return
    }
    if (!offer) {
      void loadHome().catch(err => setPhase({ kind: "error", ...describeError(err) }))
      return
    }
    void (async () => {
      try {
        const info = await inspectOffer(offer)
        setPhase({ kind: "pairing", fingerprint: info.fingerprint })
        const pending = await pairFromOffer(offer, { store: pairStore(), clientName: deviceName() })
        pendingRef.current = pending
        setPhase({ kind: "confirm", daemon: pending.daemon })
      } catch (err) {
        setPhase({ kind: "error", ...describeError(err) })
      }
    })()
  }, [loadHome])

  useEffect(() => {
    // An offer link opened while this page is already showing is only a
    // fragment change (no load): start over so the effect above reads it.
    const onHashChange = (): void => {
      if (window.location.hash.length > 1) window.location.reload()
    }
    window.addEventListener("hashchange", onHashChange)
    return () => window.removeEventListener("hashchange", onHashChange)
  }, [])

  const confirm = async (daemon: PairedDaemon) => {
    const pending = pendingRef.current
    if (!pending) return
    setPhase({ kind: "saving", daemon })
    try {
      const credential = await pending.confirm()
      pendingRef.current = null
      const reg = await registerPairingWorker(credential.id)
      // A worker already running for this daemon (a re-pair after a revoke)
      // still holds the old credential's client.
      postToWorker(reg, { type: "agentproto-pair:reset" })
      window.location.replace(statusPath(credential.id))
    } catch (err) {
      setPhase({ kind: "error", ...describeError(err) })
    }
  }

  const cancel = (daemon: PairedDaemon) => {
    pendingRef.current?.cancel()
    pendingRef.current = null
    setPhase({ kind: "cancelled", daemon })
  }

  const forget = async (id: string) => {
    await forgetPairing(id)
    await loadHome()
  }

  switch (phase.kind) {
    case "loading":
      return <PairShell eyebrow="agentproto pair" title="Loading…" />

    case "unsupported":
      return (
        <PairShell eyebrow="agentproto pair" title="This browser can't host the Control Center" tone="danger">
          <p>
            Pairing needs service workers, which this browser (or this private window) doesn&apos;t offer. Open the
            pairing link in Safari or Chrome.
          </p>
        </PairShell>
      )

    case "home":
      if (phase.pairings.length === 0) {
        return (
          <PairShell eyebrow="not paired" title="Pair this phone with your agentproto daemon">
            <HowToPair />
          </PairShell>
        )
      }
      return (
        <PairShell eyebrow="paired daemons" title="Open the Control Center" tone="ok">
          <ul className="flex flex-col gap-3">
            {phase.pairings.map(p => (
              <li key={p.id} className="rounded-lg border border-fd-border p-3">
                <div className="font-medium text-fd-foreground">{p.name}</div>
                <div className="mb-3 font-mono text-xs">{p.fingerprint}</div>
                <div className="flex gap-2">
                  <PairButton onClick={() => window.location.assign(statusPath(p.id))}>Open</PairButton>
                  <PairButton variant="secondary" onClick={() => void forget(p.id)}>
                    Forget
                  </PairButton>
                </div>
              </li>
            ))}
          </ul>
          <details className="text-xs">
            <summary className="cursor-pointer">Pair another daemon</summary>
            <div className="mt-3 flex flex-col gap-3">
              <HowToPair />
            </div>
          </details>
        </PairShell>
      )

    case "pairing":
      return (
        <PairShell eyebrow="pairing" title="Reaching the daemon…" tone="warn">
          {phase.fingerprint && (
            <>
              <p>The link names this daemon:</p>
              <Fingerprint value={phase.fingerprint} />
            </>
          )}
          <p>Running the end-to-end handshake through the rendezvous.</p>
        </PairShell>
      )

    case "confirm":
    case "saving":
      return (
        <PairShell eyebrow="confirm pairing" title={`Pair with ${phase.daemon.name}?`} tone="warn">
          <p>Check that this fingerprint matches the one printed by <code>agentproto pair offer</code>:</p>
          <Fingerprint value={phase.daemon.fingerprint} />
          {phase.daemon.platform && <p className="font-mono text-xs">{phase.daemon.platform}</p>}
          <div className="flex gap-2">
            <PairButton disabled={phase.kind === "saving"} onClick={() => void confirm(phase.daemon)}>
              {phase.kind === "saving" ? "Pairing…" : "Confirm"}
            </PairButton>
            <PairButton variant="secondary" disabled={phase.kind === "saving"} onClick={() => cancel(phase.daemon)}>
              Cancel
            </PairButton>
          </div>
        </PairShell>
      )

    case "cancelled":
      return (
        <PairShell eyebrow="cancelled" title="Nothing was saved on this phone">
          <p>
            The daemon still lists this device. Remove it on the computer with{" "}
            <code>agentproto pair revoke {phase.daemon.fingerprint}</code>.
          </p>
          <PairButton variant="secondary" onClick={() => void loadHome()}>
            Done
          </PairButton>
        </PairShell>
      )

    case "error":
      return (
        <PairShell eyebrow="pairing failed" title={phase.title} tone="danger">
          <p className="break-words font-mono text-xs">{phase.message}</p>
          <p>Pairing links are single-use and expire after a few minutes. Get a fresh one:</p>
          <HowToPair />
        </PairShell>
      )
  }
}
