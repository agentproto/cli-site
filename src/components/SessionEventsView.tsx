"use client"

import React, { memo, useCallback, useEffect, useMemo, useRef, useState } from "react"
import ReactMarkdown from "react-markdown"
import remarkGfm from "remark-gfm"

import {
  useSessionEvents,
  type PlanEntry,
  type SessionEvent,
  type ToolCallEvent,
  type ToolResultEvent,
  type UsageCost,
} from "@/lib/use-session-events"
import { PlanList, ToolPairBlock, toDisplayText } from "@/components/ToolBlocks"

// ---------------------------------------------------------------------------
// Shared style helpers (match SessionChatView dark aesthetic)
// ---------------------------------------------------------------------------

const MONO: React.CSSProperties = {
  fontFamily: "ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace",
  fontSize: 11,
}

// ---------------------------------------------------------------------------
// Markdown renderer (same config as SessionChatView)
// ---------------------------------------------------------------------------

const MD_COMPONENTS: React.ComponentProps<typeof ReactMarkdown>["components"] = {
  p: ({ children }) => <p style={{ margin: "0 0 6px", lineHeight: 1.6 }}>{children}</p>,
  h1: ({ children }) => <p style={{ margin: "8px 0 4px", fontWeight: 700, fontSize: 14 }}>{children}</p>,
  h2: ({ children }) => <p style={{ margin: "6px 0 3px", fontWeight: 700, fontSize: 13 }}>{children}</p>,
  h3: ({ children }) => <p style={{ margin: "4px 0 2px", fontWeight: 700, fontSize: 12 }}>{children}</p>,
  h4: ({ children }) => <p style={{ margin: "4px 0 2px", fontWeight: 600, fontSize: 12 }}>{children}</p>,
  h5: ({ children }) => <p style={{ margin: "3px 0 2px", fontWeight: 600, fontSize: 12 }}>{children}</p>,
  h6: ({ children }) => <p style={{ margin: "3px 0 2px", fontWeight: 600, fontSize: 11 }}>{children}</p>,
  code: ({ children, className }) => {
    if (className?.startsWith("language-")) {
      return (
        <code style={{ ...MONO }}>
          {children}
        </code>
      )
    }
    return (
      <code style={{
        background: "#0d0d0f", border: "1px solid #2a2a2a", borderRadius: 3,
        padding: "1px 4px", ...MONO, color: "#e2e8f0",
      }}>
        {children}
      </code>
    )
  },
  pre: ({ children }) => (
    <pre style={{
      background: "#0d0d0f", border: "1px solid #1e1e1e", borderRadius: 4,
      padding: "8px 10px", margin: "6px 0", overflowX: "auto",
      fontSize: 11, lineHeight: 1.5, ...MONO, whiteSpace: "pre",
    }}>
      {children}
    </pre>
  ),
  a: ({ href, children }) => (
    <a href={href} target="_blank" rel="noreferrer noopener"
      style={{ color: "#22d3ee", textDecoration: "underline", textDecorationColor: "#22d3ee40" }}>
      {children}
    </a>
  ),
  ul: ({ children }) => <ul style={{ margin: "4px 0", paddingLeft: 18, lineHeight: 1.6 }}>{children}</ul>,
  ol: ({ children }) => <ol style={{ margin: "4px 0", paddingLeft: 18, lineHeight: 1.6 }}>{children}</ol>,
  li: ({ children }) => <li style={{ marginBottom: 2 }}>{children}</li>,
  table: ({ children }) => (
    <div style={{ overflowX: "auto", margin: "6px 0" }}>
      <table style={{ borderCollapse: "collapse", fontSize: 11, width: "100%" }}>{children}</table>
    </div>
  ),
  thead: ({ children }) => <thead style={{ background: "#111" }}>{children}</thead>,
  th: ({ children }) => <th style={{ border: "1px solid #2a2a2a", padding: "3px 8px", textAlign: "left", fontWeight: 600 }}>{children}</th>,
  td: ({ children }) => <td style={{ border: "1px solid #1a1a1a", padding: "3px 8px" }}>{children}</td>,
  blockquote: ({ children }) => (
    <blockquote style={{ borderLeft: "3px solid #374151", paddingLeft: 10, margin: "4px 0", color: "#6b7280", fontStyle: "italic" }}>
      {children}
    </blockquote>
  ),
  hr: () => <hr style={{ border: "none", borderTop: "1px solid #222", margin: "8px 0" }} />,
  strong: ({ children }) => <strong style={{ fontWeight: 700 }}>{children}</strong>,
  em: ({ children }) => <em style={{ fontStyle: "italic" }}>{children}</em>,
}

