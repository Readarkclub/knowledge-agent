# 人人智学社知识库 Agent

基于飞书 Wiki 周报的知识问答与资源索引：

- 递归增量同步飞书文档
- 关键词 / 本地向量混合检索
- GLM 流式回答与原文引用
- 周报资源链接自动分类、去重和追溯
- Next.js 网页交互界面
- 移动端长回答独立滚动
- 深色 / 浅色主题切换并记住个人偏好

## 本地运行

```bash
npm install
copy .env.example .env.local
npm run sync
npm run dev
```

浏览器打开 `http://localhost:3000`。

飞书同步复用本机 `lark-cli --as user` 登录态。生成的
`data/index.json` 含知识库正文和向量，已从 Git 排除，禁止提交到公开仓库。

## 环境变量

```ini
API_SECRET_KEY=
GEMINI_GATEWAY_URL=https://api.readark.club/api
AI_MODEL=gemini-2.5-flash
EMBEDDING_PROVIDER=local
```

- 知识问答使用 Gemini 原生 `v1beta1` 协议；网关地址末尾的
  `/v1beta1` 由服务端自动补全。
- 切换为 `EMBEDDING_PROVIDER=zhipu` 时使用 `embedding-3` 的
  512 维输出；修改向量提供方后需重新执行 `npm run sync`。

## 同步与部署

- 本地执行 `npm run sync` 更新索引。
- 同步按 revision/content hash 增量处理。
- Vercel 使用部署时携带的只读索引快照，不在线调用 `lark-cli`。
- 每周同步后重新执行 Vercel 生产部署，即可发布最新快照。
- GitHub 仓库只保存代码；知识索引与密钥均不进入 Git。

## 验证

```bash
npm test
npm run lint
npm run build
```

## 界面约定

- 移动端问答主区域使用动态视口高度，会话正文在独立容器内滚动。
- 主题首次访问跟随系统偏好，手动选择后保存到浏览器本地存储。
