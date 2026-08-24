# 07. 当前开发状态

> 本文记录已经进入正式调用链并通过验证的能力。目标设计仍以 01～06 文档为准；本文不把后续计划描述成已实现功能。

## 1. 当前结论

项目已完成 **M1 固定数据闭环、M2 MySQL 持久化、M3 大纲生成代码和 M4 逐场景生成代码**。mock 下的大纲与场景正式链路均已通过，DeepSeek/阿里百炼远端调用仍等待有效 Key 做 smoke test。当前在无模型 Key、无模型网络的环境中可以完成：

```text
首页填写主题并选择 3～5 个场景
  → 在 MySQL 创建 draft 课程
  → 登记 activeOperation 后通过 MockAIAdapter 生成大纲
  → JSON 提取、严格 Schema、语义门与必要时一次模型修复
  → 用 operation id + expectedRevision 短事务提交 outline_ready
  → 人工编辑并由服务端复验、保存、确认
  → 按 outline 顺序逐个登记和生成 slide / quiz
  → 每场独立解析、语义校验、装配 Action 并短事务提交
  → 单场失败时保留其他结果、继续后续场景并显式重试
  → 进入课堂手动翻页并完成单选题
  → 重启 Next.js 后从 MySQL 恢复课程
  → 显式删除课程及其关联测验记录
```

MySQL 现在是课程事实的唯一运行时来源。`InMemoryCourseRepository` 仍用于不依赖数据库的单元测试，但正式 `.env.local` 使用 `COURSE_REPOSITORY=mysql`，不会在数据库失败时静默切换到内存。

## 2. 已实现内容

### 数据库与仓储

- 使用 `mysql2/promise` 的服务端进程级连接池；
- `ai_teaching` 数据库中的 courses、quiz_attempts 和 schema_migrations 表；
- `001_initial_schema.sql` 与幂等迁移执行器，重复执行会跳过已登记版本；
- `CourseRepository` 的 InMemory 和 MySQL 两个实现；
- courses 采用关系型顶层字段加 JSON 聚合列，读取后重新执行完整 CourseSchema；
- save 使用短事务和 `WHERE id = ? AND revision = ?`，成功后 revision 加一；
- quiz_attempts 通过外键在删除 Course 时级联清理；
- 数据库不可用、版本冲突、存储数据损坏和配置错误具有独立错误类型。

### 页面与接口

- `/`：创建 MySQL 课程、显示重启后恢复的历史课程并显式确认删除；
- `/generation/[courseId]`：从 MySQL 读取草稿，审核大纲，串行生成场景，展示逐项进度和失败重试；
- `/classroom/[courseId]`：从 MySQL 恢复课程，固定渲染 slide/quiz/code；
- `POST /api/courses`、`GET /api/courses`、`GET/DELETE /api/courses/[courseId]`；
- `POST /api/courses/[courseId]/outline/generate`：正式大纲生成与提交；
- `PATCH /api/courses/[courseId]/outline`：人工编辑后的结构与语义复验；
- `POST /api/courses/[courseId]/scenes/[outlineId]/generate`：只生成 URL 指定的一个场景；
- `GET /api/health/database`：只返回状态、数据库名和版本，不返回主机、用户或密码；
- 仓储错误统一映射为 code、message、retryable、requestId。

### AI 大纲与场景管线

