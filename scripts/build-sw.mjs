#!/usr/bin/env node
/**
 * build-sw.mjs — bundle the pairing service worker (src/sw/pair-sw.ts) for
 * the browser into public/pair-sw.js.
 *
 * A service worker is a classic script at a fixed URL, outside Next's module
 * graph, so it is built separately: one self-contained IIFE with
 * @agentproto/pair-client inlined. Served from the root, its default max
 * scope is `/`, which covers every `/d/<id>/` registration without a
 * `Service-Worker-Allowed` header. Runs before `dev` and `build`; the output
 * is gitignored.
 */

import { build } from "esbuild"
import path from "node:path"
import { fileURLToPath } from "node:url"

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..")

await build({
  entryPoints: [path.join(root, "src/sw/pair-sw.ts")],
  outfile: path.join(root, "public/pair-sw.js"),
  bundle: true,
  format: "iife",
  platform: "browser",
  target: ["es2022"],
  minify: process.env.NODE_ENV === "production",
  sourcemap: process.env.NODE_ENV === "production" ? false : "inline",
  legalComments: "none",
  // Same pair domain the pages get from Next (src/lib/pair-host.ts).
  define: {
    "process.env.NEXT_PUBLIC_AGENTPROTO_PAIR_DOMAIN": JSON.stringify(
      process.env.NEXT_PUBLIC_AGENTPROTO_PAIR_DOMAIN ?? "",
    ),
  },
  logLevel: "info",
})
