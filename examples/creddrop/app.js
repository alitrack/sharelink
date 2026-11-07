// credential drop — one-shot encrypted credential/vault file distribution.
// Sender:  file (or pasted text, ≤1MB) + passphrase -> SL1 envelope ->
//          random-ID upload -> short link; ownerToken travels in the link
//          URL hash (#tok=…) so the receiver can DELETE after reading.
// Receiver: paste link + passphrase -> decrypt -> preview/download ->
//          "burn" issues DELETE with the token (owner-verified server-side).
// Server sees only the opaque SL1 blob; the token never appears server logs
// beyond the DELETE request itself.
import { ShareLink } from "../../client/sharelink-client.js";
import { encrypt, decrypt } from "../../client/sharelink-crypto.js";

const $ = (id) => document.getElementById(id);
const MAX = 1024 * 1024;
const status = (t) => ($("status").textContent = t);
let fileBlob = null, fileMime = "", fileName = "";

function toast(msg) {
  const d = document.createElement("div");
  d.className = "toast"; d.textContent = msg;
  document.body.appendChild(d);
  setTimeout(() => d.remove(), 4000);
}

// ---------- sender ----------
const drop = $("drop");
drop.onclick = () => $("file").click();
drop.ondragover = (e) => { e.preventDefault(); drop.classList.add("over"); };
drop.ondragleave = () => drop.classList.remove("over");
drop.ondrop = (e) => {
  e.preventDefault();
  drop.classList.remove("over");
  if (e.dataTransfer.files[0]) setFile(e.dataTransfer.files[0]);
};
$("file").onchange = (e) => e.target.files[0] && setFile(e.target.files[0]);

function setFile(f) {
  if (f.size > MAX) { toast("超过 1MB 上限"); return; }
  fileBlob = f;
  fileMime = f.type || "application/octet-stream";
  fileName = f.name;
  $("fname").textContent = `${f.name}（${(f.size / 1024).toFixed(1)} KB）`;
}

$("share").onclick = async () => {
  const pass = $("pass").value;
  const text = $("text").value;
  if (!pass) return toast("需要密码");
  let payload, mime, name;
  if (fileBlob) { payload = await fileBlob.arrayBuffer(); mime = fileMime; name = fileName; }
  else if (text.trim()) {
    const enc = new TextEncoder();
    payload = enc.encode(text);
    mime = "text/plain";
    name = "credential.txt";
  } else return toast("选择文件或粘贴内容");
  try {
    const ct = await encrypt(payload, pass);
    const share = new ShareLink($("base").value.trim(), $("ns").value.trim() || "creddrop");
    const { id, ownerToken, url } = await share.put(ct);
    // token rides in the URL hash — client-side only, never a query param
    const link = `${url}#tok=${ownerToken}`;
    sessionStorage.setItem("creddrop_token", JSON.stringify({ id, ownerToken }));
    $("shareout").style.display = "block";
    $("linkout").value = link;
    $("linktag").textContent = `id=${id} · ${name}`;
    status("已加密上传 ✓ 把短链发给接收方，密码走另一渠道");
  } catch (e) {
    toast("上传失败：" + e.message);
  }
};

$("copy").onclick = async () => {
  try { await navigator.clipboard.writeText($("linkout").value); toast("已复制"); }
  catch { $("linkout").select(); document.execCommand("copy"); toast("已复制"); }
};

// ---------- receiver ----------
function parseLink(link) {
  const u = new URL(link);
  const m = u.pathname.match(/\/s\/([^/]+)\/([A-Za-z0-9]{6,16})/);
  if (!m) throw new Error("链接格式不对");
  return { base: u.origin, ns: m[1], id: m[2], tok: (u.hash.match(/tok=([a-f0-9]+)/) || [])[1] || null };
}

// prefill from a link pasted into the page URL hash or ?link=
(function () {
  const raw = decodeURIComponent((location.hash.match(/link=([^&]+)/) || [])[1] || location.hash.replace(/^#/, ""));
  if (raw.includes("/s/")) {
    try {
      const p = parseLink(raw);
      $("rlink").value = raw;
      if (p.tok) sessionStorage.setItem("creddrop_token", JSON.stringify({ id: p.id, ownerToken: p.tok }));
      status("链接已识别，输入密码后点解密");
    } catch { /* manual paste */ }
  }
})();

$("read").onclick = async () => {
  const pass = $("rpass").value;
  if (!pass) return toast("需要密码");
  let p;
  try { p = parseLink($("rlink").value.trim()); } catch (e) { return toast(e.message); }
  try {
    const share = new ShareLink(p.base, p.ns);
    const blob = await share.get(p.id);
    const plain = await decrypt(blob, pass);
    if (p.tok) sessionStorage.setItem("creddrop_token", JSON.stringify({ id: p.id, ownerToken: p.tok }));
    const bytes = new Uint8Array(plain);
    // printable ASCII heuristic -> text preview, else file download
    const sample = bytes.subarray(0, 512);
    const printable = [...sample].every((b) => b === 9 || b === 10 || b === 13 || (b >= 32 && b < 127));
    const dl = $("dl");
    if (printable) {
      $("dec").value = new TextDecoder().decode(plain);
      dl.href = URL.createObjectURL(new Blob([plain]));
      dl.download = "credential";
    } else {
      $("dec").value = `（二进制 ${bytes.length} 字节，请下载查看）`;
      dl.href = URL.createObjectURL(new Blob([plain]));
      dl.download = "credential.bin";
    }
    dl.style.display = "inline";
    status(`解密成功 ✓ ${bytes.length} 字节`);
  } catch (e) {
    if (e.message.includes("404")) toast("链接不存在（可能已被焚毁）");
    else if (e.name === "OperationError") toast("密码错误");
    else toast("读取失败：" + e.message);
  }
};

$("burn").onclick = async () => {
  try {
    const t = JSON.parse(sessionStorage.getItem("creddrop_token"));
    if (!t) return toast("没有本会话的 ownerToken");
    let p;
    try { p = parseLink($("rlink").value.trim()); }
    catch { p = { base: $("base").value.trim(), ns: $("ns").value.trim() || "creddrop", id: t.id }; }
    if (p.id !== t.id) return toast("令牌与链接不匹配");
    const share = new ShareLink(p.base, p.ns);
    await share.remove(t.id, t.ownerToken);
    sessionStorage.removeItem("creddrop_token");
    $("dec").value = "";
    $("dl").style.display = "none";
    status("已阅后即焚 🔥 服务端副本已 DELETE（ownerToken 校验通过）");
  } catch (e) {
    toast("销毁失败：" + e.message);
  }
};
