"use client"

import { usePathname } from "next/navigation"

/**
 * Cross-site ribbon: the one element that stitches the agentproto
 * surfaces (protocol site, CLI site, live panel) into a single brand.
 *
 * IDENTICAL COPY in agentproto/site and agentproto/cli-site, both at
 * src/components/brand-ribbon.tsx — only the `current` prop differs
 * at the call site. Hidden on /panel, which is a full-height app.
 */
const SURFACES = [
  { key: "protocol", label: "protocol", host: "agentproto.sh", url: "https://agentproto.sh" },
  { key: "cli", label: "cli", host: "cli.agentproto.sh", url: "https://cli.agentproto.sh" },
  { key: "panel", label: "panel", host: "/panel", url: "https://cli.agentproto.sh/panel" },
] as const

export type BrandSurface = (typeof SURFACES)[number]["key"]

export function BrandRibbon({
  current,
}: {
  current: BrandSurface
}): React.ReactElement | null {
  const pathname = usePathname()
  if (pathname?.startsWith("/panel")) return null

  return (
    <div className="border-b border-fd-border bg-fd-background">
      <div className="container mx-auto flex max-w-6xl gap-x-5 overflow-x-auto px-6 py-1.5 font-mono text-[10.5px] tracking-[0.1em] whitespace-nowrap">
        {SURFACES.map(s =>
          s.key === current ? (
            <span key={s.key} className="text-fd-muted-foreground">
              <b className="font-semibold text-fd-primary">{s.label}</b> {s.host}
            </span>
          ) : (
            <a
              key={s.key}
              href={s.url}
              className="text-fd-muted-foreground transition-colors hover:text-fd-foreground"
            >
              {s.label} {s.host}
            </a>
          )
        )}
      </div>
    </div>
  )
}
