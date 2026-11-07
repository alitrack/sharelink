// Full dead-drop protocol test: two in-process clients (A and B) share the
// local worker; exercises deriveId, SL1 envelope, catch-up polling, burn.
import { readFileSync } from "node:fs";
import { ShareLink } from "../../client/sharelink-client.js";
import { encrypt, decrypt } from "../../client/sharelink-crypto.js";

const BASE = process.env.SLBASE || "http://127.0.0.1:8098";
const NS = "deaddrop-test";
const PASS = "hunter2-正确";
const te = new TextEncoder();
const hx = (b) => [...new Uint8Array(b)].map((x) => x.toString(16).padStart(2, "0")).join("");
const deriveId = (role, n) =>
  crypto.subtle.digest("SHA-256", te.encode(`${PASS}|${NS}|${role}|${n}`)).then((d) => hx(d).slice(0, 16));

class Client {
  constructor(role) {
    this.role = role;
    this.peer = role === "A" ? "B" : "A";
    this.share = new ShareLink(BASE, NS);
    this.readN = 0;
    this.written = [];
    this.inbox = [];
  }
  async send(text) {
    const n = this.written.length;
    const id = await deriveId(this.peer, n); // 写入对方信箱
    const msg = { sender: this.role, t: "t" + n, text };
    const { ownerToken } = await this.share.put(await encrypt(JSON.stringify(msg), PASS), { id });
    this.written.push({ id, ownerToken });
  }
  async poll() {
    let k = this.readN;
    for (let i = 0; i < 100; i++) {
      const buf = await this.share.getOrNull(await deriveId(this.role, k));
      if (buf === null) break;
      const plain = await decrypt(buf, PASS);
      this.inbox.push(JSON.parse(new TextDecoder().decode(plain)));
      k++;
    }
    this.readN = k;
  }
  async burn() {
    for (const { id, ownerToken } of this.written) await this.share.remove(id, ownerToken);
    this.written = [];
  }
}

const A = new Client("A");
const B = new Client("B");
const assert = (cond, label) => { if (!cond) { console.error("FAIL", label); process.exit(1); } console.log("PASS", label); };

await A.send("第一句：确认安全通道");
await A.send("第二句：连续两条");
await A.send("第三句");
await B.poll();
assert(B.inbox.length === 3, "B reads all 3 of A's messages (catch-up)");
console.log("DEBUG B.inbox =", JSON.stringify(B.inbox));
assert(B.inbox.map((m) => m.sender).join("") === "AAA", "sender tag preserved");

await B.send("收到，回复");
await A.poll();
assert(A.inbox.length === 1 && A.inbox[0].text === "收到，回复", "A reads B's reply");

// determinism: fresh client with same pass re-derives same ids, same history
const B2 = new Client("B");
await B2.poll();
assert(B2.inbox.length === 3 && B2.inbox.map((m) => m.text).join() === B.inbox.map((m) => m.text).join(),
  "deterministic chain: fresh B re-derives identical state from password only");

// wrong password must not crash and must not yield plaintext
let threw = false;
try {
  await decrypt(await A.share.get(await deriveId("A", 0)), "wrong-pass");
} catch { threw = true; }
assert(threw, "wrong password throws (GCM auth tag)");

// raw blob on server is opaque ciphertext (starts with SL1 magic, no plaintext)
const raw = await A.share.get(await deriveId("A", 0));
const head = new TextDecoder().decode(raw.slice(0, 200));
assert(head.startsWith("SL1"), "server sees SL1 envelope, not plaintext");
assert(!new TextDecoder().decode(raw).includes("收到，回复"), "no plaintext in stored blob");

// burn: A wipes its own sent messages (cells derived with B); B's poll no longer finds them
await A.burn();
await B.poll(); // should not crash
const gone = (await A.share.getOrNull(await deriveId("B", 0))) === null;
assert(gone, "burn: A's sent mailbox cells deleted");
await B.burn();
console.log("ALL PASS");
