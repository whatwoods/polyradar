# 交接文档

更新于 2026-11-01。产品与原始方案见 [PLAN.md](../PLAN.md)，本文记录**实际做到哪、怎么跑、卡在哪、下一步**。

## 1. 现状一句话

MVP 第 1–3 周的功能和第 5–7 周的一部分已完成，本地全量跑通；代码已推到 https://github.com/whatwoods/polyradar（公开）。**还没上线**：等 Neon 数据库和几个 GitHub secrets（见第 4 节）。

## 2. 已完成

| 模块 | 内容 | 位置 |
|---|---|---|
| 数据层 | Postgres 17 + pgvector，7 个迁移；事实写入规则（§8.3）；规范键解析（GitHub、npm、arXiv、HF、DOI、PyPI） | `packages/db` |
| 种子 | 能力树、属性注册表、13 个来源、13 个手工实体（含 §12 验收样例）、24 条分类金标准 | `seeds/` |
| three.js API 变更 | r125–r187 共 62 个版本快照、2.2 万条变更；`check_api` 查询 | `packages/apidiff` |
| 采集器 | GitHub、npm、Discourse、HN、Reddit、4 个博客 RSS、arXiv、HF 每日论文、HF 3D 模型、Bluesky Jetstream（已关） | `apps/worker/src/collectors`、`streams/` |
| 分类管线 | 规则粗筛 → LLM 判断范围、类别、决策价值/展示价值两条轴 → 建实体或挂到已有实体 → 事件聚类 → 带原文引用的事实抽取（引文必须在原文中） | `normalize.ts`、`triage.ts`、`promote.ts`、`extract.ts` |
| LLM 适配 | OpenAI 兼容接口，结构化输出逐级降级，zod 校验，按模型+输入缓存在 `llm_call` | `packages/llm` |
| 网站 | 雷达（周）、展示、浏览、实体页、API 变更页、来源健康页、搜索 | `apps/web/app` |
| Agent 接入 | MCP（search、get、compare、whats_new、check_api、get_demo、report）、REST `/v1/*`、`/e/{slug}.md`、`/llms.txt`、`/feed.json` | `apps/web` |
| 部署代码 | 免费版方案（当前）和付费版全 Cloudflare 方案都已写好并在本地 Workers 运行时验证 | 见第 3 节 |

本地数据量（2026-11-01）：191 实体、135 事件、820 信号、389 事实；LLM 累计 1110 次调用、约 265 万 token（一次全量重跑约 76 万）。

评测（`pnpm eval`）：范围、可运行、实体识别 24/24；决策分档 2/3（Open GPU Benchmarker 给了 0.46，人工标低）。

## 3. 架构

### 当前：Workers 免费版 + GitHub Actions

| 部分 | 运行在 | 说明 |
|---|---|---|
| 网站、REST、MCP | Worker `polyradar-web`（OpenNext），`polyradar.wayai.cc` | `apps/web/worker.ts` 包了一层边缘缓存：页面按 URL 缓存，10 分钟内直接返回，过期先回旧页再后台刷新 |
| 采集到分类全流程 | `.github/workflows/collect.yml`，每 15 分钟 | `pnpm collect --due` 只跑到期来源，直连 Neon；apidiff 在进程内跑 |
| 发布 | `.github/workflows/deploy.yml`，推送 main 时 | 迁移、灌种子、发布网站 |
| 检查 | `.github/workflows/ci.yml`，每次推送 | 类型检查、测试、OpenNext 构建；不需要 secrets |
| 数据库 | Neon Postgres 17 | 网站经 Hyperdrive（关缓存）；Actions 直连 |

`collect` 和 `deploy` 在仓库变量 `POLYRADAR_LIVE` 为 `true` 之前不运行，避免没配好时每 15 分钟失败一次。

### 备用：付费版全 Cloudflare（代码已在，未启用）

`apps/worker/src/cf`：Cron 每分钟排期 → Queues（`polyradar-jobs` 并发 8 跑抓取解析，`polyradar-serial` 并发 1 跑分类和 apidiff）→ Durable Object 常驻 Bluesky 流 → Container 跑 .d.ts 提取（TypeScript 检查器要约 200 MB，Worker 放不下）。启用：升级 Workers 付费版，按 README 建队列和 Hyperdrive，`pnpm --filter @polyradar/worker ship`，停掉 collect 工作流。容器镜像需要 Docker 构建，计划放到 Actions 里做（尚未写）。

### 两套共用的代码

任务定义在 `apps/worker/src/jobs.ts`，与运行时无关：Cloudflare 队列消费者和 `pnpm collect` 的进程内队列跑的是同一套。`@polyradar/db` 在 Workers 里每个查询开一个短连接（Hyperdrive 负责连接池），在 Node 里用连接池。

## 4. 上线还差的步骤

**需要你做**（凭据不要发到对话里）：

1. 在 neon.tech 建项目：Postgres 17，区域 AWS Singapore。把**直连串**（不带 `-pooler`）写进本地 `.env`：`NEON_DATABASE_URL=…`
2. Cloudflare 后台用 “Edit Cloudflare Workers” 模板建一个 API token，记下 Account ID。（本机 `wrangler` 已登录，账号 weiking52095@gmail.com；要确认 `wayai.cc` 在同一个账号下。）
3. 在项目目录逐条运行，每条会提示粘贴值：
   ```bash
   gh secret set DATABASE_URL            # Neon 直连串
   gh secret set CLOUDFLARE_API_TOKEN
   gh secret set CLOUDFLARE_ACCOUNT_ID
   grep '^LLM_API_KEY=' .env | cut -d= -f2- | gh secret set LLM_API_KEY
   ```