- `MockAIAdapter` 与 `OpenAICompatibleAdapter` 共用 `AIAdapter` 接口；
- `AI_MODE=remote` 时由服务端 `AI_PROVIDER=deepseek|bailian` 选择配置档，浏览器不能覆盖 Key、Base URL、模型名或 Prompt；
- OpenAI-compatible 请求使用 `/chat/completions` 和 JSON mode，认证、限流、超时、网络与上游响应错误具有稳定分类；
- 解析只接受纯 JSON、单个 JSON 围栏或首个平衡对象，随后执行严格 Zod 和课程级语义门；
- 传输错误最多重试两次，格式/结构/语义错误最多调用一次 repair，总上游调用硬上限为 4；
- 模型不生成实体 ID，装配器补齐 outline、Scene、Block、Question、Option 和 Action ID；quiz 模型只返回 `correctOptionIndex`；
- `outlineGeneration` 保存 Provider、实际响应模型、Prompt 版本、requestId、耗时、upstreamCalls、repair 标记和可用 token usage；
- 每个 Scene 也保存独立 `GenerationMetadata`，slide 与 quiz 使用各自的版本化 Prompt；
- 大纲和每个场景均使用两个短事务包围模型调用，迟到响应必须同时匹配 operation id 和 revision；
- 场景失败只修改目标 `SceneProgress`，其他 Scene 保留；pending 场景仍可继续，failed 场景重试后按 outlineId 替换而不是重复追加；
- 进程崩溃遗留的 generating 操作只有租约到期后才能由相同 outline 恢复。

### 配置与安全边界

- `.env.example` 只提供无密码示例；真实 `.env.local` 被 Git 忽略；
- DATABASE_URL 只在服务端数据库模块读取，没有 `NEXT_PUBLIC_` 变量；
- 模型 Key、Base URL 与模型名只在服务端 Route Handler 调用链解析，没有 `NEXT_PUBLIC_` 模型配置；
- 参数化 SQL 用于所有业务值；数据库名在迁移脚本中经过标识符白名单；
- 数据库失败会返回 `DATABASE_UNAVAILABLE`，不会伪装成空课程列表；
- 固定渲染与代码块纯文本安全边界继续保留。

## 3. 验证记录

```text
pnpm db:migrate  # 首次 applied 001；复跑 skip 001
pnpm lint
pnpm test        # 10 个文件、29 项无数据库测试
pnpm test:db     # 1 个文件、8 项真实 MySQL 测试
pnpm build
```

单元测试在 M3 覆盖项之外，新增 slide/code/quiz DTO 装配、模型 ID 注入拒绝、答案索引越界、重复选项、HTML/URL 安全门、场景 repair、逐场景 revision、失败隔离、后续继续、单场重试、最终事务失败和迟到响应保护。MySQL 集成测试新增“三个场景分别提交后由新仓储实例恢复为 REV.8 ready 课程”。

Playwright CLI 在 production server 上完成“创建 3 场景草稿 → mock 生成 REV.2 大纲 → 确认后依次生成 2 个 slide 和 1 个 quiz → REV.8 ready → 进入课堂检查生成内容和答案选项”的浏览器链路。页面显示 03/03 独立提交，课堂显示 `REV.8 · MOCK`，控制台错误数为 0；验证课程随后已从 MySQL 删除。

## 4. 当前明确未实现

- 尚未用有效 Key 实际调用 DeepSeek 或阿里百炼，因此不能宣称双 Provider 远端联调完成；
- 超时租约可以被下一次显式生成请求接管，但尚无后台扫描器主动恢复遗留操作；
- 课堂仍为手动翻页，Action executor、自动播放、TextOnlySpeechAdapter 和 BrowserSpeechAdapter 尚未实现；
- quiz 页面可以判分，但尚未通过 API 写入 quiz_attempts；
- 完整 Playwright 回归测试文件仍留在 M6，当前使用受控 CLI 验证关键浏览器链路。

M4 场景代码完成不代表整个 MVP 完成；远端验收、课堂运行时和测验持久化仍分别属于 Provider 验收及 M5。

## 5. 下一步：M5（远端 Provider 验收并行保留）

下一开发步进入 M5：实现 playback reducer、Action executor、默认 TextOnlySpeechAdapter、可选 BrowserSpeechAdapter，以及 quiz_attempts 服务端写入。DeepSeek 与百炼真实 smoke test 仍是独立验收项；获得有效 Key 后应验证完整“大纲 + 多场景”链路，并以数据库中的 outline/scene `GenerationMetadata` 和实际课程内容作为证据，不以 HTTP 200 单独判定成功。
