#!/usr/bin/env node
/**
 * sync-content.mjs — pull cli docs into the site.
 *
 * Two paths, picked deterministically at script start:
 *
 *  1. **Local sibling repo** — when `../ts/docs/cli/` exists on disk
 *     (typical in the agentik-studio bootstrapped layout where the
 *     ts monorepo is a sibling), copy from there. Fast, no network.
 *
 *  2. **Git clone of the public repo** — when no sibling is present
 *     (CI / fresh clone of just `agentproto/cli-site`), clone
 *     `github.com/agentproto/ts` into `.cache/agentproto-ts/` and
 *     copy `docs/cli/` from the cache. `--depth 1` keeps it cheap.
 *
 * Output goes to `content/docs/`. Markdown files get renamed `.md` →
 * `.mdx` so Fumadocs picks them up (Fumadocs needs `.mdx`; our source
 * is plain `.md` because it ships next to code, not next to a site).
 *
 * Non-markdown assets (images, PDFs) referenced by a guide are copied
 * verbatim, byte for byte, to TWO places:
 *
 *   - `content/docs/<rel>` — fumadocs-mdx's `remarkImage` plugin turns a
 *     relative `![]()` src into a static `import` resolved against the
 *     compiled .mdx file's own directory (`fumadocs-core/dist/mdx-plugins/
 *     remark-image.js`: `getImportPath` does `path.relative(dir, file)`
 *     where `dir` is the mdx file's dirname). Webpack/Turbopack need the
 *     real file sitting there at build time for that import to resolve —
 *     it is never fetched from `public/`.
 *   - `public/docs/<rel>` — a plain markdown *link* (not an image), e.g. a
 *     "download this as a PDF" link, is NOT rewritten by remarkImage (it
 *     only visits `image` nodes) and reaches the page as a literal
 *     relative `href`. The browser resolves that against the current page
 *     URL, which is `/docs/<rel-page-path>` because `docsSource` mounts
 *     `content/docs` at `baseUrl: "/docs"` — the same relative path a
 *     sibling asset has under `content/docs`. Next.js serves `public/`
 *     files at that same path ahead of the `[[...slug]]` catch-all route,
 *     so mirroring the asset there under `public/docs/<rel>` is what
 *     actually makes the link 200 instead of 404 through the docs route.
 *
 * Frontmatter is synthesised from the first H1 + first non-heading
 * paragraph if absent, so the synced pages have title + description
 * without us having to retroactively add frontmatter to every doc.
 *
 * Idempotent: re-runs are safe and refresh stale content.
 */

import { existsSync } from "node:fs"
import { copyFile, mkdir, rm, readdir, readFile, writeFile, stat } from "node:fs/promises"
import { execFileSync } from "node:child_process"
import path from "node:path"
import { fileURLToPath } from "node:url"
import { compile } from "@mdx-js/mdx"

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const ROOT = path.resolve(__dirname, "..")

// `cli-site` lives at `projects/agentproto/cli-site/`. The ts monorepo
// is at `projects/agentproto/ts/` — same parent dir.
const SIBLING_DIR = path.resolve(ROOT, "../ts")
const SIBLING_DOCS = path.join(SIBLING_DIR, "docs/cli")
const CACHE_DIR = path.join(ROOT, ".cache/agentproto-ts")
const CACHE_DOCS = path.join(CACHE_DIR, "docs/cli")
const TARGET_DIR = path.join(ROOT, "content/docs")
const PUBLIC_DOCS_DIR = path.join(ROOT, "public/docs")

// Binary assets a guide might reference: images (for `![]()`, resolved by
// fumadocs-mdx's remarkImage as a static import) and PDFs (for a plain
// download link). Kept to what guides actually embed — not a general
// static-file mirror.
const ASSET_RE = /\.(png|jpe?g|gif|svg|webp|pdf)$/i

const REPO_URL =
  process.env.AGENTPROTO_TS_REPO_URL ?? "https://github.com/agentproto/ts.git"
const REPO_BRANCH = process.env.AGENTPROTO_TS_REPO_BRANCH ?? "main"

async function isDir(p) {
  try {
    const s = await stat(p)
    return s.isDirectory()
  } catch {
    return false
  }
}

