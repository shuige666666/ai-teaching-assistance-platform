# 12. M12 对话式课程修订 Agent 开发方案

> 文档版本：0.1（2026-09-07）
> 状态：方案设计，尚未实现
> 上游依赖：M10 单场景修订（已完成）、M11 资源包导出（已完成，非技术前置）
> 参考实现：OpenMAIC `lib/server/agent-runtime/*` 与 `components/chat/*`，仅裁剪其课程编辑主链，不复制平台级运行设施

## 1. 核心结论

M12 将现有“输入一句意见后整场重新生成”的单次修订弹层，升级为课堂右侧的**持久对话式课程修订 Agent**。用户既可以询问课程内容，也可以在同一对话中要求修改当前页或整门课程；模型通过受控工具读取真实课程、执行修改、重新读取确认，并把工具过程与最终结果展示在侧栏中。

第一版采用**单 Agent + 服务端工具循环 + MySQL 对话记录 + SSE 事件流**。不复制 OpenMAIC 的多 Agent Director、后台 Worker、跨机器恢复、Skills、联网搜索、媒体生成、语音克隆等平台能力。毕业设计需要证明的是下面这条闭环，而不是复刻完整 Agent 平台：

```text
课堂点击“对话 / 修订”
  → 右侧侧栏携带 courseId、当前 sceneId 与用户消息
  → 服务端 Agent 根据需要调用课程工具
  → 工具通过现有 Service / Repository 校验并保存
  → SSE 返回文本、工具状态和最新 course revision
  → 前端刷新课程并停留在合理的页面
  → Agent 再读目标页，必要时提示用户做视觉核对
```

本阶段不把“工具调用成功”表述为“课程内容一定正确”。工具成功只证明参数、结构校验、并发保护和持久化通过；事实正确性、教学质量、代码可执行性与视觉质量仍需各自的检查证据。

## 2. 当前实现与目标差距

### 2.1 当前已经具备的能力

当前课堂页 `components/course/classroom-runtime.tsx` 已有“修订本场”入口。它弹出一次性表单，向 `/api/courses/[courseId]/scenes/[outlineId]/revise` 提交最多 500 字意见，再由 `SceneGenerationService.revise()` 把旧场景与意见交给现有场景生成链，得到一份完整替代场景。

这条链路已经具备四项必须保留的安全语义：

- 请求携带 `expectedRevision`，旧版本写入会得到冲突而不是覆盖新内容；
- 模型调用前登记 `activeOperation`，迟到结果只有仍持有相同 operation id 才能提交；
- 新场景完整生成、Schema/策略校验和保存全部成功后才替换旧场景；失败、取消或冲突保留旧内容；
- 修订 quiz 会更换题目 ID，因此必须明确确认，并在同一数据库事务中清理该场旧作答。

当前缺口不在“能不能调用模型重做一页”，而在于它没有对话历史、没有工具选择、不能先查再改、不能跨页搜索、不能执行局部补丁或调整页序，也不能在多步修改后持续讨论。

### 2.2 M12 要增加的能力

| 维度 | 当前 M10 | M12 目标 |
| --- | --- | --- |
| 交互形态 | 一次性模态表单 | 可收起、可恢复、可多轮对话的右侧侧栏 |
| 上下文 | 当前旧场景 + 单条意见 | 课程身份、当前页、有限对话历史、工具按需读取结果 |
| 模型职责 | 直接生成完整替代场景 | 先判断回答还是行动，再选择工具并核对结果 |
| 修改粒度 | 整场替换 | 精确文本/元素修改、页级生成、页序操作 |
| 跨页能力 | 无 | 列页、读取、搜索、按明确目标操作多页 |
| 反馈 | 等待后整页刷新 | 文本增量、工具卡片、冲突/确认提示、课程即时刷新 |
| 持久化 | 只保存 Course | 对话会话/消息独立保存，Course 仍是内容真源 |

## 3. 用户体验设计

### 3.1 入口与布局

