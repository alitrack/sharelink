// Storage adapter interface:
//   name
//   put(ns, id, ArrayBuffer, {meta, ownerTokenHash, ttl})
//   get(ns, id) -> ArrayBuffer | null
//   getMeta(ns, id) -> object | null
//   delete(ns, id, ownerTokenHash) -> boolean

import { KvStore, MemoryStore } from "./kv.js";

// Memory store must survive across requests within the same isolate.
const singletonMemory = new MemoryStore();

export function getStore(env) {
  const kind = (env.SHARELINK_STORE || "kv").toLowerCase();
  if (kind === "kv") {
    if (!env.SHARES) throw new Error("SHARES KV binding missing (set binding name via env or wrangler config)");
    return new KvStore(env.SHARES);
  }
  if (kind === "memory") return singletonMemory;
  throw new Error(`Unknown store: ${kind}`);
}
