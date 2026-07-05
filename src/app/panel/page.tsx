"use client"

import { useCallback, useEffect, useRef, useState } from "react"
import { useDaemon, type DaemonSession, type CreateTerminalParams, type UseDaemonResult } from "@/lib/use-daemon"
import { SessionTerminal } from "@/components/SessionTerminal"
import { SessionChatView, SessionJsonView } from "@/components/SessionChatView"
import { SessionEventsView } from "@/components/SessionEventsView"

type TabId = "terminal" | "chat" | "json" | "tty"

const STATUS_COLOR: Record<string, string> = {
  running: "#4ade80",
  starting: "#facc15",
  exited: "#6b7280",
  killed: "#f87171",
  error: "#f87171",
}

function StatusDot({ status }: { status: string }) {
  const color = STATUS_COLOR[status] ?? "#6b7280"
  return (
    <span
      style={{
        display: "inline-block",
        width: 7,
        height: 7,
        borderRadius: "50%",
        background: color,
        flexShrink: 0,
        ...(status === "running" || status === "starting"
          ? { boxShadow: `0 0 4px ${color}` }
          : {}),
      }}
    />
  )
}

function humanAge(iso: string): string {
  const ms = Date.now() - new Date(iso).getTime()
  if (ms < 60_000) return `${Math.floor(ms / 1000)}s`
  if (ms < 3_600_000) return `${Math.floor(ms / 60_000)}m`
  if (ms < 86_400_000) return `${Math.floor(ms / 3_600_000)}h`
  return `${Math.floor(ms / 86_400_000)}d`
}

// ---------------------------------------------------------------------------
// Terminal Launcher
// ---------------------------------------------------------------------------

function TerminalLauncher({
  onCreate,
}: {
  onCreate: (params: CreateTerminalParams) => Promise<{ ok: true; session: DaemonSession } | { ok: false; error: string }>
}) {
  const [open, setOpen] = useState(false)
  const [cmd, setCmd] = useState("zsh")
  const [cwd, setCwd] = useState("")
  const [launching, setLaunching] = useState(false)
  const [err, setErr] = useState<string | null>(null)
  const cmdRef = useRef<HTMLInputElement | null>(null)

  const launch = async () => {
    const argv = cmd.trim().split(/\s+/).filter(s => s.length > 0)
    if (argv.length === 0) return
    setLaunching(true)
    setErr(null)
    const result = await onCreate({
      argv,
      cols: 120,
      rows: 32,
      ...(cwd.trim() ? { cwd: cwd.trim() } : {}),
    })
    setLaunching(false)
    if (result.ok) {
      setOpen(false)
      setCmd("zsh")
      setCwd("")
    } else {
      setErr(result.error)
    }
  }

  const onKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "Enter") { e.preventDefault(); void launch() }
    if (e.key === "Escape") { setOpen(false); setErr(null) }
  }

  useEffect(() => {
    if (open) { setTimeout(() => cmdRef.current?.focus(), 0) }
  }, [open])

  return (
    <div style={{ borderBottom: "1px solid #1a1a1a", flexShrink: 0 }}>
      {/* Trigger button */}
      <div style={{ padding: "6px 10px" }}>
        <button
          onClick={() => { setOpen(o => !o); setErr(null) }}
          style={{
            display: "flex",
            alignItems: "center",
            gap: 4,
            background: "none",
            border: "1px solid #2a2a2a",
            borderRadius: 4,
            color: "#6b7280",
            fontFamily: "ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace",
            fontSize: 10,
            padding: "3px 8px",
            cursor: "pointer",
            width: "100%",
            justifyContent: "center",
          }}
        >
          <span style={{ color: "#4ade80", fontSize: 12, lineHeight: 1 }}>+</span>
          <span>terminal</span>
        </button>
      </div>

      {/* Inline form */}
      {open && (
        <div
          style={{
            padding: "6px 10px 10px",
            display: "flex",
            flexDirection: "column",
            gap: 5,
          }}
        >
          <div style={{ color: "#4b5563", fontSize: 10, marginBottom: 2 }}>command</div>
          <input
            ref={cmdRef}
            value={cmd}
            onChange={e => setCmd(e.target.value)}
            onKeyDown={onKeyDown}
            placeholder="zsh"
            style={{
              background: "#111",
              border: "1px solid #2a2a2a",
              borderRadius: 4,
              color: "#e8e8e8",
              fontFamily: "ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace",
              fontSize: 11,
              padding: "4px 7px",
              outline: "none",
              width: "100%",
              boxSizing: "border-box",
            }}
          />
          <div style={{ color: "#4b5563", fontSize: 10 }}>cwd (optional)</div>
          <input
            value={cwd}
            onChange={e => setCwd(e.target.value)}
            onKeyDown={onKeyDown}
            placeholder="~/projects/foo"
            style={{
              background: "#111",
              border: "1px solid #2a2a2a",
              borderRadius: 4,
              color: "#e8e8e8",
              fontFamily: "ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace",
              fontSize: 11,
              padding: "4px 7px",
              outline: "none",
              width: "100%",
              boxSizing: "border-box",
            }}
          />
          {err && (
            <div style={{ color: "#f87171", fontSize: 10, wordBreak: "break-word" }}>{err}</div>
          )}
          <div style={{ display: "flex", gap: 5, marginTop: 2 }}>
            <button
              onClick={() => void launch()}
              disabled={launching || cmd.trim() === ""}
              style={{
                flex: 1,
                background: launching || cmd.trim() === "" ? "#1a1a1a" : "#0e2233",
                border: `1px solid ${launching || cmd.trim() === "" ? "#2a2a2a" : "#22d3ee40"}`,
                borderRadius: 4,
                color: launching || cmd.trim() === "" ? "#4b5563" : "#22d3ee",
                fontFamily: "ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace",
                fontSize: 11,
                padding: "4px 0",
                cursor: launching || cmd.trim() === "" ? "not-allowed" : "pointer",
              }}
            >
              {launching ? "launching…" : "launch"}
            </button>
            <button
              onClick={() => { setOpen(false); setErr(null) }}
              style={{
                background: "none",
                border: "1px solid #2a2a2a",
                borderRadius: 4,
                color: "#6b7280",
                fontFamily: "ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace",
                fontSize: 11,
                padding: "4px 10px",
                cursor: "pointer",
              }}
            >
              cancel
            </button>
          </div>
        </div>
      )}
    </div>
  )
}