课堂右侧现有“课堂调度台”保留；页头或调度台增加“对话”入口，原“修订本场”改为打开同一侧栏并预填当前页语境。侧栏从右侧覆盖或挤压主课堂区域，桌面端建议宽度 400～480px，可拖动不是首批要求。侧栏关闭后对话仍在，重新打开恢复本课程最近会话。

侧栏由上到下分为：课程与当前页标题、会话消息区、工具执行卡片、确认卡片、输入框。用户在对话期间切换页面时，只更新“当前查看页”提示，不偷偷改写已发送消息的目标；每次发送都冻结当时的 `sceneId` 与 `courseRevision`。

“对话”和“修订本场”是同一 Agent 的两个入口：

- 点击“对话”时输入框为空，适合提问或整课操作；
- 点击“修订本场”时侧栏打开，并显示“当前目标：第 N 页《标题》”，但不自动发送请求；
- 用户仍可明确说“不是当前页，修改第 4 页”，最终以工具参数中的稳定 `sceneId` 为准，不以易变的数组下标作为写入主键。

### 3.2 消息与工具过程

消息区至少显示五类节点：用户消息、模型思考、Agent 正文、工具执行、系统提示。模型思考和工具执行都采用 OpenMAIC 式的可折叠卡片：默认收起，用户点击后才展开详情；正文始终直接展示。这里的“思考”只指模型 Provider 在响应中明确返回的可见 reasoning 内容，不尝试读取服务端或模型没有提供的隐藏推理。

思考卡片在收起状态显示状态、耗时和一行摘要，例如“思考中 3.7s”或“已思考 8.0s”；展开后按 token 增量流式追加 reasoning 文本。用户在生成期间可以随时展开或收起，收起只影响显示，不停止接收；结束后保留完整可见思考，刷新会话后仍可重新展开。若当前 Provider 没有返回 reasoning 内容，则不伪造思考过程，也不显示空卡片。

工具卡片使用中文名称，并展示“准备执行 / 执行中 / 已完成 / 失败 / 需要确认”、耗时、目标页面与简短结果。连续的一组工具调用可以折叠为“2 个工具调用 · 已完成”，展开后列出每个工具；单个工具继续拥有自己的二级展开区。二级展开内容至少包括：

- “入参”：执行前经 Zod 校验、课程归属绑定后的实际参数 JSON；
- “结果原文”：工具实际返回给模型的结构化结果，而不是另写一份可能不一致的 UI 文案；
- revision、受影响 sceneId、耗时和错误码等执行元数据。

工具入参与结果默认收起。展示前统一移除 API Key、内部异常堆栈和不可展示字段；超长 source/HTML 按与 `read_stage` 相同的分页或截断规则显示，并提供“继续查看”，不能为了界面展开而绕过工具本身的读取上限。完整 system Prompt、模型隐藏推理和 Provider 原始响应信封不进入对话界面。

典型过程如下：

```text
用户：第 2 页太挤了，把解释缩短并突出结论。
Agent：先读取第 2 页，确认标题与内容结构。
[已思考 3.7s]（默认收起，可展开查看流式 reasoning）
[2 个工具调用 · 已完成]（默认收起）
[读取课堂] 已完成 · 第 2 页《慢启动与拥塞避免》
[编辑课堂] 已完成 · 缩短 2 段正文，强化结论文本
[已思考 2.8s]（默认收起）
[读取课堂] 已完成 · revision 18
Agent：已完成第 2 页的最小修改。结构校验和保存已通过；建议你查看页面确认视觉留白是否合适。
```

执行期间允许用户点击停止。停止只取消尚未开始或正在等待模型的步骤；已成功提交的工具调用不会回滚，也不能显示成“全部取消”。侧栏必须逐项标明哪些写入已经落库。

### 3.3 确认规则

不是所有写操作都要求确认，否则对话会退化成繁琐表单。第一版规则固定为：

