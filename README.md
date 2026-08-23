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

项目目前处于 **M0 设计基线完成、M1 尚未开始编码** 的阶段。仓库中已经建立六份相互追踪的复刻方案，但当前页面仍是 Create Next App 默认脚手架，尚不能生成或播放课程。

这一区分很重要：`docs/` 描述的是已经确认的目标设计，不代表对应功能已经实现。下一步先用固定数据跑通纵向闭环，然后接入 MySQL，再接真实模型；不立即引入 LangGraph 或 interactive iframe。

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

阅读顺序建议从 01 到 06。开发过程中若要扩大范围，应先修改范围和需求，再调整架构与路线图，避免代码和设计长期分叉。

## 目标架构

目标系统采用一个 Next.js 应用完成页面与 Route Handler。客户端负责交互、串行触发生成和课堂播放；服务端应用服务负责状态转换、DeepSeek/百炼调用和 MySQL 事务。MySQL 是唯一课程事实来源。

```text
app/
  page.tsx                       # 创建课程与历史课程
  generation/[courseId]/         # 大纲确认、场景生成与失败重试
  classroom/[courseId]/          # 固定渲染、播放和测验
  api/courses/                   # 课程 CRUD
  api/courses/[courseId]/        # 读取、删除与课程变更
components/
  renderers/                     # slide / quiz / code block 固定渲染器
lib/
  domain/                        # 纯 TypeScript 类型、Schema 和状态转换
  application/                   # 服务端课程用例和事务编排
  ai/                            # mock、DeepSeek、百炼配置与适配器
  generation/                    # Prompt、解析、校验、重试与 AI Adapter
  playback/                      # 播放 reducer 和 Action executor
  db/                            # CourseRepository、MySQL 适配器与迁移
```

以上是计划目录，不是当前已存在的源码结构。关键决策、组件图、时序图和恢复规则见 [系统架构设计](docs/03-architecture.md)。

## 技术栈

当前脚手架已经安装：

- Next.js 16.3.2；
- React 19.2.8；
- TypeScript 5；
- Tailwind CSS 4；
- pnpm 11.22.0。

后续按里程碑最小化添加依赖：Zod 用于运行时契约校验，MySQL 8.0+ 用于服务端持久化，Vitest 与 Playwright 用于测试。数据库驱动/ORM 在 M2 先做连接池、JSON、事务、revision 和迁移验证后再确定；业务代码只依赖 CourseRepository。

LangGraph 不是 MVP 前置依赖。OpenMAIC 的主课程生成链本身并不依赖多智能体；只有论文延展确实需要有状态图编排并且能够设计对照实验时，再考虑引入。

## 本地运行

环境要求：Node.js 20.9 或更高版本，以及与 `packageManager` 字段匹配的 pnpm。

```bash
pnpm install
pnpm dev
```

浏览器访问 [http://localhost:3000](http://localhost:3000)。当前只能看到默认脚手架页面；完成 M1 后，该命令应在无网络、无模型密钥时运行固定数据演示。

常用质量命令：

```bash
pnpm lint
pnpm build
```

`pnpm test` 和浏览器 E2E 命令将在测试框架于 M1/M6 接入后补充，README 不提前声明尚不存在的脚本。

## 计划中的模型配置

从 M3 起，系统将支持 mock、DeepSeek 和阿里百炼。配置名称已经进入设计基线，但当前代码尚未读取这些变量。

```env
AI_MODE=mock

# AI_MODE=remote 时选择一个配置档
AI_PROVIDER=deepseek

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

1. M1：用合法 fixture 跑通三个页面、slide/quiz/code block 和内存仓储；
2. M2：接入 MySQL、迁移、CourseRepository 和课程 CRUD；
3. M3：接入 DeepSeek/百炼、大纲生成和编辑确认；
4. M4：逐场景生成、事务保存、失败隔离和单场景重试；
5. M5：实现 Action 播放、quiz、TextOnly 与可选 BrowserSpeech；
6. M6：完成自动化测试、故障注入、部署和需求验收。

每一步的任务、测试和退出门见 [复刻实施路线图](docs/06-roadmap.md)。

## 与 OpenMAIC 的关系

OpenMAIC 是本项目的参考系统，其源码采用 MIT License。本仓库当前只依据公开源码分析并重新设计毕业设计规模的实现，尚未复制 OpenMAIC 源文件。若后续直接复用任何实现或资源，应保留原项目的版权和许可声明，并在本项目中明确标注来源。

本项目文档中的“复刻”指核心工作流和架构思想的独立实现，不表示与 OpenMAIC 官方项目兼容，也不代表 OpenMAIC 官方对本项目的认可。
