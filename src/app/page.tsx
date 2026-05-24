import Link from "next/link"

export default function Home(): React.ReactElement {
  return (
    <main className="mx-auto max-w-3xl px-6 py-16 sm:py-24">
      <h1 className="text-3xl font-semibold tracking-tight sm:text-4xl">
        <span className="font-mono">agentproto</span> CLI
      </h1>
      <p className="mt-4 text-base text-fd-muted-foreground">
        Reference host for AgentProto agent-CLI adapters. Install
        adapters, run a single turn or a persistent session, expose
        them as a daemon, orchestrate multi-agent swarms.
      </p>

      <div className="mt-8 flex flex-wrap gap-3">
        <Link
          href="/docs/getting-started"
          className="inline-flex items-center rounded-md bg-fd-primary px-4 py-2 text-sm font-medium text-fd-primary-foreground transition hover:opacity-90"
        >
          Get started
        </Link>
        <Link
          href="/docs"
          className="inline-flex items-center rounded-md border border-fd-border px-4 py-2 text-sm font-medium text-fd-foreground transition hover:bg-fd-accent"
        >
          Browse the docs
        </Link>
        <a
          href="https://github.com/agentproto/ts"
          className="inline-flex items-center rounded-md border border-fd-border px-4 py-2 text-sm font-medium text-fd-foreground transition hover:bg-fd-accent"
        >
          GitHub
        </a>
      </div>

      <section className="mt-12">
        <h2 className="text-lg font-semibold">Install</h2>
        <pre className="mt-3 rounded-md border border-fd-border bg-fd-card p-4 text-sm overflow-x-auto">
          <code>{`npm i -g @agentproto/cli
agentproto --version`}</code>
        </pre>
      </section>

      <section className="mt-12 grid gap-6 sm:grid-cols-3">
        <PathCard
          title="Run an agent CLI locally"
          body="Install an adapter (claude-code, hermes, …) and run a single turn or a persistent session."
          href="/docs/verbs/install"
        />
        <PathCard
          title="Share with a hosted agent"
          body="Log in via device flow, then expose your machine as a daemon over an outbound WebSocket tunnel."
          href="/docs/verbs/serve"
        />
        <PathCard
          title="Orchestrate a swarm"
          body="Compose a substrate + dispatcher + participants in a manifest. Kernel-routed, plugin-extensible."
          href="/docs/verbs/run-swarm"
        />
      </section>

      <section className="mt-12">
        <h2 className="text-lg font-semibold">Reference docs</h2>
        <p className="mt-2 text-sm text-fd-muted-foreground">
          Verb-by-verb usage, concepts, and exact on-disk schemas
          live under <code>/docs</code>. The pages are synced from{" "}
          <a
            href="https://github.com/agentproto/ts/tree/main/docs/cli"
            className="underline"
          >
            agentproto/ts:docs/cli
          </a>{" "}
          at build time — same source the package ships next to its
          code.
        </p>
      </section>

      <footer className="mt-16 border-t border-fd-border pt-6 text-xs text-fd-muted-foreground">
        <p>
          For the protocol itself, see{" "}
          <a href="https://agentproto.sh" className="underline">
            agentproto.sh
          </a>
          .
        </p>
      </footer>
    </main>
  )
}

function PathCard({
  title,
  body,
  href,
}: {
  title: string
  body: string
  href: string
}): React.ReactElement {
  return (
    <Link
      href={href}
      className="block rounded-md border border-fd-border bg-fd-card p-4 transition hover:bg-fd-accent"
    >
      <h3 className="text-sm font-semibold">{title}</h3>
      <p className="mt-1 text-sm text-fd-muted-foreground">{body}</p>
    </Link>
  )
}
