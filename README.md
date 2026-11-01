# 三维雷达 Polyradar

Web 实时 3D 与 AI 游戏创作的可验证情报库。产品与架构见 [PLAN.md](PLAN.md)。

## 本地运行

需要 Node 24、pnpm、Homebrew 的 `postgresql@17` 和 `pgvector`。

```bash
pnpm install
pnpm db:init        # 在 .pgdata 建库，端口 54317
pnpm db:migrate
pnpm seed           # seeds/*.yaml：能力树、属性注册表、首批实体
pnpm apidiff        # 下载 @types/three r125 起各版本，生成 API 快照与变更
pnpm collect        # 所有来源各采一次（首次为回填，不产生事件）
pnpm dev            # http://localhost:3100
pnpm worker         # 常驻：按 seeds/sources.yaml 的频率轮询，处理队列
```

之后再开机只需 `pnpm db:start`。设置 `GITHUB_TOKEN` 可解除 GitHub 匿名每小时 60 次的限制。来源状态见 `/sources`。

## 结构

| 路径 | 内容 |
|---|---|
| `packages/db` | 迁移、种子加载、事实写入规则（§8.3）、共享查询层 |
| `packages/apidiff` | npm 包下载、TypeScript Compiler API 提取 .d.ts 符号、相邻版本 diff |
| `apps/worker` | Graphile Worker 任务、采集器（GitHub、npm、Discourse、HN、RSS/Reddit）、RawItem→Signal、规范键解析、发布事件 |
| `apps/web` | 网站、REST `/v1/*`、MCP `/mcp`、`/e/{slug}.md`、`/llms.txt`、`/feed.json` |
| `seeds/` | 能力树、属性注册表、来源、手工实体（含 2026-10-24 周验收样例） |

## Agent 接入

```bash
claude mcp add --transport http polyradar http://localhost:3100/mcp
```