| 操作 | 是否二次确认 | 原因 |
| --- | --- | --- |
| 读取、列页、搜索 | 否 | 只读 |
| 当前页的小范围文本/样式修改 | 否 | 用户已明确授权且可由 revision 追踪 |
| 整页重新生成、新增页、复制页 | 否 | 用户明确提出即可；失败不覆盖原页 |
| 删除页 | 是 | 内容消失且页序变化 |
| 修改 quiz 题干/选项/答案或重新生成 quiz | 是 | 必须原子清理旧作答 |
| 一次修改 3 页及以上 | 是 | 影响范围较大，应先给出页清单 |
| 用户只是在提问、目标含糊 | 不执行 | Agent 先回答或追问，不推断写入授权 |

确认不能只存在于自然语言中。Agent 返回结构化 `confirmation_required` 事件，服务端保存待确认的工具名、参数摘要、目标 revision 和一次性 token；用户点击确认后由新请求执行，若 Course revision 已变化则作废并重新规划。

## 4. 工具集设计

### 4.1 第一批必须工具

工具名沿用 OpenMAIC，界面名称使用中文。参数全部包含服务端绑定的 `courseId`，模型不可改写课程归属；写工具还必须携带工具开始前读取到的 `expectedRevision`。

| 界面名称 | 内部工具 | 第一版职责 | 实现落点 |
| --- | --- | --- | --- |
| 检查当前课堂 | `list_scenes` | 返回 revision，以及页面的稳定 id、order、title、type、状态 | `CourseAgentQueryService.listScenes()` |
| 读取课堂 | `read_stage` | 读取课程摘要、大纲、指定场景的 tree/text/source 投影 | `CourseAgentQueryService.readStage()` |
| 搜索课堂 | `grep_stage` | 在可见文本中做大小写不敏感的字面量搜索，返回命中页和短片段 | `CourseAgentQueryService.grepStage()` |
| 编辑课堂 | `patch_stage` | 对一个场景执行原子化有限补丁，整场复验后保存 | `CoursePatchService.patchScene()` |
| 调整页序 | `edit_deck` | 修改标题、插入、删除、移动页面；服务端重排连续 order | `CourseDeckService.editDeck()` |
| 生成页面 | `generate_scene` | 新增或重新生成一页，复用现有 `generateScene()` 链 | 扩展 `SceneGenerationService` |

第一版暂不实现 `duplicate_scene`，因为它可在 `edit_deck` 的插入能力稳定后小成本补充；也不实现 `generate_actions`、`generate_tts`、`set_roster`，因为当前项目的 Action 由场景装配生成，尚无 TTS 资产和角色聚合，照搬名称会制造没有真实后端能力的空工具。

### 4.2 读取投影

`read_stage` 不应每次把完整 Course JSON 塞进上下文。参考 OpenMAIC，提供三种受限 detail：

- `tree`：默认，只返回课程/页面结构、元素数量、动作数量等紧凑信息；
- `text`：返回用户可见文本与稳定路径，适合问答、搜索和文字修订；
- `source`：返回单页可编辑结构，供 `patch_stage` 使用；长内容分页，互动 HTML 限长。

建议路径只支持 `""`、`/outline`、`/scenes/{sceneId}`、`/scenes/{sceneId}/actions`。读取结果带 `courseRevision`；Agent 在调用写工具前必须基于该 revision。图片数据、未来音频字节等大字段只返回占位描述，且占位符禁止写回。

`list_scenes` 只证明“有哪些页面”，不命名为内容检查或质量检查。返回示例：

```ts
interface SceneInventoryItem {
  sceneId: string;
  outlineId: string;
  order: number;
  title: string;
  type: "slide" | "quiz" | "interactive";
  elementCount?: number;
}
```

### 4.3 `patch_stage` 的有限补丁协议

本项目不接受模型返回任意 TypeScript 函数或 SQL。`patch_stage` 只允许针对一个场景的有限操作，并在内存副本上全部执行成功后一次保存：

