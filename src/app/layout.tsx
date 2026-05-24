import type { Metadata } from "next"
import { RootProvider } from "fumadocs-ui/provider/next"
import "./global.css"

export const metadata: Metadata = {
  title: {
    default: "agentproto CLI — install, run, orchestrate agent CLIs",
    template: "%s — agentproto CLI",
  },
  description:
    "Reference host for AgentProto agent-CLI adapters. Install adapters, run a single turn or a persistent session, expose them as a daemon, orchestrate multi-agent swarms.",
  metadataBase: new URL("https://cli.agentproto.sh"),
  openGraph: {
    title: "agentproto CLI",
    description:
      "The `agentproto` binary — install, run, orchestrate AgentProto agent-CLI adapters.",
    url: "https://cli.agentproto.sh",
    siteName: "agentproto CLI",
    type: "website",
  },
}

export default function RootLayout({
  children,
}: {
  children: React.ReactNode
}): React.ReactElement {
  return (
    <html lang="en" suppressHydrationWarning>
      <body className="flex flex-col min-h-screen">
        <RootProvider>
          <div className="flex-1">{children}</div>
        </RootProvider>
      </body>
    </html>
  )
}
