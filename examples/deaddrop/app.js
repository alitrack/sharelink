// dead drop — ShareLink zero-knowledge demo client.
// Protocol (all client-side; server stores opaque ciphertext only):
//   Roles:      URL hash #A / #B
//   Mailbox:    A's nth message -> blob id sha256(pass|ns|B|n).hex[0:16]  (B reads)
//               B's nth message -> blob id sha256(pass|ns|A|n).hex[0:16]  (A reads)
//   Each blob:  SL1 envelope (AES-GCM-256, PBKDF2-SHA256, client/sharelink-crypto.js)
//   State:      readN (next index to poll), written[] ({id, ownerToken} for burn)
import { ShareLink } from "../../client/sharelink-client.js";
import { encrypt, decrypt } from "../../client/sharelink-crypto.js";

const ROLE = location.hash.replace(/^#/, "").toUpperCase() === "B" ? "B" : "A";
const PEER = ROLE === "A" ? "B" : "A";
const POLL_MS = 3000;
const $ = (id) => document.getElementById(id);
const te = new TextEncoder(), td = new TextDecoder();
const hx = (b) => [...new Uint8Array(b)].map((x) => x.toString(16).padStart(2, "0")).join("");

let share = null, pass = "", ns = "", readN = 0, written = [], burning = false, started = false;

const status = (t) => ($("status").textContent = t);
const deriveId = (role, n) =>
  crypto.subtle.digest("SHA-256", te.encode(`${pass}|${ns}|${role}|${n}`)).then((d) => hx(d).slice(0, 16));

function toast(msg) {
  const d = document.createElement("div");
  d.className = "toast";
  d.textContent = msg;
  document.body.appendChild(d);
  setTimeout(() => d.remove(), 4000);
}

function addMsg(msg) {
  const d = document.createElement("div");
  d.className = "msg " + (msg.sender === ROLE ? "mine" : "theirs");
  const who = document.createElement("span");
  who.className = "who";
  who.textContent = `${msg.sender} · ${msg.t}`;
  d.appendChild(who);
  d.appendChild(document.createTextNode(msg.text));
  $("msgs").appendChild(d);
  $("msgs").scrollTop = $("msgs").scrollHeight;
}

function ingest(buf) {
  decrypt(buf, pass)
    .then((plain) => addMsg(JSON.parse(td.decode(plain))))
    .catch(() => toast("解密失败：约定密码错误"));
}

// Poll my mailbox: read one message, or catch up a run of consecutive ones.
async function poll() {
  if (burning || !started) return;
  try {
    let k = readN, caught = 0;
    while (caught < 100) {
      const buf = await share.getOrNull(await deriveId(ROLE, k));
      if (buf === null) break;
      ingest(buf);
      k++;
      caught++;
    }
    readN = k;
    status(`在线 · 角色 ${ROLE} · 等待 ${PEER}（${POLL_MS / 1000}s 轮询）`);
  } catch (e) {
    toast("网络错误：" + e.message);
  }
  if (!burning) setTimeout(poll, POLL_MS);
}

async function send() {
  const text = $("text").value.trim();
  if (!text || burning) return;
  const n = written.length;
  try {
    const id = await deriveId(PEER, n); // 我的第 n+1 条 → 写入对方的信箱（对方 poll 推导同一 id）
    const msg = { sender: ROLE, t: new Date().toISOString().slice(11, 19), text };
    const ct = await encrypt(JSON.stringify(msg), pass);
    const { ownerToken } = await share.put(ct, { id });
    written.push({ id, ownerToken });
    addMsg(msg);
    $("text").value = "";
    status(`已发送 → ${PEER}（信箱 #${n + 1}）`);
    poll();
  } catch (e) {
    toast("发送失败：" + e.message);
  }
}

// Burn: delete everything we hold owner tokens for (my sends).
// Peer's messages live in ids we can read but not delete (their tokens) —
// they expire with the ns TTL; we wipe local state on both ends when both burn.
async function burn() {
  if (burning) return;
  burning = true;
  status("销毁中…");
  const jobs = written.slice(0, 200).map(async ({ id, ownerToken }) => {
    try {
      await share.remove(id, ownerToken);
    } catch {
      /* already gone */
    }
  });
  await Promise.all(jobs);
  written = [];
  // 保留 readN（已读指针）：下一轮轮询从该处继续，不会把对端旧密信重新读回 UI。
  // 对端发给我的密信持有对方 ownerToken，我无权删除——它们留在信箱里，
  // 等对方 BURN 或 ns TTL 过期（README「边界」一节）。
  $("msgs").innerHTML = "";
  $("text").value = "";
  burning = false;
  status("本端历史已烧毁 🔥（我发出的密信已 DELETE；对端旧密信等对方 BURN / TTL 过期）");
}

function start() {
  if (started) return;
  pass = $("pass").value;
  ns = $("ns").value.trim() || "deaddrop";
  if (!pass) return;
  share = new ShareLink($("base").value.trim(), ns);
  $("send").onclick = send;
  $("burn").onclick = burn;
  $("text").onkeydown = (e) => e.key === "Enter" && send();
  started = true;
  status(`在线 · 角色 ${ROLE} · 把本页链接（带 #A/#B）和约定密码通过可信渠道给对方`);
  poll();
}

$("pass").addEventListener("change", start);
$("pass").addEventListener("input", start);
if ($("pass").value) start();
