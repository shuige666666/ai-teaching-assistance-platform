# AI Teaching Assistance Platform

一个以 [OpenMAIC](https://github.com/THU-MAIC/OpenMAIC) 为参考系统的毕业设计复刻项目。第一阶段目标不是复制 OpenMAIC 的全部平台能力，而是独立实现一条可运行、可解释、可测试的 AI 课程闭环：

```text
教学主题
  → 结构化课程大纲
  → 3～5 个教学场景
  → 固定 React 渲染器
  → Action 驱动播放与测验
  → MySQL 保存和恢复
```

## 当前状态

项目目前处于 **M5 课堂运行时代码完成、M6 系统验收待执行** 的阶段。默认 `AI_MODE=mock` 时，无模型 Key、无模型网络也能从首页创建草稿，经正式管线生成并编辑 3～5 项大纲，再按 outline 顺序逐项生成 slide/quiz 场景、进入课堂自动播放并从 MySQL 恢复课程。

大纲和场景阶段共用 `MockAIAdapter` 与 DeepSeek/百炼 `OpenAICompatibleAdapter`，均执行 JSON 提取、严格 Zod、语义门、一次模型修复和上游调用预算。课堂使用显式 playback reducer 消费 speech/pause；TextOnly 是默认适配器，浏览器朗读是可关闭增强。quiz 会停在 `awaitingLearner`，由服务端依据 MySQL Course 判分并写入独立 `quiz_attempts`。当前尚未提供两家远端 Key，因此只验证了 mock 完整调用链，不能把远端 Provider 描述为已经联调成功。

## MVP 要实现什么

MVP 面向“教师或学生输入一个主题，生成并运行一门微型课程”的场景，保留 OpenMAIC 最有代表性的三个抽象：

- `Course → SceneOutline → Scene → Action` 的结构化领域模型；
- 大纲与场景分阶段生成，模型输出经过 Schema 和语义校验；
- 固定渲染器展示 slide/quiz 和只读代码块，确定性播放引擎执行 speech/pause。

首版只支持 slide 与单选 quiz，代码块只显示和高亮、不执行；不包含文档解析、联网搜索、RAG、interactive HTML、白板、PBL、多智能体、媒体生成、协同编辑和账户系统。完整范围与退出标准见 [项目范围](docs/01-scope.md)。

## 为什么不一比一照搬 OpenMAIC

OpenMAIC 是一个约两千个前端/服务端源码文件、包含六个主要 `@openmaic` 包和多条生成入口的平台型项目。它同时处理文档导入、模型路由、媒体、白板、交互应用、多智能体、存储迁移和大量兼容逻辑，整体规模不适合作为毕业设计第一阶段的直接复刻目标。

本项目复刻其核心机制和数据流，而不是复刻全部产品功能。目标是先证明“主题 → 结构化课程 → 课堂运行时”这一最小闭环，再选择一个有基线、有指标的方向做论文延展。

## 设计文档

| 文档 | 回答的问题 |
| --- | --- |
| [01. 项目范围与 MVP 边界](docs/01-scope.md) | 哪些必须做，哪些明确不做，怎样才算复刻完成 |
| [02. 系统需求规格说明](docs/02-requirements.md) | 用户如何使用系统，功能与非功能需求是什么 |
| [03. 系统架构设计](docs/03-architecture.md) | OpenMAIC 实际如何运行，目标系统如何分层和调用 |
| [04. 领域模型与数据契约](docs/04-domain-model.md) | Course、Scene、Action、状态和 DTO 如何定义 |
| [05. AI 生成管线设计](docs/05-generation-pipeline.md) | Prompt、解析、校验、修复、重试和预算如何控制 |
| [06. 复刻实施路线图](docs/06-roadmap.md) | M1～M6 先做什么，每阶段用什么证据退出 |
| [07. 当前开发状态](docs/07-development-status.md) | 哪些代码已进入调用链、通过了什么验证、下一步是什么 |

01～06 是设计基线，07 是随开发维护的实现快照。开发过程中若要扩大范围，应先修改范围和需求，再调整架构与路线图，避免代码和设计长期分叉。

## 目标架构

目标系统采用一个 Next.js 应用完成页面与 Route Handler。客户端负责交互、串行触发生成和课堂播放；服务端应用服务负责状态转换、DeepSeek/百炼调用和 MySQL 事务。MySQL 是唯一课程事实来源。

```text
app/
  page.tsx                       # [M3 已实现] 创建 MySQL 草稿、恢复与删除课程
  generation/[courseId]/         # [M4 已实现] 大纲审核、逐场景生成、进度与重试
  classroom/[courseId]/          # [M5 已实现] 固定渲染、Action 播放、测验与可选语音
  api/courses/                   # [M2 已实现] MySQL 课程创建与读取
  api/courses/[courseId]/        # [M5 已实现] CRUD、生成与 quiz_attempts 接口
  api/health/database/           # [M2 已实现] 无敏感信息的数据库健康检查
components/
  renderers/                     # [M1 已实现] slide / quiz / code 固定渲染器
lib/
  domain/                        # [M1 已实现] Schema、状态转换与 fixture
  repository/                    # [M2 已实现] InMemory / MySQL 仓储与错误映射
  db/                            # [M2 已实现] MySQL 配置、连接池和健康检查
  application/                   # [M5 已实现] 生成用例与服务端测验判分
  ai/                            # [M3 已实现] mock 与 OpenAI-compatible 适配器
  generation/                    # [M4 已实现] 大纲/场景 Prompt、解析、装配、修复与重试
  playback/                      # [M5 已实现] 播放 reducer、Action executor 与语音适配器
migrations/                      # [M2 已实现] 版本化 SQL 迁移
scripts/migrate.mjs              # [M2 已实现] 幂等迁移执行器
```

标记为 M1～M5 的目录已经进入正式调用链，其余仍是计划结构。fixture 只保留给领域和仓储测试，不再属于运行时生成路由。关键决策、组件图、时序图和恢复规则见 [系统架构设计](docs/03-architecture.md)。

## 技术栈

当前脚手架已经安装：

- Next.js 16.3.2；
- React 19.2.8；
- TypeScript 5；
- Tailwind CSS 4；
- Zod 4.4；
- Vitest 4.1；
- Playwright 1.62；
- mysql2 3.23；
- pnpm 11.22.0。

M2 选用 `mysql2/promise`，直接使用连接池、参数化 SQL 和事务，不引入 ORM；数据库差异仍封装在 `MySQLCourseRepository` 中。Vitest 分别运行无数据库单元测试和真实 MySQL 集成测试，Playwright CLI 用于跨进程恢复验证。

LangGraph 不是 MVP 前置依赖。OpenMAIC 的主课程生成链本身并不依赖多智能体；只有论文延展确实需要有状态图编排并且能够设计对照实验时，再考虑引入。

## 本地运行

环境要求：Node.js 20.9 或更高版本、与 `packageManager` 字段匹配的 pnpm，以及 MySQL 8.0+。

```powershell
pnpm install
Copy-Item .env.example .env.local
# 编辑 .env.local，填写仅供服务端使用的 DATABASE_URL
pnpm db:migrate
pnpm dev
```

浏览器访问 [http://localhost:3000](http://localhost:3000)。mock 模式无需模型密钥，但必须先启动 MySQL 并执行迁移。`COURSE_REPOSITORY=memory` 只用于受控测试，不是正式运行模式。

常用质量命令：

```bash
pnpm lint
pnpm test
pnpm test:db
pnpm build
```

`pnpm test` 运行领域、适配器、生成管线、播放状态机、应用服务、内存仓储与渲染安全测试；`pnpm test:db` 读取本机 `.env.local`，额外运行真实 MySQL 仓储、生成恢复与测验作答测试。完整 Playwright E2E 脚本将在 M6 补齐。

## 模型配置

系统支持 mock、DeepSeek 和阿里百炼三个服务端配置档。mock 是确定性测试模式；`AI_MODE=remote` 时只校验 `AI_PROVIDER` 当前选中的配置，不会在远端失败后静默降级为 mock。

```env
AI_MODE=mock

# AI_MODE=remote 时选择一个配置档
AI_PROVIDER=deepseek
AI_OUTLINE_TIMEOUT_MS=90000
AI_SCENE_TIMEOUT_MS=120000

DEEPSEEK_API_KEY=
DEEPSEEK_BASE_URL=https://api.deepseek.com
DEEPSEEK_MODEL=deepseek-v4-flash

BAILIAN_API_KEY=
BAILIAN_BASE_URL=https://{WorkspaceId}.cn-beijing.maas.aliyuncs.com/compatible-mode/v1
BAILIAN_MODEL=qwen3.6-plus

DATABASE_URL=mysql://user:password@127.0.0.1:3306/ai_teaching
```

模型 Key 和数据库凭据仅允许在服务端读取，不能使用 `NEXT_PUBLIC_` 前缀。百炼 Base URL 必须与 API Key 地域匹配；模型名保持可配置。mock 模式仍走正式 Schema、应用服务和 MySQL 链路，不是远端失败后的静默假成功。

## 实施顺序

1. **M1（已完成）**：用合法 fixture 跑通三个页面、slide/quiz/code block 和内存仓储；
2. **M2（已完成）**：接入 MySQL、迁移、CourseRepository 和课程 CRUD；
3. **M3（代码完成，远端验收待 Key）**：统一适配器、大纲生成、修复和编辑确认已实现；
4. **M4（代码完成，远端验收待 Key）**：逐场景生成、事务保存、失败隔离和单场景重试；
5. **M5（已完成）**：Action 播放、quiz 持久化、TextOnly 与可选 BrowserSpeech；
6. **M6（下一开发步）**：完成自动化测试、故障注入、部署和需求验收。

每一步的任务、测试和退出门见 [复刻实施路线图](docs/06-roadmap.md)。

## 与 OpenMAIC 的关系

OpenMAIC 是本项目的参考系统，其源码采用 MIT License。本仓库当前只依据公开源码分析并重新设计毕业设计规模的实现，尚未复制 OpenMAIC 源文件。若后续直接复用任何实现或资源，应保留原项目的版权和许可声明，并在本项目中明确标注来源。

本项目文档中的“复刻”指核心工作流和架构思想的独立实现，不表示与 OpenMAIC 官方项目兼容，也不代表 OpenMAIC 官方对本项目的认可。