// ---------------------------------------------------------------------------
// TTY Tab
// ---------------------------------------------------------------------------

/** Maps adapterSlug → a function that builds argv given the adapterSessionId. */
const RESUME_MAP: Record<string, (adapterSessionId: string) => string[]> = {
  "claude-code": (sid) => ["claude", "--resume", sid],
  "hermes":      (sid) => ["hermes", "--resume", sid],
}

function resolveResume(
  adapterSlug: string | undefined,
  adapterSessionId: string | undefined,
): { argv: string[] } | { disabled: true; reason: string } {
  if (!adapterSlug || !adapterSessionId) {
    return { disabled: true, reason: "no resume support (missing adapterSlug / adapterSessionId)" }
  }
  const builder = RESUME_MAP[adapterSlug]
  if (!builder) {
    return { disabled: true, reason: `no TUI resume mapping for "${adapterSlug}"` }
  }
  return { argv: builder(adapterSessionId) }
}

function TtyTabContent({
  daemonUrl,
  token,
  session,
  onCreate,
  onCreated,
}: {
  daemonUrl: string
  token?: string
  session: DaemonSession
  onCreate: (params: CreateTerminalParams) => Promise<{ ok: true; session: DaemonSession } | { ok: false; error: string }>
  onCreated: (newSessionId: string) => void
}) {
  const [launching, setLaunching] = useState(false)
  const [err, setErr] = useState<string | null>(null)

  // PTY sessions: just render the terminal directly
  if (session.pty === true) {
    return (
      <SessionTerminal
        key={session.id}
        daemonUrl={daemonUrl}
        sessionId={session.id}
        pty={true}
        token={token}
      />
    )
  }

  // Agent (non-PTY) sessions: show explainer + resume button
  const resume = resolveResume(session.adapterSlug, session.adapterSessionId)
  const disabled = "disabled" in resume

  const handleResume = async () => {
    if (disabled) return
    setLaunching(true)
    setErr(null)
    const result = await onCreate({
      argv: resume.argv,
      cols: 220,
      rows: 50,
      ...(session.cwd ? { cwd: session.cwd } : {}),
      label: `tui · ${session.label ?? session.adapterSlug ?? session.id.slice(0, 8)}`,
    })
    setLaunching(false)
    if (result.ok) {
      onCreated(result.session.id)
    } else {
      setErr(result.error)
    }
  }

  const mono: React.CSSProperties = {
    fontFamily: "ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace",
  }

  return (
    <div
      style={{
        flex: 1,
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        padding: 32,
      }}
    >
      <div
        style={{
          maxWidth: 480,
          width: "100%",
          border: "1px solid #222",
          borderRadius: 8,
          padding: "24px 28px",
          background: "#0e0e10",
          display: "flex",
          flexDirection: "column",
          gap: 16,
        }}
      >
        {/* Header */}
        <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
          <span style={{ fontSize: 18, lineHeight: 1 }}>⌨</span>
          <span style={{ ...mono, fontSize: 13, color: "#e8e8e8", fontWeight: 700 }}>
            Open real TUI
          </span>
        </div>

        {/* Explainer */}
        <p style={{ ...mono, fontSize: 11, color: "#9ca3af", margin: 0, lineHeight: 1.6 }}>
          This is an agent session — it has no TTY of its own. Clicking below spawns the
          adapter&apos;s own CLI resumed on this conversation as a new interactive PTY session.
        </p>

        {/* Session info */}
        <div
          style={{
            background: "#111",
            border: "1px solid #1a1a1a",
            borderRadius: 4,
            padding: "8px 12px",
            display: "flex",
            flexDirection: "column",
            gap: 4,
          }}
        >
          {[
            ["adapter", session.adapterSlug ?? "—"],
            ["session id", session.adapterSessionId ?? "—"],
            ["cwd", session.cwd ?? "—"],
          ].map(([k, v]) => (
            <div key={k} style={{ display: "flex", gap: 8 }}>
              <span style={{ ...mono, fontSize: 10, color: "#4b5563", width: 80, flexShrink: 0 }}>{k}</span>
              <span
                style={{
                  ...mono,
                  fontSize: 10,
                  color: "#9ca3af",
                  overflow: "hidden",
                  textOverflow: "ellipsis",
                  whiteSpace: "nowrap",
                }}
              >
                {v}
              </span>
            </div>
          ))}
          {!disabled && (
            <div style={{ display: "flex", gap: 8, marginTop: 2 }}>
              <span style={{ ...mono, fontSize: 10, color: "#4b5563", width: 80, flexShrink: 0 }}>argv</span>
              <span style={{ ...mono, fontSize: 10, color: "#22d3ee" }}>
                {resume.argv.join(" ")}
              </span>
            </div>
          )}
        </div>

        {/* Disabled reason */}
        {disabled && (
          <div
            style={{
              ...mono,
              fontSize: 10,
              color: "#f87171",
              background: "#1a0a0a",
              border: "1px solid #3a1a1a",
              borderRadius: 4,
              padding: "6px 10px",
            }}
          >
            {resume.reason}
          </div>
        )}

        {/* Error */}
        {err && (
          <div
            style={{
              ...mono,
              fontSize: 10,
              color: "#f87171",
              wordBreak: "break-word",
            }}
          >
            {err}
          </div>
        )}

        {/* Launch button */}
        <button
          onClick={() => void handleResume()}
          disabled={disabled || launching}
          style={{
            ...mono,
            fontSize: 12,
            padding: "8px 16px",
            borderRadius: 4,
            border: `1px solid ${disabled || launching ? "#2a2a2a" : "#22d3ee40"}`,
            background: disabled || launching ? "#1a1a1a" : "#0e2233",
            color: disabled || launching ? "#4b5563" : "#22d3ee",
            cursor: disabled || launching ? "not-allowed" : "pointer",
            alignSelf: "flex-start",
          }}
        >
          {launching ? "spawning…" : "↗ open TUI session"}
        </button>
      </div>
    </div>
  )
}

