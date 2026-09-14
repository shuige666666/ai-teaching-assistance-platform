# 整课生成运行指标与简易用量面板开发方案

> 文档版本：0.1（2026-09-14）
>
> 状态：已完成实施与验收
>
> 归属：M12.4 之后的研究准备型独立增强，暂不占用新的主阶段编号
>
> 关联能力：课程大纲生成、逐场景生成、MySQL 持久化、离线 `eval/runs` 证据
>
> 参考：OpenMAIC `data/usage/*.jsonl`、`GET /api/usage` 与设置页用量面板的分层思路

## 1. 决策结论

新增一张 `generation_runs` 表，记录一次课程生成运行的状态、模型配置和汇总指标；新增 `/settings` 页面与只读 `GET /api/usage`，展示课程生成次数、完成情况、模型调用、token、repair 和有效生成耗时。

新指标不继续加入 `courses`。`courses` 继续表示“课程现在是什么”，`generation_runs` 表示“某一次生成发生了什么”。当前 `courses.outline_generation_json` 和 `scenes_json[].generation` 暂不迁移，它们仍负责说明当前大纲和当前页面的生成来源；新表只保存运行级汇总，不复制课程正文、大纲、页面元素、互动 HTML、完整 Prompt 或模型原文。

第一版只统计课程创建后的大纲与首次场景生成，以及未完成课程的继续生成和失败场景重试。M10 单场修订、M12 Agent 工具、PPTX 导出和课堂播放不混入课程生成面板；Agent 已有的 `agent_runs.metrics_json` 保持独立。论文中的 Recall@K、事实支持率、人工评分等算法评价继续保存在独立 `eval/runs`，待研究问题确定后再决定是否增加 `experiment_results`。

本项工作只增加记录和展示，不增加模型调用、不改变 Prompt、不提高生成门禁，也不因为指标写入失败而覆盖已经成功保存的课程。

## 2. 当前基线与问题

### 2.1 `courses` 已经承担的职责

当前 `courses` 主表同时包含：

- 课程 ID、主题、标题、状态、revision 和场景数量；
- `brief_json` 中的 CourseBrief 与字段来源；
- `outlines_json`、`scenes_json` 和 `scene_progress_json`；
- `outline_generation_json`；
- `active_operation_json` 和 `last_error_json`；
- 创建时间与更新时间。

`MySQLCourseRepository.save()` 每次都校验并更新完整课程聚合。这一设计在每课 4～8 页的当前规模下仍可工作，但不适合继续承载多次运行历史、实验版本和长期统计。生成次数越多，如果把历史数组继续写入 `courses`，单行会不断增长，课程读取也会携带课堂页面并不需要的指标历史。

### 2.2 已有指标能够回答什么

当前大纲和每个成功场景已经保存以下 `GenerationMetadata`：

```text
provider / model / promptVersion / requestId
durationMs / upstreamCalls / repaired
usage.inputTokens / usage.outputTokens / generatedAt
```

`sceneProgress` 另有当前 `status`、累计 `attempts` 和最近错误；M12 的 `agent_runs.metrics_json` 记录 Agent 模型与工具调用情况；`eval/scripts` 可以从固定样本生成离线报告。

这些数据可以解释当前产物，但不能完整回答：

- 一次整课生成总共用了多久、多少次模型调用和多少 token；
- 初次整课生成最终是完整成功、部分失败还是被中断；
- 已经失败或被后续成功结果替换的调用消耗了多少；
- 同一个实验用例在不同方法版本下的成本和完成情况；
- 最近 7 天或 30 天的生成趋势和失败分布。

### 2.3 与 OpenMAIC 的取舍

OpenMAIC 把部署级 LLM、图片、视频、TTS 和 ASR 用量写入按月 JSONL，再由 `/api/usage` 按日期、模型和模态聚合。可借鉴的是“调用记录与业务内容分开、设置页只读展示”的设计。

本项目当前更需要课程级关联，因此不直接复制无 `courseId` 的部署总账，也不先建设多模态统计。`generation_runs` 必须能够关联课程、运行类型、Prompt 和方法版本；实际价格暂不计算，Provider 没有返回的 token 也不估算。

