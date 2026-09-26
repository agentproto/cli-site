"use client"

import { useEffect, useRef, useState } from "react"
import { useParams } from "next/navigation"
import { Fingerprint, HowToPair, PairButton, PairShell } from "@/components/pair-shell"
import { controlCenterUrl, isPairWorkerStatus, isPairingId, pairingScope, type PairState } from "@/lib/pair"
import {
  forgetPairing,
  pairStore,
  postToWorker,
  registerPairingWorker,
  serviceWorkersSupported,
} from "@/lib/pair-worker"

/** How often to ask the worker for its state. Each message also keeps a worker
 *  that would otherwise idle out alive while this page waits on it. */
const POLL_MS = 2_500

type View =
  | { state: "loading" }
  | { state: PairState; error?: { code: string; message: string } }
  | { state: "error"; error: { code: string; message: string } }

/** Only ever send the user back inside this pairing's own scope. */
function resolveNext(id: string, fromQuery: string | null, here: string | null): string {
  for (const candidate of [fromQuery, here]) {
    if (candidate && candidate.startsWith(pairingScope(id)) && !candidate.includes("//")) return candidate
  }
  return controlCenterUrl(id)
}

function isPairState(s: string | null): s is PairState {
  return s === "connecting" || s === "open" || s === "offline" || s === "revoked" || s === "not_paired"
}

/**
 * `/d/<id>` — the state page for one paired daemon: registers the pairing's
 * service worker, follows its tunnel state (the worker owns the one
 * connection; this page only asks it), and opens the Control Center as soon
 * as the tunnel is up. The worker sends the Control Center back here when
 * the daemon goes offline or revokes this device.
 *
 * Also catches `/d/<id>/…` loaded while no worker controls it (first visit on
 * a new tab, site data cleared): the worker is installed, then the same URL
 * is loaded again through it.
 */
export default function DaemonStatusPage(): React.ReactElement {
  const params = useParams<{ id: string; rest?: string[] }>()
  const id = params.id
  const deep = (params.rest?.length ?? 0) > 0
  const [view, setView] = useState<View>({ state: "loading" })
  const [name, setName] = useState<string | null>(null)
  const [fingerprint, setFingerprint] = useState<string | null>(null)
  const regRef = useRef<ServiceWorkerRegistration | null>(null)

  useEffect(() => {
    if (!isPairingId(id)) {
      setView({ state: "not_paired" })
      return
    }
    if (!serviceWorkersSupported()) {
      setView({ state: "error", error: { code: "unsupported", message: "This browser has no service workers." } })
      return
    }
    const search = new URLSearchParams(window.location.search)
    const hinted = search.get("state")
    if (isPairState(hinted)) setView({ state: hinted })
    const next = resolveNext(id, search.get("next"), deep ? window.location.pathname + window.location.search : null)

    let stopped = false
    let timer: ReturnType<typeof setInterval> | undefined
    const onMessage = (event: MessageEvent): void => {
      const status = event.data
      if (stopped || !isPairWorkerStatus(status) || status.id !== id) return
      if (status.daemonName) setName(status.daemonName)
      setView(status.error ? { state: status.state, error: status.error } : { state: status.state })
      if (status.state === "open") {
        stopped = true
        window.location.replace(next)
      }
    }
    const onOnline = (): void => {
      if (regRef.current) postToWorker(regRef.current, { type: "agentproto-pair:reconnect" })
    }
    navigator.serviceWorker.addEventListener("message", onMessage)
    window.addEventListener("online", onOnline)

    void (async () => {
      const credential = await pairStore().get(id)
      if (stopped) return
      if (!credential) {
        setView({ state: "not_paired" })
        return
      }
      setName(credential.name)
      setFingerprint(credential.fingerprint)
      const reg = await registerPairingWorker(id)
      if (stopped) return
      regRef.current = reg
      const poll = (): void => {
        postToWorker(reg, { type: "agentproto-pair:status" })
      }
      poll()
      timer = setInterval(poll, POLL_MS)
    })().catch(err => {
      if (!stopped) {
        setView({ state: "error", error: { code: "error", message: err instanceof Error ? err.message : String(err) } })
      }
    })

    return () => {
      stopped = true
      clearInterval(timer)
      navigator.serviceWorker.removeEventListener("message", onMessage)
      window.removeEventListener("online", onOnline)
    }
  }, [id, deep])

  const daemon = name ?? "your daemon"

  const forget = async () => {
    await forgetPairing(id)
    window.location.replace("/pair")
  }

  switch (view.state) {
    case "loading":
    case "connecting":
    case "closed":
      return (
        <PairShell eyebrow="paired · connecting" title={`Connecting to ${daemon}…`} tone="warn">
          {fingerprint && <Fingerprint value={fingerprint} />}
          <p>Opening the end-to-end tunnel through the rendezvous. The Control Center loads from the daemon itself.</p>
        </PairShell>
      )

    case "open":
      return (
        <PairShell eyebrow="connected" title={`Connected to ${daemon}`} tone="ok">
          <p>Opening the Control Center…</p>
        </PairShell>
      )

    case "offline":
      return (
        <PairShell eyebrow="daemon offline · retrying" title={`${daemon} is unreachable`} tone="danger">
          <p>
            Retrying on its own. Check that the computer is awake and the daemon is running (
            <code>agentproto serve</code>).
          </p>
          {view.error && <p className="break-words font-mono text-xs">{view.error.message}</p>}
          <PairButton
            variant="secondary"
            onClick={() => regRef.current && postToWorker(regRef.current, { type: "agentproto-pair:reconnect" })}
          >
            Retry now
          </PairButton>
        </PairShell>
      )

    case "revoked":
      return (
        <PairShell eyebrow="revoked" title={`This phone was unpaired from ${daemon}`} tone="danger">
          <p>The daemon revoked this device, so it can&apos;t reconnect. To use it again, pair from a new QR.</p>
          <HowToPair />
          <PairButton variant="danger" onClick={() => void forget()}>
            Forget this daemon
          </PairButton>
        </PairShell>
      )

    case "not_paired":
      return (
        <PairShell eyebrow="not paired" title="This phone isn't paired with that daemon">
          <HowToPair />
          <PairButton variant="secondary" onClick={() => window.location.assign("/pair")}>
            See paired daemons
          </PairButton>
        </PairShell>
      )

    case "error":
      return (
        <PairShell eyebrow="error" title="Couldn't start the Control Center" tone="danger">
          <p className="break-words font-mono text-xs">{view.error.message}</p>
        </PairShell>
      )
  }
}
