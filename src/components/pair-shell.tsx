import type { Metadata, Viewport } from "next"
import { cn } from "@/lib/utils"

/** Shared by the `/pair` and `/d/<id>` layouts: phone viewport, the
 *  add-to-home-screen manifest, and no indexing (these pages are per-device). */
export const pairViewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
  themeColor: "#0d1512",
}

export const pairMetadata: Metadata = {
  manifest: "/pair.webmanifest",
  robots: { index: false, follow: false },
  appleWebApp: { capable: true, title: "agentproto", statusBarStyle: "black-translucent" },
  icons: { apple: "/pair-icon-192.png" },
}

export type Tone = "neutral" | "ok" | "warn" | "danger"

const DOT: Record<Tone, string> = {
  neutral: "bg-fd-muted-foreground",
  ok: "bg-[var(--phos)] shadow-[0_0_6px_var(--phos)]",
  warn: "bg-[var(--amber)] animate-pulse",
  danger: "bg-[var(--color-fd-danger)]",
}

export function PairShell({
  eyebrow,
  title,
  tone = "neutral",
  children,
}: {
  eyebrow: string
  title: string
  tone?: Tone
  children?: React.ReactNode
}): React.ReactElement {
  return (
    <main className="mx-auto flex min-h-[70vh] w-full max-w-md flex-col justify-center px-5 py-10">
      <div className="rounded-xl border border-fd-border bg-fd-card p-6 shadow-sm">
        <div className="mb-3 flex items-center gap-2 font-mono text-xs uppercase tracking-wider text-fd-muted-foreground">
          <span className={cn("inline-block size-2 rounded-full", DOT[tone])} />
          {eyebrow}
        </div>
        <h1 className="mb-4 text-xl font-semibold leading-snug">{title}</h1>
        <div className="flex flex-col gap-4 text-sm text-fd-muted-foreground">{children}</div>
      </div>
    </main>
  )
}

export function Fingerprint({ value }: { value: string }): React.ReactElement {
  return (
    <code className="block rounded-md bg-fd-muted px-3 py-2 text-center font-mono text-lg tracking-widest text-fd-foreground">
      {value}
    </code>
  )
}

export function PairButton({
  variant = "primary",
  className,
  ...props
}: React.ButtonHTMLAttributes<HTMLButtonElement> & { variant?: "primary" | "secondary" | "danger" }): React.ReactElement {
  return (
    <button
      type="button"
      {...props}
      className={cn(
        "min-h-11 flex-1 rounded-md px-4 text-sm font-medium transition-colors disabled:cursor-not-allowed disabled:opacity-50",
        variant === "primary" && "bg-fd-primary text-fd-primary-foreground hover:opacity-90",
        variant === "secondary" && "border border-fd-border bg-transparent text-fd-foreground hover:bg-fd-muted",
        variant === "danger" && "border border-[var(--color-fd-danger)]/40 bg-transparent text-[var(--color-fd-danger)] hover:bg-[var(--color-fd-danger)]/10",
        className,
      )}
    />
  )
}

export function Command({ children }: { children: string }): React.ReactElement {
  return (
    <code className="block overflow-x-auto rounded-md bg-[var(--term-bg)] px-3 py-2 font-mono text-[13px] text-[var(--term-text)]">
      <span className="select-none text-[var(--phos)]">$ </span>
      {children}
    </code>
  )
}

/** Where to get a QR — shown whenever there is nothing (usable) to open. */
export function HowToPair(): React.ReactElement {
  return (
    <>
      <p>On the computer running the agentproto daemon:</p>
      <Command>agentproto pair offer --qr</Command>
      <p>
        Scan the QR code with this phone&apos;s camera. The pairing link opens here, and you confirm the
        daemon&apos;s fingerprint against the one printed in the terminal.
      </p>
    </>
  )
}
