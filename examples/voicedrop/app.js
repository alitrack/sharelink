// voice drop — async encrypted walkie-talkie over ShareLink.
// Same deterministic-mailbox protocol as deaddrop (roles #A/#B,
// id = sha256(pass|ns|role|n).hex[0:16], SL1 envelope, 3s polling),
// but the payload is a recorded WebM/Opus clip instead of text:
//   JSON { sender, t, mime, audio: base64 }
// Server still sees only an opaque SL1 ciphertext blob.
import { ShareLink } from "../../client/sharelink-client.js";
import { encrypt, decrypt } from "../../client/sharelink-crypto.js";

const ROLE = location.hash.replace(/^#/, "").toUpperCase() === "B" ? "B" : "A";
const PEER = ROLE === "A" ? "B" : "A";
const POLL_MS = 3000, MAX_CLIP_MS = 30000;
const $ = (id) => document.getElementById(id);
const te = new TextEncoder(), td = new TextDecoder();
const hx = (b) => [...new Uint8Array(b)].map((x) => x.toString(16).padStart(2, "0")).join("");

let share = null, pass = "", ns = "", readN = 0, written = [], burning = false, started = false;
let rec = null, chunks = [], recTimer = null, recStart = 0;

const status = (t) => ($("status").textContent = t);
const deriveId = (role, n) =>
  crypto.subtle.digest("SHA-256", te.encode(`${pass}|${ns}|${role}|${n}`)).then((d) => hx(d).slice(0, 16));
// base64 in 64KB chunks (spread beyond that overflows the stack).
const b64 = (buf) => {
  const b = new Uint8Array(buf);
  let s = "";
  for (let i = 0; i < b.length; i += 0x10000) s += String.fromCharCode.apply(null, b.subarray(i, i + 0x10000));
  return btoa(s);
};

function toast(msg) {
  const d = document.createElement("div");
  d.className = "toast"; d.textContent = msg;
  document.body.appendChild(d);
  setTimeout(() => d.remove(), 4000);
}

function addClip(msg) {
  const d = document.createElement("div");
  d.className = "msg " + (msg.sender === ROLE ? "mine" : "theirs");
  const who = document.createElement("span");
  who.className = "who";
  who.textContent = `${msg.sender} · ${msg.t}`;
  const audio = document.createElement("audio");
  audio.controls = true;
  audio.src = "data:" + msg.mime + ";base64," + msg.audio;
  d.appendChild(who);
  d.appendChild(audio);
  $("msgs").appendChild(d);
  $("msgs").scrollTop = $("msgs").scrollHeight;
  if (msg.sender !== ROLE) audio.play().catch(() => {}); // 对端语音自动播放（浏览器可能拦截，可手动）
}

function ingest(buf) {
  decrypt(buf, pass)
    .then((plain) => addClip(JSON.parse(td.decode(plain))))
    .catch(() => toast("解密失败：约定密码错误"));
}

async function poll() {
  if (burning || !started) return;
  try {
    let k = readN, caught = 0;
    while (caught < 100) {
      const buf = await share.getOrNull(await deriveId(ROLE, k));
      if (buf === null) break;
      ingest(buf);
      k++; caught++;
    }
    readN = k;
    status(`在线 · 角色 ${ROLE} · 频道 ${PEER}（${POLL_MS / 1000}s 轮询）`);
  } catch (e) {
    toast("网络错误：" + e.message);
  }
  if (!burning) setTimeout(poll, POLL_MS);
}

// 点按开始/停止录音；停止即发送（无单独发送按钮，对讲机语义）。
async function toggleTalk() {
  if (burning) return;
  if (!rec) { startRec(); return; }
  stopRec();
}

async function startRec() {
  try {
    const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    const mime = MediaRecorder.isTypeSupported("audio/webm") ? "audio/webm" : "";
    rec = new MediaRecorder(stream, mime ? { mimeType: mime } : undefined);
    chunks = [];
    rec.ondataavailable = (e) => e.data.size && chunks.push(e.data);
    rec.onstop = async () => {
      stream.getTracks().forEach((t) => t.stop());
      const clip = new Blob(chunks, { type: rec.mimeType || "audio/webm" });
      rec = null; chunks = [];
      $("talk").classList.remove("rec");
      $("talk").textContent = "● TALK（点按说话，再点发送）";
      clearInterval(recTimer);
      if (clip.size === 0) { toast("录音为空"); return; }
      sendClip(clip);
    };
    rec.start(250);
    recStart = Date.now();
    $("talk").classList.add("rec");
    $("talk").textContent = "◼ STOP（发送）";
    recTimer = setInterval(() => {
      const s = Math.round((Date.now() - recStart) / 1000);
      $("talk").textContent = `◼ ${s}s（再点发送）`;
      if (Date.now() - recStart >= MAX_CLIP_MS) stopRec();
    }, 500);
  } catch (e) {
    toast("无法访问麦克风：" + e.message);
  }
}

function stopRec() { if (rec) rec.stop(); }

async function sendClip(clip) {
  const n = written.length;
  try {
    const id = await deriveId(PEER, n);
    const msg = {
      sender: ROLE,
      t: new Date().toISOString().slice(11, 19),
      mime: clip.type || "audio/webm",
      audio: b64(await clip.arrayBuffer()),
    };
    const ct = await encrypt(JSON.stringify(msg), pass);
    const { ownerToken } = await share.put(ct, { id });
    written.push({ id, ownerToken });
    addClip(msg);
    status(`已发送 → ${PEER}（${(clip.size / 1024).toFixed(0)} KB，信箱 #${n + 1}）`);
    poll();
  } catch (e) {
    toast("发送失败：" + e.message);
  }
}

async function burn() {
  if (burning) return;
  burning = true;
  status("销毁中…");
  await Promise.all(written.slice(0, 200).map(async ({ id, ownerToken }) => {
    try { await share.remove(id, ownerToken); } catch { /* already gone */ }
  }));
  written = [];
  $("msgs").innerHTML = "";
  burning = false;
  status("本端语音已烧毁 🔥（对端旧语音等对方 BURN / TTL 过期）");
}

function start() {
  if (started) return;
  pass = $("pass").value;
  ns = $("ns").value.trim() || "voicedrop";
  if (!pass) return;
  share = new ShareLink($("base").value.trim(), ns);
  $("talk").onclick = toggleTalk;
  $("burn").onclick = burn;
  started = true;
  status(`在线 · 角色 ${ROLE} · 把链接（#A/#B）和密码通过可信渠道给对方`);
  poll();
}

$("pass").addEventListener("change", start);
$("pass").addEventListener("input", start);
if ($("pass").value) start();
