"use client"

/**
 * SessionTerminal — xterm panel for a local-daemon session.
 * Adapted from guilde's LocalSessionTerminal (same xterm.js lib, same WS/SSE
 * protocol). Two transports chosen by the session's `pty` flag:
 *   - PTY (pty:true): WS /sessions/:id/pty — raw bytes, duplex
 *   - SSE (default):  EventSource /sessions/:id/stream — line-by-line, read-only
 */

import { useEffect, useRef } from "react"
import type { Terminal as XTerminal } from "@xterm/xterm"
import type { FitAddon as FitAddonType } from "@xterm/addon-fit"
import "@xterm/xterm/css/xterm.css"
import { cn } from "@/lib/utils"

interface Props {
  daemonUrl: string
  sessionId: string
  pty?: boolean
  token?: string
  className?: string
}

export function SessionTerminal({ daemonUrl, sessionId, pty, token, className }: Props) {
  const containerRef = useRef<HTMLDivElement | null>(null)
  const termRef = useRef<XTerminal | null>(null)
  const fitRef = useRef<FitAddonType | null>(null)

  // Boot xterm once. Re-create when pty flag flips (disableStdin can't change at runtime).
  useEffect(() => {
    let cancelled = false
    let ro: ResizeObserver | null = null

    void (async () => {
      const [{ Terminal }, { FitAddon }] = await Promise.all([
        import("@xterm/xterm"),
        import("@xterm/addon-fit"),
      ])
      if (cancelled || !containerRef.current) return
      const term = new Terminal({
        fontSize: 12,
        fontFamily: "ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace",
        scrollback: 5000,
        convertEol: !pty,
        disableStdin: !pty,
        theme: { background: "#0b0b0d", foreground: "#e8e8e8", cursor: "#777" },
      })
      const fit = new FitAddon()
      term.loadAddon(fit)
      term.open(containerRef.current)
      fit.fit()
      term.scrollToBottom()

      const fitSafe = () => {
        try {
          const wasAtBottom = term.buffer.active.viewportY === term.buffer.active.baseY
          fit.fit()
          if (wasAtBottom) term.scrollToBottom()
        } catch { /* ignore */ }
      }

      ro = new ResizeObserver(fitSafe)
      ro.observe(containerRef.current)
      window.addEventListener("resize", fitSafe)

      termRef.current = term
      fitRef.current = fit

      return () => {
        window.removeEventListener("resize", fitSafe)
      }
    })()

    return () => {
      cancelled = true
      ro?.disconnect()
      termRef.current?.dispose()
      termRef.current = null
      fitRef.current = null
    }
  }, [pty])

  // Stream: SSE or WS per session. Reset xterm on session change.
  useEffect(() => {
    if (!sessionId || !daemonUrl) return
    let cancelled = false
    let cleanup: (() => void) | null = null
    let retryTimer: ReturnType<typeof setTimeout> | null = null

    const start = () => {
      if (cancelled) return
      const term = termRef.current
      if (!term) {
        retryTimer = setTimeout(start, 50)
        return
      }
      term.clear()
      cleanup = pty
        ? attachPty({ term, fit: fitRef.current, daemonUrl, sessionId, token })
        : attachSse({ term, daemonUrl, sessionId, token })
    }

    start()
    return () => {
      cancelled = true
      if (retryTimer) clearTimeout(retryTimer)
      cleanup?.()
    }
  }, [daemonUrl, sessionId, pty, token])

  return (
    <div
      className={cn("flex-1", className)}
      style={{ background: "#0b0b0d", display: "flex", flex: 1, minHeight: 0, padding: "6px", overflow: "hidden" }}
    >
      <div ref={containerRef} style={{ flex: 1, minWidth: 0, minHeight: 0, overflow: "hidden" }} />
    </div>
  )
}

