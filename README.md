# AI Teaching Assistance Platform

一个以 [OpenMAIC](https://github.com/THU-MAIC/OpenMAIC) 为参考系统的毕业设计复刻项目。第一阶段目标不是复制 OpenMAIC 的全部平台能力，而是独立实现一条可运行、可解释、可测试的 AI 课程闭环：

```text
教学主题
  → 结构化课程大纲
  → 4～8 个教学场景
  → 固定 React 渲染器
  → Action 驱动播放与测验
  → MySQL 保存和恢复
```

## 当前状态

2026-08-31 互动扩展：支持关系探索、过程模拟、互动挑战和 Python/JavaScript 编程实验；分类不锁死玩法。大纲页可改互动类型与设计意图。资源策略改为允许 CDN/联网、保留无同源权限 iframe；不要在互动页输入敏感数据。请运行 `pnpm db:migrate` 应用 003，修正此前 MySQL 仍限制 3～5 场景的问题。详见 09 第 6 节。

项目的 **M1～M9 功能代码已进入正式调用链**。当前交付边界是本机运行、MySQL 持久化、mock 自动回归和 DeepSeek 真实生成；默认 `AI_MODE=mock` 时，无模型 Key、无模型网络也能从首页创建带可追溯 CourseBrief 的 v4 草稿，经 `outline.v2.3` 在同一次调用中解析明确要求并生成 4～8 项大纲，再按 outline 顺序逐项生成 PPT 式 slide/quiz/interactive 场景、进入课堂自动播放并从 MySQL 恢复课程。

大纲和场景阶段共用 `MockAIAdapter` 与 OpenAI-compatible 远端适配器，大纲/slide/quiz 走 JSON，interactive 走原始 HTML + scene-meta；统一执行领域校验、至多一次模型修复和上游调用预算。课堂使用显式 playback reducer 消费 speech/pause；TextOnly 是默认适配器，浏览器朗读是可关闭增强。quiz 可在讲解前直接作答；自动播放到 learner pause 时仍会进入 `awaitingLearner`，答案由服务端依据 MySQL Course 判分并写入独立 `quiz_attempts`。DeepSeek 已完成一门 5 场景真实课程的大纲、场景、修复与失败后重试验证。代码中保留百炼兼容配置，但百炼联调和异机部署均属于后续可选扩展，不再作为第一阶段完成条件。

M6.5 已补齐 DeepSeek 返回 2xx 但空体、非 JSON、异常 envelope 或空 content 时的分类、受限重试、脱敏日志和用户恢复反馈。真实 DeepSeek smoke 中，一个场景的 repair 连续两次返回空 content，系统在第 4 次上游调用成功恢复，最终完成 3/3 ready 课程。M6.5 验收后的缺陷回归又明确了两条边界：JSX/HTML 可以存在于 `code.code` 中作为转义后的只读教学源码，但普通文本和外链仍被拒绝；课程至少有一个成功场景时即可进入带提示的部分预览，`ready` 仍只表示全部完成。

**M7.0、M7.1、M8 与 M9 已完成**：6 个公开主题及 Prompt v1 输入、报告和 28 份逐场景 MHTML 保持冻结，不因本次升级重新生成。新课程统一使用 Course schema v4；CourseBrief 与 `outline.v2.3` 保持 M7.1 语义，slide 只允许 `content.canvas` 下的 `text/shape/line/code`，不再保留旧 block Renderer。v1/v2/v3 数据行原样留在 MySQL，但不出现在列表，按旧 ID 访问返回 `LEGACY_COURSE_UNSUPPORTED`。互动模式默认 `off`，大纲页可开启 `required`：4 场景 1 个、5～6 场景 1～2 个、7～8 场景 1～3 个互动；M8～M10 只承诺桌面端，M11 编辑器和 M12 导出均为可选扩展。

## v0.3 MVP 已实现什么

MVP 面向“教师或学生输入一个主题，生成并运行一门微型课程”的场景，保留 OpenMAIC 最有代表性的三个抽象：

- `Course → SceneOutline → Scene → Action` 的结构化领域模型；
- 大纲与场景分阶段生成，模型输出经过 Schema 和语义校验；
- 固定渲染器展示 slide/quiz 和只读代码块，确定性播放引擎执行 speech/pause。

v0.3 只支持 slide 与单选 quiz，代码块可以显示 HTML/JSX/TSX 源码但始终按文本转义、不执行；不包含文档解析、联网搜索、RAG、interactive HTML、白板、PBL、多智能体、媒体生成、协同编辑和账户系统。v0.4 在 M8 把新生成的 slide 统一升级为只读、桌面端的 OpenMAIC 式 `Slide/PPTElement` 幻灯片，在 M9 加入 diagram/simulation/game/code 多样化互动页；不再并行建设类 Markdown/纵向讲义视图。基于同一 Slide 数据的编辑器留到可选 M11，只含 PPTX 与 `interactive/*.html` 的简化 ZIP 导出留到可选 M12，其余能力继续排除。完整版本边界与退出标准见 [项目范围](docs/01-scope.md)。

## 为什么不一比一照搬 OpenMAIC

OpenMAIC 是一个约两千个前端/服务端源码文件、包含六个主要 `@openmaic` 包和多条生成入口的平台型项目。它同时处理文档导入、模型路由、媒体、白板、交互应用、多智能体、存储迁移和大量兼容逻辑，整体规模不适合作为毕业设计第一阶段的直接复刻目标。

本项目不复制完整平台，但对已经进入本项目范围的能力应优先裁剪其成熟纵向实现，而不是重新设计一套更重的架构。当前已经证明“主题 → 结构化课程 → PPTElement 幻灯片 → 课堂运行时”这一闭环；M8 已成套裁剪 OpenMAIC 的 slide Prompt、直接坐标元素、normalize、Slide 装配和只读 Renderer，M9 已按同样方式参考四类互动 Prompt、HTML 后处理与 iframe 宿主，再适配本项目的 AIAdapter、MySQL 和有限类型。

## 设计文档

| 文档 | 回答的问题 |
| --- | --- |
| [01. 项目范围与版本边界](docs/01-scope.md) | v0.3 与 v0.4 分别做什么、哪些继续不做、怎样才算完成 |
| [02. 系统需求规格说明](docs/02-requirements.md) | 用户如何使用系统，功能与非功能需求是什么 |
| [03. 系统架构设计](docs/03-architecture.md) | OpenMAIC 实际如何运行，目标系统如何分层和调用 |
| [04. 领域模型与数据契约](docs/04-domain-model.md) | Course、Scene、Action、状态和 DTO 如何定义 |
| [05. AI 生成管线设计](docs/05-generation-pipeline.md) | Prompt、解析、校验、修复、重试和预算如何控制 |
| [06. 复刻实施路线图](docs/06-roadmap.md) | M1～M10、可选 M11/M12 与暂存 MX 如何分阶段，每阶段用什么证据退出 |
| [07. 当前开发状态](docs/07-development-status.md) | 哪些代码已进入调用链、通过了什么验证、下一步是什么 |
| [08. 部署、恢复与验收手册](docs/08-deployment-and-acceptance.md) | 如何生产启动、备份恢复、排障并复现 AC-01～AC-12 |
| [09. v0.4 课程质量、幻灯片与互动开发方案](docs/09-v0.4-quality-and-interaction-plan.md) | M7～M10 的 CourseBrief、PPT 式只读幻灯片、互动沙箱、再生成，以及 M11/M12 和 OpenMAIC 参考路径 |
| [10. M6.5 远端响应韧性与可观测性开发方案](docs/10-m6.5-remote-response-resilience-plan.md) | DeepSeek 响应分类、受限重试、安全日志和验收证据 |

01～06 是跨版本设计基线，07 是随开发维护的实现快照，08 是交付与验收手册，09 是 M7～M10 的可执行开发方案，10 是插入 M6 与 M7 之间的 M6.5 工程加固方案。开发过程中若要扩大范围，应先修改范围和需求，再调整架构与路线图，避免代码和设计长期分叉。

## 目标架构

目标系统采用一个 Next.js 应用完成页面与 Route Handler。客户端负责交互、串行触发生成和课堂播放；服务端应用服务负责状态转换、DeepSeek 调用和 MySQL 事务。MySQL 是唯一课程事实来源。

```text
app/
  page.tsx                       # [M3 已实现] 创建 MySQL 草稿、恢复与删除课程
  generation/[courseId]/         # [M4 已实现] 大纲审核、逐场景生成、进度与重试
  classroom/[courseId]/          # [M5 已实现] 固定渲染、Action 播放、测验与可选语音
  api/courses/                   # [M2 已实现] MySQL 课程创建与读取
  api/courses/[courseId]/        # [M7.1 已实现] CRUD、Brief、outline.v2、场景与 quiz_attempts 接口
  api/health/database/           # [M2 已实现] 无敏感信息的数据库健康检查
  api/health/config/             # [M6 已实现] 当前 AI 档位的无密钥配置检查
components/
  renderers/                     # [M1 已实现] slide / quiz / code 固定渲染器
  slides/                        # [M8 已实现] 只读 SlideCanvas 与 text/shape/line/code Renderer
  interactive/                   # [M9 已实现] sandbox iframe 宿主与消息桥
  editor/                        # [M11 可选] 在 SlideCanvas 上叠加 PPT 式编辑交互
lib/
  domain/                        # [M9 已实现] Course v4、CourseBrief、Slide/PPTElement 与 fixture
  repository/                    # [M7.1 已实现] v2 InMemory / MySQL 仓储、旧行隔离与错误映射
  db/                            # [M2 已实现] MySQL 配置、连接池和健康检查
  application/                   # [M7.1 已实现] Brief、大纲/场景生成用例与服务端测验判分
  ai/                            # [M3/M6.5 已实现] mock、OpenAI-compatible 适配器与响应诊断
  generation/                    # [M7.1 已实现] outline.v2、解析、服务端复算、修复、预算与受限重试
  playback/                      # [M5 已实现] 播放 reducer、Action executor 与语音适配器
  quality/                       # [M7/M10 计划] 固定主题、人工量表与离线汇总
  slides/                        # [M8 已实现] Slide/PPTElement、规范化与富文本净化
  interactive/                   # [M9 已实现] HTML 校验、CSP patch 与运行协议
  export/                        # [M12 可选] Slide/PPTElement → PPTX 与简单 ZIP 打包
migrations/                      # [M2 已实现] 版本化 SQL 迁移
scripts/migrate.mjs              # [M2 已实现] 幂等迁移执行器
e2e/                             # [M6 已实现] production mock 完整浏览器回归
eval/                            # [M7.0] 评测总说明、冻结配置、工具和正式运行结果
.github/workflows/quality.yml    # [M6 已实现] 临时 MySQL + mock CI
```

标记为 M1～M9 的能力已经进入正式调用链；M10 仍是计划结构，M11/M12 只有在再次确认可选范围后才创建。fixture 只保留给领域和仓储测试，不属于运行时生成路由。关键决策、组件图、时序图和恢复规则见 [系统架构设计](docs/03-architecture.md)。

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

LangGraph 不是 M7～M10 的前置依赖。OpenMAIC 的主课程生成和自包含互动页面本身不依赖多智能体；只有暂存的 MX 单一研究问题确实需要有状态图编排并且能够设计对照实验时，再考虑引入。

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

开发时普通的 `pnpm dev` 已输出课程创建、大纲生成和场景生成的结构化日志；长时间模型调用每 10 秒输出一次 `running` 心跳。需要在 IDE 中给 Route Handler 或应用服务设置 Node.js 断点时使用 `pnpm dev:inspect`。页面操作台与终端日志共用 `requestId`，可据此定位同一次请求；日志不会打印主题、Prompt、模型原文、数据库 URL 或 API Key。

常用质量命令：

```bash
pnpm lint
pnpm test
pnpm test:db
pnpm build
pnpm test:e2e
pnpm verify:full
```

`pnpm test` 运行领域、API 错误契约、适配器、生成管线、播放状态机、应用服务、内存仓储与渲染安全测试；`pnpm test:db` 读取本机 `.env.local`，额外运行真实 MySQL 仓储、生成恢复与测验作答测试。`pnpm test:e2e` 在 production server 上运行完整 mock Chromium 回归，Playwright 启动的服务会强制覆盖为 `AI_MODE=mock` 并拒绝复用未知配置的既有端口服务，不受本机 remote 档位影响；新机器首次执行前需运行 `pnpm exec playwright install chromium`。

## 模型配置

MVP 正式使用 mock 与 DeepSeek 两个服务端配置档。mock 是确定性测试模式；`AI_MODE=remote` 时使用 DeepSeek，且不会在远端失败后静默降级为 mock。代码中已有的阿里百炼配置档作为兼容扩展保留，但不进入当前验收范围。

```env
AI_MODE=mock

# AI_MODE=remote 时选择一个配置档
AI_PROVIDER=deepseek
AI_OUTLINE_TIMEOUT_MS=120000
AI_SCENE_TIMEOUT_MS=120000

DEEPSEEK_API_KEY=
DEEPSEEK_BASE_URL=https://api.deepseek.com
DEEPSEEK_MODEL=deepseek-v4-flash

DATABASE_URL=mysql://user:password@127.0.0.1:3306/ai_teaching
```

模型 Key 和数据库凭据仅允许在服务端读取，不能使用 `NEXT_PUBLIC_` 前缀；模型名保持可配置。mock 模式仍走正式 Schema、应用服务和 MySQL 链路，不是远端失败后的静默假成功。`.env.example` 中保留的百炼变量仅供后续兼容扩展，当前无需填写。

## 实施顺序

1. **M1（已完成）**：用合法 fixture 跑通三个页面、slide/quiz/code block 和内存仓储；
2. **M2（已完成）**：接入 MySQL、迁移、CourseRepository 和课程 CRUD；
3. **M3（已完成）**：统一适配器、DeepSeek 大纲生成、修复和编辑确认已实现并验收；
4. **M4（已完成）**：DeepSeek 逐场景生成、事务保存、失败隔离和单场景重试已验收；
5. **M5（已完成）**：Action 播放、quiz 持久化、TextOnly 与可选 BrowserSpeech；
6. **M6（已完成）**：本机自动化测试、故障注入、生产构建、恢复和 DeepSeek 真实生成证据均已通过。
7. **M6.5（已完成）**：DeepSeek 远端响应分类 → 受限自动重试 → 安全日志与前端恢复反馈 → 故障注入和真实 smoke 验收；
8. **M7（已完成）**：M7.0 已保留六题基线、生成事实和逐场景 MHTML；M7.1 已完成 CourseBrief、Course v2 和 outline v2.1；
9. **M8（已完成）**：裁剪 OpenMAIC 的 `slide-content Prompt → 带坐标 PPTElement → normalize → Slide → SlideCanvas` 纵向链，升级 Course v3，并用 3 个真实主题和 4 份 MHTML 完成桌面校准；
10. **M9（已完成）**：裁剪 OpenMAIC 四类互动 Prompt，实现多样化生成、外部依赖加载、隔离运行和 fallback；
11. **M10（计划）**：实现 ready 场景按指令再生成、事务替换和 v0.3/v0.4 成对质量验收；
12. **M11（可选）**：在 M8 的同一 `Slide/PPTElement` 上增加选择、拖拽、缩放、文本编辑、撤销重做和保存，不建立第二套页面格式，也不阻塞 v0.4；
13. **M12（可选）**：把 slide 导出为 PPTX，并把互动场景导出为 `interactive/<顺序>_<标题>.html`，最终只打包为一个简单 ZIP；
14. **MX（暂时搁置）（未选题）**：待 M10 产品质量闭环完成后选择一个可度量的毕业论文研究问题。

每一步的任务、测试和退出门见 [复刻实施路线图](docs/06-roadmap.md)。

## 与 OpenMAIC 的关系

OpenMAIC 是本项目的参考系统，其源码采用 MIT License。M8 已裁剪固定提交中的 slide-content Prompt，并按本项目范围重新实现有限 DSL、规范化和 Renderer；来源、改动与完整许可见 [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md)。

本项目文档中的“复刻”指在毕业设计范围内重建核心工作流，并允许在遵守 MIT License、保留版权和明确标注来源的前提下裁剪复用上游成熟链路。本项目需要明确区分上游原有实现与自己的范围裁剪、AIAdapter/MySQL 适配、代码元素扩展和后续研究工作；它不表示与 OpenMAIC 官方项目兼容，也不代表 OpenMAIC 官方对本项目的认可。