## 3. 目标与非目标

### 3.1 目标

1. 一次首次课程生成能够形成一条可恢复、可收尾的运行记录。
2. 人工审核大纲期间不把等待时间计入模型生成耗时。
3. 成功、失败、repair、重试、模型调用和可获得 token 能形成整次运行汇总。
4. 失败场景后续重试形成独立运行事实，不改写最初生成的结果。
5. 设置页可以查看总体用量、状态分布、每日趋势、模型分组和最近运行。
6. 指标可以通过 `courseId` 定位课程，通过 `methodVersion` 支持后续算法实验。
7. 删除课程时同步删除在线运行记录；需要长期保留的论文证据先脱敏归档到 `eval/runs`。

### 3.2 非目标

- 不拆分当前 `courses.scenes_json`、`outlines_json` 或 CourseSchema 聚合。
- 不建设 Prometheus、OpenTelemetry、消息队列或独立监控服务。
- 不保存 API Key、完整 Prompt、模型原文、课程正文或 interactive HTML。
- 不建立 `generation_run_steps` 明细表；第一版复用当前成功产物元数据和错误信息。
- 不统计真实货币成本，不维护动态 Provider 价格表。
- 不自动生成事实正确性、教学质量、视觉质量或学习效果分数。
- 不把设置面板中的指标变成课程生成门禁。
- 不回填无法可靠恢复的历史运行。

## 4. 数据职责与权威来源

| 数据 | 权威来源 | 说明 |
| --- | --- | --- |
| 当前课程内容、状态、revision | `courses` | 课堂与编辑工具继续只读取 Course 聚合 |
| 当前大纲生成来源 | `courses.outline_generation_json` | 跟随当前大纲；重新生成后被替换 |
| 当前场景生成来源 | `courses.scenes_json[].generation` | 跟随当前场景；重新生成后被替换 |
| 当前场景进度与最近错误 | `courses.scene_progress_json`、`last_error_json` | 表示当前可恢复状态，不作为历史日志 |
| 一次课程生成的历史结果 | `generation_runs` | 完成后冻结，不因课程后续修改而回写 |
| Agent 对话运行指标 | `agent_runs.metrics_json` | 不计入第一版课程生成面板 |
| 算法评价与人工评分 | `eval/runs` | 与产品运行表分开，记录实验定义和样本证据 |

字段层面允许有少量有意重叠：当前场景的 `provider/model/usage` 用于解释当前产物，运行表中的同名汇总用于还原当时运行。禁止在 `generation_runs` 再保存完整 `GenerationMetadata[]` 或 Course JSON。

## 5. 指标口径

### 5.1 第一版持久化指标

| 字段 | 口径 |
| --- | --- |
| `status` | 本次运行的当前或最终状态 |
| `active_duration_ms` | 大纲和场景生成请求实际执行时间之和，不包含人工审核与页面停留 |
| `requested_scene_count` | 运行开始时计划生成的场景数快照 |
| `succeeded_scene_count` | 本次运行成功保存的场景数 |
| `failed_scene_count` | 本次运行最终生成失败的场景数 |
| `first_pass_succeeded_count` | `upstreamCalls=1` 且没有进入 repair 的成功场景数 |
| `model_calls` | 本次运行已发起的上游模型调用次数，包括重试和 repair |
| `repair_count` | 本次运行实际进入 repair 的次数 |
| `repair_succeeded_count` | 进入 repair 后成功保存结果的次数 |
| `input_tokens` | Provider 实际返回的已知输入 token 之和 |
| `output_tokens` | Provider 实际返回的已知输出 token 之和 |
| `usage_status` | `complete / partial / unavailable`，说明 token 汇总覆盖程度 |
| `error_code` | 运行终态的主要失败码；成功时为空 |

大纲也计入 `model_calls`、repair、token 和有效耗时，但不计入场景成功数。`first_pass_succeeded_count` 的分母只使用请求场景数，避免把大纲和页面混在同一个完成率中。

### 5.2 关联与复现字段

以下字段不是评价指标，但必须与运行一起保存：

