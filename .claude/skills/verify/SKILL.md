---
name: verify
description: 本仓库的端到端验证配方：生成合成索引、启动生产服务、用 curl 驱动 API。
---

# 端到端验证配方

无需真实飞书数据或模型密钥即可驱动全部检索与确定性问答路径。

## 1. 生成合成索引

写一个脚本导入 `src/lib/chunking` 的 `chunkDocument`，构造：

- 若干标题含日期范围的周报文档（`人人智学社周报 2026-06-15~2026-06-21`），
  内容带 `# 本周亮点` 等章节，命中周报路由与检索；
- 可选大量填充文档 + 384 维随机向量，把 `data/index.json`
  撑到 ~15MB 以复现真实解析成本。

`sync` 元数据：`status: "ready"`、`documentCount/chunkCount/embeddedChunkCount`
与实际一致；`version: 3`。写入 `data/index.json`（已被 gitignore）。

## 2. 启动生产服务

```bash
npm run build
AUTH_PASSWORD='verify-password-123!' \
AUTH_SESSION_SECRET='0123456789abcdef0123456789abcdef0123456789abcdef' \
PORT=4000 npx next start
```

- `AUTH_PASSWORD` ≥12 字符、`AUTH_SESSION_SECRET` ≥32 字符，否则中间件 503。
- 不配置 `API_SECRET_KEY` 时，LLM 内容问答返回 500（预期）；
  周报统计/最新一期/证据缺失路由不经过 LLM，可完整验证。
- 不配置 `EMBEDDING_PROVIDER` 时走纯关键词检索，无远程调用。

## 3. 登录并驱动

```bash
curl -s -c /tmp/jar -H 'Content-Type: application/json' \
  -d '{"username":"admin","password":"verify-password-123!"}' \
  http://localhost:4000/api/auth/login

curl -s -b /tmp/jar http://localhost:4000/api/status

curl -s -b /tmp/jar -H 'Content-Type: application/json' \
  -d '{"query":"RAG 知识库落地有哪些经验"}' http://localhost:4000/api/search

# 聊天消息体（UIMessage 格式，最后一条必须是 user）：
curl -s -b /tmp/jar -H 'Content-Type: application/json' \
  -d '{"messages":[{"id":"m1","role":"user","parts":[{"type":"text","text":"一共有多少份周报？"}]}]}' \
  http://localhost:4000/api/chat
```

值得驱动的流：周报总数/月份数量/最新一期（确定性直答）、内容检索、
术语改写兜底（如「检索增强生成」→ RAG）、证据缺失拒答、
运行中外部改写 `data/index.json` 后 `/api/status` 立即反映（索引缓存失效）。

## 4. 陷阱

- 登录限流 5 次/15 分钟，验证过程不要反复登录；search 限流 60/分钟。
- 对照旧版本时用 `git worktree`，但 Turbopack 拒绝跨文件系统的
  `node_modules` 软链——worktree 放同一文件系统并用 `cp -al` 硬链接。
- 本环境 npm 需 `npm_config_registry=https://registry.npmjs.org
  npm_config_replace_registry_host=always npm install --no-save`
  （锁文件指向 npmmirror，代理返回 403）。
