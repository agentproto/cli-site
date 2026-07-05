"use client"

import { useCallback, useEffect, useRef, useState } from "react"

const DEFAULT_PORT = 18790
/** Scan this many ports above DEFAULT_PORT when the default is not listening. */
const PORT_SCAN_RANGE = 6
const POLL_MS = 3_000
const PROBE_TIMEOUT_MS = 800
const REDISCOVERY_MS = 15_000
/** localStorage key holding an explicit (usually remote/tunnel) connection. */
const CONN_KEY = "agentproto.panel.connection"

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

/** An explicit connection target — a remote daemon reached over its tunnel
 *  (or any non-default local URL). `url` is always normalized to an http(s)
 *  base; `SessionTerminal` derives ws(s) from it. */
export interface DaemonConnection {
  url: string
  token?: string
}

export interface UseDaemonResult {
  url: string | null
  /** True when connected to an explicit (remote/tunnel) daemon rather than a
   *  locally auto-probed one. */
  remote: boolean
  /** Bearer token for the current connection, if any. Threaded into the PTY
   *  WebSocket + mutating POSTs; read-only GETs/SSE ride CORS ungated. */
  token: string | null
  probing: boolean
  health: DaemonHealth | null
  sessions: DaemonSession[]
  error: string | null
  refresh(): Promise<void>
  killSession(id: string): Promise<boolean>
  createTerminalSession(params: CreateTerminalParams): Promise<CreateTerminalResult | CreateTerminalError>
  /** Point the panel at an explicit daemon URL (a tunnel/remote or a custom
   *  local port). Persists to localStorage so a reload stays connected. */
  connect(input: { url: string; token?: string }): void
  /** Drop the explicit connection and fall back to localhost auto-probe. */
  disconnect(): void
}

/**
 * Normalize a user- or link-supplied daemon address into an http(s) base URL
 * (no trailing slash). Accepts ws/wss (the shape a PTY wsUrl is shown in) and
 * http/https; a bare host gets https:// (safer default for a public tunnel).
 * Returns null when the input can't be parsed as a URL/host.
 */