```ts
type ScenePatchOperation =
  | { op: "set"; path: string; value: unknown }
  | { op: "remove"; path: string }
  | { op: "str_replace"; path: string; oldText: string; newText: string }
  | { op: "add_element"; element: IdLessPPTElement; afterElementId?: string }
  | { op: "delete_element"; elementId: string };

interface PatchStageInput {
  sceneId: string;
  expectedRevision: number;
  intent: string;
  operations: ScenePatchOperation[];
  confirmQuizAttemptDeletion?: boolean;
}
```

路径白名单按场景类型定义，不开放 `/id`、`/outlineId`、`/order`、`/generation` 等服务端字段。slide 可编辑标题、`content.canvas.background/elements` 与 actions 文本；interactive 第一版只开放标题、`content.html`、summary/fallback 与 actions；quiz 的题目修改继续复用 `QuizEditingService` 的“服务端生成新 ID + 清理旧作答”语义，不让通用 JSON Pointer 绕开它。

处理顺序固定为：加载 Course → 校验 revision 和 sceneId → 在克隆场景上顺序应用所有 op → 按场景类型执行既有 Schema、净化和策略校验 → 必要时处理 quiz 作答 → `CourseRepository.save()` 一次提交。任一 op 失败则整批不保存。

### 4.4 `edit_deck` 与 `generate_scene`

`edit_deck` 第一版只支持 `rename`、`move`、`delete` 三种动作，并只对 `ready` 课程开放结构修改。页面移动按稳定 `sceneId` 指定目标位置，服务端同步重排 `scenes`、`outlines` 与 `sceneProgress`，保证 order 从 1 连续递增。删除页时同步减少 `requestedSceneCount`，且结果必须仍满足当前 CourseSchema 的 4～8 页、1～2 个非首页 quiz、至少 2 个 slide、互动数量与相邻关系等课程级约束；若删除 quiz，在同一事务清理作答。

新增页由 `generate_scene` 负责，而不是先插入一个无效空 Scene。新增只对 `ready` 且少于 8 页的课程开放；它接收目标位置、页面标题/目标/type 与用户编辑指令，先构造合法 `SceneOutline`，再复用现有场景生成、校验和装配链；成功时一次性把 outline、scene、progress 插入 Course，并同步增加 `requestedSceneCount`。重新生成已有页可用于 `ready/partial_failed` 中已有的 ready 场景，继续复用 M10 的“旧内容成功前不被替换”语义。任何新增或删除都必须在提交前通过完整 CourseSchema，而不是只校验目标页面。

`generate_scene` 不等同于 `patch_stage`：可用局部补丁完成时优先补丁；只有布局或内容需要整体重构、用户明确要求重做、或目标页尚不存在时才生成。

### 4.5 标准执行策略

系统 Prompt 明确要求 Agent 遵守：

```text
明确目标页
  → read_stage(detail="source" 或 "text")
  → patch_stage / edit_deck / generate_scene
  → read_stage 再读目标页与最新 revision
  → 向用户报告“已保存的变化”和“尚未证明的质量”
```

跨页修改先 `list_scenes` 或 `grep_stage`；一次修改多页时逐页提交，每次使用最新 revision，避免多个并发写工具互相冲突。第一版同一 Agent run 内所有写工具严格串行。

## 5. 后端架构

### 5.1 模块划分

```text
app/api/courses/[courseId]/agent/
├─ sessions/route.ts                  # GET 列表、POST 新建/复用会话
├─ sessions/[sessionId]/route.ts      # GET 消息与状态
├─ sessions/[sessionId]/messages/route.ts  # POST 消息，返回 SSE
├─ sessions/[sessionId]/confirm/route.ts   # POST 确认高影响工具
└─ sessions/[sessionId]/cancel/route.ts    # POST 请求取消

lib/agent/
├─ contracts.ts                       # Zod 输入、事件、消息、工具调用契约
├─ course-agent-service.ts            # 一轮 Agent 工具循环
├─ system-prompt.ts                   # 能力、边界和标准修改流程
├─ context-builder.ts                 # 有限历史 + 当前课程锚点
├─ tool-registry.ts                   # 名称、Schema、中文展示信息
└─ tools/
   ├─ course-query-tools.ts           # list_scenes/read_stage/grep_stage
   ├─ patch-stage-tool.ts
   ├─ edit-deck-tool.ts
   └─ generate-scene-tool.ts

lib/application/
├─ course-agent-query-service.ts
├─ course-patch-service.ts
└─ course-deck-service.ts

lib/repository/
├─ agent-session-repository.ts
└─ mysql-agent-session-repository.ts
```

