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

2026-11-01 新增幻灯片分段讲解与画面联动：`scene-slide.v2.6` 在同一次调用中生成分段讲稿及元素临时引用，服务端映射为正式 ID；课堂支持段落定位、上一段／下一段、重听及随播放状态变化的元素高亮。旧课程继续单段播放，无需数据库迁移。设计、使用方式、开发记录和验证限制见 [分段讲解与画面联动](docs/stage-plans/segmented-narration.md)。

2026-10-24 新增教学材料驱动生成：主页或大纲页可上传文字型 PDF、Markdown、TXT，PDF 可指定页码范围。材料原文独立保存至 MySQL，大纲规划各页来源，slide/quiz/interactive 生成、重试、修订和 Agent 插页均经服务层读取原文；课堂可查看本页生成时参考的文件及片段。部署前运行 `pnpm db:migrate` 应用 `009_course_materials.sql`。使用方式、预算、来源语义和验收证据见 [教学材料驱动生成](docs/stage-plans/material-driven-generation.md)。

2026-09-05 slide 视觉升级：slide Prompt 升级为 `scene-slide.v2.4`、大纲 Prompt 升级为 `outline.v2.4`，移植 OpenMAIC 的量化排版规则（文字宽度容量、字号×行数高度查表、对齐公式、间距标准）、三种装饰线配方、整页 few-shot 示例和输出前自检清单，并按大纲角色（hook/concept/mechanism/worked_example/practice/summary）提供版式骨架分支。元素在 `text/shape/line/code` 基础上新增 `chart`（bar/column/line/pie，模型只输出数据，ECharts SVG 渲染）与 `table`（纯文本行 + 列宽比例）；shape 支持渐变填充和 pathFormula 圆角/箭头等形状预设（服务端解析）。三套主题色板按 courseId 确定性选择（学术蓝青为项目原有色板，经典蓝橙与淡彩清新取自 OpenMAIC 默认主题与 Prompt 示例配色），同一课程共用一套视觉。可视化采用 OpenMAIC 同款两级机制：大纲阶段把 [Chart]/[Table] 标记写入 slide 页 keyPoints，场景阶段按标记生成真实元素（真实 smoke 首轮发现仅靠 slide prompt 指令模型不会主动用图表，故移植大纲级规划）；mechanism 页连线按内容关系条件触发并附工艺规范（边到边、长度 ≥40px、禁止色条拼接）。历史课程与旧场景完全兼容；不需要数据库迁移。验证见 docs/07，浏览器截图核对脚本见 `scripts/slide-visual-check.mjs`，真实生成冒烟脚本见 `scripts/deepseek-slide-smoke.mjs`。

2026-08-31 互动扩展：支持关系探索、过程模拟、互动挑战和 Python/JavaScript 编程实验；分类不锁死玩法。大纲页可改互动类型与设计意图。资源策略改为允许 CDN/联网、保留无同源权限 iframe；不要在互动页输入敏感数据。课堂展示使用最大可用 16:9 视口，Prompt 提供三种可改写布局骨架以及 SVG/Canvas/reset 示例；独立 HTML 下载仍保持自身自适应。请运行 `pnpm db:migrate` 应用 003 场景数量修复与 004 Quiz 多选作答迁移。详见 09 第 6 节。

互动稳定性补充：新生成使用 `scene-<type>.v2.3`，Canvas 尺寸与绘制分离，补齐数值输入、游戏失败与重置示例。ResizeObserver 循环与未处理异常都会停止 iframe 并降级，新桥接保留行列和初始化错误重放。降级区可由用户点击“重新生成本场互动”，成功才替换这一场，失败保留原内容；“重新加载原脚本”不调用模型。课程 `ready` 只代表生成保存完成，不代表全部玩法已验收。

项目的 **M1～M9 功能代码已进入正式调用链**。当前交付边界是本机运行、MySQL 持久化、mock 自动回归和 DeepSeek 真实生成；默认 `AI_MODE=mock` 时，无模型 Key、无模型网络也能从首页创建带可追溯 CourseBrief 的 v5 草稿，经 `outline.v2.3` 在同一次调用中解析明确要求并生成 4～8 项大纲，再按 outline 顺序逐项生成 PPT 式 slide/quiz/interactive 场景、进入课堂自动播放并从 MySQL 恢复课程。

大纲和场景阶段共用 `MockAIAdapter` 与 OpenAI-compatible 远端适配器，大纲/slide/quiz 走 JSON，interactive 走原始 HTML + scene-meta；统一执行领域校验、至多一次模型修复和上游调用预算。课堂使用显式 playback reducer 消费 speech/pause；TextOnly 是默认适配器，浏览器朗读是可关闭增强。quiz 支持单选和多选，多选按答案集合完全一致判分；课堂可不调用模型直接手动调整题目，保存时原子清理本场旧作答。自动播放到 learner pause 时仍会进入 `awaitingLearner`，答案由服务端依据 MySQL Course 判分并写入独立 `quiz_attempts`。

