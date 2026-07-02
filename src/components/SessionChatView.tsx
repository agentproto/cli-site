"use client"

import { useCallback, useEffect, useMemo, useRef, useState } from "react"
import ReactMarkdown from "react-markdown"
import remarkGfm from "remark-gfm"

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface ExportedMessage {
  role: "user" | "assistant" | "tool" | "system"
  text?: string
  reasoning?: string
  toolName?: string
  toolCalls?: { name: string; args: string }[]
  ts?: number
}

interface TranscriptMeta {
  title?: string
  model?: string
  startedAt?: string
  endedAt?: string
  messageCount?: number
  toolCallCount?: number
  costUsd?: number
  source?: string
}

interface ParsedContent {
  meta: TranscriptMeta
  messages: ExportedMessage[]
}

interface ExportResponse {
  sessionId: string
  adapter: string
  format: string
  meta: TranscriptMeta
  content: string
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const POLL_MS = 2_500

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function formatTs(ts: number): string {
  return new Date(ts).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" })
}

function parseCost(n: number): string {
  return `$${n.toFixed(4)}`
}

/** Strip ANSI escape sequences and collapse carriage-return progress rewrites. */
function cleanToolText(raw: string): string {
  // Remove full ANSI sequences: ESC[...m and ESC[...other
  // eslint-disable-next-line no-control-regex
  let s = raw.replace(/\x1b\[[0-9;]*[A-Za-z]/g, "")
  // Remove orphaned color codes that lost their ESC byte (e.g. "[32m", "[0m")
  s = s.replace(/\[[0-9;]*m/g, "")
  // Collapse carriage-return rewrites: keep only text after the last \r on each line
  s = s
    .split("\n")
    .map(line => {
      const parts = line.split("\r")
      return parts[parts.length - 1] ?? ""
    })
    .join("\n")
  return s
}

// ---------------------------------------------------------------------------
// Message grouping
// ---------------------------------------------------------------------------

/** A single non-tool message, passed through as-is. */
interface SingleMessage {
  kind: "single"
  /** Index of this message in the original array — stable across polls for keying. */
  firstIdx: number
  msg: ExportedMessage
}

/** A run of consecutive role:"tool" messages (streaming output chunks) with the same toolName. */
interface ToolGroup {
  kind: "tool-group"
  /** Index of first chunk in the original array — stable across polls for keying. */
  firstIdx: number
  toolName: string
  chunks: ExportedMessage[]
}

/**
 * A run of consecutive assistant messages that carry ONLY toolCalls (no text, no reasoning).
 * These are tool-dispatch rows that should be collapsed into one group header.
 * Stable group key = index of the first message in the original messages array.
 */
interface AssistantToolGroup {
  kind: "assistant-tool-group"
  /** Index of first message in the original array — stable across polls for keying. */
  firstIdx: number
  msgs: ExportedMessage[]
}

type MessageItem = SingleMessage | ToolGroup | AssistantToolGroup

/** Returns true when an assistant message has tool calls but no visible text/reasoning. */
function isPureToolDispatch(msg: ExportedMessage): boolean {
  return (
    msg.role === "assistant" &&
    (!msg.text || msg.text.trim() === "") &&
    (!msg.reasoning || msg.reasoning.trim() === "") &&
    msg.toolCalls !== undefined &&
    msg.toolCalls.length > 0
  )
}

/**
 * Two-pass grouping:
 *   Pass 1: group consecutive role:"tool" chunks with same toolName.
 *   Pass 2: group consecutive pure-tool-dispatch assistant messages.
 */
function groupMessages(messages: ExportedMessage[]): MessageItem[] {
  // Pass 1: coalesce consecutive role:"tool" output chunks
  const pass1: Array<{ item: SingleMessage | ToolGroup; origIdx: number }> = []
  let i = 0
  while (i < messages.length) {
    const msg = messages[i]
    if (msg === undefined) { i++; continue }
    if (msg.role !== "tool") {
      pass1.push({ item: { kind: "single", firstIdx: i, msg }, origIdx: i })
      i++
      continue
    }
    const groupName = msg.toolName && msg.toolName.trim() !== "" ? msg.toolName : "tool output"
    const firstIdx = i
    const chunks: ExportedMessage[] = [msg]
    i++
    while (i < messages.length) {
      const next = messages[i]
      if (next === undefined) break
      if (next.role !== "tool") break
      const nextName = next.toolName && next.toolName.trim() !== "" ? next.toolName : "tool output"
      if (nextName !== groupName) break
      chunks.push(next)
      i++
    }
    pass1.push({ item: { kind: "tool-group", firstIdx, toolName: groupName, chunks }, origIdx: firstIdx })
  }

  // Pass 2: coalesce consecutive pure-tool-dispatch assistant SingleMessages
  const result: MessageItem[] = []
  let j = 0
  while (j < pass1.length) {
    const entry = pass1[j]
    if (entry === undefined) { j++; continue }
    const { item, origIdx } = entry
    if (item.kind === "single" && isPureToolDispatch(item.msg)) {
      const groupMsgs: ExportedMessage[] = [item.msg]
      const firstIdx = origIdx
      j++
      while (j < pass1.length) {
        const next = pass1[j]
        if (next === undefined) break
        if (next.item.kind !== "single" || !isPureToolDispatch(next.item.msg)) break
        groupMsgs.push(next.item.msg)
        j++
      }
      result.push({ kind: "assistant-tool-group", firstIdx, msgs: groupMsgs })
    } else {
      result.push(item)
      j++
    }
  }
  return result
}

/** Build compact summary: "⚒ 6 tools · Bash ×4 · Read ×2" from AssistantToolGroup. */
function assistantToolGroupSummary(msgs: ExportedMessage[]): string {
  const counts = new Map<string, number>()
  const order: string[] = []
  for (const msg of msgs) {
    for (const tc of msg.toolCalls ?? []) {
      if (!counts.has(tc.name)) order.push(tc.name)
      counts.set(tc.name, (counts.get(tc.name) ?? 0) + 1)
    }
  }
  const totalTools = [...counts.values()].reduce((a, b) => a + b, 0)
  const parts = order.map(n => {
    const c = counts.get(n) ?? 1
    return c > 1 ? `${n} ×${c}` : n
  })
  if (parts.length === 0) return `⚒ ${msgs.length} tool dispatch${msgs.length === 1 ? "" : "es"}`
  return `⚒ ${totalTools} tool${totalTools === 1 ? "" : "s"} · ${parts.join(" · ")}`
}

// ---------------------------------------------------------------------------
// Markdown renderer
// ---------------------------------------------------------------------------

const MD_COMPONENTS: React.ComponentProps<typeof ReactMarkdown>["components"] = {
  // Paragraphs — no extra block margin inside bubbles
  p: ({ children }) => (
    <p style={{ margin: "0 0 6px", lineHeight: 1.6 }}>{children}</p>
  ),
  // Headings — scaled down to fit chat bubbles
  h1: ({ children }) => (
    <p style={{ margin: "8px 0 4px", fontWeight: 700, fontSize: 14 }}>{children}</p>
  ),
  h2: ({ children }) => (
    <p style={{ margin: "6px 0 3px", fontWeight: 700, fontSize: 13 }}>{children}</p>
  ),
  h3: ({ children }) => (
    <p style={{ margin: "4px 0 2px", fontWeight: 700, fontSize: 12 }}>{children}</p>
  ),
  h4: ({ children }) => (
    <p style={{ margin: "4px 0 2px", fontWeight: 600, fontSize: 12 }}>{children}</p>
  ),
  h5: ({ children }) => (
    <p style={{ margin: "3px 0 2px", fontWeight: 600, fontSize: 12 }}>{children}</p>
  ),
  h6: ({ children }) => (
    <p style={{ margin: "3px 0 2px", fontWeight: 600, fontSize: 11 }}>{children}</p>
  ),
  // Inline code
  code: ({ children, className }) => {
    const isBlock = className?.startsWith("language-")
    if (isBlock) {
      // fenced code block — rendered via <pre> below
      return (
        <code style={{ fontFamily: "ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace", fontSize: 11 }}>
          {children}
        </code>
      )
    }
    return (
      <code
        style={{
          background: "#0d0d0f",
          border: "1px solid #2a2a2a",
          borderRadius: 3,
          padding: "1px 4px",
          fontFamily: "ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace",
          fontSize: 11,
          color: "#e2e8f0",
        }}
      >
        {children}
      </code>
    )
  },
  // Fenced code blocks
  pre: ({ children }) => (
    <pre
      style={{
        background: "#0d0d0f",
        border: "1px solid #1e1e1e",
        borderRadius: 4,
        padding: "8px 10px",
        margin: "6px 0",
        overflowX: "auto",
        fontSize: 11,
        lineHeight: 1.5,
        fontFamily: "ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace",
        whiteSpace: "pre",
      }}
    >
      {children}
    </pre>
  ),
  // Links — open in new tab, teal
  a: ({ href, children }) => (
    <a
      href={href}
      target="_blank"
      rel="noreferrer noopener"
      style={{ color: "#22d3ee", textDecoration: "underline", textDecorationColor: "#22d3ee40" }}
    >
      {children}
    </a>
  ),
  // Lists
  ul: ({ children }) => (
    <ul style={{ margin: "4px 0", paddingLeft: 18, lineHeight: 1.6 }}>{children}</ul>
  ),
  ol: ({ children }) => (
    <ol style={{ margin: "4px 0", paddingLeft: 18, lineHeight: 1.6 }}>{children}</ol>
  ),
  li: ({ children }) => <li style={{ marginBottom: 2 }}>{children}</li>,
  // Tables
  table: ({ children }) => (
    <div style={{ overflowX: "auto", margin: "6px 0" }}>
      <table style={{ borderCollapse: "collapse", fontSize: 11, width: "100%" }}>{children}</table>
    </div>
  ),
  thead: ({ children }) => <thead style={{ background: "#111" }}>{children}</thead>,
  th: ({ children }) => (
    <th style={{ border: "1px solid #2a2a2a", padding: "3px 8px", textAlign: "left", fontWeight: 600 }}>{children}</th>
  ),
  td: ({ children }) => (
    <td style={{ border: "1px solid #1a1a1a", padding: "3px 8px" }}>{children}</td>
  ),
  // Blockquote
  blockquote: ({ children }) => (
    <blockquote
      style={{
        borderLeft: "3px solid #374151",
        paddingLeft: 10,
        margin: "4px 0",
        color: "#6b7280",
        fontStyle: "italic",
      }}
    >
      {children}
    </blockquote>
  ),
  // Horizontal rule
  hr: () => <hr style={{ border: "none", borderTop: "1px solid #222", margin: "8px 0" }} />,
  // Bold / italic
  strong: ({ children }) => <strong style={{ fontWeight: 700 }}>{children}</strong>,
  em: ({ children }) => <em style={{ fontStyle: "italic" }}>{children}</em>,
}

function MarkdownContent({ text, dimmed }: { text: string; dimmed?: boolean }) {
  const plugins = useMemo(() => [remarkGfm], [])
  return (
    <div
      style={{
        color: dimmed ? "#4b5563" : "inherit",
        fontSize: "inherit",
        lineHeight: "inherit",
      }}
    >
      <ReactMarkdown remarkPlugins={plugins} components={MD_COMPONENTS}>
        {text}
      </ReactMarkdown>
    </div>
  )
}

// ---------------------------------------------------------------------------
// Sub-components
// ---------------------------------------------------------------------------

function ToolCallBlock({ tc }: { tc: { name: string; args: string } }) {
  const [open, setOpen] = useState(false)
  let parsed: unknown = null
  try { parsed = JSON.parse(tc.args) } catch { parsed = tc.args }
  return (
    <div
      style={{
        border: "1px solid #2a2a2a",
        borderRadius: 4,
        marginTop: 4,
        overflow: "hidden",
      }}
    >
      <button
        onClick={() => setOpen(o => !o)}
        style={{
          display: "flex",
          alignItems: "center",
          gap: 6,
          width: "100%",
          background: "#111",
          border: "none",
          color: "#a78bfa",
          fontFamily: "ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace",
          fontSize: 11,
          padding: "3px 8px",
          cursor: "pointer",
          textAlign: "left",
        }}
      >
        <span style={{ color: "#6b7280", fontSize: 10 }}>{open ? "▾" : "▸"}</span>
        <span style={{ color: "#6b7280" }}>tool</span>
        <span>{tc.name}</span>
      </button>
      {open && (
        <pre
          style={{
            margin: 0,
            padding: "6px 8px",
            fontSize: 11,
            color: "#d1d5db",
            background: "#0d0d0f",
            overflowX: "auto",
            whiteSpace: "pre-wrap",
            wordBreak: "break-all",
          }}
        >
          {typeof parsed === "string" ? parsed : JSON.stringify(parsed, null, 2)}
        </pre>
      )}
    </div>
  )
}

function ToolGroupBlock({ group }: { group: ToolGroup }) {
  const [open, setOpen] = useState(false)
  const chunkCount = group.chunks.length
  const label = chunkCount > 1 ? `${group.toolName}  ·  ${chunkCount} chunks` : group.toolName

  const cleanedText = useMemo(() => {
    const raw = group.chunks.map(c => c.text ?? "").join("")
    return cleanToolText(raw)
  }, [group.chunks])

  return (
    <div
      style={{
        border: "1px solid #1f2d1f",
        borderRadius: 4,
        overflow: "hidden",
        margin: "4px 0",
      }}
    >
      <button
        onClick={() => setOpen(o => !o)}
        style={{
          display: "flex",
          alignItems: "center",
          gap: 6,
          width: "100%",
          background: "#0f1a0f",
          border: "none",
          color: "#4ade80",
          fontFamily: "ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace",
          fontSize: 11,
          padding: "3px 8px",
          cursor: "pointer",
          textAlign: "left",
        }}
      >
        <span style={{ color: "#6b7280", fontSize: 10 }}>{open ? "▾" : "▸"}</span>
        <span style={{ color: "#6b7280" }}>result</span>
        <span>{label}</span>
      </button>
      {open && cleanedText && (
        <pre
          style={{
            margin: 0,
            padding: "6px 8px",
            fontSize: 11,
            color: "#d1d5db",
            background: "#0d0d0f",
            overflowX: "auto",
            whiteSpace: "pre",
            wordBreak: "normal",
          }}
        >
          {cleanedText}
        </pre>
      )}
    </div>
  )
}

function ReasoningBlock({ text }: { text: string }) {
  const [open, setOpen] = useState(false)
  return (
    <div style={{ marginBottom: 4 }}>
      <button
        onClick={() => setOpen(o => !o)}
        style={{
          display: "flex",
          alignItems: "center",
          gap: 4,
          background: "none",
          border: "none",
          color: "#4b5563",
          fontFamily: "ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace",
          fontSize: 10,
          cursor: "pointer",
          padding: 0,
        }}
      >
        <span>{open ? "▾" : "▸"}</span>
        <span>reasoning</span>
      </button>
      {open && (
        <div
          style={{
            fontSize: 11,
            fontStyle: "italic",
            paddingLeft: 12,
            marginTop: 2,
            borderLeft: "2px solid #222",
          }}
        >
          <MarkdownContent text={text} dimmed />
        </div>
      )}
    </div>
  )
}

function SystemNotice({ text }: { text: string }) {
  return (
    <div
      style={{
        color: "#4b5563",
        fontSize: 10,
        fontStyle: "italic",
        padding: "3px 8px",
        borderLeft: "2px solid #222",
        margin: "4px 0",
      }}
    >
      {text}
    </div>
  )
}

function MessageBubble({ msg }: { msg: ExportedMessage }) {
  if (msg.role === "system") {
    return <SystemNotice text={msg.text ?? ""} />
  }

  const isUser = msg.role === "user"
  // Show role label only when there's visible text content
  const hasText = msg.text && msg.text.trim().length > 0
  const hasReasoning = msg.reasoning && msg.reasoning.trim().length > 0
  const showLabel = hasText || hasReasoning

  return (
    <div
      style={{
        display: "flex",
        flexDirection: "column",
        alignItems: isUser ? "flex-end" : "flex-start",
        marginBottom: 10,
      }}
    >
      {showLabel && (
        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: 6,
            marginBottom: 3,
            flexDirection: isUser ? "row-reverse" : "row",
          }}
        >
          <span
            style={{
              fontSize: 9,
              color: isUser ? "#22d3ee" : "#a78bfa",
              fontWeight: 700,
              letterSpacing: "0.05em",
              textTransform: "uppercase",
            }}
          >
            {msg.role}
          </span>
          {msg.ts !== undefined && (
            <span style={{ fontSize: 9, color: "#374151" }}>{formatTs(msg.ts)}</span>
          )}
        </div>
      )}

      {msg.reasoning && <ReasoningBlock text={msg.reasoning} />}

      {msg.text && (
        <div
          style={{
            maxWidth: "85%",
            background: isUser ? "#0e2233" : "#111",
            border: `1px solid ${isUser ? "#164e6340" : "#222"}`,
            borderRadius: 6,
            padding: "6px 10px",
            color: "#e8e8e8",
            fontSize: 12,
            lineHeight: 1.6,
            wordBreak: "break-word",
          }}
        >
          <MarkdownContent text={msg.text} />
        </div>
      )}

      {msg.toolCalls && msg.toolCalls.length > 0 && (
        <div style={{ maxWidth: "85%", width: "100%" }}>
          {msg.toolCalls.map((tc, i) => (
            <ToolCallBlock key={i} tc={tc} />
          ))}
        </div>
      )}
    </div>
  )
}

function AssistantToolGroupBlock({
  group,
  expanded,
  onToggle,
}: {
  group: AssistantToolGroup
  expanded: boolean
  onToggle: (firstIdx: number) => void
}) {
  const summary = assistantToolGroupSummary(group.msgs)
  const single = group.msgs.length === 1 && (group.msgs[0]?.toolCalls?.length ?? 0) === 1

  return (
    <div style={{ marginBottom: 6 }}>
      <button
        onClick={() => onToggle(group.firstIdx)}
        style={{
          display: "flex",
          alignItems: "center",
          gap: 6,
          background: "none",
          border: "none",
          color: "#6b7280",
          fontFamily: "ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace",
          fontSize: 10,
          cursor: "pointer",
          padding: "2px 0",
          width: "100%",
          textAlign: "left",
        }}
      >
        <span>{expanded ? "▾" : "▸"}</span>
        <span style={{ color: single ? "#9ca3af" : "#a78bfa" }}>{summary}</span>
      </button>
      {expanded && (
        <div style={{ paddingLeft: 14, borderLeft: "1px solid #222", marginTop: 2 }}>
          {group.msgs.map((msg, i) => (
            <MessageBubble key={i} msg={msg} />
          ))}
        </div>
      )}
    </div>
  )
}

function MetaFooter({ meta }: { meta: TranscriptMeta }) {
  const parts: string[] = []
  if (meta.messageCount !== undefined) parts.push(`${meta.messageCount} msgs`)
  if (meta.toolCallCount !== undefined) parts.push(`${meta.toolCallCount} tool calls`)
  if (meta.costUsd !== undefined) parts.push(parseCost(meta.costUsd))
  if (meta.model) parts.push(meta.model)
  if (parts.length === 0) return null
  return (
    <div
      style={{
        borderTop: "1px solid #1a1a1a",
        padding: "4px 12px",
        color: "#374151",
        fontSize: 10,
        display: "flex",
        gap: 12,
        flexShrink: 0,
      }}
    >
      {parts.map((p, i) => <span key={i}>{p}</span>)}
    </div>
  )
}

// ---------------------------------------------------------------------------
// PromptInput
// ---------------------------------------------------------------------------

function PromptInput({
  daemonUrl,
  sessionId,
  disabled,
}: {
  daemonUrl: string
  sessionId: string
  disabled: boolean
}) {
  const [value, setValue] = useState("")
  const [sending, setSending] = useState(false)
  const [err, setErr] = useState<string | null>(null)

  const send = useCallback(async () => {
    const trimmed = value.trim()
    if (!trimmed || sending) return
    setSending(true)
    setErr(null)
    try {
      const res = await fetch(`${daemonUrl}/sessions/${encodeURIComponent(sessionId)}/prompt`, {
        method: "POST",
        mode: "cors",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ prompt: trimmed }),
      })
      if (!res.ok) {
        const body = (await res.json().catch(() => ({}))) as { error?: string }
        throw new Error(body.error ?? `HTTP ${res.status}`)
      }
      setValue("")
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e))
    } finally {
      setSending(false)
    }
  }, [value, sending, daemonUrl, sessionId])

  const onKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault()
      void send()
    }
  }

  return (
    <div
      style={{
        borderTop: "1px solid #222",
        padding: "8px 12px",
        flexShrink: 0,
        display: "flex",
        flexDirection: "column",
        gap: 4,
      }}
    >
      {err && (
        <div style={{ color: "#f87171", fontSize: 10 }}>{err}</div>
      )}
      <div style={{ display: "flex", gap: 8, alignItems: "flex-end" }}>
        <textarea
          value={value}
          onChange={e => setValue(e.target.value)}
          onKeyDown={onKeyDown}
          disabled={disabled || sending}
          placeholder={disabled ? "session not running" : "Send a prompt… (Enter to send, Shift+Enter for newline)"}
          rows={2}
          style={{
            flex: 1,
            background: "#111",
            border: "1px solid #2a2a2a",
            borderRadius: 4,
            color: disabled ? "#4b5563" : "#e8e8e8",
            fontFamily: "ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace",
            fontSize: 12,
            padding: "6px 8px",
            resize: "none",
            outline: "none",
            lineHeight: 1.5,
          }}
        />
        <button
          onClick={() => void send()}
          disabled={disabled || sending || value.trim() === ""}
          style={{
            background: disabled || sending || value.trim() === "" ? "#1a1a1a" : "#0e2233",
            border: `1px solid ${disabled || sending || value.trim() === "" ? "#2a2a2a" : "#22d3ee40"}`,
            borderRadius: 4,
            color: disabled || sending || value.trim() === "" ? "#4b5563" : "#22d3ee",
            fontFamily: "ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace",
            fontSize: 11,
            padding: "6px 12px",
            cursor: disabled || sending || value.trim() === "" ? "not-allowed" : "pointer",
            flexShrink: 0,
            alignSelf: "stretch",
          }}
        >
          {sending ? "…" : "send"}
        </button>
      </div>
    </div>
  )
}

