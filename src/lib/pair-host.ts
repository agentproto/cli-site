/**
 * Which daemon(s) this origin may hold pairings for. Shared by the pages and
 * the pairing service worker, so no DOM- or React-only imports.
 *
 *   - Per-daemon origin: `https://<fingerprint>.<pair domain>` (default pair
 *     domain `agentproto.cloud`). The origin belongs to exactly one daemon.
 *     Browsers isolate storage and service workers per origin, so no other
 *     daemon's Control Center can reach this pairing. /pair refuses offers for
 *     any other daemon, and the credential store holds that one daemon only.
 *   - Shared origin: any other host (cli.agentproto.sh, localhost). Every
 *     daemon paired there shares the origin's storage (today's behaviour,
 *     kept as a fallback).
 *
 * The pair domain is set at build time with NEXT_PUBLIC_AGENTPROTO_PAIR_DOMAIN
 * (inlined by Next for the pages and by scripts/build-sw.mjs for the worker).
 */

import type { CredentialStore, PairCredential } from "@agentproto/pair-client"
import { isPairingId } from "./pair"

export const PAIR_DOMAIN = (process.env.NEXT_PUBLIC_AGENTPROTO_PAIR_DOMAIN || "agentproto.cloud").toLowerCase()

export type PairHostMode =
  /** `<fingerprint>.<pair domain>`: this origin serves that one daemon. */
  | { kind: "daemon"; fingerprint: string }
  /** The pair domain itself, or a label under it that isn't a fingerprint:
   *  not a daemon origin, so nothing may be paired here. */
  | { kind: "invalid" }
  /** Any other host: every pairing on it shares the origin. */
  | { kind: "shared" }

export function pairHostMode(hostname: string): PairHostMode {
  const host = hostname.toLowerCase().replace(/\.$/, "")
  if (host === PAIR_DOMAIN) return { kind: "invalid" }
  if (!host.endsWith(`.${PAIR_DOMAIN}`)) return { kind: "shared" }
  const label = host.slice(0, -PAIR_DOMAIN.length - 1)
  return isPairingId(label) ? { kind: "daemon", fingerprint: label } : { kind: "invalid" }
}

/** The per-daemon origin for `fingerprint`, keeping the current scheme and
 *  port (so a local `http://<fp>.localtest.me:3010` test maps the same way). */
export function daemonOrigin(fingerprint: string, current: { protocol: string; port: string }): string {
  return `${current.protocol}//${fingerprint}.${PAIR_DOMAIN}${current.port ? `:${current.port}` : ""}`
}

export class ForeignDaemonError extends Error {
  readonly code = "foreign_daemon"
}

/**
 * On a per-daemon origin, a view of `store` that holds that daemon only: other
 * ids read as absent and are never written. On a shared origin, `store`
 * unchanged.
 */
export function scopeCredentialStore(store: CredentialStore, mode: PairHostMode): CredentialStore {
  if (mode.kind === "shared") return store
  const allowed = mode.kind === "daemon" ? mode.fingerprint : null
  const mine = (c: PairCredential | undefined): c is PairCredential =>
    !!c && c.id === allowed && c.fingerprint === allowed
  return {
    async get(id) {
      const c = id === allowed ? await store.get(id) : undefined
      return mine(c) ? c : undefined
    },
    async put(credential) {
      const { fingerprint } = credential
      if (!mine(credential)) {
        throw new ForeignDaemonError(
          `this origin only holds the pairing for daemon ${allowed ?? "(none)"}, not ${fingerprint}`,
        )
      }
      await store.put(credential)
    },
    async delete(id) {
      return id === allowed ? store.delete(id) : false
    },
    async list() {
      return (await store.list()).filter(mine)
    },
  }
}