const REMARK_PLUGINS = [remarkGfm]

function MarkdownContent({ text, dimmed }: { text: string; dimmed?: boolean }) {
  return (
    <div style={{ color: dimmed ? "#4b5563" : "inherit", fontSize: "inherit", lineHeight: "inherit" }}>
      <ReactMarkdown remarkPlugins={REMARK_PLUGINS} components={MD_COMPONENTS}>
        {text}
      </ReactMarkdown>
    </div>
  )
}

// ---------------------------------------------------------------------------
// Render item types — what buildRenderItems produces
// ---------------------------------------------------------------------------

/** Coalesced assistant text bubble (one or more text-delta events). */
interface TextItem {
  kind: "text"
  id: string      // stable: first event seq
  text: string    // all deltas concatenated
  partial: boolean
}

/** User prompt. */
interface UserItem {
  kind: "user"
  id: string
  text: string
  ts: string
}

/** Thought / reasoning block. */
interface ThoughtItem {
  kind: "thought"
  id: string
  text: string
}

/** Tool call+result pair. */
interface ToolPairItem {
  kind: "tool-pair"
  id: string          // toolCallId
  call: ToolCallEvent
  result: ToolResultEvent | null
  turnOpen: boolean   // whether the turn is still open (running state indicator)
}

/** A maximal run of consecutive tool-pair items, grouped for display. */
interface ToolGroupItem {
  kind: "tool-group"
  id: string              // stable: first ToolPairItem's id
  pairs: ToolPairItem[]
  growing: boolean        // last item in group has no result and session is still running
}

/** Plan. */
interface PlanItem {
  kind: "plan"
  id: string          // seq of latest plan event at this position
  entries: PlanEntry[]
}

/** Usage chip shown at turn boundary. */
interface UsageItem {
  kind: "usage"
  id: string
  size: number
  used: number
  cost: UsageCost | null
}

/** Turn-end divider. */
interface TurnEndItem {
  kind: "turn-end"
  id: string
  reason: string
}

type RenderItem = TextItem | UserItem | ThoughtItem | ToolPairItem | ToolGroupItem | PlanItem | UsageItem | TurnEndItem

// ---------------------------------------------------------------------------
// buildRenderItems — pure function, converts event list → RenderItem[]
// ---------------------------------------------------------------------------