function attachPty({
  term,
  fit,
  daemonUrl,
  sessionId,
  token,
}: {
  term: XTerminal
  fit: FitAddonType | null
  daemonUrl: string
  sessionId: string
  token?: string
}): () => void {
  const wsBase = daemonUrl.replace(/^http/, "ws")
  let active = true
  let ws: WebSocket | null = null
  let offData: { dispose(): void } | null = null
  let offResize: { dispose(): void } | null = null
  let attempts = 0
  let exited = false
  const MAX = 6

  const connect = (isReconnect: boolean) => {
    if (!active) return
    const cols = term.cols || 80
    const rows = term.rows || 24
    const qs = new URLSearchParams({ cols: String(cols), rows: String(rows) })
    if (token) qs.set("token", token)
    const sock = new WebSocket(
      `${wsBase}/sessions/${encodeURIComponent(sessionId)}/pty?${qs}`
    )
    ws = sock

    try { offData?.dispose() } catch { /* ignore */ }
    try { offResize?.dispose() } catch { /* ignore */ }

    offData = term.onData(chunk => {
      if (!active || sock.readyState !== WebSocket.OPEN) return
      const bytes = new TextEncoder().encode(chunk)
      sock.send(JSON.stringify({ kind: "input", b64: bufToB64(bytes) }))
    })

    const sendResize = () => {
      if (sock.readyState !== WebSocket.OPEN) return
      try { fit?.fit() } catch { /* ignore */ }
      sock.send(JSON.stringify({ kind: "resize", cols: term.cols, rows: term.rows }))
    }
    offResize = term.onResize(() => sendResize())

    sock.addEventListener("open", () => {
      attempts = 0
      const d = "\x1b[2m", r = "\x1b[0m", b = "\x1b[1;36m"
      if (isReconnect) {
        term.writeln(`${d}── ${r}${b}agentproto${r}${d} · reattached ────────────${r}`)
      } else {
        term.writeln(`${d}┌─ ${r}${b}agentproto${r}${d} ─────────────────────────${r}`)
        term.writeln(`${d}│  session  ${r}${sessionId}`)
        term.writeln(`${d}│  via      ${r}PTY · ${daemonUrl}`)
        term.writeln(`${d}└────────────────────────────────────${r}\r\n`)
      }
      sendResize()
    })

    sock.addEventListener("message", ev => {
      let f: unknown
      try { f = JSON.parse(typeof ev.data === "string" ? ev.data : new TextDecoder().decode(ev.data as ArrayBuffer)) }
      catch { return }
      if (!f || typeof f !== "object") return
      const frame = f as Record<string, unknown>
      if (frame.kind === "data" && typeof frame.b64 === "string") {
        try { term.write(b64ToString(frame.b64)) } catch { /* ignore */ }
      } else if (frame.kind === "exit") {
        exited = true
        const code = typeof frame.exitCode === "number" ? frame.exitCode : 0
        term.writeln(`\r\n\x1b[2m── session exited (code ${code}) ──\x1b[0m`)
      }
    })

    sock.addEventListener("close", ev => {
      if (!active || exited) return
      attempts++
      if (attempts > MAX) {
        term.writeln(`\r\n\x1b[2m── stream interrupted — gave up after ${MAX} attempts ──\x1b[0m`)
        return
      }
      const delay = Math.min(1000 * 2 ** (attempts - 1), 15_000)
      term.writeln(`\r\n\x1b[2m── reconnecting in ${Math.round(delay / 1000)}s (${attempts}/${MAX})… ──\x1b[0m`)
      setTimeout(() => connect(true), delay)
    })
  }

  connect(false)

  return () => {
    active = false
    try { offData?.dispose() } catch { /* ignore */ }
    try { offResize?.dispose() } catch { /* ignore */ }
    try { ws?.close(1000, "unmount") } catch { /* ignore */ }
  }
}

function attachSse({
  term,
  daemonUrl,
  sessionId,
  token,
}: {
  term: XTerminal
  daemonUrl: string
  sessionId: string
  token?: string
}): () => void {
  const dim = "\x1b[2m", reset = "\x1b[0m"
  term.writeln(`${dim}── attached to ${sessionId} (${daemonUrl}) ──${reset}`)
  // The SSE stream is read-only and ungated, so a token isn't required — but
  // an EventSource can't set an Authorization header, so we thread it via the
  // query string (same `?token=` the WS path uses) to stay correct if a daemon
  // ever gates the stream.
  const streamQs = token ? `?token=${encodeURIComponent(token)}` : ""
  const src = new EventSource(
    `${daemonUrl}/sessions/${encodeURIComponent(sessionId)}/stream${streamQs}`,
    { withCredentials: true }
  )
  src.onmessage = ev => {
    try {
      const j = JSON.parse(ev.data) as { line?: string; stream?: string }
      if (typeof j.line !== "string") return
      if (j.stream === "stderr") {
        term.writeln(`\x1b[31m${j.line}\x1b[0m`)
      } else {
        term.writeln(j.line)
      }
    } catch { /* ignore */ }
  }
  src.onerror = () => {
    term.writeln(`\x1b[2m── stream interrupted (session ended or daemon stopped) ──\x1b[0m`)
  }
  return () => src.close()
}

function bufToB64(bytes: Uint8Array): string {
  let bin = ""
  const chunk = 0x8000
  for (let i = 0; i < bytes.byteLength; i += chunk)
    bin += String.fromCharCode(...bytes.subarray(i, i + chunk))
  return btoa(bin)
}

function b64ToString(b64: string): string {
  const bin = atob(b64)
  const out = new Uint8Array(bin.length)
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i)
  return new TextDecoder().decode(out)
}