M6.5 已补齐 DeepSeek 返回 2xx 但空体、非 JSON、异常 envelope 或空 content 时的分类、受限重试、脱敏日志和用户恢复反馈。真实 DeepSeek smoke 中，一个场景的 repair 连续两次返回空 content，系统在第 4 次上游调用成功恢复，最终完成 3/3 ready 课程。M6.5 验收后的缺陷回归又明确了两条边界：JSX/HTML 可以存在于 `code.code` 中作为转义后的只读教学源码，但普通文本和外链仍被拒绝；课程至少有一个成功场景时即可进入带提示的部分预览，`ready` 仍只表示全部完成。

**M7.0、M7.1、M8、M9 与 M10 当前范围已完成**：6 个公开主题及 Prompt v1 输入、报告和 28 份逐场景 MHTML 保持冻结，不因本次升级重新生成。新课程统一使用 Course schema v5 和 `scene-quiz.v2`；v4 课程在读取时把单个正确答案无损转换为数组，并在下次保存时自然升级为 v5。v1～v3 数据行仍保留但隐藏，按旧 ID 访问返回 `LEGACY_COURSE_UNSUPPORTED`。新版 PPT 式 slide 已按已确认的课堂页面需求完成单人验收，v0.3 仅作为历史参考，不再要求 A/B 配对评分；MHTML 只用于固定视口留档。CourseBrief、PPT 式 slide 和互动数量规则保持不变；请运行 `pnpm db:migrate` 应用 004 作答数组迁移。

2026-09-14 已完成整课生成运行指标与简易用量面板。迁移 007 使用独立 `generation_runs` 保存一次 outline + 首次 scenes、继续批次和失败场景重试的运行事实；`courses` 仍只负责当前课程与当前产物来源。首页可进入 `/settings` 查看运行数、场景完成、模型调用、repair、可获得 token、有效生成耗时、每日趋势、模型分组和最近运行。未知 token 不按 0 解释，人工审核等待不计入有效耗时，产品用量不冒充课程质量或论文算法指标。

2026-09-15 已补齐轻量课程库管理：首页课程卡片支持移动到文件夹、编辑课程名称和删除，并可按“全部课程 / 未分类 / 自定义文件夹”筛选。三个课程操作使用带悬停提示的图标按钮；课程删除采用卡片内模糊遮罩和红色确认按钮。迁移 008 使用独立 `course_folders` 与 `course_folder_memberships`，不继续向 `courses` 塞入组织字段；删除非空文件夹时可以仅解除归属，也可以经过红色警示确认后连同其中课程删除。文件夹名称在筛选栏截断显示，桌面课程库按四列紧凑排布。当前保持单层文件夹和单课程单归属，不引入拖拽、批量操作、回收站或权限系统。

## v0.3 MVP 已实现什么

MVP 面向“教师或学生输入一个主题，生成并运行一门微型课程”的场景，保留 OpenMAIC 最有代表性的三个抽象：

- `Course → SceneOutline → Scene → Action` 的结构化领域模型；
- 大纲与场景分阶段生成，模型输出经过 Schema 和语义校验；
- 固定渲染器展示 slide/quiz 和只读代码块，确定性播放引擎执行 speech/pause。

