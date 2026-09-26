// Build-time values inlined by scripts/build-sw.mjs (`define`); the worker has
// no Node `process` at runtime.
declare const process: { env: { NEXT_PUBLIC_AGENTPROTO_PAIR_DOMAIN?: string } }
