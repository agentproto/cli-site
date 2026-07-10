import type { Viewport } from "next"

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
}

export default function PanelLayout({ children }: { children: React.ReactNode }): React.ReactElement {
  return <>{children}</>
}
