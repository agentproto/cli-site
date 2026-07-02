"use client"

import { useCallback, useEffect, useRef, useState } from "react"

// ---------------------------------------------------------------------------
// Event type definitions
// ---------------------------------------------------------------------------

interface BaseEvent {
  seq: number
  ts: string
  kind: string
  sessionId: string
}

export interface UserPromptEvent extends BaseEvent {
  kind: "user-prompt"
  text: string
}

export interface TextDeltaEvent extends BaseEvent {
  kind: "text-delta"
  text: string
  partial?: boolean
}

export interface ThoughtEvent extends BaseEvent {
  kind: "thought"
  text: string
}

export interface ToolCallEvent extends BaseEvent {
  kind: "tool-call"
  toolCallId: string
  toolName: string
  arguments: Record<string, unknown>
}

export interface ToolResultEvent extends BaseEvent {
  kind: "tool-result"
  toolCallId: string
  result: string
}

export interface PlanEntry {
  content: string
  priority: "high" | "medium" | "low"
  status: "pending" | "in_progress" | "completed"
}

export interface PlanEvent extends BaseEvent {
  kind: "plan"
  entries: PlanEntry[]
}

export interface UsageCost {
  amount: number
  currency: string
}

export interface UsageUpdateEvent extends BaseEvent {
  kind: "usage_update"
  size: number
  used: number
  cost?: UsageCost
}

export interface TurnEndEvent extends BaseEvent {
  kind: "turn-end"
  reason: string
}

export type SessionEvent =
  | UserPromptEvent
  | TextDeltaEvent
  | ThoughtEvent
  | ToolCallEvent
  | ToolResultEvent
  | PlanEvent
  | UsageUpdateEvent
  | TurnEndEvent

// ---------------------------------------------------------------------------
// API response shape
// ---------------------------------------------------------------------------

interface EventsResponse {
  sessionId: string
  events: SessionEvent[]
  nextSeq: number
  complete: boolean
}

// ---------------------------------------------------------------------------
// Hook result
// ---------------------------------------------------------------------------

export interface UseSessionEventsResult {
  /** Accumulated events (all since mount), in seq order. */
  events: SessionEvent[]
  /** true when the /events endpoint returned 404 — caller should fall back to export polling. */
  notSupported: boolean
  /** true while the first fetch is in-flight. */
  loading: boolean
  /** Latest fetch error string, null when healthy. */
  error: string | null
}

// ---------------------------------------------------------------------------
// Hook
// ---------------------------------------------------------------------------

const POLL_MS = 2_000

export function useSessionEvents(
  daemonUrl: string,
  sessionId: string,
  sessionStatus: string,
): UseSessionEventsResult {
  const [events, setEvents] = useState<SessionEvent[]>([])
  const [notSupported, setNotSupported] = useState(false)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  // Refs so the polling closure always sees the latest values without re-creating timers.
  const nextSeqRef = useRef<number>(0)
  const notSupportedRef = useRef(false)
  const isRunning = sessionStatus === "running"

  // Reset when session changes.
  useEffect(() => {
    setEvents([])
    setNotSupported(false)
    setLoading(true)
    setError(null)
    nextSeqRef.current = 0
    notSupportedRef.current = false
  }, [sessionId])

  const fetchEvents = useCallback(async (): Promise<boolean> => {
    if (notSupportedRef.current) return false
    const url = `${daemonUrl}/sessions/${encodeURIComponent(sessionId)}/events?since=${nextSeqRef.current}`
    try {
      const res = await fetch(url, { mode: "cors", credentials: "include" })
      if (res.status === 404) {
        // Endpoint doesn't exist on this daemon version — permanent fallback.
        notSupportedRef.current = true
        setNotSupported(true)
        setLoading(false)
        return false
      }
      if (!res.ok) {
        throw new Error(`HTTP ${res.status}`)
      }
      const body = (await res.json()) as EventsResponse
      if (body.events.length > 0) {
        setEvents(prev => {
          // Deduplicate by seq in case of duplicate delivery.
          const seen = new Set(prev.map(e => e.seq))
          const fresh = body.events.filter(e => !seen.has(e.seq))
          if (fresh.length === 0) return prev
          return [...prev, ...fresh].sort((a, b) => a.seq - b.seq)
        })
        nextSeqRef.current = body.nextSeq
      }
      setError(null)
      setLoading(false)
      return true
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
      setLoading(false)
      return false
    }
  }, [daemonUrl, sessionId])

  useEffect(() => {
    let cancelled = false
    let timer: ReturnType<typeof setTimeout> | null = null

    const tick = async () => {
      if (cancelled || notSupportedRef.current) return
      await fetchEvents()
      if (cancelled || notSupportedRef.current) return
      if (isRunning) {
        timer = setTimeout(tick, POLL_MS)
      }
    }

    void tick()

    return () => {
      cancelled = true
      if (timer) clearTimeout(timer)
    }
  }, [fetchEvents, isRunning, sessionId])

  return { events, notSupported, loading, error }
}