function buildRenderItems(events: SessionEvent[]): RenderItem[] {
  const items: RenderItem[] = []

  // Track open text accumulator
  let textBuf: { startSeq: number; chunks: string[]; partial: boolean } | null = null

  // Track pending tool calls (toolCallId → item index in `items`)
  const toolPairIndex = new Map<string, number>()

  // Latest plan position (seq → index in items), so later plan events update in-place
  let planIdx = -1

  // Latest usage per turn — accumulate, emit one UsageItem at turn-end
  let latestUsage: { size: number; used: number; cost: UsageCost | null } | null = null

  // Is the current turn open?
  let turnOpen = true

  const flushText = () => {
    if (!textBuf) return
    items.push({
      kind: "text",
      id: `text-${textBuf.startSeq}`,
      text: textBuf.chunks.join(""),
      partial: textBuf.partial,
    })
    textBuf = null
  }

  for (const ev of events) {
    if (ev.kind === "text-delta") {
      if (!textBuf) {
        textBuf = { startSeq: ev.seq, chunks: [], partial: ev.partial ?? false }
      }
      textBuf.chunks.push(toDisplayText(ev.text))
      textBuf.partial = ev.partial ?? false
      continue
    }

    // Any non-delta event closes the current text accumulator
    flushText()

    switch (ev.kind) {
      case "user-prompt": {
        turnOpen = true
        latestUsage = null
        planIdx = -1
        items.push({ kind: "user", id: `user-${ev.seq}`, text: toDisplayText(ev.text), ts: ev.ts })
        break
      }

      case "thought": {
        items.push({ kind: "thought", id: `thought-${ev.seq}`, text: toDisplayText(ev.text) })
        break
      }

      case "tool-call": {
        const item: ToolPairItem = {
          kind: "tool-pair",
          id: `tool-${ev.toolCallId}`,
          call: ev,
          result: null,
          turnOpen,
        }
        toolPairIndex.set(ev.toolCallId, items.length)
        items.push(item)
        break
      }

      case "tool-result": {
        const idx = toolPairIndex.get(ev.toolCallId)
        if (idx !== undefined) {
          const existing = items[idx]
          if (existing?.kind === "tool-pair") {
            // Update in-place (safe: same reference slot, React key stable)
            items[idx] = { ...existing, result: ev }
          }
        } else {
          // Orphaned result — shouldn't happen but handle gracefully
          // (no-op: we don't have the call to pair it with)
        }
        break
      }

      case "plan": {
        if (planIdx >= 0) {
          // Replace earlier plan in-place at its position
          const existing = items[planIdx]
          if (existing?.kind === "plan") {
            items[planIdx] = { kind: "plan", id: `plan-${ev.seq}`, entries: ev.entries }
          }
        } else {
          planIdx = items.length
          items.push({ kind: "plan", id: `plan-${ev.seq}`, entries: ev.entries })
        }
        break
      }

      case "usage_update": {
        latestUsage = { size: ev.size, used: ev.used, cost: ev.cost ?? null }
        break
      }

      case "turn-end": {
        turnOpen = false
        // Emit usage chip before the turn-end divider
        if (latestUsage) {
          items.push({
            kind: "usage",
            id: `usage-${ev.seq}`,
            size: latestUsage.size,
            used: latestUsage.used,
            cost: latestUsage.cost,
          })
          latestUsage = null
        }
        items.push({ kind: "turn-end", id: `turn-end-${ev.seq}`, reason: toDisplayText(ev.reason) })
        // Reset plan tracking for next turn
        planIdx = -1
        break
      }
    }
  }

  // Flush any trailing text accumulator
  flushText()

  // Mark all open tool pairs with current turnOpen state
  for (const [, idx] of toolPairIndex) {
    const item = items[idx]
    if (item?.kind === "tool-pair" && item.result === null) {
      items[idx] = { ...item, turnOpen }
    }
  }

  return items
}

// ---------------------------------------------------------------------------
// groupToolPairs — post-process RenderItem[] to coalesce consecutive tool-pairs
// ---------------------------------------------------------------------------

function groupToolPairs(items: RenderItem[]): RenderItem[] {
  const out: RenderItem[] = []
  let i = 0
  while (i < items.length) {
    const item = items[i]
    if (item === undefined) { i++; continue }
    if (item.kind !== "tool-pair") {
      out.push(item)
      i++
      continue
    }
    // Collect maximal run of consecutive tool-pair items
    const run: ToolPairItem[] = [item]
    i++
    while (i < items.length) {
      const next = items[i]
      if (next === undefined || next.kind !== "tool-pair") break
      run.push(next)
      i++
    }
    if (run.length === 1) {
      const only = run[0]!
      out.push({
        kind: "tool-group",
        id: `tg-${only.id}`,
        pairs: run,
        growing: only.result === null && only.turnOpen,
      })
    } else {
      const first = run[0]!
      const last = run[run.length - 1]!
      out.push({
        kind: "tool-group",
        id: `tg-${first.id}`,
        pairs: run,
        growing: last.result === null && last.turnOpen,
      })
    }
  }
  return out
}

