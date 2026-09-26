import type { Metadata, Viewport } from "next"
import { pairMetadata, pairViewport } from "@/components/pair-shell"

export const viewport: Viewport = pairViewport

export const metadata: Metadata = { ...pairMetadata, title: "Control Center" }

/** `/d/<id>` is the status page for one paired daemon. Everything under
 *  `/d/<id>/` is answered by that pairing's service worker; these routes only
 *  render when it isn't in control yet (see src/lib/pair.ts). */
export default function DaemonLayout({ children }: { children: React.ReactNode }): React.ReactElement {
  return <>{children}</>
}
