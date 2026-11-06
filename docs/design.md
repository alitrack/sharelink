# Design notes

## Why a zero-knowledge blob server

The share-link products worth studying converge on the same architecture:

1. Client serializes its own state into a **self-contained bundle**
   (schema + data + session), using standard formats (gzip/tar, Parquet, JSON).
2. Backend is a **stateless store**: opaque bytes in, opaque bytes out, plus
   a small metadata record.
3. The share URL carries only a short ID.

Consequences: the backend never breaks when the client format evolves
(`bundleVersion` lives inside the blob); the backend is generic (any app can
reuse it); the wire protocol is 4 endpoints and stable.

## Decisions in this implementation

- **Short IDs (10 chars, crockford-ish alphabet)**: >10^17 space, unguessable,
  readability-friendly (no 0/O/1/I). Read access = possession of the ID.
  Acceptable for share-by-link semantics (same as the products studied);
  not acceptable for confidential data — front it with Cloudflare Access or
  add signed URLs if you need that.
- **ownerToken**: 192-bit random, SHA-256 stored, returned once. Enables
  delete without any user accounts. Deletion is the only mutating op.
- **Namespace-keyed everything** (`b:{ns}:{id}`): quota/TTL per app on a
  shared deployment; cheap isolation (not a security boundary by itself).
- **TTL via storage-native expiry** (KV `expirationTtl`): no cron sweeper.
- **Memory adapter singleton**: required in dev because each request
  re-instantiates modules otherwise; harmless in production.

## Not built (yet)

- R2 adapter for >25 MB blobs
- D1 adapter when listing/search across shares is needed
- Rate limiting (per-IP) — front with Cloudflare WAF rules for public hosts
- Content-addressed mode (id = hash) for dedup