```text
id / course_id / run_type
provider / model / prompt_version / method_version
base_revision / final_revision
started_at / finished_at / updated_at
root_request_id / config_json
```

`config_json` 只保存后续实验需要的短配置，例如检索 `topK`、上下文预算或排序权重。普通生产基线可以为空；不保存 topic、CourseBrief、课程正文或 Prompt 文本。

### 5.3 派生指标

设置页查询时计算，不另外持久化：

```text
场景完成率 = succeeded_scene_count / requested_scene_count
首次通过率 = first_pass_succeeded_count / requested_scene_count
repair 恢复率 = repair_succeeded_count / repair_count
完整运行率 = completed 运行数 / 已进入终态的首次课程生成运行数
平均有效耗时 = 终态运行 active_duration_ms 平均值
```

`running`、`awaiting_review` 和 `awaiting_generation` 不进入完整运行率分母。分母为 0 时显示“暂无数据”，不显示 0%。token 覆盖为 partial 或 unavailable 时，界面显示“部分可用”或“未返回”，不把未知值解释为 0。

## 6. 运行类型与生命周期

### 6.1 运行类型

第一版使用三种 `run_type`：

| 类型 | 触发点 | 范围 |
| --- | --- | --- |
| `course_generation` | 点击“生成课程大纲” | 大纲生成、人工审核后的首次 pending 场景生成 |
| `scene_batch` | 没有可继续的首次运行时点击“继续生成” | 一批 pending 场景 |
| `scene_retry` | 对 failed 场景点击单独重试 | 单个失败场景 |

M10 修订、M12 `generate_scene` 和未来媒体生成暂不写入本面板。表中的 `run_type` 使用受控字符串而不是 MySQL ENUM，后续增加类型不需要改列类型。

### 6.2 首次课程生成

```text
draft
  → 点击生成大纲
  → 创建 course_generation / running
  → 大纲失败：failed + finished_at
  → 大纲成功：awaiting_review
  → 用户人工编辑和保存大纲：仍为 awaiting_review
  → 开始生成某个 pending 场景：running
  → 当前请求结束且仍有 pending：awaiting_generation
  → 所有场景 ready：completed + finished_at
  → 不再有 pending 且至少一项 failed：partial_failed + finished_at
```

`active_duration_ms` 每次只累加真实大纲或场景请求的服务端耗时。`started_at` 与 `finished_at` 用于审计完整时间跨度，但面板默认展示有效耗时，避免把人工审核大纲的几分钟或几天计算成模型延迟。

用户刷新页面后，通过 `course_id` 查询最新的非终态 `course_generation`，不要求浏览器长期保存 run ID。生成新大纲时，先把同课程旧的 `awaiting_review/awaiting_generation` 运行标记为 `superseded`，再开始新运行。修改 CourseBrief 导致旧大纲失效时，同样将对应运行标记为 `superseded`。

### 6.3 继续生成与重试

首次运行仍处于 `awaiting_generation` 时，“继续生成”沿用该运行。首次运行已经进入 `partial_failed/failed/cancelled/interrupted` 终态后，不重新打开或覆盖它：

- 批量处理剩余 pending 场景时创建 `scene_batch`；
- 单独重试 failed 场景时创建 `scene_retry`；
- 重试成功让课程变为 ready，也只完成重试 run，不把原来的 `partial_failed` 改成成功。

这样可以同时回答“课程最后是否修好”和“第一次生成是否稳定”。课程当前状态由 `courses` 提供，历史首次运行结果由 `generation_runs` 提供。

### 6.4 取消、中断和迟到结果

- 浏览器显式取消已经传入 Provider 的请求时，当前请求按服务端实际结果更新；已保存场景不回滚。
- 用户在两次场景请求之间停止，首次运行保持 `awaiting_generation`，以后可以继续。
- 进程在模型调用中断时可能遗留 `running`。下次进入生成页或开始新运行时，根据课程 `activeOperation.expiresAt` 收尾为 `interrupted`；设置页 GET 不隐式修改运行状态。
- 迟到结果只有仍持有现有 operation id 和 revision 才能保存；指标收尾不得绕开课程已有并发语义。
- 指标写入失败只记录脱敏服务端错误，不把已经保存成功的课程改成失败。

