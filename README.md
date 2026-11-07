# ShareLink

**A format-agnostic blob share service for pure-frontend tools.** One Cloudflare
Worker (free tier friendly) + pluggable storage. Give any browser app — SQL
workbench, diagram editor, code playground, form builder — "save state to a
short link" in ~10 lines of client code.

The server treats every payload as an **opaque blob**. Format semantics
(gzip, JSON, Parquet, Arrow, whatever) live entirely in the client. This is
the core design lesson extracted from studying share-link products: keep the
backend zero-knowledge and it stays generic forever.

## API

```
POST   /s/:ns/check        {"size":N}   -> {"ok":true,"maxSize":...}
POST   /s/:ns              body=blob    -> {"id","ownerToken","url"}
       (opt header X-ShareLink-Id: client-chosen id, idempotent overwrite)
GET    /s/:ns/:id                       -> blob bytes
GET    /s/:ns/:id/meta                  -> {"id","ns","size","createdAt","expiresAt"}
DELETE /s/:ns/:id?token=ownerToken      -> {"ok":true}
GET    /healthz                          -> {"ok":true,"store":"kv"|"memory"}
```

- **Namespace** `:ns` — virtual multi-tenancy on one deployment (`/s/duckui/...`,
  `/s/mermaid/...`). Per-ns `maxSize`/`ttl` overrides via `NAMESPACE_CONFIG`.
- **ownerToken** — returned once at upload; SHA-256 hashed server-side; required
  for delete. Anyone with the link can read; only the uploader can delete.
  Overwriting the same client-chosen ID rotates the token (new owner).
- **Client-chosen ID** (`X-ShareLink-Id`) — POST accepts an optional header to
  write to a deterministic address (validated against the same 6-16 char
  unambiguous alphabet as generated IDs; invalid → 400). Same ID = idempotent
  overwrite. This is what makes stateless client-to-client protocols possible
  — see `examples/deaddrop/`. Omit the header for classic random-ID behavior.
- **CORS** — open (`*`); preflight handled (incl. `X-ShareLink-Id`).

## Storage adapters

| Adapter | Use | Limit |
|---|---|---|
| `kv` (default) | Cloudflare KV | 25 MB/blob |
| `memory` | local dev, tests | per-isolate |

Select via env var `SHARELINK_STORE`. Interface is 4 methods
(`put/get/getMeta/delete`) — add R2 or D1 by implementing them in `src/store/`.

## Quick start

```bash
git clone https://github.com/alitrack/sharelink && cd sharelink

# local (memory store, zero config)
npx wrangler dev --config wrangler.dev.jsonc
./test-e2e.sh                       # full round-trip suite

# production (KV)
npx wrangler kv namespace create SHARES      # put id into wrangler.jsonc
npx wrangler deploy
```

## Client SDK (browser)

```html
<script type="module">
import { ShareLink } from "./client/sharelink-client.js";
const share = new ShareLink("https://share.example.com", "myapp");

const { id, ownerToken, url } = await share.put(gzipBundle);   // random id
const { id: d } = await share.put(gzipBundle, { id: "myAppId1" }); // deterministic
const back = await share.get(id);            // ArrayBuffer
await share.remove(id, ownerToken);          // optional cleanup
</script>
```

## Examples

- **`examples/deaddrop/`** — 死信箱: two browsers, one shared passphrase,
  async encrypted note-passing with deterministic mailboxes and 3s polling.
  Pure frontend; proves the zero-knowledge architecture end to end.
  Run: `npx wrangler dev --config wrangler.dev.jsonc` + any static server on
  the repo root, open `…/examples/deaddrop/index.html#A` and `#B`.

## Optional end-to-end encryption (client-side, zero server changes)

Share the link through any channel, and **the password through another** —
without it the blob is useless ciphertext. The password never leaves the
browser; the server never sees anything but an opaque envelope.

- AES-GCM-256, key derived via PBKDF2-SHA256 (310k iterations, per-blob salt)
- Envelope: `"SL1"` magic + JSON header + `\n` + ciphertext — self-describing
- Works with any backend that stores bytes; server code untouched

```html
<script type="module">
import { ShareLink } from "./client/sharelink-client.js";
import { withCrypto } from "./client/sharelink-crypto.js";
const share = withCrypto(new ShareLink("https://share.example.com", "myapp"));

const { url } = await share.putEncrypted(gzipBundle, "passphrase");
const back = await share.getEncrypted(id, "passphrase");   // ArrayBuffer
</script>
```

Wrong password throws (`OperationError` from WebCrypto) — GCM auth tag makes
tampering/cracking detectable and brute-force the only attack surface (raise
`ITER` if you care). Note: the share **ID** is still bearer — pair encryption
with Cloudflare Access if you also need to hide existence/metadata.


## Deployment notes (Cloudflare, 2026 edition)

- Worker-only, no static assets — plain `npx wrangler deploy` works from CI
  (Workers Builds: connect repo, empty build command, deploy command
  `npx wrangler deploy`).
- KV binding must live in `wrangler.jsonc` (`kv_namespaces`), not just the
  dashboard — CI deploys overwrite dashboard-added bindings otherwise.
- Free tier: 100k reads/day, 1k writes/day, 1 GB storage — enough for a
  community tool.

## Origin

Extracted as the generic core of a share-API built while studying how
browser-native data tools implement "share my analysis as a link". The
protocol lessons (self-contained bundles, zero-knowledge backend, short IDs)
are documented in `docs/design.md`.

## License

MIT
