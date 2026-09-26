"use client"

import { useEffect, useState } from "react"
import { PAIR_DOMAIN, pairHostMode } from "@/lib/pair-host"

/**
 * The honest caveat of a shared origin (cli.agentproto.sh, localhost): every
 * daemon paired here shares this origin's storage and service workers, so a
 * daemon's Control Center could reach another daemon's pairing. Renders
 * nothing on a per-daemon origin. Client-only: it reads the host.
 */
export function SharedOriginNotice(): React.ReactElement | null {
  const [shared, setShared] = useState(false)
  useEffect(() => {
    setShared(pairHostMode(window.location.hostname).kind === "shared")
  }, [])
  if (!shared) return null
  return (
    <p className="border-t border-fd-border pt-3 text-xs">
      <strong className="font-medium text-fd-foreground">Shared address.</strong> Every daemon paired on{" "}
      {typeof window === "undefined" ? "this site" : window.location.host} shares its storage, so one
      daemon&apos;s Control Center could use another&apos;s pairing. The pairing QR normally opens the
      daemon&apos;s own address, <code>&lt;fingerprint&gt;.{PAIR_DOMAIN}</code>, which keeps each pairing
      separate.
    </p>
  )
}
