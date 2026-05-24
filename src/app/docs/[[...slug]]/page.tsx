import { notFound } from "next/navigation"
import {
  DocsPage,
  DocsBody,
  DocsTitle,
  DocsDescription,
} from "fumadocs-ui/page"
import defaultMdxComponents from "fumadocs-ui/mdx"
import type { ComponentType } from "react"
import type { TOCItemType } from "fumadocs-core/toc"
import { docsSource } from "@/lib/docs-source"

interface DocsParamProps {
  params: Promise<{ slug?: string[] }>
}

export async function generateStaticParams(): Promise<{ slug?: string[] }[]> {
  return docsSource.generateParams()
}

export async function generateMetadata({ params }: DocsParamProps) {
  const { slug } = await params
  const page = docsSource.getPage(slug)
  if (!page) return {}
  const data = page.data as { title?: string; description?: string }
  return {
    title: data.title,
    description: data.description,
  }
}

interface CliPageData {
  title?: string
  description?: string
  full?: boolean
  toc: TOCItemType[]
  body: ComponentType<{ components?: Record<string, unknown> }>
}

export default async function Page({
  params,
}: DocsParamProps): Promise<React.ReactElement> {
  const { slug } = await params
  const page = docsSource.getPage(slug)
  if (!page) notFound()

  const data = page.data as CliPageData
  const MDXContent = data.body

  return (
    <DocsPage toc={data.toc} full={data.full}>
      <DocsTitle>{data.title ?? "Untitled"}</DocsTitle>
      {data.description && <DocsDescription>{data.description}</DocsDescription>}
      <DocsBody>
        <MDXContent components={defaultMdxComponents} />
      </DocsBody>
    </DocsPage>
  )
}
