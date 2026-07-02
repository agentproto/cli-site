"use client"

import { useCallback, useEffect, useRef, useState } from "react"

const DEFAULT_PORT = 18790
/** Scan this many ports above DEFAULT_PORT when the default is not listening. */
const PORT_SCAN_RANGE = 6
const POLL_MS = 3_000
const PROBE_TIMEOUT_MS = 800
const REDISCOVERY_MS = 15_000

export interface DaemonSession {
  id: string
  kind: string
  workspaceSlug: string
  command: string
  status: "starting" | "running" | "exited" | "killed" | "error" | string
  startedAt: string
  endedAt?: string
  exitCode?: number
  pty?: boolean
  name?: string
  label?: string
  adapterSlug?: string
  adapterSessionId?: string
  cwd?: string
}

export interface DaemonHealth {
  status?: string
  workspace?: string
  uptimeMs?: number
}

export interface CreateTerminalParams {
  argv: string[]
  cwd?: string
  cols: number
  rows: number
  name?: string
  label?: string
}

export interface CreateTerminalResult {
  ok: true
  session: DaemonSession
}

export interface CreateTerminalError {
  ok: false
  error: string
}

export interface UseDaemonResult {
  url: string | null
  probing: boolean
  health: DaemonHealth | null
  sessions: DaemonSession[]
  error: string | null
  refresh(): Promise<void>
  killSession(id: string): Promise<boolean>
  createTerminalSession(params: CreateTerminalParams): Promise<CreateTerminalResult | CreateTerminalError>
}

export function useDaemon(port = DEFAULT_PORT): UseDaemonResult {
  const [url, setUrl] = useState<string | null>(null)
  const [probing, setProbing] = useState(true)
  const [health, setHealth] = useState<DaemonHealth | null>(null)
  const [sessions, setSessions] = useState<DaemonSession[]>([])
  const [error, setError] = useState<string | null>(null)
  const urlRef = useRef<string | null>(null)
  urlRef.current = url

  useEffect(() => {
    let cancelled = false
    let retryTimer: ReturnType<typeof setTimeout> | null = null

    const probeOne = async (candidate: string): Promise<DaemonHealth | null> => {
      try {
        const ctrl = new AbortController()
        const t = setTimeout(() => ctrl.abort(), PROBE_TIMEOUT_MS)
        const res = await fetch(`${candidate}/health`, {
          mode: "cors",
          credentials: "include",
          signal: ctrl.signal,
        })
        clearTimeout(t)
        if (!res.ok) return null
        return (await res.json()) as DaemonHealth
      } catch {
        return null
      }
    }

    /** Scan [port, port+1, …, port+PORT_SCAN_RANGE-1] in parallel, return the
     *  first that responds (lowest port wins on a tie). */
    const probe = async (): Promise<boolean> => {
      const ports = Array.from({ length: PORT_SCAN_RANGE }, (_, i) => port + i)
      const results = await Promise.all(
        ports.map(async (p) => ({ p, body: await probeOne(`http://127.0.0.1:${p}`) }))
      )
      const hit = results.find(r => r.body !== null)
      if (!hit || cancelled) return false
      setUrl(`http://127.0.0.1:${hit.p}`)
      setHealth(hit.body)
      setProbing(false)
      return true
    }

    void (async () => {
      setProbing(true)
      const found = await probe()
      if (cancelled) return
      if (!found) {
        setUrl(null)
        setHealth(null)
        setProbing(false)
        const tick = async () => {
          if (cancelled) return
          const ok = await probe()
          if (cancelled || ok) return
          retryTimer = setTimeout(tick, REDISCOVERY_MS)
        }
        retryTimer = setTimeout(tick, REDISCOVERY_MS)
      }
    })()

    return () => {
      cancelled = true
      if (retryTimer) clearTimeout(retryTimer)
    }
  }, [port])

  const refresh = useCallback(async (): Promise<void> => {
    const target = urlRef.current
    if (!target) return
    try {
      const res = await fetch(`${target}/sessions`, {
        mode: "cors",
        credentials: "include",
      })
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
      const body = (await res.json()) as { sessions?: DaemonSession[] }
      setSessions(Array.isArray(body.sessions) ? body.sessions : [])
      setError(null)
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    }
  }, [])

  const killSession = useCallback(
    async (id: string): Promise<boolean> => {
      const target = urlRef.current
      if (!target) return false
      try {
        const res = await fetch(`${target}/sessions/${id}/kill`, {
          method: "POST",
          mode: "cors",
          credentials: "include",
        })
        const body = (await res.json().catch(() => ({}))) as { ok?: boolean }
        if (body.ok) await refresh()
        return !!body.ok
      } catch {
        return false
      }
    },
    [refresh]
  )

  useEffect(() => {
    if (!url) return
    let cancelled = false
    let timer: ReturnType<typeof setTimeout> | null = null
    const tick = async () => {
      if (cancelled) return
      await refresh()
      if (cancelled) return
      timer = setTimeout(tick, POLL_MS)
    }
    void tick()
    return () => {
      cancelled = true
      if (timer) clearTimeout(timer)
    }
  }, [url, refresh])

  const createTerminalSession = useCallback(
    async (params: CreateTerminalParams): Promise<CreateTerminalResult | CreateTerminalError> => {
      const target = urlRef.current
      if (!target) return { ok: false, error: "daemon not connected" }
      try {
        const res = await fetch(`${target}/sessions/terminal`, {
          method: "POST",
          mode: "cors",
          credentials: "include",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(params),
        })
        if (res.status === 201) {
          const session = (await res.json()) as DaemonSession
          await refresh()
          return { ok: true, session }
        }
        const body = (await res.json().catch(() => ({}))) as { error?: string }
        return { ok: false, error: body.error ?? `HTTP ${res.status}` }
      } catch (e) {
        return { ok: false, error: e instanceof Error ? e.message : String(e) }
      }
    },
    [refresh]
  )

  return { url, probing, health, sessions, error, refresh, killSession, createTerminalSession }
}