// ---------------------------------------------------------------------------
// Main component
// ---------------------------------------------------------------------------

interface Props {
  daemonUrl: string
  sessionId: string
  sessionStatus: string
}

export function SessionChatView({ daemonUrl, sessionId, sessionStatus }: Props) {
  const [transcript, setTranscript] = useState<ParsedContent | null>(null)
  const [rawExport, setRawExport] = useState<ExportResponse | null>(null)
  const [noTranscript, setNoTranscript] = useState(false)
  const [fetchErr, setFetchErr] = useState<string | null>(null)
  const scrollRef = useRef<HTMLDivElement | null>(null)
  const isRunning = sessionStatus === "running"

  // Stable expansion state for assistant-tool-groups, keyed by firstIdx.
  const [groupExpanded, setGroupExpanded] = useState<Map<number, boolean>>(() => new Map())
  const handleGroupToggle = useCallback((firstIdx: number) => {
    setGroupExpanded(prev => {
      const next = new Map(prev)
      next.set(firstIdx, !(next.get(firstIdx) ?? false))
      return next
    })
  }, [])

  const fetchTranscript = useCallback(async () => {
    try {
      let res = await fetch(
        `${daemonUrl}/sessions/${encodeURIComponent(sessionId)}/export?format=json`,
        { mode: "cors", credentials: "include" }
      )
      if (!res.ok && (res.status === 404 || res.status === 422)) {
        // Retry with source=daemon
        res = await fetch(
          `${daemonUrl}/sessions/${encodeURIComponent(sessionId)}/export?format=json&source=daemon`,
          { mode: "cors", credentials: "include" }
        )
      }
      if (!res.ok) {
        if (res.status === 404 || res.status === 422) {
          setNoTranscript(true)
          return
        }
        throw new Error(`HTTP ${res.status}`)
      }
      const body = (await res.json()) as ExportResponse
      setRawExport(body)
      const parsed = JSON.parse(body.content) as ParsedContent
      setTranscript(parsed)
      setNoTranscript(false)
      setFetchErr(null)
    } catch (e) {
      if (e instanceof SyntaxError) {
        setFetchErr("Failed to parse transcript JSON")
      } else if (e instanceof Error && (e.message === "HTTP 404" || e.message === "HTTP 422")) {
        setNoTranscript(true)
      } else {
        setFetchErr(e instanceof Error ? e.message : String(e))
      }
    }
  }, [daemonUrl, sessionId])

  // Scroll to bottom when new messages arrive
  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight
    }
  }, [transcript?.messages.length])

  useEffect(() => {
    setTranscript(null)
    setRawExport(null)
    setNoTranscript(false)
    setFetchErr(null)
  }, [sessionId])

  useEffect(() => {
    void fetchTranscript()
    if (!isRunning) return
    const timer = setInterval(() => { void fetchTranscript() }, POLL_MS)
    return () => clearInterval(timer)
  }, [fetchTranscript, isRunning])

  const messages = transcript?.messages ?? []
  const meta = transcript?.meta ?? rawExport?.meta ?? null

  return (
    <div
      style={{
        display: "flex",
        flexDirection: "column",
        flex: 1,
        minHeight: 0,
        background: "#0b0b0d",
      }}
    >
      {/* Message list */}
      <div
        ref={scrollRef}
        style={{
          flex: 1,
          minHeight: 0,
          overflowY: "auto",
          padding: "12px 16px",
        }}
      >
        {noTranscript && (
          <div
            style={{
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              height: "100%",
              color: "#4b5563",
              fontSize: 11,
              textAlign: "center",
              flexDirection: "column",
              gap: 6,
            }}
          >
            <div>no structured transcript for this session</div>
            <div style={{ fontSize: 10 }}>PTY / terminal sessions don't produce a structured export</div>
          </div>
        )}

        {fetchErr && (
          <div style={{ color: "#f87171", fontSize: 11, padding: 8 }}>
            error fetching transcript: {fetchErr}
          </div>
        )}

        {!noTranscript && !fetchErr && messages.length === 0 && (
          <div style={{ color: "#4b5563", fontSize: 11, padding: 8 }}>
            {isRunning ? "waiting for messages…" : "no messages"}
          </div>
        )}

        {groupMessages(messages).map(item => {
          if (item.kind === "tool-group") {
            return <ToolGroupBlock key={`tg-${item.firstIdx}`} group={item} />
          }
          if (item.kind === "assistant-tool-group") {
            return (
              <AssistantToolGroupBlock
                key={`atg-${item.firstIdx}`}
                group={item}
                expanded={groupExpanded.get(item.firstIdx) ?? false}
                onToggle={handleGroupToggle}
              />
            )
          }
          return <MessageBubble key={`msg-${item.firstIdx}`} msg={item.msg} />
        })}
      </div>

      {/* Meta footer */}
      {meta && <MetaFooter meta={meta} />}

      {/* Prompt input */}
      {!noTranscript && (
        <PromptInput
          daemonUrl={daemonUrl}
          sessionId={sessionId}
          disabled={!isRunning}
        />
      )}
    </div>
  )
}

