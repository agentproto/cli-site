// ESLint flat config — Next.js 16 dropped the `next lint` subcommand, so
// `pnpm lint` runs the `eslint` binary directly against this file.
//
// `eslint-config-next` ships flat configs natively (no @eslint/eslintrc
// FlatCompat shim needed). `core-web-vitals` already spreads the base
// `eslint-config-next` config, so the two entries below are the flat
// equivalent of the legacy `extends: ["next/core-web-vitals",
// "next/typescript"]`.
//
// Kept byte-identical with the sibling repo (agentproto/site ⇄
// agentproto/cli-site) — the two are near-identical Next + fumadocs
// codebases sharing components and scripts.
import nextCoreWebVitals from "eslint-config-next/core-web-vitals"
import nextTypescript from "eslint-config-next/typescript"

const config = [
  {
    // `eslint-config-next` already ignores .next/, out/, build/ and
    // next-env.d.ts. These are the repo-specific generated trees:
    //   .source/  — fumadocs-mdx compiled content tree
    //   .cache/   — depth-1 clone of the upstream content repo, pulled by
    //               scripts/sync-content.mjs at dev/build time
    //   content/  — synced MDX + authored specs, not linted as source
    ignores: [".source/**", ".cache/**", ".turbo/**", "content/**"],
  },
  {
    // A stale `eslint-disable` is how lint silently rots: the rule stops
    // running, the comment stays, nobody notices. Fail on it — in editors
    // too, which a CLI flag would not cover.
    linterOptions: { reportUnusedDisableDirectives: "error" },
  },
  ...nextCoreWebVitals,
  ...nextTypescript,
  {
    rules: {
      // React-Compiler-era advisories, new in eslint-plugin-react-hooks v7
      // (pulled in by eslint-config-next 16). They are performance advice,
      // not correctness bugs, and the cli-site daemon panel is built on the
      // patterns they flag: reset-state-on-session-change effects and refs
      // mirrored during render. Converting ~11 of those call sites is a
      // behavioural refactor of a live interactive UI — its own change, not
      // a rider on the lint migration. Off for now, tracked separately.
      "react-hooks/set-state-in-effect": "off",
      "react-hooks/refs": "off",
    },
  },
]

export default config