## 7. 表结构

建议新增 `migrations/007_generation_runs.sql`：

```sql
CREATE TABLE IF NOT EXISTS generation_runs (
  id CHAR(36) NOT NULL,
  course_id CHAR(36) NOT NULL,
  run_type VARCHAR(32) NOT NULL,
  status VARCHAR(32) NOT NULL,

  provider VARCHAR(32) NULL,
  model VARCHAR(120) NULL,
  prompt_version VARCHAR(80) NULL,
  method_version VARCHAR(80) NULL,
  root_request_id VARCHAR(80) NULL,

  base_revision BIGINT UNSIGNED NOT NULL,
  final_revision BIGINT UNSIGNED NULL,
  requested_scene_count TINYINT UNSIGNED NOT NULL,
  succeeded_scene_count TINYINT UNSIGNED NOT NULL DEFAULT 0,
  failed_scene_count TINYINT UNSIGNED NOT NULL DEFAULT 0,
  first_pass_succeeded_count TINYINT UNSIGNED NOT NULL DEFAULT 0,

  model_calls INT UNSIGNED NOT NULL DEFAULT 0,
  repair_count INT UNSIGNED NOT NULL DEFAULT 0,
  repair_succeeded_count INT UNSIGNED NOT NULL DEFAULT 0,
  input_tokens BIGINT UNSIGNED NULL,
  output_tokens BIGINT UNSIGNED NULL,
  usage_status VARCHAR(16) NOT NULL DEFAULT 'unavailable',
  active_duration_ms BIGINT UNSIGNED NOT NULL DEFAULT 0,

  error_code VARCHAR(64) NULL,
  config_json JSON NULL,
  started_at BIGINT UNSIGNED NOT NULL,
  finished_at BIGINT UNSIGNED NULL,
  updated_at BIGINT UNSIGNED NOT NULL,

  PRIMARY KEY (id),
  INDEX idx_generation_runs_course_time (course_id, started_at),
  INDEX idx_generation_runs_status_time (status, started_at),
  INDEX idx_generation_runs_model_time (model, started_at),
  CONSTRAINT fk_generation_runs_course
    FOREIGN KEY (course_id) REFERENCES courses(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_ai_ci;
```

常用统计字段使用普通数值列，便于 SQL 聚合；只把低频、后续研究才可能出现的参数放入 `config_json`。不增加逐字段 CHECK 或复杂触发器，状态和数值范围由 TypeScript Schema、Repository 参数化 SQL 和核心测试约束。

迁移不回填现有课程。面板明确显示“统计自本功能启用后开始”；现有 `GenerationMetadata` 无法可靠恢复历史失败、重试和人工停留边界，不能据此伪造完整 run。

## 8. 服务端设计

### 8.1 建议文件

```text
lib/domain/generation-run.ts
lib/repository/generation-run-repository.ts
lib/repository/mysql-generation-run-repository.ts
lib/repository/in-memory-generation-run-repository.ts
lib/application/generation-run-tracker.ts
app/api/usage/route.ts
app/settings/page.tsx
components/settings/usage-dashboard.tsx
```

`GenerationRunRepository` 只处理运行记录的创建、查询、原子累加和收尾；不读取或写入课程正文。`GenerationRunTracker` 负责把大纲/场景结果转换成统一增量，业务 Service 不直接拼 SQL。

### 8.2 领域契约

建议定义：

```ts
type GenerationRunType = "course_generation" | "scene_batch" | "scene_retry";

type GenerationRunStatus =
  | "running"
  | "awaiting_review"
  | "awaiting_generation"
  | "completed"
  | "partial_failed"
  | "failed"
  | "cancelled"
  | "interrupted"
  | "superseded";

type UsageStatus = "complete" | "partial" | "unavailable";
```

更新采用增量对象，模型和 token 只能由服务端生成链提交。浏览器不能上传汇总数值，也不能直接修改运行状态。

### 8.3 接入大纲生成

