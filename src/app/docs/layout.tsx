import { DocsLayout } from "fumadocs-ui/layouts/docs"
import { docsSource } from "@/lib/docs-source"

export default function Layout({
  children,
}: {
  children: React.ReactNode
}): React.ReactElement {
  return (
    <DocsLayout
      tree={docsSource.pageTree}
      nav={{
        title: "agentproto CLI",
        url: "/",
      }}
      links={[
        {
          text: "GitHub",
          url: "https://github.com/agentproto/ts",
          external: true,
        },
        {
          text: "Protocol (agentproto.sh)",
          url: "https://agentproto.sh",
          external: true,
        },
      ]}
    >
      {children}
    </DocsLayout>
  )
}