// ---------------------------------------------------------------------------
// JSON syntax colorizer
// ---------------------------------------------------------------------------

const SIZE_CAP = 100_000 // chars

type JsonToken =
  | { kind: "key"; text: string }
  | { kind: "string"; text: string }
  | { kind: "number"; text: string }
  | { kind: "bool"; text: string }
  | { kind: "null"; text: string }
  | { kind: "punct"; text: string }
  | { kind: "ws"; text: string }

function tokenizeJson(src: string): JsonToken[] {
  const tokens: JsonToken[] = []
  let i = 0
  // expectValue stack: false = expecting object key, true = expecting value
  const expectValue: boolean[] = [true]

  const ch = (): string => src[i] ?? ""
  const peek = (offset: number): string => src[i + offset] ?? ""
  const evTop = (): boolean => expectValue[expectValue.length - 1] ?? true
  const setEvTop = (v: boolean) => { if (expectValue.length > 0) expectValue[expectValue.length - 1] = v }

  while (i < src.length) {
    const c = ch()

    // Whitespace
    if (/\s/.test(c)) {
      let ws = ""
      while (i < src.length && /\s/.test(ch())) ws += src[i++]
      tokens.push({ kind: "ws", text: ws })
      continue
    }

    // String
    if (c === '"') {
      let s = '"'
      i++
      while (i < src.length) {
        const sc = ch()
        if (sc === '\\') { s += sc + peek(1); i += 2 }
        else if (sc === '"') { s += '"'; i++; break }
        else { s += sc; i++ }
      }
      // Look ahead past whitespace for ':' to detect object key
      let j = i
      while (j < src.length && /\s/.test(src[j] ?? "")) j++
      const nextIsColon = (src[j] ?? "") === ":"
      if (!evTop() && nextIsColon) {
        tokens.push({ kind: "key", text: s })
      } else {
        tokens.push({ kind: "string", text: s })
        if (evTop()) setEvTop(false)
      }
      continue
    }

    // Number
    if (c === "-" || (c >= "0" && c <= "9")) {
      let n = ""
      while (i < src.length && /[-+0-9.eE]/.test(ch())) n += src[i++]
      tokens.push({ kind: "number", text: n })
      if (evTop()) setEvTop(false)
      continue
    }

    // true / false / null
    if (src.slice(i, i + 4) === "true") {
      tokens.push({ kind: "bool", text: "true" }); i += 4
      if (evTop()) setEvTop(false)
      continue
    }
    if (src.slice(i, i + 5) === "false") {
      tokens.push({ kind: "bool", text: "false" }); i += 5
      if (evTop()) setEvTop(false)
      continue
    }
    if (src.slice(i, i + 4) === "null") {
      tokens.push({ kind: "null", text: "null" }); i += 4
      if (evTop()) setEvTop(false)
      continue
    }

    // Punctuation
    const pc = c
    i++
    tokens.push({ kind: "punct", text: pc })
    if (pc === "{") {
      expectValue.push(false) // object: next string is a key
    } else if (pc === "[") {
      expectValue.push(true)  // array: next is a value
    } else if (pc === "}" || pc === "]") {
      if (expectValue.length > 1) expectValue.pop()
    } else if (pc === ":") {
      setEvTop(true) // after colon, next is a value
    }
    // commas: leave stack as-is; object still expects key (false), array expects value (true)
  }
  return tokens
}

