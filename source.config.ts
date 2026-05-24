import { defineDocs, defineConfig, frontmatterSchema } from "fumadocs-mdx/config"

/**
 * Fumadocs source config — reads .mdx from `content/docs/`, populated
 * by `scripts/sync-content.mjs` from either the local sibling
 * @agentproto/ts repo (dev) or a `git clone --depth 1` cache
 * (CI/prod).
 *
 * Frontmatter is intentionally minimal — the docs live as plain .md
 * next to code, and sync-content.mjs synthesises title + description
 * from the first H1 and following paragraph when absent.
 */
export const docs = defineDocs({
  dir: "content/docs",
  docs: {
    files: ["**/*.mdx"],
    schema: frontmatterSchema.extend({
      // No CLI-doc-specific fields today; the schema is open so
      // sync-content.mjs can layer in extras (last-modified, source
      // path, etc.) without rev-locking this file.
    }),
  },
})

export default defineConfig({})