Route 只承担鉴权边界（本项目目前为本机单用户时至少校验 course/session 归属）、输入解析、SSE 输出和错误映射；Agent 循环在 `CourseAgentService`；真正课程修改仍在 application service，不把业务写入藏在工具定义或 React 组件中。

### 5.2 Agent 循环

当前 `AIAdapter` 只有 `generateText()`，只接受 system/user 两条消息且没有原生工具调用。M12 开工第一步应把它扩为独立的 Agent 能力，而不是破坏大纲/场景生成接口：

```ts
interface AgentTurnInput {
  requestId: string;
  systemPrompt: string;
  messages: AgentModelMessage[];
  tools: AgentToolDefinition[];
  signal: AbortSignal;
  maxOutputTokens: number;
}

interface AgentAdapter {
  streamTurn(input: AgentTurnInput): AsyncIterable<AgentModelEvent>;
}
```

`OpenAICompatibleAgentAdapter` 调用同一 `/chat/completions`，传入完整有限历史、`tools`、`tool_choice: "auto"` 与 `stream: true`，分别解析 Provider 返回的 reasoning 增量、正文增量和 tool-call 参数增量。只有 Provider 明确输出的 reasoning 字段才能转成思考事件；适配器不能根据正文补写“思考过程”。`AIAdapter.generateText()` 保持原状，继续服务结构化大纲和页面生成。Mock 适配器必须支持按测试脚本流式返回思考、正文和工具调用。

一条用户消息触发的服务端循环为：调用模型 → 若返回工具调用则校验并逐个执行 → 将结构化 tool result 追加到本轮上下文 → 再调用模型 → 直到输出最终文本、要求确认、失败或达到预算。第一版硬限制建议为：最多 8 次模型 turn、最多 12 次工具调用、最多 4 次写工具调用、单轮 120 秒；达到限制时停止并如实报告已提交步骤。

### 5.3 SSE 事件协议

浏览器接口采用 SSE，把模型可见思考、正文和工具生命周期分别流式发送：

```ts
type CourseAgentEvent =
  | { type: "run_started"; runId: string; baseRevision: number }
  | { type: "thinking_started"; blockId: string; startedAt: number }
  | { type: "thinking_delta"; blockId: string; delta: string }
  | { type: "thinking_finished"; blockId: string; durationMs: number }
  | { type: "text_delta"; messageId: string; delta: string }
  | { type: "tool_started"; groupId: string; callId: string; name: ToolName; label: string; summary: string; arguments: unknown }
  | { type: "tool_finished"; groupId: string; callId: string; ok: boolean; summary: string; result: unknown; durationMs: number; courseRevision?: number; affectedSceneIds?: string[] }
  | { type: "confirmation_required"; confirmationId: string; summary: string; expiresAt: number }
  | { type: "course_updated"; revision: number; affectedSceneIds: string[] }
  | { type: "run_finished"; status: "completed" | "failed" | "cancelled"; finalMessageId?: string }
  | { type: "error"; code: string; message: string; requestId: string };
```

前端把 thinking 事件写入默认收起的思考卡，把相同 `groupId` 的工具聚合成可折叠工具组。`arguments/result` 必须是经过服务端展示净化和大小限制后的实际工具数据；不能把数据库连接信息、异常堆栈或 Provider 响应信封直接透传。前端接到 `course_updated` 后 GET 最新课程，按稳定 sceneId 保持当前位置；该页被删除时跳到删除位置附近的页面。

## 6. 数据与持久化