// Build compact summary string: "⚒ 6 tools · Bash ×4 · Read ×2"
function toolGroupSummary(pairs: ToolPairItem[]): string {
  const counts = new Map<string, number>()
  const order: string[] = []
  for (const p of pairs) {
    const name = p.call.toolName
    if (!counts.has(name)) order.push(name)
    counts.set(name, (counts.get(name) ?? 0) + 1)
  }
  const parts = order.map(n => {
    const c = counts.get(n) ?? 1
    return c > 1 ? `${n} ×${c}` : n
  })
  return `⚒ ${pairs.length} tool${pairs.length === 1 ? "" : "s"} · ${parts.join(" · ")}`
}

// ---------------------------------------------------------------------------
// Individual render components (memoized)
// ---------------------------------------------------------------------------

const UserBubble = memo(function UserBubble({ item }: { item: UserItem }) {
  return (
    <div style={{ display: "flex", justifyContent: "flex-end", marginBottom: 10 }}>
      <div
        style={{
          maxWidth: "78%",
          background: "#0e1f2a",
          border: "1px solid #22d3ee30",
          borderRadius: "8px 8px 2px 8px",
          padding: "7px 12px",
          color: "#e8e8e8",
          fontSize: 12,
          lineHeight: 1.6,
          whiteSpace: "pre-wrap",
          wordBreak: "break-word",
        }}
      >
        {item.text}
      </div>
    </div>
  )
})

const AssistantBubble = memo(function AssistantBubble({ item }: { item: TextItem }) {
  return (
    <div style={{ display: "flex", justifyContent: "flex-start", marginBottom: 10 }}>
      <div
        style={{
          maxWidth: "88%",
          background: "#111",
          border: "1px solid #222",
          borderRadius: "2px 8px 8px 8px",
          padding: "7px 12px",
          color: "#e8e8e8",
          fontSize: 12,
          lineHeight: 1.6,
        }}
      >
        <MarkdownContent text={item.text} />
        {item.partial && (
          <span style={{ color: "#4b5563", fontSize: 10, marginLeft: 4 }}>▌</span>
        )}
      </div>
    </div>
  )
})

const ThoughtRow = memo(function ThoughtRow({ item }: { item: ThoughtItem }) {
  const [open, setOpen] = useState(false)
  return (
    <div style={{ marginBottom: 4 }}>
      <button
        onClick={() => setOpen(o => !o)}
        style={{
          display: "flex", alignItems: "center", gap: 4,
          background: "none", border: "none", color: "#4b5563",
          ...MONO, fontSize: 10, cursor: "pointer", padding: 0,
        }}
      >
        <span>{open ? "▾" : "▸"}</span>
        <span>reasoning</span>
      </button>
      {open && (
        <div style={{
          fontSize: 11, fontStyle: "italic", paddingLeft: 12,
          marginTop: 2, borderLeft: "2px solid #222",
        }}>
          <MarkdownContent text={item.text} dimmed />
        </div>
      )}
    </div>
  )
})

const UsageChip = memo(function UsageChip({ item }: { item: UsageItem }) {
  const parts: string[] = []
  if (item.used > 0) parts.push(`${item.used.toLocaleString()} tokens`)
  if (item.cost) {
    const sym = item.cost.currency === "USD" ? "$" : item.cost.currency + " "
    parts.push(`${sym}${item.cost.amount.toFixed(4)}`)
  }
  if (parts.length === 0) return null
  return (
    <div style={{ display: "flex", justifyContent: "flex-end", marginBottom: 4 }}>
      <span style={{
        color: "#4b5563", fontSize: 10, ...MONO,
        background: "#111", border: "1px solid #1a1a1a",
        borderRadius: 10, padding: "1px 8px",
      }}>
        {parts.join(" · ")}
      </span>
    </div>
  )
})

