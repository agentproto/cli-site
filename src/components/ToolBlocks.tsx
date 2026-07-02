"use client"

import { useMemo, useState } from "react"
import type { PlanEntry, ToolCallEvent, ToolResultEvent } from "@/lib/use-session-events"

// ---------------------------------------------------------------------------
// Shared styles / constants
// ---------------------------------------------------------------------------

const MONO: React.CSSProperties = {
  fontFamily: "ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace",
  fontSize: 11,
}

const CARD: React.CSSProperties = {
  borderRadius: 5,
  overflow: "hidden",
  margin: "4px 0",
}

// ---------------------------------------------------------------------------
// ANSI / CR cleaning (shared with SessionChatView)
// ---------------------------------------------------------------------------

export function cleanToolText(raw: string): string {
  // eslint-disable-next-line no-control-regex
  let s = raw.replace(/\x1b\[[0-9;]*[A-Za-z]/g, "")
  s = s.replace(/\[[0-9;]*m/g, "")
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
// First-arg helper — extract a meaningful string from tool arguments
// ---------------------------------------------------------------------------

function firstStringArg(args: Record<string, unknown>): string | null {
  for (const v of Object.values(args)) {
    if (typeof v === "string" && v.trim().length > 0) return v.trim()
  }
  return null
}

function pathArg(args: Record<string, unknown>): string | null {
  const keys = ["path", "file", "filename", "filepath", "target"]
  for (const k of keys) {
    const v = args[k]
    if (typeof v === "string" && v.trim().length > 0) return v.trim()
  }
  return firstStringArg(args)
}

// ---------------------------------------------------------------------------
// Collapsible wrapper used by all tool blocks
// ---------------------------------------------------------------------------

interface CollapsibleProps {
  header: React.ReactNode
  children: React.ReactNode
  defaultOpen?: boolean
  borderColor?: string
  headerBg?: string
}

function Collapsible({ header, children, defaultOpen = false, borderColor = "#2a2a2a", headerBg = "#111" }: CollapsibleProps) {
  const [open, setOpen] = useState(defaultOpen)
  return (
    <div style={{ ...CARD, border: `1px solid ${borderColor}` }}>
      <button
        onClick={() => setOpen(o => !o)}
        style={{
          display: "flex",
          alignItems: "center",
          gap: 6,
          width: "100%",
          background: headerBg,
          border: "none",
          cursor: "pointer",
          padding: "4px 8px",
          textAlign: "left",
          ...MONO,
        }}
      >
        <span style={{ color: "#6b7280", fontSize: 10, flexShrink: 0 }}>{open ? "▾" : "▸"}</span>
        {header}
      </button>
      {open && children}
    </div>
  )
}

// ---------------------------------------------------------------------------
// Output panel — shared pre-formatted result area
// ---------------------------------------------------------------------------

function OutputPanel({ text, bg = "#0d0d0f" }: { text: string; bg?: string }) {
  return (
    <pre
      style={{
        margin: 0,
        padding: "6px 10px",
        fontSize: 11,
        color: "#d1d5db",
        background: bg,
        overflowX: "auto",
        whiteSpace: "pre",
        wordBreak: "normal",
        ...MONO,
      }}
    >
      {text}
    </pre>
  )
}

// ---------------------------------------------------------------------------
// PlanList
// ---------------------------------------------------------------------------

const PRIORITY_COLOR: Record<PlanEntry["priority"], string> = {
  high: "#f87171",
  medium: "#facc15",
  low: "#6b7280",
}

const STATUS_ICON: Record<PlanEntry["status"], string> = {
  completed: "✓",
  in_progress: "▸",
  pending: "○",
}

export function PlanList({ entries }: { entries: PlanEntry[] }) {
  return (
    <div
      style={{
        border: "1px solid #1e3a1e",
        borderRadius: 5,
        overflow: "hidden",
        margin: "4px 0",
      }}
    >
      <div
        style={{
          background: "#0d1f0d",
          padding: "3px 10px",
          color: "#4ade80",
          fontSize: 10,
          letterSpacing: "0.06em",
          textTransform: "uppercase",
          ...MONO,
        }}
      >
        plan · {entries.length} items
      </div>
      <div style={{ padding: "4px 0" }}>
        {entries.map((entry, i) => {
          const done = entry.status === "completed"
          const active = entry.status === "in_progress"
          return (
            <div
              key={i}
              style={{
                display: "flex",
                alignItems: "flex-start",
                gap: 8,
                padding: "3px 10px",
                opacity: done ? 0.45 : 1,
              }}
            >
              <span
                style={{
                  color: active ? "#22d3ee" : done ? "#4b5563" : STATUS_ICON[entry.status] === "○" ? "#6b7280" : "#e8e8e8",
                  flexShrink: 0,
                  ...MONO,
                  fontSize: 11,
                }}
              >
                {STATUS_ICON[entry.status]}
              </span>
              <span
                style={{
                  color: done ? "#4b5563" : "#d1d5db",
                  textDecoration: done ? "line-through" : "none",
                  fontSize: 11,
                  lineHeight: 1.5,
                  flex: 1,
                }}
              >
                {entry.content}
              </span>
              <span
                style={{
                  color: PRIORITY_COLOR[entry.priority],
                  fontSize: 9,
                  flexShrink: 0,
                  opacity: 0.7,
                  alignSelf: "center",
                  ...MONO,
                }}
              >
                {entry.priority}
              </span>
            </div>
          )
        })}
      </div>
    </div>
  )
}

// ---------------------------------------------------------------------------
// BashBlock — /bash|shell|exec|command|terminal/i
// ---------------------------------------------------------------------------

interface ToolBlockProps {
  call: ToolCallEvent
  result: ToolResultEvent | null
  running: boolean
}

export function BashBlock({ call, result, running }: ToolBlockProps) {
  const command =
    (typeof call.arguments["command"] === "string" ? call.arguments["command"] : null) ??
    firstStringArg(call.arguments) ??
    call.toolName

  const cleanedResult = useMemo(
    () => (result ? cleanToolText(result.result) : null),
    [result]
  )

  return (
    <div
      style={{
        ...CARD,
        border: "1px solid #1e2d1a",
      }}
    >
      {/* Header — always visible, terminal-card style */}
      <div
        style={{
          background: "#0e1a0a",
          padding: "4px 10px",
          display: "flex",
          alignItems: "center",
          gap: 8,
          ...MONO,
        }}
      >
        <span style={{ color: "#4ade80", fontSize: 12 }}>$</span>
        <span style={{ color: "#e8e8e8", flex: 1, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
          {command}
        </span>
        {running && !result && (
          <span style={{ color: "#facc15", fontSize: 9, flexShrink: 0 }}>running…</span>
        )}
      </div>
      {/* Output */}
      {cleanedResult !== null && (
        <OutputPanel text={cleanedResult} bg="#0b110a" />
      )}
    </div>
  )
}

// ---------------------------------------------------------------------------
// FileViewBlock — /read|view|cat|open/i
// ---------------------------------------------------------------------------

export function FileViewBlock({ call, result, running }: ToolBlockProps) {
  const filePath = pathArg(call.arguments) ?? call.toolName
  const cleanedResult = useMemo(
    () => (result ? cleanToolText(result.result) : null),
    [result]
  )

  return (
    <Collapsible
      defaultOpen={false}
      borderColor="#222a33"
      headerBg="#0d1520"
      header={
        <>
          <span style={{ color: "#22d3ee", fontSize: 10 }}>view</span>
          <span style={{ color: "#93c5fd", flex: 1, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
            {filePath}
          </span>
          {running && !result && (
            <span style={{ color: "#facc15", fontSize: 9, flexShrink: 0 }}>reading…</span>
          )}
        </>
      }
    >
      {cleanedResult !== null && <OutputPanel text={cleanedResult} bg="#0b1018" />}
    </Collapsible>
  )
}

// ---------------------------------------------------------------------------
// FileEditBlock — /write|edit|str_replace|create|patch/i
// ---------------------------------------------------------------------------

export function FileEditBlock({ call, result, running }: ToolBlockProps) {
  const filePath = pathArg(call.arguments) ?? call.toolName
  const cleanedResult = useMemo(
    () => (result ? cleanToolText(result.result) : null),
    [result]
  )

  return (
    <Collapsible
      defaultOpen={false}
      borderColor="#2a1f33"
      headerBg="#150d20"
      header={
        <>
          <span style={{ color: "#a78bfa", fontSize: 10 }}>edit</span>
          <span style={{ color: "#c4b5fd", flex: 1, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
            {filePath}
          </span>
          <span style={{ color: "#6b7280", fontSize: 9, flexShrink: 0 }}>edited</span>
          {running && !result && (
            <span style={{ color: "#facc15", fontSize: 9, flexShrink: 0, marginLeft: 4 }}>writing…</span>
          )}
        </>
      }
    >
      {cleanedResult !== null && <OutputPanel text={cleanedResult} bg="#100b18" />}
    </Collapsible>
  )
}

// ---------------------------------------------------------------------------
// Generic ToolBlock
// ---------------------------------------------------------------------------

export function GenericToolBlock({ call, result, running }: ToolBlockProps) {
  const argsEmpty =
    Object.keys(call.arguments).length === 0 ||
    (Object.keys(call.arguments).length === 1 && Object.values(call.arguments)[0] === "")

  const argsText = useMemo(
    () => (argsEmpty ? null : JSON.stringify(call.arguments, null, 2)),
    [call.arguments, argsEmpty]
  )

  const cleanedResult = useMemo(
    () => (result ? cleanToolText(result.result) : null),
    [result]
  )

  return (
    <Collapsible
      defaultOpen={false}
      borderColor="#2a2a2a"
      headerBg="#111"
      header={
        <>
          <span style={{ color: "#6b7280", fontSize: 10 }}>tool</span>
          <span style={{ color: "#e8e8e8", flex: 1 }}>{call.toolName}</span>
          {running && !result && (
            <span style={{ color: "#facc15", fontSize: 9, flexShrink: 0 }}>running…</span>
          )}
        </>
      }
    >
      {argsText && (
        <div style={{ borderBottom: "1px solid #1a1a1a" }}>
          <div style={{ padding: "2px 8px", color: "#4b5563", fontSize: 10, ...MONO }}>args</div>
          <pre
            style={{
              margin: 0,
              padding: "4px 10px",
              fontSize: 11,
              color: "#9ca3af",
              background: "#0d0d0f",
              overflowX: "auto",
              whiteSpace: "pre-wrap",
              wordBreak: "break-all",
              ...MONO,
            }}
          >
            {argsText}
          </pre>
        </div>
      )}
      {cleanedResult !== null && (
        <div>
          <div style={{ padding: "2px 8px", color: "#4b5563", fontSize: 10, ...MONO }}>result</div>
          <OutputPanel text={cleanedResult} />
        </div>
      )}
    </Collapsible>
  )
}

// ---------------------------------------------------------------------------
// Dispatcher — pick the right block for a toolName
// ---------------------------------------------------------------------------

export function ToolPairBlock({ call, result, running }: ToolBlockProps) {
  const name = call.toolName.toLowerCase()

  // Plan with entries in args
  if (/todo|plan/.test(name)) {
    const entries = call.arguments["entries"]
    if (Array.isArray(entries) && entries.length > 0) {
      // Safe cast: validate shape
      const typed = (entries as unknown[]).filter(
        (e): e is PlanEntry =>
          typeof e === "object" &&
          e !== null &&
          "content" in e &&
          "priority" in e &&
          "status" in e
      )
      if (typed.length > 0) return <PlanList entries={typed} />
    }
  }

  if (/bash|shell|exec|command|terminal/.test(name)) {
    return <BashBlock call={call} result={result} running={running} />
  }
  if (/read|view|cat|open/.test(name)) {
    return <FileViewBlock call={call} result={result} running={running} />
  }
  if (/write|edit|str_replace|create|patch/.test(name)) {
    return <FileEditBlock call={call} result={result} running={running} />
  }
  return <GenericToolBlock call={call} result={result} running={running} />
}