对话不塞进 `courses.scenes_json`，否则每条聊天消息都会增加 Course revision，并与课堂内容并发冲突。新增独立表：

```text
agent_sessions
  id, course_id, status, title,
  created_at, updated_at, last_run_id

agent_messages
  id, session_id, sequence_no, role,
  content_json, created_at

agent_runs
  id, session_id, status, base_course_revision,
  final_course_revision, request_id, error_json,
  started_at, finished_at
```

`content_json` 保存用户可见的正文块、Provider 明确返回的 reasoning 块、工具调用的展示净化后入参/结果、执行元数据和确认记录，使折叠卡片在刷新后可以完整恢复。它不保存模型未提供的隐藏推理、API Key、完整 system Prompt、内部异常堆栈、Provider 原始响应信封或超过工具读取上限的大段 Course source。课程删除时三个表通过外键级联删除。

Course 始终是课程内容真源。历史消息里出现的“第 2 页”只是当时记录；恢复会话后，Agent 必须重新 `list_scenes/read_stage`，不能把旧工具结果当作当前数据。每个工具结果记录执行前后 revision，形成可审计修改轨迹。

第一版保留每课程最多 10 个会话、每会话最近 60 条模型上下文消息；数据库可以保存完整可见历史，但传给模型时只取最近消息，并生成一段确定性的旧历史摘要。若没有足够真实用例，暂不实现自动语义压缩或向量检索。

## 7. 并发、一致性与失败语义

### 7.1 revision 与写入串行化

每个写工具都从数据库重新读取 Course，并校验 `expectedRevision`。同一 run 内工具串行执行，前一个工具成功后把返回的新 revision 传给下一步。另一个浏览器标签、手动编辑器或其他会话先完成写入时，当前工具返回 `COURSE_CONFLICT`；Agent 不自动套用旧补丁，而是重新读取并决定是否能安全重试。

Agent 会话的运行状态不能复用 Course 的 `activeOperation`：后者当前服务的是一次大纲/场景模型生成。M12 第一版通过 `agent_runs.status=running` 限制同一 session 同时一个 run，并通过 Course revision 协调课程写入。`generate_scene` 内部继续使用现有 operation lease；`patch_stage/edit_deck` 是短事务，不登记长 operation。

### 7.2 部分成功

一次对话可能包含多个独立写工具，因此不承诺跨工具的数据库大事务。若第 1、2 页修改成功，第 3 页冲突，前两页保持已提交，工具时间线和最终回复必须明确列出部分成功。首批不实现跨页自动回滚；如后续需要，可增加 Course revision 快照与显式“恢复到某版本”，不能用内存对象假装事务回滚。

### 7.3 取消与刷新

取消通过 `AbortController` 传到 Agent adapter 和 `generate_scene`。短事务写工具开始提交后不可中断；API 应在响应中返回最终真实状态。浏览器刷新后通过 session/run GET 恢复消息和状态；第一版不承诺服务进程重启后继续正在进行的模型请求，重启时把遗留 `running` run 标记为 `interrupted`，已完成的 Course 写入仍保留。

## 8. 安全与内容质量边界

- 课程源码、用户消息和工具结果都作为不可信数据包裹，不能覆盖 system prompt 或改变工具 Schema；
- `courseId` 从 URL 与 session 归属解析，不能由模型参数切换到其他课程；
- 工具参数先过 Zod，再进入 application service；Repository 不是唯一校验边界；
- `patch_stage` 采用字段白名单和整场复验，不开放任意 JSON Patch、文件系统、网络、SQL 或脚本执行；
- interactive HTML 继续通过现有 `postProcessInteractiveHtml` / `html-policy` 边界；slide 继续通过 `SlideSchema`、normalize 和 sanitize；
- 工具日志只记录摘要、耗时、token、revision 和错误码，不记录 API Key、完整 Prompt 或不必要的课程全文；
- 对话记录可以保存并展示 Provider 明确返回的可见 reasoning，但不得把它与模型未提供的隐藏推理混为一谈；
- 模型对“已完成”的陈述必须由成功 tool result 支撑。没有工具结果时，只能说建议或计划。

