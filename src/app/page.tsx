import Image from "next/image"
import Link from "next/link"
import { CopyCommand } from "@/components/copy-command"
import { HeroTerminal } from "@/components/hero-terminal"

const PATHS = [
  {
    cmd: "agentproto run",
    title: "Run an agent locally",
    body: "Install an adapter (claude-code, hermes, …) and run a single turn or a persistent session.",
    href: "/docs/verbs/install",
  },
  {
    cmd: "agentproto serve",
    title: "Share with a hosted agent",
    body: "Log in via device flow, then expose your machine as a daemon over an outbound WebSocket tunnel.",
    href: "/docs/verbs/serve",
  },
  {
    cmd: "agentproto run-swarm",
    title: "Orchestrate a swarm",
    body: "Compose a substrate + dispatcher + participants in a manifest. Kernel-routed, plugin-extensible.",
    href: "/docs/verbs/run-swarm",
  },
]

/**
 * Landing page for cli.agentproto.sh — the tool site. The visitor
 * has already decided to try the CLI (or is about to): the page's
 * one job is a first success in 60 seconds. Terminal first, panel
 * second, reference paths third.
 */
export default function Home(): React.ReactElement {
  return (
    <main className="mx-auto max-w-5xl px-6 py-14 sm:py-20">
      {/* ── 1. Hero — the terminal is the pitch ─────────────────── */}
      <section className="grid gap-10 lg:grid-cols-[0.9fr_1.1fr] lg:items-center">
        <div className="min-w-0">
          <p className="mb-5 font-mono text-xs uppercase tracking-[0.14em] text-fd-muted-foreground">
            <span aria-hidden="true" className="session-blink mr-2 text-fd-primary">
              ▍
            </span>
            reference host · 9 adapters · v1 on npm
          </p>
          <h1 className="mb-4 font-serif text-4xl font-bold leading-[1.08] tracking-tight text-balance sm:text-5xl">
            Install it. Run an agent.{" "}
            <em className="text-fd-primary">Watch it live.</em>
          </h1>
          <p className="mb-7 max-w-md text-base leading-relaxed text-fd-muted-foreground text-pretty">
            The reference host for AgentProto adapters — run a turn, keep a
            session, serve a daemon, orchestrate a swarm. One binary.
          </p>
          <div className="mb-6">
            <CopyCommand command="npm i -g @agentproto/cli" />
          </div>
          <div className="flex flex-wrap gap-3">
            <Link
              href="/docs/getting-started"
              className="bg-fd-foreground px-5 py-2 font-medium text-fd-background transition-opacity hover:opacity-85"
            >
              Get started
            </Link>
            <Link
              href="/panel"
              className="border border-fd-border px-5 py-2 font-medium transition-colors hover:border-fd-primary/50"
            >
              Open the panel
            </Link>
            <a
              href="https://github.com/agentproto/ts"
              className="border border-fd-border px-5 py-2 font-medium transition-colors hover:border-fd-primary/50"
            >
              GitHub
            </a>
          </div>
        </div>
        <HeroTerminal />
      </section>

      {/* ── 2. The panel, on stage ──────────────────────────────── */}
      <section className="mt-20 border-t border-fd-border pt-14">
        <div className="mb-8 flex flex-wrap items-end justify-between gap-4">
          <div>
            <p className="font-mono text-xs uppercase tracking-[0.14em] text-fd-muted-foreground">
              <span
                aria-hidden="true"
                className="mr-3 inline-block h-0.5 w-6 translate-y-[-3px] bg-fd-primary align-middle"
              />
              the panel
            </p>
            <h2 className="mt-3 font-serif text-3xl font-bold tracking-tight text-balance">
              Every session, live, in one dashboard
            </h2>
            <p className="mt-2 max-w-xl leading-relaxed text-fd-muted-foreground">
              Session sidebar, terminal/chat/JSON/event views per session,
              shareable deep-links over a tunnel. It talks to whatever daemon
              it finds on ports 18790–18795, local or remote.
            </p>
          </div>
          <Link
            href="/panel"
            className="shrink-0 bg-fd-foreground px-5 py-2 font-medium text-fd-background transition-opacity hover:opacity-85"
          >
            Open the panel
          </Link>
        </div>
        <div className="overflow-hidden border border-[var(--term-line)] bg-[var(--term-bg)] shadow-[0_24px_50px_-20px_rgba(6,24,16,0.55)]">
          <div className="flex items-center gap-2.5 border-b border-[var(--term-line)] px-4 py-2.5">
            <span
              aria-hidden="true"
              className="session-blink h-2 w-2 shrink-0 rounded-full bg-[var(--phos)]"
            />
            <span className="font-mono text-xs text-[var(--term-dim)]">
              panel · connected · http://127.0.0.1:18790
            </span>
          </div>
          <Image
            src="/panel.png"
            alt="The agentproto panel: a session sidebar on the left, a live terminal view of a running claude-code session on the right."
            width={1440}
            height={900}
            className="block w-full"
            priority={false}
          />
        </div>
      </section>

      {/* ── 3. Three paths ──────────────────────────────────────── */}
      <section className="mt-20 border-t border-fd-border pt-14">
        <div className="grid gap-10 md:grid-cols-3">
          {PATHS.map(p => (
            <Link
              key={p.cmd}
              href={p.href}
              className="group border-t-2 border-fd-primary pt-5"
            >
              <span className="font-mono text-xs text-fd-primary">{p.cmd}</span>
              <h3 className="mt-2 mb-2 font-serif text-xl font-bold group-hover:text-fd-primary">
                {p.title}
              </h3>
              <p className="text-sm leading-relaxed text-fd-muted-foreground">
                {p.body}
              </p>
            </Link>
          ))}
        </div>
      </section>

      {/* ── 4. Docs pointer ─────────────────────────────────────── */}
      <section className="mt-20 border-t border-fd-border pt-14">
        <div className="flex flex-wrap items-center justify-between gap-6 border border-fd-border bg-fd-card px-6 py-6 sm:px-8">
          <div className="min-w-0">
            <p className="font-mono text-xs uppercase tracking-[0.14em] text-fd-muted-foreground">
              reference docs
            </p>
            <p className="mt-2 max-w-xl font-serif text-lg font-bold leading-snug">
              Verb-by-verb usage, concepts, and exact on-disk schemas — synced
              from the package&apos;s own docs at build time.
            </p>
          </div>
          <Link
            href="/docs"
            className="shrink-0 border border-fd-foreground/80 px-5 py-2 font-medium transition-colors hover:border-fd-primary hover:text-fd-primary"
          >
            Browse the docs →
          </Link>
        </div>
      </section>

      <footer className="mt-16 border-t border-fd-border pt-6 text-xs text-fd-muted-foreground">
        <p>
          For the protocol itself — the daemon, orchestration, and the AIP
          spec family — see{" "}
          <a href="https://agentproto.sh" className="text-fd-primary hover:underline">
            agentproto.sh
          </a>
          .
        </p>
      </footer>
    </main>
  )
}
