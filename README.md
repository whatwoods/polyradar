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
pnpm worker         # 本地跑生产后台：wrangler dev + 每分钟 cron + 提取服务
```

之后再开机只需 `pnpm db:start`。LLM 走 OpenAI 兼容接口，在 `.env` 填 `LLM_BASE_URL`、`LLM_API_KEY`、`LLM_MODEL_FAST/SMART`；未配置时采集照常，只是不做分类。改了提示词或模型后跑 `pnpm eval`（金标准集在 `seeds/eval/`）。设置 `GITHUB_TOKEN` 可解除 GitHub 匿名每小时 60 次的限制。来源状态见 `/sources`。`pnpm worker` 需要 `apps/worker/.dev.vars`（`LLM_API_KEY`、`GITHUB_TOKEN`、`APIDIFF_URL=http://localhost:8099`、`DEV_ENQUEUE=1`）；`pnpm preview` 在本地 Workers 运行时里跑网站（:8788）。

## 部署

现在跑在 Cloudflare Workers 免费版 + GitHub Actions：

| 部分 | 运行在 |
|---|---|
| 网站、REST、MCP | Worker `polyradar-web`（OpenNext），https://polyradar.wayai.cc ；页面在边缘缓存 10 分钟，过期先回旧页再后台刷新，免费版每次 10 ms CPU 不够首次渲染 |
| 采集、解析、分类、apidiff | `.github/workflows/collect.yml`，每 15 分钟 `pnpm collect --due`，直连 Neon |
| 发布 | `.github/workflows/deploy.yml`，推送 main 时检查、迁移、灌种子、发布网站 |
| 数据库 | Neon Postgres 17 + pgvector；网站经 Hyperdrive 连接 |

两个工作流在仓库变量 `POLYRADAR_LIVE` 为 `true` 前不运行。需要的配置：

| 名称 | 类型 | 内容 |
|---|---|---|
| `DATABASE_URL` | secret | Neon 直连串 |
| `LLM_API_KEY` | secret | LLM key |
| `CLOUDFLARE_API_TOKEN` / `CLOUDFLARE_ACCOUNT_ID` | secret | 能发布 Workers 的 API token 和账户 id |
| `LLM_BASE_URL` / `LLM_MODEL_FAST` / `LLM_MODEL_SMART` | variable | 同 `.env` |

Hyperdrive：`npx wrangler hyperdrive create polyradar --connection-string=<Neon 直连串> --caching-disabled`，把 id 填进 `apps/web/wrangler.jsonc`。首次把本地数据搬上去：

```bash
DATABASE_URL=<Neon 直连串> pnpm db:migrate
pg_dump -h localhost -p 54317 --data-only --exclude-table=_migration polyradar | psql <Neon 直连串>
```

升级 Workers 付费版后可换成全 Cloudflare 后台（`apps/worker/src/cf`：Cron + Queues + Durable Object 跑 Bluesky + Container 跑 apidiff，`pnpm --filter @polyradar/worker ship`），并停掉 collect 工作流。

## 结构

| 路径 | 内容 |
|---|---|
| `packages/db` | 迁移、种子加载、事实写入规则（§8.3）、共享查询层 |
| `packages/apidiff` | 内存解包 npm tarball、TypeScript Compiler API 提取 .d.ts 符号（容器服务 `server.ts`）、相邻版本 diff |
| `apps/worker` | Cloudflare 入口（`src/cf`：cron、队列、Durable Object、容器）、与运行时无关的任务（`jobs.ts`）、采集器（GitHub、npm、Discourse、HN、RSS/Reddit、arXiv、HF 论文与模型、Bluesky Jetstream）、RawItem→Signal、规范键解析、分类（规则 + LLM）、建实体与聚类、带证据的事实抽取 |
| `packages/llm` | OpenAI 兼容适配层：结构化输出及降级、zod 校验、按模型+输入缓存、`llm_call` 记账 |
| `apps/web` | 网站、REST `/v1/*`、MCP `/mcp`、`/e/{slug}.md`、`/llms.txt`、`/feed.json` |
| `seeds/` | 能力树、属性注册表、来源、手工实体（含 2026-10-24 周验收样例） |

## Agent 接入

```bash
claude mcp add --transport http polyradar http://localhost:3100/mcp
```