const TOKEN_COLOR: Record<JsonToken["kind"], string> = {
  key:    "#22d3ee", // teal
  string: "#4ade80", // green
  number: "#facc15", // yellow
  bool:   "#f97316", // orange
  null:   "#9ca3af", // muted gray
  punct:  "#6b7280", // gray
  ws:     "inherit",
}

function ColorizedJson({ text }: { text: string }) {
  const tokens = useMemo(() => tokenizeJson(text), [text])
  return (
    <pre
      style={{
        margin: 0,
        fontSize: 11,
        lineHeight: 1.6,
        fontFamily: "ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace",
        whiteSpace: "pre",
        overflowX: "auto",
        background: "transparent",
      }}
    >
      {tokens.map((tok, i) => (
        <span key={i} style={{ color: TOKEN_COLOR[tok.kind] }}>{tok.text}</span>
      ))}
    </pre>
  )
}

// ---------------------------------------------------------------------------
// Collapsible top-level JSON section
// ---------------------------------------------------------------------------

interface TopLevelSectionProps {
  label: string
  value: unknown
  rawUrl: string
}

function TopLevelSection({ label, value, rawUrl }: TopLevelSectionProps) {
  const [open, setOpen] = useState(label !== "messages") // meta open by default, messages closed
  const inner = useMemo(() => JSON.stringify(value, null, 2), [value])
  const sizeOk = inner.length <= SIZE_CAP
  const displayText = sizeOk ? inner : inner.slice(0, SIZE_CAP)
  const totalKb = Math.round(inner.length / 1024)

  return (
    <div style={{ marginBottom: 6 }}>
      <button
        onClick={() => setOpen(o => !o)}
        style={{
          display: "flex",
          alignItems: "center",
          gap: 6,
          background: "none",
          border: "none",
          color: "#22d3ee",
          fontFamily: "ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace",
          fontSize: 11,
          cursor: "pointer",
          padding: "2px 0",
        }}
      >
        <span style={{ color: "#6b7280", fontSize: 10 }}>{open ? "▾" : "▸"}</span>
        <span style={{ color: "#6b7280" }}>&quot;{label}&quot;</span>
        <span style={{ color: "#6b7280" }}>:</span>
        {!open && <span style={{ color: "#6b7280" }}>{Array.isArray(value) ? `[…${(value as unknown[]).length}]` : "{…}"}</span>}
      </button>
      {open && (
        <div style={{ paddingLeft: 12, borderLeft: "1px solid #1a1a1a" }}>
          {!sizeOk && (
            <div
              style={{
                fontSize: 10,
                color: "#6b7280",
                padding: "2px 0 4px",
                fontFamily: "ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace",
              }}
            >
              truncated — {totalKb} KB total ·{" "}
              <a
                href={rawUrl}
                target="_blank"
                rel="noreferrer noopener"
                style={{ color: "#22d3ee", textDecoration: "underline" }}
              >
                view raw
              </a>
            </div>
          )}
          <ColorizedJson text={displayText} />
        </div>
      )}
    </div>
  )
}

