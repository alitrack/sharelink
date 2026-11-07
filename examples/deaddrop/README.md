# Dead Drop — 死信箱（ShareLink 零知识示例）

两个人，一个约定密码，一个短链接。无账号、无服务端状态、服务端零知识——
一条纯浏览器运行的异步加密传纸条。

这是 ShareLink「后端是绝对盲目的磁带机，客户端定义全部格式语义」架构
的第一个 showcase：信箱 ID、加密、轮询协议 **全部** 在客户端推导，
服务端只存它看不懂的密文 blob。

> ⚠️ **Security Warning**: This is a zero-knowledge **architectural demo**.
> It does NOT provide Forward Secrecy (Double Ratchet) or metadata
> obfuscation. Do not use for high-stake communications.

## 协议

```
角色:      URL 末尾 #A / #B（链接即身份）
信箱链:    A 的第 n+1 条 → blob id = sha256(pass|ns|B|n).hex 前 16 位（B 轮询）
           B 的第 n+1 条 → blob id = sha256(pass|ns|A|n).hex 前 16 位（A 轮询）
加密:      SL1 信封 = AES-GCM-256，PBKDF2-SHA256 310k 次（client/sharelink-crypto.js）
轮询:      每 3s GET 推导出的 id；404=对方没发；200=解密入聊天框
销毁:      BURN ROOM 用上传时返回的 ownerToken 逐条 DELETE 本端发出的密信
```

双方对同一个 `(passphrase, ns, role, index)` 四元组推导出完全相同的 16 位
短 ID —— 这就是「确定性命信箱链」：没有服务端会话，同步靠哈希，不靠状态。

## 跑起来

```bash
# 1. 起一个 ShareLink（本地 memory store 即可）
npx wrangler dev --config wrangler.dev.jsonc

# 2. 静态服务本目录（examples/ 不是 Worker 资源，需自己的静态托管）
npx serve examples/deaddrop        # 或任意静态服务器，改 app.js 里的 base 指向 worker

# 3. 两个浏览器 / 隐私窗口：
#    .../index.html#A  和  .../index.html#B
#    输入同一个约定密码，互相发消息。
```

注意：本地 `npx serve`（http://localhost）访问 WebCrypto 需要 secure context，
localhost 是豁免的，可直接用；非 localhost 需 https。

## 服务端改动（本示例依赖的最小增量）

POST /s/:ns 默认随机生成 id。死信箱需要**确定性 id**（双方独立推导同一地址），
因此 worker 增加了一个可选请求头 `X-ShareLink-Id`：客户端自带 id 上传，
命中同一地址即幂等覆写（id 校验复用 `ID_RE`，字母表与随机 id 一致）。
不传该头的行为与之前完全相同——纯增量，默认零行为变化。

## 它证明了什么

- **格式语义由客户端定义**：同一个 blob 服务，装得下 SQL 结果、Markdown、
  游戏存档，也装得下一条加密纸条。服务端一行业务代码都不用写。
- **零知识**：Cloudflare 看到的只是 `sha256` 短 id + 一段 AES-GCM 密文，
  连「两个人在对话」这件事本身都不留在服务端元数据里。
- **状态外置到密码**：会话状态（读到第几条、谁发过什么）不在任何服务器，
  而在双方脑中的 passphrase 里——忘了密码，比销毁按钮更彻底的销毁。

## 边界（诚实声明）

- 无向前保密：泄露密码 = 全部历史密文泄露。
- 元数据可见：blob 的存在、大小、时间戳对服务端可观测。
- 轮询 3s 延迟是刻意的（KV 免费额度友好），不是性能事故。
- 对方发来的密信用对方的 ownerToken，本端只能删自己发的；BURN 会保留
  已读指针，不会把对端旧密信重新读回 UI——对端旧密信等对方 BURN 或 ns TTL 过期。
