// sharelink-crypto — optional client-side E2E encryption for ShareLink.
// The server stays zero-knowledge: it stores an opaque blob. The password
// never leaves the browser. Without the password the downloaded blob is
// useless ciphertext (AES-GCM-256, key derived via PBKDF2).
//
// Envelope format (binary-safe):
//   "SL1" + JSON header (ASCII, no newlines) + "\n" + AES-GCM ciphertext
// header: {"v":1,"alg":"AES-GCM-256","kdf":"PBKDF2-SHA256","iter":N,"salt":"hex","iv":"hex"}
//
// Usage:
//   import { ShareLink } from "./sharelink-client.js";
//   import { encrypt, decrypt, isEncrypted } from "./sharelink-crypto.js";
//   const blob = await encrypt(data, password);   // ArrayBuffer
//   const back = await decrypt(blob, password);   // ArrayBuffer (throws on wrong password)

const MAGIC = "SL1";
const ITER = 310_000; // OWASP 2023 recommendation for PBKDF2-SHA256

const te = new TextEncoder();
const td = new TextDecoder();

async function deriveKey(password, salt, iterations = ITER) {
  const base = await crypto.subtle.importKey("raw", te.encode(password), "PBKDF2", false, [
    "deriveKey",
  ]);
  return crypto.subtle.deriveKey(
    { name: "PBKDF2", salt, iterations, hash: "SHA-256" },
    base,
    { name: "AES-GCM", length: 256 },
    false,
    ["encrypt", "decrypt"]
  );
}

const hex = (buf) => [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, "0")).join("");
const unhex = (h) => new Uint8Array(h.match(/../g).map((x) => parseInt(x, 16)));

export function isEncrypted(buf) {
  const b = buf instanceof Uint8Array ? buf : new Uint8Array(buf);
  return b[0] === 0x53 && b[1] === 0x4c && b[2] === 0x31; // "SL1"
}

export async function encrypt(data, password) {
  const plain = data instanceof ArrayBuffer ? data : await new Blob([data]).arrayBuffer();
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const key = await deriveKey(password, salt);
  const ct = await crypto.subtle.encrypt({ name: "AES-GCM", iv }, key, plain);
  const header = te.encode(
    JSON.stringify({ v: 1, alg: "AES-GCM-256", kdf: "PBKDF2-SHA256", iter: ITER, salt: hex(salt), iv: hex(iv) })
  );
  const out = new Uint8Array(3 + header.length + 1 + ct.byteLength);
  out.set(te.encode(MAGIC), 0);
  out.set(header, 3);
  out[3 + header.length] = 0x0a; // "\n"
  out.set(new Uint8Array(ct), 3 + header.length + 1);
  return out.buffer;
}

export async function decrypt(buf, password) {
  const b = buf instanceof Uint8Array ? buf : new Uint8Array(buf);
  if (!isEncrypted(b)) throw new Error("Not a ShareLink encrypted envelope (missing SL1 magic).");
  const nl = b.indexOf(0x0a, 3);
  if (nl < 0) throw new Error("Malformed envelope header.");
  const header = JSON.parse(td.decode(b.subarray(3, nl)));
  if (header.alg !== "AES-GCM-256" || header.kdf !== "PBKDF2-SHA256")
    throw new Error(`Unsupported: ${header.alg}/${header.kdf}`);
  const key = await deriveKey(password, unhex(header.salt), header.iter);
  const plain = await crypto.subtle.decrypt(
    { name: "AES-GCM", iv: unhex(header.iv) },
    key,
    b.subarray(nl + 1)
  );
  return plain; // ArrayBuffer; wrong password throws OperationError
}

// Convenience: attach encrypted methods to ShareLink instances.
export function withCrypto(share) {
  share.putEncrypted = async (data, password, opts = {}) =>
    share.put(await encrypt(data, password), { ...opts, ns: opts.ns ?? share.ns });
  share.getEncrypted = async (id, password, ns = share.ns) =>
    decrypt(await share.get(id, ns), password);
  return share;
}