// ---------------------------------------------------------------------------
// JSON view
// ---------------------------------------------------------------------------

interface JsonViewProps {
  daemonUrl: string
  sessionId: string
  sessionStatus: string
}

export function SessionJsonView({ daemonUrl, sessionId, sessionStatus }: JsonViewProps) {
  const [data, setData] = useState<ExportResponse | null>(null)
  const [noTranscript, setNoTranscript] = useState(false)
  const [fetchErr, setFetchErr] = useState<string | null>(null)
  const [copied, setCopied] = useState(false)
  const isRunning = sessionStatus === "running"

  const fetchData = useCallback(async () => {
    try {
      let res = await fetch(
        `${daemonUrl}/sessions/${encodeURIComponent(sessionId)}/export?format=json`,
        { mode: "cors", credentials: "include" }
      )
      if (!res.ok && (res.status === 404 || res.status === 422)) {
        res = await fetch(
          `${daemonUrl}/sessions/${encodeURIComponent(sessionId)}/export?format=json&source=daemon`,
          { mode: "cors", credentials: "include" }
        )
      }
      if (!res.ok) {
        if (res.status === 404 || res.status === 422) {
          setNoTranscript(true)
          return
        }
        throw new Error(`HTTP ${res.status}`)
      }
      const body = (await res.json()) as ExportResponse
      setData(body)
      setNoTranscript(false)
      setFetchErr(null)
    } catch (e) {
      setFetchErr(e instanceof Error ? e.message : String(e))
    }
  }, [daemonUrl, sessionId])

  useEffect(() => {
    setData(null)
    setNoTranscript(false)
    setFetchErr(null)
  }, [sessionId])

  useEffect(() => {
    void fetchData()
    if (!isRunning) return
    const timer = setInterval(() => { void fetchData() }, POLL_MS)
    return () => clearInterval(timer)
  }, [fetchData, isRunning])

  // Full payload for copy (always the raw complete text)
  const fullJsonText = useMemo(() => data ? JSON.stringify(data, null, 2) : null, [data])
  const rawUrl = `${daemonUrl}/sessions/${encodeURIComponent(sessionId)}/export?format=json`

  const copy = async () => {
    if (!fullJsonText) return
    await navigator.clipboard.writeText(fullJsonText)
    setCopied(true)
    setTimeout(() => setCopied(false), 1500)
  }

  // Split into top-level keys for collapsible rendering
  const topLevelEntries = useMemo(
    () => data ? (Object.entries(data) as [string, unknown][]) : null,
    [data]
  )

  return (
    <div
      style={{
        display: "flex",
        flexDirection: "column",
        flex: 1,
        minHeight: 0,
        background: "#0b0b0d",
      }}
    >
      {/* Toolbar */}
      <div
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "flex-end",
          padding: "4px 12px",
          borderBottom: "1px solid #1a1a1a",
          flexShrink: 0,
          gap: 8,
        }}
      >
        <a
          href={rawUrl}
          target="_blank"
          rel="noreferrer noopener"
          style={{
            color: "#6b7280",
            fontFamily: "ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace",
            fontSize: 10,
            textDecoration: "none",
          }}
        >
          raw ↗
        </a>
        <button
          onClick={() => void copy()}
          disabled={!fullJsonText}
          style={{
            background: "none",
            border: "1px solid #2a2a2a",
            borderRadius: 4,
            color: copied ? "#4ade80" : "#6b7280",
            fontFamily: "ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace",
            fontSize: 10,
            padding: "2px 8px",
            cursor: fullJsonText ? "pointer" : "not-allowed",
          }}
        >
          {copied ? "copied!" : "copy"}
        </button>
      </div>

      {/* Content */}
      <div style={{ flex: 1, minHeight: 0, overflowY: "auto", padding: "12px 16px" }}>
        {noTranscript && (
          <div style={{ color: "#4b5563", fontSize: 11 }}>
            no structured transcript for this session
          </div>
        )}
        {fetchErr && (
          <div style={{ color: "#f87171", fontSize: 11 }}>error: {fetchErr}</div>
        )}
        {topLevelEntries && (
          <div>
            <span style={{ color: "#6b7280", fontFamily: "ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace", fontSize: 11 }}>{"{"}</span>
            <div style={{ paddingLeft: 12 }}>
              {topLevelEntries.map(([key, val]) =>
                val !== null && typeof val === "object" ? (
                  <TopLevelSection key={key} label={key} value={val} rawUrl={rawUrl} />
                ) : (
                  <div key={key} style={{ fontFamily: "ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace", fontSize: 11, marginBottom: 2 }}>
                    <span style={{ color: "#22d3ee" }}>&quot;{key}&quot;</span>
                    <span style={{ color: "#6b7280" }}>: </span>
                    <ColorizedJson text={JSON.stringify(val)} />
                  </div>
                )
              )}
            </div>
            <span style={{ color: "#6b7280", fontFamily: "ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace", fontSize: 11 }}>{"}"}</span>
          </div>
        )}
        {!noTranscript && !fetchErr && !topLevelEntries && (
          <div style={{ color: "#4b5563", fontSize: 11 }}>
            {isRunning ? "loading…" : "no data"}
          </div>
        )}
      </div>
    </div>
  )
}