async function walkMarkdown(dir, out = []) {
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name)
    if (entry.isDirectory()) {
      await walkMarkdown(full, out)
    } else if (entry.isFile() && (entry.name.endsWith(".md") || entry.name === "meta.json")) {
      // Include meta.json alongside .md files so Fumadocs sidebar ordering
      // (section title, page order) can be controlled from the source docs.
      out.push(full)
    }
  }
  return out
}

/** Images and PDFs a guide embeds or links to — copied verbatim, see the
 *  header comment for why this needs two destinations. */
async function walkAssets(dir, out = []) {
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name)
    if (entry.isDirectory()) {
      await walkAssets(full, out)
    } else if (entry.isFile() && ASSET_RE.test(entry.name)) {
      out.push(full)
    }
  }
  return out
}

/** Copy one asset byte-for-byte to both `content/docs/<rel>` (so
 *  remarkImage's static import resolves) and `public/docs/<rel>` (so a
 *  plain relative link to it 200s). Same relative path in both — see the
 *  header comment. */
async function copyAsset(srcAbs, srcRoot) {
  const rel = path.relative(srcRoot, srcAbs)
  for (const base of [TARGET_DIR, PUBLIC_DOCS_DIR]) {
    const dstAbs = path.join(base, rel)
    await mkdir(path.dirname(dstAbs), { recursive: true })
    await copyFile(srcAbs, dstAbs)
  }
}

/**
 * Copy a single .md file from `src` to `dst` (renamed .mdx), adding
 * minimal frontmatter when absent so Fumadocs has a title +
 * description without us touching the source docs.
 */
async function syncOne(srcAbs, srcRoot, dstRoot) {
  const rel = path.relative(srcRoot, srcAbs)

  // Pass meta.json through unchanged — no rename, no frontmatter injection.
  if (path.basename(srcAbs) === "meta.json") {
    const dstAbs = path.join(dstRoot, rel)
    await mkdir(path.dirname(dstAbs), { recursive: true })
    await writeFile(dstAbs, await readFile(srcAbs, "utf8"), "utf8")
    return
  }

  // Fumadocs uses `index.mdx` as the section landing — `/docs` resolves
  // to `content/docs/index.mdx`, `/docs/concepts` to
  // `content/docs/concepts/index.mdx`, etc. Map `README.md` → `index.mdx`
  // so the source convention (README per dir) reaches the right URL.
  const dstRel = rel
    .replace(/(^|\/)README\.md$/, "$1index.mdx")
    .replace(/\.md$/, ".mdx")
  const dstAbs = path.join(dstRoot, dstRel)
  await mkdir(path.dirname(dstAbs), { recursive: true })

  const raw = await readFile(srcAbs, "utf8")
  const transformed = mdToMdx(raw)
  const out = transformed.startsWith("---\n")
    ? transformed
    : addFrontmatter(transformed)
  await writeFile(dstAbs, out, "utf8")
}

/**
 * Quick md → mdx safety transforms applied outside fenced code blocks:
 *
 *   - `<https://…>` autolinks → `[url](url)`. MDX treats `<` followed
 *     by `/` as a JSX tag and chokes on the bare autolink form.
 */
function mdToMdx(source) {
  const lines = source.split("\n")
  let inCode = false
  for (let i = 0; i < lines.length; i++) {
    const ln = lines[i]
    if (/^```/.test(ln.trim())) {
      inCode = !inCode
      continue
    }
    if (inCode) continue
    lines[i] = ln.replace(
      /<((?:https?|wss?|ftp):\/\/[^\s>]+)>/g,
      "[$1]($1)"
    )
  }
  return lines.join("\n")
}

function addFrontmatter(body) {
  // First H1 → title. First following blank-line-separated paragraph
  // (that isn't itself a heading) → description.
  const lines = body.split("\n")
  let title
  let description
  for (let i = 0; i < lines.length; i++) {
    const ln = lines[i]
    if (!title && /^#\s+/.test(ln)) {
      title = ln.replace(/^#\s+/, "").trim()
      // Look for description in the next non-empty non-heading line.
      for (let j = i + 1; j < lines.length; j++) {
        const next = lines[j].trim()
        if (!next) continue
        if (/^#{1,6}\s+/.test(next)) break
        // Take the first paragraph (up to the next blank line).
        const para = []
        for (let k = j; k < lines.length; k++) {
          if (!lines[k].trim()) break
          para.push(lines[k])
        }
        description = para
          .join(" ")
          .replace(/`/g, "")
          .replace(/\s+/g, " ")
          .trim()
          .slice(0, 200)
        break
      }
      break
    }
  }
  const fm = ["---"]
  if (title) fm.push(`title: ${JSON.stringify(title)}`)
  if (description) fm.push(`description: ${JSON.stringify(description)}`)
  fm.push("---", "")
  return fm.join("\n") + body
}

