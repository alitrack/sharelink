// Protocol tests for voicedrop + creddrop (no browser/mic needed):
//  - voice: deterministic mailbox + SL1 + base64-of->100KB payload round-trip
//  - cred:  random-ID upload, token-in-hash parse, decrypt, wrong-pass,
//           ownerToken DELETE, 404-after-burn, wrong-token rejected
import { Buffer } from "node:buffer";
import { ShareLink } from "../client/sharelink-client.js";
import { encrypt, decrypt } from "../client/sharelink-crypto.js";

const BASE = process.env.SLBASE || "http://127.0.0.1:8098";
const te = new TextEncoder();
const hx = (b) => [...new Uint8Array(b)].map((x) => x.toString(16).padStart(2, "0")).join("");
const b64 = (buf) => {
  const b = new Uint8Array(buf);
  let s = "";
  for (let i = 0; i < b.length; i += 0x10000) s += String.fromCharCode.apply(null, b.subarray(i, i + 0x10000));
  return btoa(s);
};
const unb64 = (s) => Uint8Array.from(atob(s), (c) => c.charCodeAt(0));
const assert = (c, l) => { if (!c) { console.error("FAIL", l); process.exit(1); } console.log("PASS", l); };

// ---------------- voice ----------------
{
  const NS = "voicedrop-test", PASS = "频道-密码";
  const d = async (r, n) => { const x = await crypto.subtle.digest("SHA-256", te.encode(`${PASS}|${NS}|${r}|${n}`)); return hx(x).slice(0, 16); };
  const A = new ShareLink(BASE, NS);
  // sender A: 120KB pseudo-audio (> 64KB chunk boundary)
  const clip = Buffer.alloc(120 * 1024);
  for (let i = 0; i < clip.length; i++) clip[i] = (i * 31 + 7) & 0xff;
  const msg = { sender: "A", t: "t0", mime: "audio/webm", audio: b64(clip) };
  const id0 = await d("B", 0);
  await A.put(await encrypt(JSON.stringify(msg), PASS), { id: id0 });
  // receiver B polls its own mailbox (deriveId(ROLE=B) matches sender's deriveId(PEER=B))
  const B = new ShareLink(BASE, NS);
  const buf = await B.getOrNull(await d("B", 0));
  assert(buf !== null, "voice: B polls and finds A's clip at derived id");
  const got = JSON.parse(new TextDecoder().decode(await decrypt(buf, PASS)));
  const rt = unb64(got.audio);
  assert(got.sender === "A" && got.mime === "audio/webm", "voice: envelope meta preserved");
  assert(rt.length === clip.length && rt.every((x, i) => x === clip[i]), "voice: 120KB audio round-trips byte-identical via base64");
  // B replies with a clip; A reads it
  await B.put(await encrypt(JSON.stringify({ sender: "B", t: "t0", mime: "audio/webm", audio: b64(Buffer.from("fake-opus-bytes")) }), PASS), { id: await d("A", 0) });
  const ab = await A.getOrNull(await d("A", 0));
  assert(new TextDecoder().decode(await decrypt(ab, PASS)).includes('"sender":"B"'), "voice: bidirectional clip delivery");
}

// ---------------- credential ----------------
{
  const NS = "creddrop-test", PASS = "k8s-super-secret";
  const share = new ShareLink(BASE, NS);
  // sender: PEM-like text
  const pem = "-----BEGIN OPENSSH PRIVATE KEY-----\n" + Buffer.alloc(4096, 65).toString("latin1").split("").map(c => String.fromCharCode((c.charCodeAt(0) + Math.random() * 25) & 127)).join("") + "\n-----END OPENSSH PRIVATE KEY-----\n";
  const ct = await encrypt(pem, PASS);
  const { id, ownerToken, url } = await share.put(ct);
  assert(id.length === 10, "cred: random id returned");
  // link parsing (same regex as the UI)
  const link = `${url}#tok=${ownerToken}`;
  const u = new URL(link);
  const m = u.pathname.match(/\/s\/([^/]+)\/([A-Za-z0-9]{6,16})/);
  const tok = (u.hash.match(/tok=([a-f0-9]+)/) || [])[1];
  assert(m && m[1] === NS && m[2] === id && tok === ownerToken, "cred: #tok= hash link parses (id+token recovered, token not in query)");
  assert(!u.search.includes("tok"), "cred: token NOT in query string");
  // receiver decrypts
  const plain = new TextDecoder().decode(await decrypt(await share.get(id), PASS));
  assert(plain === pem, "cred: PEM round-trips byte-identical");
  // wrong password
  let threw = false;
  try { await decrypt(await share.get(id), "wrong"); } catch { threw = true; }
  assert(threw, "cred: wrong password throws (GCM)");
  // burn: correct token
  await share.remove(id, ownerToken);
  assert((await share.getOrNull(id)) === null, "cred: DELETE with ownerToken wipes blob");
  // a second credential: wrong token must be rejected
  const c2 = await share.put(await encrypt(Buffer.from("kubeconfig: admin"), PASS));
  let rej = false;
  try { await share.remove(c2.id, "f".repeat(48)); } catch (e) { rej = /404/.test(e.message); }
  assert(rej && (await share.getOrNull(c2.id)) !== null, "cred: wrong ownerToken rejected, blob survives");
  await share.remove(c2.id, c2.ownerToken);
}

console.log("ALL PASS");