v0.3 只支持 slide 与单选 quiz，代码块可以显示 HTML/JSX/TSX 源码但始终按文本转义、不执行；不包含文档解析、联网搜索、RAG、interactive HTML、白板、PBL、多智能体、媒体生成、协同编辑和账户系统。v0.4 在 M8 把新生成的 slide 统一升级为只读、桌面端的 OpenMAIC 式 `Slide/PPTElement` 幻灯片，在 M9 加入 diagram/simulation/game/code 多样化互动页；不再并行建设类 Markdown/纵向讲义视图。M11 简化 ZIP 导出与 M12.0～M12.4 对话式课程修订工程主链均已完成；M12.4 已补齐课程/对话双栏、场景导航、会话逐项重命名与删除。M12 的隔离副本真实 DeepSeek 调序、新增、补丁、重生成和确认案例已归档，人工内容/互动质量判断仍按方案执行。专业幻灯片编辑器后移为 MX 按需候选，其余能力继续排除。完整版本边界与退出标准见 [项目范围](docs/01-scope.md)。

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
| [06. 复刻实施路线图](docs/06-roadmap.md) | M1～M12 与暂存 MX 如何分阶段，每阶段用什么证据退出 |
| [07. 当前开发状态](docs/07-development-status.md) | 哪些代码已进入调用链、通过了什么验证、下一步是什么 |
| [08. 部署、恢复与验收手册](docs/08-deployment-and-acceptance.md) | 如何生产启动、备份恢复、排障并复现 AC-01～AC-12 |
| [09. v0.4 课程质量、幻灯片与互动开发方案](docs/stage-plans/m7-m10-v0.4-quality-and-interaction-plan.md) | M7～M10 的 CourseBrief、PPT 式只读幻灯片、互动沙箱、再生成与 OpenMAIC 参考路径 |
| [10. M6.5 远端响应韧性与可观测性开发方案](docs/stage-plans/m6.5-remote-response-resilience-plan.md) | DeepSeek 响应分类、受限重试、安全日志和验收证据 |
| [11. M11 资源包导出开发方案](docs/stage-plans/m11-slide-export-plan.md) | M11 PPTX + HTML 资源包映射表、保真度决策与验收证据 |
| [12. M12 对话式课程修订 Agent 开发方案](docs/stage-plans/m12-conversational-course-revision-agent-plan.md) | 右侧对话侧栏、课程工具、流式思考、并发保护与分阶段验收 |
| [13. 整课生成运行指标与简易用量面板](docs/stage-plans/generation-run-metrics-and-usage-dashboard-plan.md) | `generation_runs` 职责、运行生命周期、用量 API、设置页与研究指标边界 |

01～06 是跨版本设计基线，07 是随开发维护的实现快照，08 是交付与验收手册，stage-plans 中分别保存 M6.5、M7～M10、M11 和 M12 的可执行开发方案。开发过程中若要扩大范围，应先修改范围和需求，再调整架构与路线图，避免代码和设计长期分叉。

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
  api/usage/                     # [运行指标增强] 7d/30d/all 只读聚合
  settings/                      # [运行指标增强] 简易用量面板
components/
  renderers/                     # [M1 已实现] slide / quiz / code 固定渲染器
  slides/                        # [M8 已实现，v2.2 扩展] 只读 SlideCanvas 与 text/shape/line/code/chart/table Renderer
  interactive/                   # [M9 已实现] sandbox iframe 宿主与消息桥
  agent/                         # [M12.0～12.4 已实现] 可调宽智能修订侧栏、Markdown 回答、会话管理与思考/工具卡片
  settings/                      # [运行指标增强] 用量摘要、趋势、模型与最近运行
  editor/                        # [MX 按需候选] 在 SlideCanvas 上叠加 PPT 式编辑交互
lib/
  domain/                        # [M10 已实现] Course v5、单选/多选 Quiz、CourseBrief、Slide/PPTElement 与 fixture
  repository/                    # Course、Agent 与 generation_runs 的 InMemory/MySQL 仓储
  db/                            # [M2 已实现] MySQL 配置、连接池和健康检查
  application/                   # [M7.1 已实现] Brief、大纲/场景生成用例与服务端测验判分
  ai/                            # [M3/M6.5 已实现] mock、OpenAI-compatible 适配器与响应诊断
  generation/                    # [M7.1 已实现] outline.v2、解析、服务端复算、修复、预算与受限重试
  playback/                      # [M5 已实现] 播放 reducer、Action executor 与语音适配器
  quality/                       # [M7 历史/可选] 固定主题与离线汇总工具
  slides/                        # [M8 已实现，v2.2 扩展] Slide/PPTElement、规范化、富文本净化、主题预设与形状解析
  interactive/                   # [M9 已实现] HTML 校验、CSP patch、运行协议与布局 Prompt 骨架
  export/                        # [M11 + 保真增强] Slide/PPTElement → 可编辑 PPTX 与简单 ZIP 打包
