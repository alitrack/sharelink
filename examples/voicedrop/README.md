# Voice Drop — 异步加密对讲机（ShareLink 零知识示例）

deaddrop 的音频版：两个人约定一个密码，用 `MediaRecorder` 录一段语音，
加密成 SL1 信封，走同一条确定性命信箱链，对方 3 秒内轮询到即自动播放。
轮询延迟不是缺陷——是刻意的「太空通信感」：双方像跨星系用无线电对讲，
声音阅后即焚，服务端只见密文。

> ⚠️ Security Warning: zero-knowledge architectural demo. No Forward
> Secrecy, no metadata obfuscation. Do not use for high-stake comms.

## 与 deaddrop 的关系

**协议零改动**：角色（#A/#B）、信箱 ID 链（`sha256(pass|ns|role|n).hex[0:16]`）、
SL1 信封（AES-GCM-256 / PBKDF2 310k）、3s 轮询 + catch-up、BURN 全部复用
`client/sharelink-crypto.js` 与 deaddrop 同一套推导。唯一差异是 payload：

```
deaddrop:  { sender, t, text }
voicedrop: { sender, t, mime: "audio/webm", audio: base64 }
```

这正是 ShareLink 架构复利的演示——**服务端一行业务代码没动**，
「装得下文字」自动意味着「装得下音频、图片、游戏存档」，
格式语义 100% 由客户端定义。

## 跑起来

```bash
npx wrangler dev --config wrangler.dev.jsonc          # worker
python -m http.server 8099                            # 仓库根，静态
# 两个浏览器 tab：
#   http://127.0.0.1:8099/examples/voicedrop/index.html#A
#   http://127.0.0.1:8099/examples/voicedrop/index.html#B
# 输入同一密码 → 点 TALK 说话 → 再点发送 → 对方 3s 内自动播放
```

麦克风需要 secure context：`localhost` 豁免可直接用，非 localhost 需 https。
自动播放可能被浏览器策略拦截（非用户手势触发的 play），被拦时手动点播放。

## 边界

- 单条语音 ≤30s（自动截停），base64 进 JSON 后 ~1.33 倍膨胀，
  远小于 KV 25MB/blob 上限。
- 无实时性：3s 轮询是刻意的（KV 免费额度友好）。
- 其余边界同 deaddrop（无 Forward Secrecy / 元数据可见 / 对端密信等对方 BURN）。