// ---------------------------------------------------------------------------
// ConnectBar — status + connect-to-remote-daemon control
// ---------------------------------------------------------------------------

function stripScheme(u: string): string {
  return u.replace(/^https?:\/\//, "").replace(/^wss?:\/\//, "")
}

function ConnectBar({ daemon }: { daemon: UseDaemonResult }) {
  const [formOpen, setFormOpen] = useState(false)
  const [urlInput, setUrlInput] = useState("")
  const [tokenInput, setTokenInput] = useState("")
  const [copied, setCopied] = useState(false)

  const submit = () => {
    if (!urlInput.trim()) return
    daemon.connect({ url: urlInput.trim(), ...(tokenInput.trim() ? { token: tokenInput.trim() } : {}) })
    setFormOpen(false)
    setUrlInput("")
    setTokenInput("")
  }

  // Shareable deep-link: the tunnel wss origin, no token (auth rides the
  // trusted panel Origin). Opening it on another machine auto-connects.
  const shareLink = (): string => {
    if (typeof window === "undefined" || !daemon.url) return ""
    const wss = daemon.url.replace(/^http/, "ws")
    return `${window.location.origin}/panel?daemon=${encodeURIComponent(wss)}`
  }

  const copyLink = async () => {
    const link = shareLink()
    if (!link) return
    try {
      await navigator.clipboard.writeText(link)
      setCopied(true)
      setTimeout(() => setCopied(false), 1500)
    } catch {
      /* clipboard blocked — ignore */
    }
  }

  const btn: React.CSSProperties = {
    fontSize: 10,
    padding: "2px 8px",
    border: "1px solid #333",
    borderRadius: 4,
    background: "transparent",
    color: "#9ca3af",
    cursor: "pointer",
    fontFamily: "inherit",
  }
  const input: React.CSSProperties = {
    fontSize: 11,
    padding: "3px 7px",
    border: "1px solid #333",
    borderRadius: 4,
    background: "#0e0e10",
    color: "#e8e8e8",
    fontFamily: "inherit",
    outline: "none",
  }

  return (
    <div style={{ marginLeft: "auto", display: "flex", alignItems: "center", gap: 8, position: "relative" }}>
      {daemon.probing && <span style={{ color: "#6b7280" }}>connecting…</span>}

      {!daemon.probing && daemon.url && (
        <>
          <span style={{ color: "#4ade80", fontSize: 10 }}>● live</span>
          <span
            style={{
              fontSize: 9,
              padding: "1px 5px",
              borderRadius: 3,
              border: `1px solid ${daemon.remote ? "#22d3ee40" : "#4ade8040"}`,
              color: daemon.remote ? "#22d3ee" : "#4ade80",
            }}
            title={daemon.remote ? "remote daemon via tunnel" : "local daemon on this machine"}
          >
            {daemon.remote ? "remote" : "local"}
          </span>
          <span style={{ color: "#6b7280", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", maxWidth: 260 }}>
            {stripScheme(daemon.url)}
          </span>
          {daemon.health?.workspace && (
            <span style={{ color: "#6b7280", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", maxWidth: 220 }}>
              · {daemon.health.workspace.split("/").slice(-2).join("/")}
            </span>
          )}
          {daemon.remote && (
            <button style={btn} onClick={copyLink} title="Copy a shareable link to this daemon">
              {copied ? "copied ✓" : "copy link"}
            </button>
          )}
          {daemon.remote && (
            <button style={btn} onClick={daemon.disconnect} title="Disconnect and fall back to the local daemon">
              use local
            </button>
          )}
        </>
      )}

      {!daemon.probing && !daemon.url && (
        <span style={{ color: "#f87171", fontSize: 11 }}>
          {daemon.remote
            ? `unreachable${daemon.error ? ` · ${daemon.error}` : ""}`
            : "no local daemon · agentproto serve"}
        </span>
      )}

      <button style={btn} onClick={() => setFormOpen(o => !o)}>
        {formOpen ? "close" : "connect ▾"}
      </button>

      {formOpen && (
        <div
          style={{
            position: "absolute",
            top: "calc(100% + 6px)",
            right: 0,
            zIndex: 20,
            width: 340,
            padding: 12,
            border: "1px solid #333",
            borderRadius: 8,
            background: "#0e0e10",
            boxShadow: "0 8px 24px rgba(0,0,0,0.5)",
            display: "flex",
            flexDirection: "column",
            gap: 8,
          }}
        >
          <div style={{ color: "#9ca3af", fontSize: 10 }}>
            Connect to a remote daemon over its tunnel (wss/https). Token is optional —
            the hosted panel is a trusted origin.
          </div>
          <input
            style={input}
            placeholder="wss://agentproto-local.example.com"
            value={urlInput}
            onChange={e => setUrlInput(e.target.value)}
            onKeyDown={e => { if (e.key === "Enter") submit() }}
            autoFocus
            spellCheck={false}
          />
          <input
            style={input}
            placeholder="token (optional)"
            value={tokenInput}
            onChange={e => setTokenInput(e.target.value)}
            onKeyDown={e => { if (e.key === "Enter") submit() }}
            type="password"
            spellCheck={false}
          />
          <div style={{ display: "flex", gap: 8, justifyContent: "flex-end" }}>
            <button style={btn} onClick={() => setFormOpen(false)}>cancel</button>
            <button
              style={{ ...btn, borderColor: "#22d3ee40", color: "#22d3ee" }}
              onClick={submit}
              disabled={!urlInput.trim()}
            >
              connect
            </button>
          </div>
        </div>
      )}
    </div>
  )
}

// ---------------------------------------------------------------------------
// PanelPage
// ---------------------------------------------------------------------------

export default function PanelPage() {
  const daemon = useDaemon()
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [tab, setTab] = useState<TabId>("chat")
  // When true, the /events endpoint returned 404 for this session — fall back to export polling.
  const [chatFallback, setChatFallback] = useState(false)

  const selected = daemon.sessions.find(s => s.id === selectedId) ?? null

  // Auto-select first session when list loads and nothing is selected yet
  useEffect(() => {
    if (!selectedId && daemon.sessions.length > 0) {
      setSelectedId(daemon.sessions[0]!.id)
    }
  }, [daemon.sessions, selectedId])

  // Default tab: Terminal for PTY sessions, Chat for others. Reset fallback on session change.
  useEffect(() => {
    if (selected) {
      setTab(selected.pty === true ? "terminal" : "chat")
      setChatFallback(false)
    }
  }, [selected?.id]) // eslint-disable-line react-hooks/exhaustive-deps

  const handleEventsNotSupported = useCallback(() => setChatFallback(true), [])

  const handleCreateTerminal = async (params: CreateTerminalParams) => {
    const result = await daemon.createTerminalSession(params)
    if (result.ok) {
      setSelectedId(result.session.id)
      setTab("terminal")
    }
    return result
  }

  const handleTtyCreated = useCallback((newSessionId: string) => {
    setSelectedId(newSessionId)
    setTab("tty")
  }, [])

  return (
    <div
      style={{
        display: "flex",
        flexDirection: "column",
        height: "100vh",
        background: "#0b0b0d",
        color: "#e8e8e8",
        fontFamily: "ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace",
        fontSize: 12,
      }}
    >
      {/* Header */}
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: 12,
          padding: "8px 16px",
          borderBottom: "1px solid #222",
          flexShrink: 0,
        }}
      >
        <span style={{ fontWeight: 700, color: "#22d3ee", letterSpacing: "-0.01em" }}>
          agentproto
        </span>
        <span style={{ color: "#6b7280" }}>sessions</span>

        <ConnectBar daemon={daemon} />
      </div>

      {/* Body */}
      <div style={{ display: "flex", flex: 1, minHeight: 0 }}>
        {/* Sidebar */}
        <div
          style={{
            width: 260,
            borderRight: "1px solid #222",
            display: "flex",
            flexDirection: "column",
            flexShrink: 0,
            overflowY: "auto",
          }}
        >
          {/* Launcher — only shown when daemon is connected */}
          {daemon.url && (
            <TerminalLauncher onCreate={handleCreateTerminal} />
          )}

          {daemon.sessions.length === 0 && daemon.url && (
            <div style={{ padding: "16px 12px", color: "#6b7280" }}>
              No sessions.{"\n"}Run{" "}
              <code style={{ color: "#e8e8e8" }}>agentproto run claude-code</code>
              {" "}to start one.
            </div>
          )}

          {daemon.sessions.map(s => (
            <SessionRow
              key={s.id}
              session={s}
              selected={s.id === selectedId}
              onSelect={() => setSelectedId(s.id)}
              onKill={() => void daemon.killSession(s.id)}
            />
          ))}
        </div>

        {/* Main pane */}
        <div style={{ flex: 1, minWidth: 0, minHeight: 0, display: "flex", flexDirection: "column" }}>
          {!daemon.url && !daemon.probing ? (
            <div style={{ display: "flex", alignItems: "center", justifyContent: "center", flex: 1, color: "#6b7280" }}>
              <div style={{ textAlign: "center", lineHeight: 2 }}>
                <div style={{ color: "#22d3ee", fontWeight: 700, fontSize: 14 }}>agentproto daemon not detected</div>
                <div>Start it with:</div>
                <code style={{ color: "#e8e8e8" }}>agentproto serve</code>
                <div style={{ marginTop: 8, fontSize: 10 }}>Scanning ports 18790–18795 · auto-connects when the daemon starts</div>
              </div>
            </div>
          ) : selected ? (
            <>
              {/* Tab bar */}
              <div
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: 0,
                  borderBottom: "1px solid #222",
                  flexShrink: 0,
                  paddingLeft: 8,
                }}
              >
                {(["terminal", "chat", "json", "tty"] as TabId[]).map(t => (
                  <button
                    key={t}
                    onClick={() => setTab(t)}
                    style={{
                      background: "none",
                      border: "none",
                      borderBottom: tab === t ? "2px solid #22d3ee" : "2px solid transparent",
                      color: tab === t ? "#e8e8e8" : "#6b7280",
                      fontFamily: "ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace",
                      fontSize: 11,
                      padding: "6px 12px",
                      cursor: "pointer",
                      marginBottom: -1,
                      textTransform: "uppercase",
                      letterSpacing: "0.05em",
                    }}
                  >
                    {t}
                  </button>
                ))}
              </div>

              {/* Tab content */}
              <div style={{ flex: 1, minHeight: 0, display: "flex", flexDirection: "column" }}>
                {tab === "terminal" && (
                  <SessionTerminal
                    key={selected.id}
                    daemonUrl={daemon.url!}
                    sessionId={selected.id}
                    pty={selected.pty === true}
                    token={daemon.token ?? undefined}
                  />
                )}
                {tab === "chat" && (
                  chatFallback ? (
                    <SessionChatView
                      key={selected.id}
                      daemonUrl={daemon.url!}
                      sessionId={selected.id}
                      sessionStatus={selected.status}
                    />
                  ) : (
                    <SessionEventsView
                      key={selected.id}
                      daemonUrl={daemon.url!}
                      sessionId={selected.id}
                      sessionStatus={selected.status}
                      onNotSupported={handleEventsNotSupported}
                    />
                  )
                )}
                {tab === "json" && (
                  <SessionJsonView
                    key={selected.id}
                    daemonUrl={daemon.url!}
                    sessionId={selected.id}
                    sessionStatus={selected.status}
                  />
                )}
                {tab === "tty" && (
                  <TtyTabContent
                    key={selected.id}
                    daemonUrl={daemon.url!}
                    token={daemon.token ?? undefined}
                    session={selected}
                    onCreate={daemon.createTerminalSession}
                    onCreated={handleTtyCreated}
                  />
                )}
              </div>
            </>
          ) : (
            <div style={{ display: "flex", alignItems: "center", justifyContent: "center", flex: 1, color: "#6b7280" }}>
              Select a session
            </div>
          )}
        </div>
      </div>
    </div>
  )
}

function SessionRow({
  session,
  selected,
  onSelect,
  onKill,
}: {
  session: DaemonSession
  selected: boolean
  onSelect: () => void
  onKill: () => void
}) {
  const canKill = session.status === "running" || session.status === "starting"
  const label = session.label ?? session.name ?? session.adapterSlug ?? session.kind
  return (
    <div
      onClick={onSelect}
      style={{
        display: "flex",
        flexDirection: "column",
        gap: 3,
        padding: "8px 12px",
        cursor: "pointer",
        borderBottom: "1px solid #1a1a1a",
        background: selected ? "#111" : "transparent",
        transition: "background 0.1s",
      }}
    >
      <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
        <StatusDot status={session.status} />
        <span style={{ flex: 1, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", color: "#e8e8e8" }}>
          {label}
        </span>
        {session.pty && (
          <span style={{ fontSize: 9, padding: "1px 4px", border: "1px solid #4ade8040", color: "#4ade80", borderRadius: 3 }}>
            PTY
          </span>
        )}
        {canKill && (
          <button
            onClick={e => { e.stopPropagation(); onKill() }}
            style={{
              fontSize: 9,
              padding: "1px 5px",
              border: "1px solid #f8717140",
              color: "#f87171",
              borderRadius: 3,
              background: "transparent",
              cursor: "pointer",
            }}
          >
            kill
          </button>
        )}
      </div>
      <div style={{ display: "flex", alignItems: "center", gap: 6, color: "#6b7280" }}>
        <span style={{ fontSize: 10, fontFamily: "monospace", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
          {session.id}
        </span>
        <span style={{ marginLeft: "auto", flexShrink: 0, fontSize: 10 }}>
          {humanAge(session.startedAt)}
        </span>
      </div>
      <div style={{ color: "#6b7280", fontSize: 10, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
        {session.command}
      </div>
    </div>
  )
}