质量验证分层：

| 层级 | 第一版能证明什么 | 不能证明什么 |
| --- | --- | --- |
| Zod / 字段白名单 | 数据结构与允许字段合法 | 知识事实正确 |
| HTML/CSP/净化策略 | 互动页满足结构与运行隔离要求 | 内部 Python/JS 逻辑必然正确 |
| expectedRevision / 事务 | 没有静默覆盖并完成持久化 | 修改符合用户真实意图 |
| 再次 `read_stage` | 数据库中已出现预期字段变化 | 页面视觉必然优秀 |
| 浏览器渲染检查 | 页面能渲染、关键文本可见 | 教学效果已经得到实证 |

`render_scene_preview` 可作为 M12.4 增强：由服务端浏览器渲染场景图片再供 Agent 查看。由于当前项目没有截图服务，第一版不注册一个永远失败的空工具，而是在修改完成后引导用户在主课堂区域人工查看。

## 9. 分阶段实施

### M12.0：Agent 适配器与只读问答

实现 `AgentAdapter`、工具调用解析、会话/消息/运行表、SSE 协议和右侧侧栏；只注册 `list_scenes/read_stage/grep_stage`。目标是用户能持续讨论当前课程，Agent 的答案来自按需读取，而不是把整门课预塞入 Prompt。

验收：会话刷新可恢复；切页后新消息携带新的 currentSceneId；只读问答不改变 Course revision；伪造其他 courseId 被拒绝；停止请求能结束等待且不产生写入。

### M12.1：单页最小修改

实现 `patch_stage`，先覆盖 slide 的文字/形状/线/代码元素与 interactive 的允许字段，quiz 走专用分支；接入 revision 冲突、工具卡片和结构化确认。

验收：读取 → 补丁 → 再读闭环；多 op 中任一失败整批不保存；编辑后刷新恢复；并发冲突不覆盖；quiz 未确认拒绝，确认后课程保存与旧作答清理同事务完成。

### M12.2：页序与生成

实现 `edit_deck` 的 rename/move/delete，以及 `generate_scene` 的重生成和新增页。所有关联数组保持一致、order 连续，页面 ID 与服务端字段由服务端生成。

验收：移动后 outlines/scenes/progress 顺序一致；删除确认与 quiz 清理正确；新增页失败不留下空 outline；重新生成失败保留原页；多步骤部分成功如实展示。

### M12.3：体验与论文证据收口

补全会话管理、上下文裁剪、token/工具耗时指标、错误恢复、E2E 和真实 DeepSeek 用例。选择 3 门课程，每门完成“问答不修改”“单页局部修改”“跨页搜索后修改”“调序或重生成”四类任务，保存请求、工具轨迹、revision 变化与最终页面截图。

不以模型自评作为成功判定。论文可报告任务完成率、平均工具调用数、冲突拦截率、无效工具参数率、人工意图符合率和人工视觉核对结果；其中结构通过率与人工质量评分分开统计。

### 后置增强

`duplicate_scene`、`generate_actions`、TTS、角色设定、图片/视频生成、上传素材、预览截图、版本历史/撤销、跨服务进程恢复、联网检索均后置。只有当相应领域对象和真实执行后端已经存在时才注册工具。

## 10. 测试计划

### 10.1 单元与服务测试

- Agent 协议：reasoning/text/tool-call 流式增量拼接、tool call 解析、未知工具、坏参数、turn/tool/write 预算、确认 token 过期；
- 读取投影：tree/text/source 的字段边界、分页、长 HTML 与媒体占位；
- 补丁：路径白名单、原子多 op、`str_replace` 唯一命中、元素 ID 服务端生成、最终 SceneSchema 复验；
- 页序：rename/move/delete 后三个数组的一致性与连续 order；
- Agent 循环：只回答、读后回答、读改读、工具错误后解释、冲突后重新读取、部分成功；
- 安全：消息中的伪造 system 指令、跨课程 sceneId、占位媒体写回、隐藏字段修改均被拒绝。