**之后由 Claude 做**：

1. `DATABASE_URL=$NEON_DATABASE_URL pnpm db:migrate`，再 `pg_dump --data-only --exclude-table=_migration` 把本地数据搬到 Neon。
2. `npx wrangler hyperdrive create polyradar --connection-string=… --caching-disabled`，把 id 填进 `apps/web/wrangler.jsonc`（替换 `REPLACE_WITH_HYPERDRIVE_ID`）。
3. `gh variable set POLYRADAR_LIVE --body true`，推送触发 deploy；手动触发一次 collect（`gh workflow run collect`）。
4. 逐页验证 https://polyradar.wayai.cc ，盯 Workers 日志里有没有 CPU 超限（错误 1102）。

已经设好的仓库变量：`LLM_BASE_URL`、`LLM_MODEL_FAST`、`LLM_MODEL_SMART`。

## 5. 本地开发

```bash
pnpm db:start                 # 本地 Postgres（.pgdata，端口 54317）
pnpm dev                      # 网站 http://localhost:3100
pnpm collect                  # 所有来源采一次；--due 只跑到期的；单个来源写 slug
pnpm collect --retriage arxiv # 重新解析并分类（LLM 有缓存）
pnpm eval                     # 改了提示词或模型后跑
pnpm preview                  # 在本地 Workers 运行时里跑网站（:8788）
pnpm worker                   # 本地模拟付费版后台：wrangler dev + 每分钟 cron + 提取服务
```

`.env`（不入库）：`LLM_BASE_URL`、`LLM_API_KEY`、`LLM_MODEL_FAST/SMART`。`pnpm worker` 另需 `apps/worker/.dev.vars`（已在本机生成，不入库）。

## 6. 决策记录

| 日期 | 决策 | 原因 |
|---|---|---|
| 10 月 | LLM 用 lisaapi 的 gemini-3.8-flash-high，分类和抽取同一个模型 | 评测过 3.5-flash-lite，判断质量不够 |
| 10 月 | 论文用单独的评分说明（只加在用户提示里） | 带代码的论文被打到 0.75，过高；只改用户提示可保住帖子类的缓存 |
| 11-01 | 部署目标从 Hetzner + Docker Compose 改为 Cloudflare Workers | 用户决定 |
| 11-01 | 先用 Workers 免费版，后台放 GitHub Actions，仓库公开 | 不升级付费版；公开仓库 Actions 分钟数不限 |
| 11-01 | Bluesky 关闭 | 免费版没有常驻对象；关键词在 Bluesky 上几乎无命中 |
| 11-01 | 数据库用 Neon，域名 polyradar.wayai.cc | 用户决定 |
| 11-01 | 提示词里的实体拼写表只放种子里的“精选”实体，按名字排序 | 原来放全部实体、按重要度排序，每新增一个实体所有缓存失效 |

## 7. 已知问题与风险

- **免费版 CPU**：每次请求 10 ms。实测（Node 下）首页 17 ms、来源页 10 ms，其他页 1–8 ms。靠边缘缓存挡住大部分请求，但每个机房每个页面首次渲染、以及过期后的后台刷新仍可能超限。上线后看日志，不行就升级付费版或继续压首页。
- **雷达偏松**：决策价值阈值 0.4，一周 25 条以上。需要更多决策分档的人工标注来校准，可能提到 0.5。
- **Hyperdrive 免费额度**每天 10 万次查询；页面每次渲染 5–10 个查询，靠缓存应当够。
- **GitHub 定时工作流**在公开仓库 60 天没有提交会被自动停用，需要到 Actions 页手动重新启用。
- **arXiv** 要求请求间隔 3 秒，采集器已遵守；一次最多 6 页。
- **apidiff 只覆盖 three / @types/three**；PLAN 里的 R3F、drei 还没做。
- 付费版方案的容器镜像构建工作流还没写；本机没有 Docker。

## 8. 下一步（建议顺序）

1. 上线（第 4 节）。
2. 审核台 + 决策分档标注，校准雷达阈值（PLAN 第 4 周）。
3. 确定性核验：许可、链接存活、维护健康度（PLAN 第 4 周）。
4. 截图采集：Browser Rendering 给 demo 截图存 R2（PLAN 第 7 周）。
5. 语义搜索：Workers AI 的 bge-m3 生成向量存 pgvector（PLAN 第 6 周的混合检索）。
6. API diff 扩到 R3F、drei；对比页；OpenAPI 文档；种子扩到 300 个仓库（PLAN 第 5–8 周）。
7. 按 PLAN 9.2 跑全部验收指标，然后公开发布、上架 MCP 目录。

## 9. 文件地图

| 路径 | 内容 |
|---|---|
| `apps/web` | Next.js 16 网站；`worker.ts` 是 Cloudflare 入口（Hyperdrive + 边缘缓存）；`wrangler.jsonc` |
| `apps/worker/src/jobs.ts` | 任务定义：poll_source、normalize、triage、apidiff |
| `apps/worker/src/collect.ts` | 命令行与 Actions 用的进程内任务队列 |
| `apps/worker/src/cf/` | 付费版入口：cron、队列消费者、Bluesky Durable Object、apidiff 容器 |
| `apps/worker/src/collectors/` | 各来源采集器 |
| `apps/worker/src/{normalize,triage,promote,extract}.ts` | 分类管线 |
| `packages/apidiff` | npm 包内存解包、.d.ts 符号提取（`server.ts` 是容器服务）、版本 diff |
| `packages/db` | 迁移、种子、事实写入、查询层 |
| `packages/llm` | LLM 适配层 |
| `seeds/` | 种子 YAML 与评测金标准 |
| `.github/workflows/` | ci、collect、deploy |
