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

## 部署（Cloudflare）

| 部分 | 运行在 |
|---|---|
| 网站、REST、MCP | Worker `polyradar-web`（OpenNext） |
| 每分钟排期 | `polyradar-jobs` 的 Cron Trigger |
| 抓取、解析 | Queue `polyradar-jobs`，并发 8 |
| LLM 分类、apidiff | Queue `polyradar-serial`，并发 1 |
| Bluesky 实时流 | Durable Object `JetstreamStream`，30 秒一次 alarm 落库并保活 |
| .d.ts 提取 | Container `ApiDiffContainer`（`packages/apidiff/Dockerfile`），TypeScript 检查器要约 200 MB，Worker 放不下 |
| 数据库 | 外部 Postgres 17 + pgvector，经 Hyperdrive |

需要 Workers 付费版（Containers、5 分钟 CPU 上限）和本机 Docker（构建容器镜像）。首次：

```bash
npx wrangler login
DATABASE_URL=<postgres 直连串> pnpm db:migrate
pg_dump -h localhost -p 54317 --data-only --exclude-table=_migration polyradar | psql <postgres 直连串>
npx wrangler hyperdrive create polyradar --connection-string=<postgres 直连串> --caching-disabled
npx wrangler queues create polyradar-jobs
npx wrangler queues create polyradar-serial
npx wrangler queues create polyradar-dead
cd apps/worker && npx wrangler secret put LLM_API_KEY && npx wrangler secret put GITHUB_TOKEN
```

把 Hyperdrive id 填进 `apps/worker/wrangler.jsonc` 和 `apps/web/wrangler.jsonc`，之后每次发布：`pnpm ship`。

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
