# cli.agentproto.sh

Public docs site for [`@agentproto/cli`](https://www.npmjs.com/package/@agentproto/cli)
and adjacent runtime packages. Sibling of [agentproto.sh](https://agentproto.sh),
but scoped to the *tool* — what the `agentproto` binary does, what
flags it takes, what files it touches.

## How it works

The site is Next.js + [Fumadocs](https://fumadocs.dev). Content is
pulled in at build time from
[`github.com/agentproto/ts`](https://github.com/agentproto/ts) under
`docs/cli/`. The sync script picks one of two paths:

1. **Local sibling** — when `../ts/docs/cli/` exists on disk (the
   agentik-studio bootstrap layout), copy from there. Fast, instant
   feedback during dev.
2. **Git clone** — otherwise `git clone --depth 1
   github.com/agentproto/ts` into `.cache/agentproto-ts/` and copy
   `docs/cli/` from the cache.

Markdown files are renamed `.md → .mdx`. When a file has no
frontmatter, the script synthesises `title` from the first H1 and
`description` from the first following paragraph — so the source docs
stay as plain markdown next to the code and don't need a per-file
frontmatter dance.

## Local dev

```bash
pnpm install
pnpm dev          # → http://localhost:3010
```

`predev` runs the content sync once before `next dev` boots. Edit a
file under `../ts/docs/cli/`, restart `pnpm dev` to re-sync.

## Build

```bash
pnpm build        # syncs content then builds
pnpm start        # serves the built output
```

## Deploy

Same pattern as the main site:

```bash
docker build -t cli-agentproto-site .
docker run --rm -p 8080:8080 cli-agentproto-site
# → http://localhost:8080
```

Deploy targets:

- **Cloud Run service** at `cli.agentproto.sh`. Map the custom domain
  to the service.
- The Dockerfile expects no build-time secrets — `scripts/sync-content.mjs`
  clones a public repo over HTTPS.

Env vars at build time:

| Var                            | Default                                        |
| ------------------------------ | ---------------------------------------------- |
| `AGENTPROTO_TS_REPO_URL`       | `https://github.com/agentproto/ts.git`         |
| `AGENTPROTO_TS_REPO_BRANCH`    | `main`                                         |

Set them when you want to publish from a fork or a non-main branch.

## Structure

```
cli-site/
├── scripts/sync-content.mjs    # the GitHub-fetch / sibling-copy
├── source.config.ts            # Fumadocs source — reads content/docs/
├── src/
│   ├── app/
│   │   ├── layout.tsx          # root layout + metadata
│   │   ├── page.tsx            # landing
│   │   ├── global.css
│   │   └── docs/
│   │       ├── layout.tsx      # DocsLayout with tree + nav
│   │       └── [[...slug]]/page.tsx   # MDX renderer
│   └── lib/docs-source.ts      # loader against .source/
├── content/docs/               # gitignored; synced
├── Dockerfile                  # multi-stage, Cloud Run ready
├── package.json
└── next.config.mjs
```

The package metadata is intentionally close to
`projects/agentproto/site` so a future "unify the two sites" refactor
is a mechanical diff.
