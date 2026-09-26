"use client"

import { createIndexedDbCredentialStore, type CredentialStore } from "@agentproto/pair-client"
import { PAIR_SW_URL, pairingScope, type PairWorkerRequest } from "@/lib/pair"

let store: CredentialStore | null = null

/** The origin's pairing credentials (IndexedDB — never localStorage). The
 *  worker opens the same database. */
export function pairStore(): CredentialStore {
  store ??= createIndexedDbCredentialStore()
  return store
}

export function serviceWorkersSupported(): boolean {
  return typeof navigator !== "undefined" && "serviceWorker" in navigator
}

/** Register (or refresh) the worker for one pairing and resolve once it is
 *  active. `navigator.serviceWorker.ready` can't be used: it tracks the
 *  registration for *this* page's scope, and the pages that call this sit
 *  outside `/d/<id>/`. */
export async function registerPairingWorker(id: string): Promise<ServiceWorkerRegistration> {
  const reg = await navigator.serviceWorker.register(PAIR_SW_URL, { scope: pairingScope(id) })
  const worker = reg.installing ?? reg.waiting ?? reg.active
  if (worker && worker.state !== "activated") {
    await new Promise<void>((resolve, reject) => {
      const onChange = (): void => {
        if (worker.state === "activated") {
          worker.removeEventListener("statechange", onChange)
          resolve()
        } else if (worker.state === "redundant") {
          worker.removeEventListener("statechange", onChange)
          reject(new Error("the pairing service worker failed to install"))
        }
      }
      worker.addEventListener("statechange", onChange)
      onChange()
    })
  }
  return reg
}

export function postToWorker(reg: ServiceWorkerRegistration, message: PairWorkerRequest): boolean {
  const worker = reg.active
  if (!worker) return false
  worker.postMessage(message)
  return true
}

/** Forget a pairing on this device: drop the stored credential and the
 *  worker that served it. The daemon's record stays until `agentproto pair
 *  revoke`. */
export async function forgetPairing(id: string): Promise<void> {
  await pairStore().delete(id)
  if (!serviceWorkersSupported()) return
  const reg = await navigator.serviceWorker.getRegistration(pairingScope(id))
  if (reg && new URL(reg.scope).pathname === pairingScope(id)) await reg.unregister()
}
