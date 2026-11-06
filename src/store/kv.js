import { encode, decode } from "./codec.js";

// KV adapter. Keys:
//   b:{ns}:{id}  -> blob bytes
//   m:{ns}:{id}  -> meta JSON
//   t:{ns}:{id}  -> owner token hash
export class KvStore {
  constructor(kv) {
    this.kv = kv;
    this.name = "kv";
  }
  async put(ns, id, buf, { meta, ownerTokenHash, ttl }) {
    const opt = ttl ? { expirationTtl: Math.max(ttl, 60) } : {};
    await this.kv.put(`b:${ns}:${id}`, buf, opt);
    await this.kv.put(`m:${ns}:${id}`, JSON.stringify(meta), opt);
    await this.kv.put(`t:${ns}:${id}`, ownerTokenHash, opt);
  }
  async get(ns, id) {
    return (await this.kv.get(`b:${ns}:${id}`, { type: "arrayBuffer" })) || null;
  }
  async getMeta(ns, id) {
    const raw = await this.kv.get(`m:${ns}:${id}`);
    return raw ? JSON.parse(raw) : null;
  }
  async delete(ns, id, ownerTokenHash) {
    const stored = await this.kv.get(`t:${ns}:${id}`);
    if (!stored || stored !== ownerTokenHash) return false;
    await Promise.all([
      this.kv.delete(`b:${ns}:${id}`),
      this.kv.delete(`m:${ns}:${id}`),
      this.kv.delete(`t:${ns}:${id}`),
    ]);
    return true;
  }
}

// In-memory adapter: local dev / tests / edge runtimes without KV.
export class MemoryStore {
  constructor() {
    this.map = new Map();
    this.name = "memory";
  }
  async put(ns, id, buf, { meta, ownerTokenHash }) {
    this.map.set(`b:${ns}:${id}`, buf);
    this.map.set(`m:${ns}:${id}`, meta);
    this.map.set(`t:${ns}:${id}`, ownerTokenHash);
  }
  async get(ns, id) {
    return this.map.get(`b:${ns}:${id}`) || null;
  }
  async getMeta(ns, id) {
    return this.map.get(`m:${ns}:${id}`) || null;
  }
  async delete(ns, id, ownerTokenHash) {
    if (this.map.get(`t:${ns}:${id}`) !== ownerTokenHash) return false;
    for (const p of ["b", "m", "t"]) this.map.delete(`${p}:${ns}:${id}`);
    return true;
  }
}
export { encode, decode };