`OutlineGenerationService.generate()` 在课程状态与 expectedRevision 通过后创建 `course_generation`。成功时：

- 保存 `provider/model/promptVersion`；
- 累加大纲 `upstreamCalls`、usage 和 `durationMs`；
- 根据 `repaired` 记录 repair；
- 状态进入 `awaiting_review`；
- 保存完成后的 course revision。

失败时使用 `OutlineGenerationError.upstreamCalls` 和服务端计时完成 run；如果失败路径不能获得 token，标记 `usage_status=partial/unavailable`。课程失败保存仍按现有 Service 执行，运行记录收尾不能包住模型调用形成长事务。

### 8.4 接入场景生成

`SceneGenerationService.generate()` 开始时查找同课程可继续的 `course_generation/scene_batch`；如果当前操作是明确的失败场景重试且没有可继续 run，则创建 `scene_retry`。成功时根据 `scene.generation` 累加：

```text
succeededSceneCount + 1
modelCalls + upstreamCalls
activeDurationMs + durationMs
input/output tokens
repairCount / repairSucceededCount
firstPassSucceededCount
```

失败时累加 `failedSceneCount`、已知 `upstreamCalls`、有效耗时和错误码。请求结束后读取已经提交的 Course 状态和 `sceneProgress`，决定进入 `awaiting_generation` 还是终态。

为了准确记录 repair 失败，`OutlineGenerationError` 和 `SceneGenerationError` 可增加内部可选字段 `repairAttempted` 与已知 usage。它们只用于运行统计和脱敏错误映射，不把 Provider 原文或 Prompt 带入数据库。Provider 完全没有返回 usage 时保持未知。

### 8.5 原子性与失败优先级

- 课程内容事务仍是业务主事务；不把模型调用放进数据库事务。
- 指标采用短 `INSERT/UPDATE`，计数使用 SQL 原子加法，防止刷新或重复请求丢失累计值。
- 先完成 Course 成功提交，再把成功计入 run；课程提交失败不能记录为成功场景。
- 指标收尾失败时输出 `generation.metrics.write_failed` 日志，返回课程真实结果，不用指标错误替换业务响应。
- 重复收尾已终态 run 返回原记录，不再次累加。

## 9. 用量 API

新增只读接口：

```text
GET /api/usage?range=7d|30d|all
```

默认 `30d`。第一版只接受三个固定范围，避免增加任意查询 DSL。接口返回：

```ts
type UsageResponse = {
  recordingStartedAt?: number;
  totals: {
    runs: number;
    terminalRuns: number;
    completedRuns: number;
    requestedScenes: number;
    succeededScenes: number;
    firstPassSucceededScenes: number;
    modelCalls: number;
    repairCount: number;
    repairSucceededCount: number;
    inputTokens?: number;
    outputTokens?: number;
    usageStatus: UsageStatus;
    averageActiveDurationMs?: number;
  };
  byStatus: Array<{ status: GenerationRunStatus; count: number }>;
  byDay: Array<{
    date: string;
    runs: number;
    completedRuns: number;
    failedRuns: number;
    modelCalls: number;
    inputTokens?: number;
    outputTokens?: number;
  }>;
  byModel: Array<{
    provider?: string;
    model?: string;
    runs: number;
    modelCalls: number;
    inputTokens?: number;
    outputTokens?: number;
    averageActiveDurationMs?: number;
  }>;
  recentRuns: Array<{
    id: string;
    courseId: string;
    courseTitle: string;
    runType: GenerationRunType;
    status: GenerationRunStatus;
    provider?: string;
    model?: string;
    promptVersion?: string;
    methodVersion?: string;
    succeededScenes: number;
    requestedScenes: number;
    modelCalls: number;
    repairCount: number;
    inputTokens?: number;
    outputTokens?: number;
    usageStatus: UsageStatus;
    activeDurationMs: number;
    startedAt: number;
    finishedAt?: number;
    errorCode?: string;
  }>;
};
```

最近记录限制为 20 条。`courseTitle` 通过 JOIN 当前 `courses` 获得，不写回运行表。日期按应用约定时区展示，数据库继续保存毫秒时间戳。接口不返回 `config_json` 和错误详情，避免设置页无意暴露研究配置或课程信息。