const TurnEndRow = memo(function TurnEndRow({ item }: { item: TurnEndItem }) {
  const isAbnormal = item.reason !== "completed"
  return (
    <div style={{
      display: "flex", alignItems: "center", gap: 8,
      margin: "8px 0 12px",
    }}>
      <div style={{ flex: 1, height: 1, background: "#1a1a1a" }} />
      {isAbnormal && (
        <span style={{
          fontSize: 9, ...MONO, padding: "1px 6px",
          border: "1px solid #78350f", borderRadius: 3,
          color: "#fbbf24", background: "#1c1200",
        }}>
          {item.reason}
        </span>
      )}
      <div style={{ flex: 1, height: 1, background: "#1a1a1a" }} />
    </div>
  )
})

// ToolPairRow is NOT memoized with React.memo because tool-pair items are mutated
// in-place (result arrives) — the parent re-renders and passes the new item.
function ToolPairRow({ item }: { item: ToolPairItem }) {
  return (
    <div style={{ marginBottom: 4 }}>
      <ToolPairBlock call={item.call} result={item.result} running={item.turnOpen} />
    </div>
  )
}

interface ToolGroupRowProps {
  item: ToolGroupItem
  expanded: boolean
  onToggle: (id: string) => void
}

function ToolGroupRow({ item, expanded, onToggle }: ToolGroupRowProps) {
  const summary = toolGroupSummary(item.pairs)
  const single = item.pairs.length === 1

  return (
    <div style={{ marginBottom: 4 }}>
      {/* Header — always visible */}
      <button
        onClick={() => onToggle(item.id)}
        style={{
          display: "flex",
          alignItems: "center",
          gap: 6,
          background: "none",
          border: "none",
          color: "#6b7280",
          ...MONO,
          fontSize: 10,
          cursor: "pointer",
          padding: "2px 0",
          width: "100%",
          textAlign: "left",
        }}
      >
        <span style={{ fontSize: 10 }}>{expanded ? "▾" : "▸"}</span>
        <span style={{ color: single ? "#9ca3af" : "#a78bfa" }}>{summary}</span>
        {item.growing && (
          <span style={{
            color: "#22d3ee",
            fontSize: 9,
            animation: "none",
            opacity: 0.7,
          }}>
            ▌
          </span>
        )}
      </button>

      {/* Expanded: individual ToolPairRows */}
      {expanded && (
        <div style={{ paddingLeft: 14, borderLeft: "1px solid #222", marginTop: 2 }}>
          {item.pairs.map(p => (
            <ToolPairRow key={p.id} item={p} />
          ))}
        </div>
      )}
    </div>
  )
}

function PlanRow({ item }: { item: PlanItem }) {
  return (
    <div style={{ marginBottom: 4 }}>
      <PlanList entries={item.entries} />
    </div>
  )
}

// ---------------------------------------------------------------------------
// RenderItemView dispatcher
// ---------------------------------------------------------------------------

interface RenderItemViewProps {
  item: RenderItem
  groupExpanded: Map<string, boolean>
  onGroupToggle: (id: string) => void
}

function RenderItemView({ item, groupExpanded, onGroupToggle }: RenderItemViewProps) {
  switch (item.kind) {
    case "user":       return <UserBubble item={item} />
    case "text":       return <AssistantBubble item={item} />
    case "thought":    return <ThoughtRow item={item} />
    case "tool-pair":  return <ToolPairRow item={item} />
    case "tool-group": return (
      <ToolGroupRow
        item={item}
        expanded={groupExpanded.get(item.id) ?? false}
        onToggle={onGroupToggle}
      />
    )
    case "plan":       return <PlanRow item={item} />
    case "usage":      return <UsageChip item={item} />
    case "turn-end":   return <TurnEndRow item={item} />
  }
}

// ---------------------------------------------------------------------------
// PromptInput (same as SessionChatView, duplicated to keep file self-contained)
// ---------------------------------------------------------------------------

