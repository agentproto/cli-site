"use client"

import { useState } from "react"
import { cn } from "@/lib/utils"

interface CopyCommandProps {
  /** The command text to copy. */
  command: string
  className?: string
}

/**
 * A mono one-liner install command in a bordered pill with a copy
 * button. Uses navigator.clipboard; button text flips to "Copied"
 * for 1.5s on success.
 */
export function CopyCommand({
  command,
  className,
}: CopyCommandProps): React.ReactElement {
  const [copied, setCopied] = useState(false)

  async function copy() {
    try {
      await navigator.clipboard.writeText(command)
      setCopied(true)
      window.setTimeout(() => setCopied(false), 1500)
    } catch {
      // Clipboard API may be unavailable (insecure context); no-op.
    }
  }

  return (
    <div
      className={cn(
        "inline-flex items-center gap-2 border border-fd-foreground/80 bg-fd-card px-3.5 py-2 font-mono text-sm",
        className
      )}
    >
      <span aria-hidden="true" className="font-semibold text-fd-primary">
        $
      </span>
      <span className="select-all text-fd-foreground">{command}</span>
      <button
        type="button"
        onClick={copy}
        aria-label="Copy command"
        className={cn(
          "inline-flex items-center rounded-md border px-2 py-1 text-xs font-medium transition-colors select-none",
          copied
            ? "border-green-500/40 bg-green-500/10 text-green-500"
            : "border-fd-border text-fd-muted-foreground hover:text-fd-foreground hover:border-fd-primary/40"
        )}
      >
        {copied ? "Copied" : "Copy"}
      </button>
    </div>
  )
}