## 10. 设置页与用量面板

### 10.1 页面入口

新增 `/settings`。首页头部右侧增加“设置”入口；设置页提供返回首页的品牌链接。第一版侧栏或页签只出现“用量统计”，不提前展示不可用的模型、账户、外观等空栏目。

### 10.2 页面结构

顶部使用六个摘要卡：

1. 生成运行数；
2. 完整运行数；
3. 场景完成率；
4. 模型调用数；
5. 输入/输出 token；
6. 平均有效生成耗时。

下方依次显示：

- 7 天、30 天、全部范围切换与刷新按钮；
- 每日运行/成功/失败趋势；
- 按模型的运行数、调用数、token 和平均耗时；
- 状态分布及 repair 恢复情况；
- 最近 20 次运行表格，课程仍存在时可点击返回生成页。

项目已经依赖 ECharts，趋势图可复用现有依赖，不新增图表包。窄屏将摘要卡改为单列或双列，最近运行表允许容器横向滚动；不增加复杂拖拽、导出或自定义仪表盘。

### 10.3 展示语义

- `active_duration_ms` 标为“有效生成耗时”，并提示不含人工审核等待。
- token 不完整时显示“已知 X / 部分记录未返回”，不能显示为完整总量。
- 面板顶部显示“统计自 YYYY-MM-DD 开始”。
- `awaiting_review/awaiting_generation` 显示为未结束，不计入成功率。
- `superseded` 表示用户重新开始生成，不归类为模型失败。
- 页面明确说明“用量与运行结果不代表课程事实或教学质量”。

## 11. 与论文实验的连接

`generation_runs.method_version` 为未来实验留出最小关联点，例如：

```text
production-baseline
lexical-retrieval-v1
hybrid-retrieval-v1
context-selector-v1
```

正式 AI Search 实验还应在 `eval/runs/<experiment>/<run-id>/` 保存：

- 固定 `caseId`、数据集版本和方法配置；
- 关联的 `generationRunId/courseId`；
- 检索结果与必要的脱敏证据；
- Recall@K、MRR/nDCG、证据覆盖率等专项指标；
- 人工评价和评价说明；
- 汇总脚本输出。

产品表只记录运行事实，不把算法评分塞进 `courses` 或用量面板。等论文确实需要跨实验 SQL 查询时，再建立独立 `experiment_results`；第一版不提前建设。

## 12. 实施顺序

### 增量 A：运行记录基础

- 新增迁移、领域类型、Repository 接口及 MySQL/InMemory 实现；
- 完成 create、find open、append metrics、transition、finish、supersede 和按 course 级联删除；
- 为缺失 usage、重复收尾和短事务原子累计补核心测试。

### 增量 B：接入生成主链

- 大纲生成开始、成功、失败接入 tracker；
- 首次 pending 场景、继续生成、单场 retry 接入同一指标口径；
- 处理人工等待、Brief 失效、刷新继续、部分失败和进程中断；
- 日志增加 `generationRunId`，不改变现有 requestId。

### 增量 C：查询与设置页

- 新增按范围聚合 Repository 查询和 `GET /api/usage`；
- 新增 `/settings`、首页入口、摘要卡、趋势、模型分组和最近记录；
- 对 unknown/partial token、未结束运行和空数据提供真实文案；
- 补窄屏基础布局。

### 增量 D：文档与样例验收

- 更新 README、路线图、开发状态、架构和部署验收文档；
- 使用 mock 完成完整成功、部分失败和重试样例；
- 如果需要真实 DeepSeek，只运行一门小课程验证 Provider usage，不设置波动性成功率门槛。

## 13. 核心测试与验收

### 13.1 单元测试

- 指标增量正确累加，终态不能再次累计；
- 人工审核等待不进入 `active_duration_ms`；
- 首次通过、repair 成功和 repair 失败口径正确；
- usage 缺失时为 partial/unavailable，而不是 0；
- 派生完成率在空分母时返回空值；
- superseded、awaiting 状态不被算作模型失败。

### 13.2 MySQL 集成测试

