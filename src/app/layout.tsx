import type { Metadata } from "next"
import { IBM_Plex_Mono, IBM_Plex_Sans, IBM_Plex_Serif } from "next/font/google"
import { RootProvider } from "fumadocs-ui/provider/next"
import { BrandRibbon } from "@/components/brand-ribbon"
import "./global.css"

const plexSans = IBM_Plex_Sans({
  subsets: ["latin"],
  weight: ["400", "500", "600"],
  variable: "--font-plex-sans",
})
const plexMono = IBM_Plex_Mono({
  subsets: ["latin"],
  weight: ["400", "600"],
  variable: "--font-plex-mono",
})
const plexSerif = IBM_Plex_Serif({
  subsets: ["latin"],
  weight: ["600", "700"],
  style: ["normal", "italic"],
  variable: "--font-plex-serif",
})

export const metadata: Metadata = {
  title: {
    default: "agentproto CLI — install, run, orchestrate agent CLIs",
    template: "%s — agentproto CLI",
  },
  description:
    "The agentproto binary: install adapters, run a single turn or a persistent session, serve a daemon, watch everything live in the panel.",
  metadataBase: new URL("https://cli.agentproto.sh"),
  openGraph: {
    title: "agentproto CLI",
    description: "Install it. Run an agent. Watch it live.",
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
    <html
      lang="en"
      suppressHydrationWarning
      className={`${plexSans.variable} ${plexMono.variable} ${plexSerif.variable}`}
    >
      <body className="flex flex-col min-h-screen">
        <RootProvider>
          <BrandRibbon current="cli" />
          <div className="flex-1">{children}</div>
        </RootProvider>
      </body>
    </html>
  )
}