function PromptInput({ daemonUrl, sessionId, disabled }: { daemonUrl: string; sessionId: string; disabled: boolean }) {
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
        method: "POST", mode: "cors", credentials: "include",
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
    if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); void send() }
  }

  return (
    <div style={{ borderTop: "1px solid #222", padding: "8px 12px", flexShrink: 0, display: "flex", flexDirection: "column", gap: 4 }}>
      {err && <div style={{ color: "#f87171", fontSize: 10 }}>{err}</div>}
      <div style={{ display: "flex", gap: 8, alignItems: "flex-end" }}>
        <textarea
          value={value}
          onChange={e => setValue(e.target.value)}
          onKeyDown={onKeyDown}
          disabled={disabled || sending}
          placeholder={disabled ? "session not running" : "Send a prompt… (Enter to send, Shift+Enter for newline)"}
          rows={2}
          style={{
            flex: 1, background: "#111", border: "1px solid #2a2a2a", borderRadius: 4,
            color: disabled ? "#4b5563" : "#e8e8e8",
            ...MONO, fontSize: 12, padding: "6px 8px", resize: "none", outline: "none", lineHeight: 1.5,
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
            ...MONO, fontSize: 11, padding: "6px 12px",
            cursor: disabled || sending || value.trim() === "" ? "not-allowed" : "pointer",
            flexShrink: 0, alignSelf: "stretch",
          }}
        >
          {sending ? "…" : "send"}
        </button>
      </div>
    </div>
  )
}

// ---------------------------------------------------------------------------
// SessionEventsView — main export
// ---------------------------------------------------------------------------

interface Props {
  daemonUrl: string
  sessionId: string
  sessionStatus: string
  /** Called when the events endpoint 404s so the parent can fall back to export polling. */
  onNotSupported: () => void
}

export function SessionEventsView({ daemonUrl, sessionId, sessionStatus, onNotSupported }: Props) {
  const { events, notSupported, loading, error } = useSessionEvents(daemonUrl, sessionId, sessionStatus)
  const scrollRef = useRef<HTMLDivElement | null>(null)
  const isRunning = sessionStatus === "running"

  // Stable expansion state: Map<groupId, expanded>. Using useState(Map) so
  // toggling forces a re-render but doesn't lose state across polls.
  const [groupExpanded, setGroupExpanded] = useState<Map<string, boolean>>(() => new Map())

  const handleGroupToggle = useCallback((id: string) => {
    setGroupExpanded(prev => {
      const next = new Map(prev)
      next.set(id, !(next.get(id) ?? false))
      return next
    })
  }, [])

  // Signal parent to fall back as soon as notSupported is confirmed.
  useEffect(() => {
    if (notSupported) onNotSupported()
  }, [notSupported, onNotSupported])

  // Build render items — recomputed on every events change.
  // Memoised on the events array reference — hook only mutates by replacing array.
  const items = useMemo(() => groupToolPairs(buildRenderItems(events)), [events])

  // Scroll to bottom when items are added.
  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight
    }
  }, [items.length])

  return (
    <div style={{ display: "flex", flexDirection: "column", flex: 1, minHeight: 0, background: "#0b0b0d" }}>
      {/* Message list */}
      <div
        ref={scrollRef}
        style={{ flex: 1, minHeight: 0, overflowY: "auto", padding: "12px 16px" }}
      >
        {loading && events.length === 0 && (
          <div style={{ color: "#4b5563", fontSize: 11, padding: 8 }}>loading events…</div>
        )}

        {!loading && error && (
          <div style={{ color: "#f87171", fontSize: 11, padding: 8 }}>error: {error}</div>
        )}

        {!loading && !error && items.length === 0 && (
          <div style={{ color: "#4b5563", fontSize: 11, padding: 8 }}>
            {isRunning ? "waiting for events…" : "no events"}
          </div>
        )}

        {items.map(item => (
          <RenderItemView
            key={item.id}
            item={item}
            groupExpanded={groupExpanded}
            onGroupToggle={handleGroupToggle}
          />
        ))}
      </div>

      {/* Prompt input */}
      <PromptInput daemonUrl={daemonUrl} sessionId={sessionId} disabled={!isRunning} />
    </div>
  )
}