export function normalizeDaemonBase(input: string): string | null {
  const raw = input.trim()
  if (raw === "") return null
  let candidate = raw
  if (/^wss:\/\//i.test(candidate)) candidate = "https://" + candidate.slice(6)
  else if (/^ws:\/\//i.test(candidate)) candidate = "http://" + candidate.slice(5)
  else if (!/^https?:\/\//i.test(candidate)) candidate = "https://" + candidate
  try {
    const u = new URL(candidate)
    if (u.protocol !== "http:" && u.protocol !== "https:") return null
    // Preserve host + port; drop any path/query/hash — the daemon routes are
    // appended by callers (`${base}/sessions/...`).
    return `${u.protocol}//${u.host}`
  } catch {
    return null
  }
}

function readStoredConnection(): DaemonConnection | null {
  if (typeof window === "undefined") return null
  try {
    const raw = window.localStorage.getItem(CONN_KEY)
    if (!raw) return null
    const parsed = JSON.parse(raw) as Partial<DaemonConnection>
    if (typeof parsed.url !== "string") return null
    const base = normalizeDaemonBase(parsed.url)
    if (!base) return null
    return {
      url: base,
      ...(typeof parsed.token === "string" && parsed.token ? { token: parsed.token } : {}),
    }
  } catch {
    return null
  }
}

/**
 * Read a `?daemon=<url>&token=<token>` deep-link once on mount. The token is
 * stripped from the address bar immediately (history.replaceState) so it isn't
 * left in a shareable URL / browser history — the connection is held in state
 * + localStorage instead.
 */
function readLinkConnection(): DaemonConnection | null {
  if (typeof window === "undefined") return null
  const params = new URLSearchParams(window.location.search)
  const daemon = params.get("daemon")
  if (!daemon) return null
  const base = normalizeDaemonBase(daemon)
  if (!base) return null
  const token = params.get("token") ?? undefined
  // Scrub the token (and the now-consumed daemon param) from the URL.
  if (params.has("token") || params.has("daemon")) {
    params.delete("token")
    params.delete("daemon")
    const qs = params.toString()
    const next = window.location.pathname + (qs ? `?${qs}` : "") + window.location.hash
    try {
      window.history.replaceState(null, "", next)
    } catch {
      /* ignore */
    }
  }
  return { url: base, ...(token ? { token } : {}) }
}

export function useDaemon(port = DEFAULT_PORT): UseDaemonResult {
  const [url, setUrl] = useState<string | null>(null)
  const [remote, setRemote] = useState(false)
  const [token, setToken] = useState<string | null>(null)
  const [probing, setProbing] = useState(true)
  const [health, setHealth] = useState<DaemonHealth | null>(null)
  const [sessions, setSessions] = useState<DaemonSession[]>([])
  const [error, setError] = useState<string | null>(null)
  // The explicit connection, or null for localhost auto-probe. `undefined`
  // means "not yet resolved from link/localStorage" — the boot effect fills it.
  const [connection, setConnection] = useState<DaemonConnection | null | undefined>(undefined)

  const urlRef = useRef<string | null>(null)
  urlRef.current = url
  const tokenRef = useRef<string | null>(null)
  tokenRef.current = token

  const authHeaders = useCallback((): Record<string, string> => {
    const t = tokenRef.current
    return t ? { authorization: `Bearer ${t}` } : {}
  }, [])

  // Resolve the initial connection once: deep-link wins over stored, both win
  // over localhost auto-probe.
  useEffect(() => {
    setConnection(readLinkConnection() ?? readStoredConnection() ?? null)
  }, [])

  const connect = useCallback((input: { url: string; token?: string }) => {
    const base = normalizeDaemonBase(input.url)
    if (!base) {
      setError(`invalid daemon URL: ${input.url}`)
      return
    }
    const conn: DaemonConnection = {
      url: base,
      ...(input.token ? { token: input.token } : {}),
    }
    if (typeof window !== "undefined") {
      try {
        window.localStorage.setItem(CONN_KEY, JSON.stringify(conn))
      } catch {
        /* ignore quota/private-mode */
      }
    }
    setConnection(conn)
  }, [])

  const disconnect = useCallback(() => {
    if (typeof window !== "undefined") {
      try {
        window.localStorage.removeItem(CONN_KEY)
      } catch {
        /* ignore */
      }
    }
    setConnection(null)
  }, [])

  // Connect: either use the explicit connection or auto-probe localhost.
  useEffect(() => {
    if (connection === undefined) return // not resolved yet
    let cancelled = false
    let retryTimer: ReturnType<typeof setTimeout> | null = null

    const healthFetch = async (base: string, tok?: string): Promise<DaemonHealth | null> => {
      try {
        const ctrl = new AbortController()
        const t = setTimeout(() => ctrl.abort(), PROBE_TIMEOUT_MS)
        const res = await fetch(`${base}/health`, {
          mode: "cors",
          credentials: "include",
          headers: tok ? { authorization: `Bearer ${tok}` } : {},
          signal: ctrl.signal,
        })
        clearTimeout(t)
        if (!res.ok) return null
        return (await res.json()) as DaemonHealth
      } catch {
        return null
      }
    }

    // ── Explicit connection (remote/tunnel or custom local) ──────────────
    if (connection) {
      setRemote(true)
      setToken(connection.token ?? null)
      void (async () => {
        setProbing(true)
        const body = await healthFetch(connection.url, connection.token)
        if (cancelled) return
        if (body) {
          setUrl(connection.url)
          setHealth(body)
          setError(null)
        } else {
          setUrl(null)
          setHealth(null)
          setError(`could not reach daemon at ${connection.url}`)
        }
        setProbing(false)
      })()
      return () => {
        cancelled = true
      }
    }

    // ── localhost auto-probe (default) ───────────────────────────────────
    setRemote(false)
    setToken(null)
    const probe = async (): Promise<boolean> => {
      const ports = Array.from({ length: PORT_SCAN_RANGE }, (_, i) => port + i)
      const results = await Promise.all(
        ports.map(async (p) => ({ p, body: await healthFetch(`http://127.0.0.1:${p}`) }))
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
  }, [connection, port])

  const refresh = useCallback(async (): Promise<void> => {
    const target = urlRef.current
    if (!target) return
    try {
      const res = await fetch(`${target}/sessions`, {
        mode: "cors",
        credentials: "include",
        headers: authHeaders(),
      })
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
      const body = (await res.json()) as { sessions?: DaemonSession[] }
      setSessions(Array.isArray(body.sessions) ? body.sessions : [])
      setError(null)
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    }
  }, [authHeaders])

  const killSession = useCallback(
    async (id: string): Promise<boolean> => {
      const target = urlRef.current
      if (!target) return false
      try {
        const res = await fetch(`${target}/sessions/${id}/kill`, {
          method: "POST",
          mode: "cors",
          credentials: "include",
          headers: authHeaders(),
        })
        const body = (await res.json().catch(() => ({}))) as { ok?: boolean }
        if (body.ok) await refresh()
        return !!body.ok
      } catch {
        return false
      }
    },
    [refresh, authHeaders]
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
          headers: { "Content-Type": "application/json", ...authHeaders() },
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
    [refresh, authHeaders]
  )

  return {
    url,
    remote,
    token,
    probing,
    health,
    sessions,
    error,
    refresh,
    killSession,
    createTerminalSession,
    connect,
    disconnect,
  }
}