- 迁移可重复执行并能写入、读取、更新 run；
- 同一 run 的原子增量不会丢计数；
- 课程删除级联删除 `generation_runs`；
- 重新生成大纲会终止旧的非终态运行；
- 用量查询的 totals、byStatus、byModel 和 recentRuns 与原始记录一致。

### 13.3 少量页面与流程回归

- 新课程从大纲到全部场景完成后出现一条 completed 记录；
- 某场失败后记录 partial_failed，单场重试产生独立 scene_retry；
- 设置页刷新后数字与 API 一致，最近课程链接有效；
- 空数据库和全部 token 未返回时页面不报错、不显示虚假 0 token；
- 390px 窄屏没有页面级横向溢出，运行表仅在自己的容器内滚动。

阶段结束执行 `pnpm lint`、核心单元测试、MySQL 集成测试和 `pnpm build`；只保留一条覆盖“生成课程后打开设置页”的 mock 浏览器流程，不为每张卡片增加重复 E2E。真实模型验收属于可选校准，不作为日常 CI。

## 14. 完成标准

满足以下条件即可收口：

1. 新生成课程和失败/重试运行都能形成独立、可查询的运行事实；
2. `courses` 没有新增历史指标 JSON，课程读取与 revision 语义不变；
3. 人工等待、未知 token、部分失败和重试的统计口径不会误导；
4. `/settings` 能展示真实汇总、趋势、模型分组和最近运行；
5. 删除课程后在线指标一并删除，论文留档继续使用脱敏 `eval/runs`；
6. 指标记录故障不会破坏课程成功提交；
7. 相关核心测试、MySQL 集成、lint 与 production build 通过。

完成后即可把该面板作为后续 AI Search 实验的运行成本底座。专项研究指标仍由选题决定，不因本项工作提前扩展生成门禁或实验平台。

## 15. 实施与验收记录（2026-09-14）

本方案已按收缩后的第一版边界完成。迁移 007 新增 `generation_runs`；领域层新增运行、状态、用量覆盖和设置页响应契约；MySQL/InMemory Repository 支持创建、开放运行查询、原子增量、状态转换、替代、用量读取和按课程删除。`GenerationRunTracker` 以 best-effort 方式接入大纲生成、首次 pending 场景、继续生成、失败场景重试和 Brief 失效，指标写入错误只输出脱敏日志，不覆盖课程真实响应。

失败的 outline/scene 管线现在会携带本次已经取得的 Provider、模型、Prompt 版本、调用次数、repair、耗时和可获得 token。首次整课运行按自己的请求数收尾；后来重试使用独立 `scene_retry`，不会改写首次结果。过期 scene operation 恢复时冻结旧运行并另起批次。课程删除依靠 MySQL 外键级联，内存演示仓储由同一 API 入口显式清理。

产品侧已新增 `GET /api/usage?range=7d|30d|all`、`/settings` 和首页“用量统计”入口。设置页展示六项摘要、每日 ECharts 趋势、状态/repair、模型分组、最近 20 次运行和统计起点；unknown/partial token、空分母、人工等待和质量边界均使用明确文案。第一版没有增加价格表、逐调用明细、监控平台、算法评分或课程生成门禁。

验收结果：

- `pnpm lint`、无增量 TypeScript 检查和 `pnpm build` 通过；构建清单包含 `/settings` 与 `/api/usage`；
- `pnpm test`：35 个文件、200 项通过；新增核心用例覆盖完整运行、首次部分失败与独立重试、终态幂等及 unknown token；
- `pnpm test:db`：23 项通过；新增 MySQL 用例覆盖并发原子累计、partial usage、用量查询和课程删除级联；
- production mock 临时课程完成 `outline + 4 scenes`，得到 1 次 completed、5 次模型调用、4/4 场景与 complete usage；桌面非空面板和 390px 空面板均无控制台错误，窄屏无页面级横向溢出；
- 临时课程及关联运行记录验收后已删除。本次不调用真实 DeepSeek，因为实现没有改变 Prompt、Provider 请求或课程生成质量，mock 纵向链和真实 MySQL 已足以验证新增职责。
