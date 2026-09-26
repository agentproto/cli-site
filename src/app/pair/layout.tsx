import type { Metadata, Viewport } from "next"
import { pairMetadata, pairViewport } from "@/components/pair-shell"

export const viewport: Viewport = pairViewport

export const metadata: Metadata = { ...pairMetadata, title: "Pair a phone" }

export default function PairLayout({ children }: { children: React.ReactNode }): React.ReactElement {
  return <>{children}</>
}
