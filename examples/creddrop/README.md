# Credential Drop — 阅后即焚凭证保险箱（ShareLink 零知识示例）

比 Yopass 强在哪：ShareLink 是 **blob** 服务不是文本服务——
SSL 证书、SSH 私钥、kubeconfig、任意二进制（≤1MB）都能装。
前端用随机密码 AES-GCM 加密上传，短链里的 `#tok=` 携带 ownerToken
（纯客户端 hash，不进查询串、不进服务端日志的 URL 部分），
接收方解密读取后点「阅后即焚」，worker 校验 ownerToken 哈希后
从 KV 中彻底抹除。

> ⚠️ Security Warning: 链接即访问权，密码必须经另一渠道传递。
> 无 Forward Secrecy。阅后即焚依赖接收方主动点击或 ns TTL 过期。

## 流程

```
发送方                        服务端（零知识）              接收方
文件+密码 ──SL1 加密──▶ POST /s/creddrop ──▶ GET 链接
                ◀── {id, ownerToken} ──
短链 + #tok=ownerToken ──(任意渠道)──────────────▶  密码+短链
                                              解密 ✓ 预览/下载
                                              阅后即焚 ▶ DELETE ?token=
                                                   404（已抹除）
```

- 覆写/删除都走 ownerToken SHA-256 哈希校验（服务端只见哈希）。
- 接收方拿错密码 → GCM auth tag 失败，前端提示「密码错误」，服务端无感知。
- 文件 vs 文本：可打印 ASCII 启发式判定，文本进预览框，二进制给下载。

## 跑起来

```bash
npx wrangler dev --config wrangler.dev.jsonc
python -m http.server 8099    # 仓库根
# 单浏览器即可自测：① 打包一张 .pem/私钥文本 + 密码 → 复制短链
#                   ② 下方读取区贴短链 + 密码 → 解密 → 阅后即焚
#                   ③ 再贴一次同链接 → 「链接不存在（可能已被焚毁）」
```

## 边界

- 1MB 上限是 demo 保守值（KV 单 blob 25MB，但 base64/信封膨胀 + 免费额度）。
- token 在 URL hash 里：复制/粘贴短链时别把 hash 截掉，否则接收方能读但不能焚毁
  （服务端副本等 TTL 过期——demo ns 默认 1 年，生产建议给 `creddrop` 配短 TTL，
  见 `src/worker.js` NAMESPACE_CONFIG 的 per-ns 覆盖）。