### 10.2 MySQL 集成测试

- 会话、消息、run 持久化与课程删除级联；
- `patch_stage/edit_deck` revision 冲突；
- quiz 修改/删除与作答清理在同一事务；
- `generate_scene` 的 operation lease 与迟到响应保护；
- 服务异常后遗留 run 的 interrupted 收口。

### 10.3 Playwright 与真实模型验收

Playwright 覆盖：打开侧栏 → 提问 → 默认收起的思考卡流式更新 → 展开后看到完整可见 reasoning → 默认收起的工具组出现 → 展开工具及其入参/结果原文 → 修改当前 slide → 主课堂刷新且仍定位该页 → 刷新浏览器恢复对话及折叠内容；删除与 quiz 修改必须出现确认卡。另测 Provider 不返回 reasoning 时不出现空思考卡，以及超长工具结果不能突破分页/大小限制。

真实模型验收至少记录：原始 revision、用户原话、模型/Prompt 版本、完整工具名称与参数摘要、每次 revision、最终 Course、页面截图和人工判断。对 code 互动场景额外执行现有静态/语义检查；不能只因 HTML/CSP 校验通过就判定代码题修复正确。

## 11. 开工顺序与文件影响

1. 先完成 M12.0 数据契约、迁移、Repository、AgentAdapter 与 Mock 测试，再做 UI；
2. 侧栏先接只读工具，确认会话/SSE/取消链路稳定；
3. 抽取 M10 修订与未来 MX 编辑器都可复用的场景校验和保存函数，再接 `patch_stage`，避免 Agent 另建旁路；
4. 最后增加 deck 与生成工具，因为它们会同时改动多个 Course 子结构；
5. 每个子阶段独立提交并执行 `pnpm lint`、`pnpm test`、`pnpm test:db`、`pnpm build`；阶段完成再运行 `pnpm test:e2e` 与 `pnpm verify:full`。

预计主要影响：`components/course/classroom-runtime.tsx` 拆出侧栏入口与课程刷新协调；新增 `components/agent/`；新增 `lib/agent/`；扩展 `lib/ai/contracts.ts` 但保留现有 `AIAdapter`；新增 application service 和 agent repository；新增 005 起的幂等迁移；复用而不是绕过 `SceneGenerationService`、`QuizEditingService`、`CourseRepository.save()`、scene/slide/interactive 校验链。

## 12. 明确不做与决策检查点

M12 第一版明确不做多 Agent 课堂讨论、不做 LangGraph、不让 Agent 操作文件系统或数据库、不做任意代码执行、不把完整 Course 每轮传给模型、不让多个写工具并行、不实现跨工具自动回滚，也不把 OpenMAIC 的平台级 Session Worker 当作毕业设计前置。

开工前只需再确认三项产品决策：

1. 第一版是否允许删除页面；建议保留但强制确认，它能完整验证 `edit_deck`，同时风险可控；
2. 真实模型是否支持标准 OpenAI-compatible tool calls；若当前 DeepSeek 接口不支持，则 M12.0 开工时先做一次最小 capability spike。不得用“让模型输出一段自定义 JSON 文本”长期冒充可靠工具调用协议。

## 13. 与 OpenMAIC 的复用边界

直接借鉴的设计包括：`read_stage` 的 tree/text/source 投影、`grep_stage` 的有界搜索、`patch_stage` 的读后最小原子修改、写工具串行化、工具可用性与 system prompt 一致、修改后再次读取、工具执行过程可见。

不直接复制的部分包括：OpenMAIC 的持久后台 session worker、owner/lease/wakeup 体系、多 Agent 调度、Skills、媒体与语音工具、素材库、PostgreSQL document store。教学平台继续以 MySQL Course 聚合、Next.js Route、现有 AI Provider 配置和单 Agent 为主干。这样既保留 OpenMAIC 已验证的工具化编辑思想，也把实现规模控制在可开发、可测试、可作为论文工程章节说明的范围内。