async function syncTree(srcRoot, dstRoot) {
  await rm(dstRoot, { recursive: true, force: true })
  await mkdir(dstRoot, { recursive: true })
  const files = await walkMarkdown(srcRoot)
  for (const f of files) {
    await syncOne(f, srcRoot, dstRoot)
  }
  console.log(`[sync-content] synced ${files.length} file(s) to ${dstRoot}`)

  await rm(PUBLIC_DOCS_DIR, { recursive: true, force: true })
  const assets = await walkAssets(srcRoot)
  for (const a of assets) {
    await copyAsset(a, srcRoot)
  }
  if (assets.length > 0) {
    console.log(`[sync-content] synced ${assets.length} asset(s) to ${dstRoot} and ${PUBLIC_DOCS_DIR}`)
  }
}

async function syncFromSibling() {
  console.log(`[sync-content] using sibling repo at ${SIBLING_DIR}`)
  await syncTree(SIBLING_DOCS, TARGET_DIR)
}

async function syncFromGit() {
  console.log(`[sync-content] no sibling found — cloning ${REPO_URL}`)
  await mkdir(path.dirname(CACHE_DIR), { recursive: true })
  if (existsSync(CACHE_DIR)) {
    try {
      execFileSync("git", ["-C", CACHE_DIR, "fetch", "--depth", "1", "origin", REPO_BRANCH], { stdio: "inherit" })
      execFileSync("git", ["-C", CACHE_DIR, "reset", "--hard", `origin/${REPO_BRANCH}`], { stdio: "inherit" })
    } catch (err) {
      console.warn(`[sync-content] cache fetch failed (${err.message}) — re-cloning`)
      await rm(CACHE_DIR, { recursive: true, force: true })
      execFileSync("git", ["clone", "--depth", "1", "--branch", REPO_BRANCH, REPO_URL, CACHE_DIR], { stdio: "inherit" })
    }
  } else {
    execFileSync("git", ["clone", "--depth", "1", "--branch", REPO_BRANCH, REPO_URL, CACHE_DIR], { stdio: "inherit" })
  }
  if (!(await isDir(CACHE_DOCS))) {
    throw new Error(`[sync-content] cache clone succeeded but ${CACHE_DOCS} does not exist`)
  }
  await syncTree(CACHE_DOCS, TARGET_DIR)
}

function stripFrontmatter(src) {
  if (!src.startsWith("---\n")) return src
  const end = src.indexOf("\n---\n", 4)
  if (end === -1) return src
  const linesConsumed = src.slice(0, end + 5).split("\n").length - 1
  return "\n".repeat(linesConsumed) + src.slice(end + 5)
}

async function findMdxFiles(dir, out = []) {
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name)
    if (entry.isDirectory()) await findMdxFiles(full, out)
    else if (entry.name.endsWith(".mdx")) out.push(full)
  }
  return out
}

// Catch a broken doc BEFORE `next build` ever sees it — e.g. a
// kramdown-style `{#custom-id}` heading suffix or a brace that MDX
// tries to parse as a JS expression. Flat "file:line" list while the
// content is still sitting here, synced but not yet committed to a
// build.
async function validateContent() {
  const files = await findMdxFiles(TARGET_DIR)
  const failures = []
  for (const file of files) {
    const src = stripFrontmatter(await readFile(file, "utf8"))
    try {
      await compile(src, { format: "mdx" })
    } catch (err) {
      const rel = path.relative(TARGET_DIR, file)
      const at = err.place ? ` @ line ${err.place.line ?? "?"}` : ""
      failures.push(`  ${rel}${at}: ${err.message}`)
    }
  }
  if (failures.length > 0) {
    throw new Error(
      `[sync-content] ${failures.length} synced .mdx file(s) fail to compile:\n${failures.join("\n")}`
    )
  }
}

async function main() {
  if (await isDir(SIBLING_DOCS)) {
    await syncFromSibling()
  } else {
    await syncFromGit()
  }
  await validateContent()
  console.log(`[sync-content] done`)
}

main().catch(err => {
  console.error("[sync-content] failed:", err)
  process.exit(1)
})