migrations/                      # [M2 已实现] 版本化 SQL 迁移
scripts/migrate.mjs              # [M2 已实现] 幂等迁移执行器
e2e/                             # [M6 已实现] production mock 完整浏览器回归
eval/                            # [M7.0] 评测总说明、冻结配置、工具和正式运行结果
.github/workflows/quality.yml    # [M6 已实现] 临时 MySQL + mock CI
```

标记为 M1～M11 的当前能力已经进入正式调用链；M12.0～M12.3 已完成持久对话、流式思考/工具过程、六个课程工具、会话切换、完整轮次上下文裁剪、运行状态恢复和轻量 run 指标，并补齐过期插页租约恢复、逐工具轨迹检查点与确认原子领取。M12.4 已补齐课堂/对话双栏、场景导航、会话逐项重命名与删除，桌面浏览器回归确认真实课堂画面和侧栏可以同时操作。M10 旧的一次性修订服务仍保留为代码回退，但课堂入口已收口到 Agent 侧栏。真实 DeepSeek 调序、新增、补丁、重生成、确认/取消与浏览器侧栏证据已在隔离副本归档；这不替代人工页面可用性判断。MHTML 只作为固定 `1280×720` 视口的静态留档，实时课堂页面负责响应式缩放。fixture 只保留给领域和仓储测试，不属于运行时生成路由。关键决策、组件图、时序图和恢复规则见 [系统架构设计](docs/03-architecture.md)。

2026-09-14 已完成独立的 [PPT 可编辑保真优化](docs/stage-plans/pptx-editable-fidelity-optimization-plan.md)：统一逻辑画布到 PPTX 的字号、线宽、文本内边距和段距换算，普通 SVG path 与曲线改为可编辑自由形状，并收口原生表格/图表的核心样式。完整单测、生产构建、两门真实课程结构检查和 Microsoft PowerPoint PNG 渲染冒烟已通过；用户进一步检查输出样例并自行下载、打开多门课程，确认新版整体观感较旧版明显更和谐，本项工作已完成人工验收。该结论不代表网页与 PPT 逐像素一致。

专业幻灯片编辑器后移为 MX：它主要解决拖拽、缩放和精确排版，不能直接提高课程事实正确性或教学质量，而且当前已经可以导出 PPTX 后在 PowerPoint/WPS 中精修。只有当真实使用持续出现“自然语言修订无法解决的精确坐标调整”，或产品目标明确转为平台内专业课件制作时，才重新立项；届时仍复用 `Slide/PPTElement`、净化、完整 Schema 与 `expectedRevision` 保存边界，不建立第二套页面格式。

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
11. **M10（当前范围已完成）**：`/revise` 根据必填意见和当前旧场景修订 ready slide/interactive/quiz；`/regenerate` 对运行失败 interactive 做不携带旧 HTML 的干净重生成；失败保留原内容，quiz 修订时事务化清理旧作答；新版 slide 已由开发者依据已确认需求完成单人验收，v0.3 仅作历史留档，不再进行 v0.3/v0.4 成对质量验收；
12. **M11（已完成，2026-09-07）**：把 slide 导出为 PPTX，并把互动场景导出为 `interactive/<顺序>_<标题>.html`，最终只打包为一个简单 ZIP；已补充字体/透明度、长代码文本、下载释放时序、状态播报和移动端提示适配。2026-09-14 的独立保真增强进一步统一文字尺度并支持 SVG path/曲线可编辑导出，结构、PowerPoint 渲染与用户多课程主观验收均已通过（见 [M11 方案](docs/stage-plans/m11-slide-export-plan.md)与[保真优化方案](docs/stage-plans/pptx-editable-fidelity-optimization-plan.md)）；
13. **M12（M12.0～M12.4 工程主链已实现）**：已完成持久对话、流式可见思考、默认收起的两级工具卡、`read_stage/list_scenes/grep_stage/patch_stage/edit_deck/generate_scene`、revision 冲突保护、页面调序/新增/删除/整页重生成、会话切换、完整轮次上下文裁剪和刷新状态恢复；M12.4 进一步完成课堂/对话双栏、消息场景锚点、会话逐项重命名与删除按钮原位二次点击确认。隔离副本真实案例、MHTML 和浏览器侧栏证据已归档；人工内容/互动质量判断仍不冒充为工程通过；
14. **生成运行指标与用量面板（已完成）**：新增独立 `generation_runs`、运行生命周期、失败/重试统计、`GET /api/usage` 和 `/settings`；不继续扩张 `courses`，也不把运行指标变成质量门；
15. **MX（暂时搁置）**：专业幻灯片编辑器与毕业设计 AI Search 研究选题均按真实需求另行立项，不作为 M12 前置。

每一步的任务、测试和退出门见 [复刻实施路线图](docs/06-roadmap.md)。

## 与 OpenMAIC 的关系

OpenMAIC 是本项目的参考系统，其源码采用 MIT License。M8 已裁剪固定提交中的 slide-content Prompt，并按本项目范围重新实现有限 DSL、规范化和 Renderer；来源、改动与完整许可见 [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md)。

本项目文档中的“复刻”指在毕业设计范围内重建核心工作流，并允许在遵守 MIT License、保留版权和明确标注来源的前提下裁剪复用上游成熟链路。本项目需要明确区分上游原有实现与自己的范围裁剪、AIAdapter/MySQL 适配、代码元素扩展和后续研究工作；它不表示与 OpenMAIC 官方项目兼容，也不代表 OpenMAIC 官方对本项目的认可。
