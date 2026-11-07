// ShareLink Worker — a format-agnostic blob share service.
// Any pure-frontend tool (SQL workbench, diagram editor, playground, ...) can
// save user state to a short link. The server treats every payload as an
// opaque blob; format semantics live entirely in the client.
//
// Routes:
//   POST   /s/:ns/check        {"size":N}            -> {"ok":true,"maxSize":...}
//   POST   /s/:ns              body=blob             -> {"id","ownerToken","url"}
//   GET    /s/:ns/:id                                -> blob bytes
//   GET    /s/:ns/:id/meta                           -> {"id","ns","size","createdAt","expiresAt"}
//   DELETE /s/:ns/:id?token=...                      -> {"ok":true}
//   GET    /healthz                                   -> {"ok":true}
//
// Storage adapters are selected via env.SHARELINK_STORE (default: "kv").
// Namespaces are virtual: any {ns} works, quota/TTL read from NAMESPACE_CONFIG.

import { getStore } from "./store/index.js";

const DEFAULT_MAX_SIZE = 25 * 1024 * 1024; // KV value limit
const DEFAULT_TTL = 60 * 60 * 24 * 365; // 1 year
const ID_LEN = 10;

const NAMESPACE_CONFIG = {
  // defaults apply to any unlisted ns
  default: { maxSize: DEFAULT_MAX_SIZE, ttl: DEFAULT_TTL },
  // example overrides:
  // demo: { maxSize: 1024 * 1024, ttl: 60 * 60 },
};

const ID_RE = /^[A-Za-z0-9]{6,16}$/;
const NS_RE = /^[a-z0-9][a-z0-9-]{0,31}$/;

const json = (obj, status = 200) =>
  new Response(JSON.stringify(obj), {
    status,
    headers: { "Content-Type": "application/json", "Cache-Control": "no-store", ...CORS },
  });

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, DELETE, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization, X-ShareLink-Id",
};

function configFor(ns) {
  return NAMESPACE_CONFIG[ns] || NAMESPACE_CONFIG.default;
}

function genId(len = ID_LEN) {
  const alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789";
  const rnd = crypto.getRandomValues(new Uint8Array(len));
  let id = "";
  for (const b of rnd) id += alphabet[b % alphabet.length];
  return id;
}

function genToken() {
  const b = crypto.getRandomValues(new Uint8Array(24));
  return [...b].map((x) => x.toString(16).padStart(2, "0")).join("");
}

async function hashToken(token) {
  const d = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(token));
  return [...new Uint8Array(d)].map((x) => x.toString(16).padStart(2, "0")).join("");
}

function routes(request, env) {
  const url = new URL(request.url);
  const parts = url.pathname.split("/").filter(Boolean); // ["s", ns, id?, "meta"?]
  return { url, parts };
}

export default {
  async fetch(request, env) {
    if (request.method === "OPTIONS") return new Response(null, { status: 204, headers: CORS });

    const store = getStore(env);
    const { url, parts } = routes(request, env);
    const method = request.method;

    if (url.pathname === "/healthz") return json({ ok: true, store: store.name });

    if (!(parts[0] === "s" && parts[1])) return json({ error: "Not found." }, 404);
    const ns = parts[1];
    if (!NS_RE.test(ns)) return json({ error: "Invalid namespace." }, 400);
    const cfg = configFor(ns);
    const id = parts[2];

    // POST /s/:ns/check
    if (parts.length === 2 && parts[1] === "check" && method === "POST") {
      return json({ ok: true, maxSize: cfg.maxSize });
    }
    if (parts.length === 3 && parts[2] === "check" && method === "POST") {
      const body = await request.json().catch(() => ({}));
      const size = typeof body.size === "number" ? body.size : 0;
      if (size > cfg.maxSize) return json({ error: "Too large.", maxSize: cfg.maxSize }, 413);
      return json({ ok: true, maxSize: cfg.maxSize });
    }

    // POST /s/:ns — upload
    if (parts.length === 2 && method === "POST") {
      const buf = await request.arrayBuffer();
      if (buf.byteLength === 0) return json({ error: "Empty body." }, 400);
      if (buf.byteLength > cfg.maxSize)
        return json({ error: "Too large.", maxSize: cfg.maxSize }, 413);
      // Client-chosen ID (deterministic mailboxes, see examples/deaddrop):
      // idempotent overwrite of the same address; same ID alphabet as genId.
      let id = request.headers.get("X-ShareLink-Id");
      if (id === null) id = genId();
      else if (!ID_RE.test(id)) return json({ error: "Invalid ID." }, 400);
      const ownerToken = genToken();
      const createdAt = Math.floor(Date.now() / 1000);
      const expiresAt = cfg.ttl ? createdAt + cfg.ttl : null;
      await store.put(ns, id, buf, {
        meta: { id, ns, size: buf.byteLength, createdAt, expiresAt },
        ownerTokenHash: await hashToken(ownerToken),
        ttl: cfg.ttl,
      });
      return json({ id, ns, ownerToken, url: `${url.origin}/s/${ns}/${id}` });
    }

    if (!id || !ID_RE.test(id)) return json({ error: "Not found." }, 404);

    // GET /s/:ns/:id/meta
    if (parts.length === 4 && parts[3] === "meta" && method === "GET") {
      const meta = await store.getMeta(ns, id);
      if (!meta) return json({ error: "Not found." }, 404);
      return json(meta);
    }

    // GET /s/:ns/:id — download
    if (parts.length === 3 && method === "GET") {
      const blob = await store.get(ns, id);
      if (!blob) return json({ error: "Not found." }, 404);
      return new Response(blob, {
        headers: {
          "Content-Type": "application/octet-stream",
          "Content-Length": String(blob.byteLength),
          "Cache-Control": "no-store",
          ...CORS,
        },
      });
    }

    // DELETE /s/:ns/:id — owner only
    if (parts.length === 3 && method === "DELETE") {
      const token =
        url.searchParams.get("token") ||
        (request.headers.get("Authorization") || "").replace(/^Bearer\s+/i, "");
      if (!token) return json({ error: "Missing owner token." }, 401);
      const ok = await store.delete(ns, id, await hashToken(token));
      return ok ? json({ ok: true }) : json({ error: "Not found." }, 404);
    }

    return json({ error: "Not found." }, 404);
  },
};
