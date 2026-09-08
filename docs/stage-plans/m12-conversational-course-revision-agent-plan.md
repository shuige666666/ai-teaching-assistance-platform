# 12. M12 对话式课程修订 Agent 开发方案

> 文档版本：0.4（2026-09-08，补充真实修订问题回归）
> 状态：M12.0 只读对话与 M12.1 单页最小修改已实现；M12.2/M12.3 待开发
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

### 1.1 当前实现结果（2026-09-08）

M12.0/M12.1 已进入正式调用链：新增独立 AgentAdapter 流式协议、标准 tool calls、MySQL session/message/run/confirmation 四类记录、`list_scenes/read_stage/grep_stage/patch_stage` 四个真实工具，以及课堂右侧持久对话侧栏。Provider 明确返回的 `reasoning_content` 才显示为思考卡；思考、工具组和工具入参/结果均使用默认收起的原生 details。课堂页“对话”和“修订本场”已收口到同一侧栏，写入后按稳定 sceneId 重新读取 Course。

`patch_stage` 已覆盖 slide、interactive、quiz 的 `/content` 与 `/actions` 通用原子补丁，支持五种 operation；候选页一次性通过 SceneSchema/CourseSchema 后再保存。quiz 题目实际变化会冻结候选页并等待结构化确认，确认后保持 Scene ID，以现有 Repository 事务同时保存题目/actions 并清理旧作答。图表 values/labels 与表格 rows/colWidths 只增加基本结构一致性，不增加视觉评分或教学质量门禁。

当前尚未注册 `edit_deck`、`generate_scene`、页面删除/调序/新增、整页重生成与视觉预览工具；这些仍属于 M12.2。真实 DeepSeek 只读冒烟使用合成空课程验证了 reasoning 流、标准 `list_scenes` 调用、第二轮回答和 revision 不变；真实模型写入任务仍留给后续固定课程验收，不以本次只读结果替代。

首次真实 slide 修订发现：模型完成 `list_scenes/read_stage` 后，第二轮约 1.5 万字符的可见思考耗尽原 4,096 单轮输出预算，尚未形成正文或 `patch_stage` 即以失败结束；前端当时又未展示 `run_finished.error`，用户侧表现为停在思考卡。现将 Agent 单轮总输出预算提高到 16,384，思考不设独立 token 上限，并在 Prompt 中只要求目标明确后尽快调用最小工具。侧栏进行中耗时每 0.1 秒更新；自动跟随仅在用户位于消息底部时生效，向上滚动后不再抢占滚动位置；失败结束事件会显示真实错误。

侧栏关闭只改变可见性，不取消当前 Agent Run。课堂组件始终保留 Agent Drawer 实例，关闭后仍继续消费 SSE；只有用户明确点击“停止”才中止请求。重新打开侧栏会继续显示同一 Session 中已经收到的流式块或完成后从数据库恢复的消息，目标场景仍以发送消息时记录的 `currentSceneId` 为准。

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
| 用户明确要求跨页修改 | 不因页数单独确认 | 逐页提交；其中 quiz 内容变更、删除页仍按各自规则确认 |
| 用户只是在提问、目标含糊 | 不执行 | Agent 先回答或追问，不推断写入授权 |

确认不能只存在于自然语言中。Agent 返回结构化 `confirmation_required` 事件，服务端保存待确认的工具参数和目标 revision；用户点击确认时只提交 confirmationId。若 Course revision 已变化，则本次确认作废并重新读取。

## 4. 工具集设计

### 4.1 第一批必须工具

工具名沿用 OpenMAIC，界面名称使用中文。参数全部包含服务端绑定的 `courseId`，模型不可改写课程归属；写工具还必须携带工具开始前读取到的 `expectedRevision`。

| 界面名称 | 内部工具 | 第一版职责 | 实现落点 |
| --- | --- | --- | --- |
| 检查当前课堂 | `list_scenes` | 返回 revision，以及页面的稳定 id、order、title、type、状态 | `CourseAgentQueryService.listScenes()` |
| 读取课堂 | `read_stage` | 读取课程摘要、大纲、指定场景的 tree/text/source 投影 | `CourseAgentQueryService.readStage()` |
| 搜索课堂 | `grep_stage` | 在可见文本中做大小写不敏感的字面量搜索，返回命中页和短片段 | `CourseAgentQueryService.grepStage()` |
| 编辑课堂 | `patch_stage` | 对一个场景执行原子化有限补丁，整场复验后保存 | `CoursePatchService.patchScene()` |
| 调整页序 | `edit_deck` | 修改标题、删除、移动页面；同步大纲和页序，新增页交给 generate_scene | `CourseDeckService.editDeck()` |
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

### 4.3 `patch_stage` 的通用原子补丁协议

参考 OpenMAIC，`patch_stage` 不为文本、图表、表格、主题、quiz 和 actions 分别设计工具，而是对一个场景提供少量通用操作。模型以刚刚由 `read_stage(detail: "source")` 返回的场景结构作为寻址依据，所有操作先作用于内存副本，最终结构通过校验后一次保存：

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
}
```

`set/remove/str_replace` 的路径统一从场景根开始，只允许 `/content/...`、`/actions` 或 `/actions/...`。因此图表数据、表格单元格、slide theme、合法 SVG path、interactive HTML/config、quiz 题目和整组 actions 都可以按照真实 source 路径修改，不再维护逐类型字段白名单。场景标题和页序等页面元数据仍交给 `edit_deck`。

必要保护下沉到工具实现：JSON Pointer 中间路径必须存在；元素已有 ID 和 type 不能通过通用操作改写，新增、删除使用专用 op；互动运行时契约保持服务端所有。完整候选场景放回 Course 后，通过 SceneSchema、CourseSchema、净化与 HTML policy 再保存。quiz 的 questions 实际变化时复用抽取后的题目转换逻辑，并进入确认与旧作答清理流程，不直接调用现有 QuizEditingService.edit() 保存通用补丁。

处理顺序固定为：加载 Course → 校验 revision 和 sceneId → 在克隆场景上顺序应用所有 op → 校验身份字段和最终场景结构 → 必要时处理 quiz 确认与作答清理 → `CourseRepository.save()` 一次提交。任一 op 失败则整批不保存。本项目仍不接受模型返回 TypeScript 函数、SQL、文件操作或可执行补丁脚本。

常驻 Prompt 只描述工具选择、最小修改和结果核验。工具 Schema 解释五种 op；read_stage(source) 提供实际字段及下标，并按场景类型附带简短 structureGuide，说明必要约束。当前页没有的元素类型，可通过 read_stage 的可选 schemaFor 参数获取该类型的字段、枚举和合法示例。说明从本项目 Schema 与精简示例维护，不照搬 OpenMAIC 字段名；首版无需建设 Skills 系统。

下面是 M12.1 的 Prompt 示例；system-prompt 按工具注册表组装，只描述实际可用能力。M12.0 仅描述只读工具；M12.2 才追加 edit_deck 的 rename/move/delete 与 generate_scene 的新增/重生成说明。

```text
Before editing, read the target scene with read_stage detail="source".
Use patch_stage only for one scene and address /content/... or /actions/....
Prefer the smallest set/remove/str_replace operation that satisfies the request.
Use add_element/delete_element when slide element identity changes.
Scene metadata such as page titles is outside patch_stage; describe this limit if asked.
After a successful write, verify the saved result and report only confirmed changes.
```

### 4.4 `edit_deck` 与 `generate_scene`

`edit_deck` 第一版只支持 `rename`、`move`、`delete` 三种动作，并只对 `ready` 课程开放结构修改。页面移动按稳定 `sceneId` 指定目标位置，服务端同步重排 `scenes`、`outlines` 与 `sceneProgress`，保证 order 从 1 连续递增。删除页时同步减少 `requestedSceneCount`，且结果必须仍满足当前 CourseSchema 的 4～8 页、1～2 个非首页 quiz、至少 2 个 slide、互动数量与相邻关系等课程级约束；若删除 quiz，在同一事务清理作答。

新增页由 `generate_scene` 负责，而不是先插入一个无效空 Scene。新增只对 `ready` 且少于 8 页的课程开放；它接收目标位置、页面标题/目标/type 与用户编辑指令，先构造合法 `SceneOutline`，再复用现有场景生成、校验和装配链；成功时一次性把 outline、scene、progress 插入 Course，并同步增加 `requestedSceneCount`。重新生成已有页可用于 `ready/partial_failed` 中已有的 ready 场景，继续复用 M10 的“旧内容成功前不被替换”语义。任何新增或删除都必须在提交前通过完整 CourseSchema，而不是只校验目标页面。

`generate_scene` 不等同于 `patch_stage`：可用局部补丁完成时优先补丁；只有布局或内容需要整体重构、用户明确要求重做、或目标页尚不存在时才生成。

### 4.5 标准执行策略

系统 Prompt 明确要求 Agent 遵守：

```text
明确目标页
  → read_stage(detail="source") 获取补丁依据；纯问答可用 text
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
└─ sessions/[sessionId]/confirm/route.ts   # M12.1 POST 确认高影响工具

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

服务端循环为：调用模型 → 校验并顺序执行工具 → 追加对应 tool result → 继续调用模型，直到最终回答、等待确认、失败或预算耗尽。预算集中配置：M12.0 可从 8 次模型 turn、12 次工具调用、120 秒起步；M12.1 跨页修订可从 20 次 turn、32 次工具调用、300 秒起步，按真实耗时调整，不另设固定 4 次写入上限。M12.2 沿用现有生成超时，并给总预算留出足够时间。预算耗尽时停止启动新步骤，如实报告已提交和未执行步骤，不重试已经成功的写入。

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
  | { type: "run_finished"; status: "completed" | "failed" | "cancelled" | "waiting_confirmation" | "interrupted"; finalMessageId?: string }
  | { type: "error"; code: string; message: string; requestId: string };
```

前端把 thinking 事件写入默认收起的思考卡，把相同 `groupId` 的工具聚合成可折叠工具组。`arguments/result` 必须是经过服务端展示净化和大小限制后的实际工具数据；不能把数据库连接信息、异常堆栈或 Provider 响应信封直接透传。前端接到 `course_updated` 后 GET 最新课程，按稳定 sceneId 保持当前位置；该页被删除时跳到删除位置附近的页面。

## 6. 数据与持久化

对话不塞进 `courses.scenes_json`，否则每条聊天消息都会增加 Course revision，并与课堂内容并发冲突。新增独立表：

```text
agent_sessions
  id, course_id, status, title,
  created_at, updated_at

agent_messages
  id, session_id, run_id, sequence_no, role,
  content_json, created_at

agent_runs
  id, session_id, status, base_course_revision,
  final_course_revision, error_json,
  started_at, deadline_at, finished_at

agent_confirmations                  # M12.1 增加
  id, session_id, run_id, call_id, tool_name, target_revision,
  payload_json, status, expires_at, created_at, completed_at
```

`content_json` 保存规范化消息块及工具协议字段：modelTurnId、callId、工具名称、有效参数、实际返回模型的有界结果、顺序和状态，以及用户可见正文和 Provider 公开返回的 reasoning。前端由这些块生成折叠卡片，不能把 UI 进一步截断的文案作为模型历史。API Key、system Prompt、堆栈及 Provider 原始响应信封不落库。agent_messages.run_id 和 confirmation 的 run_id/call_id 定位原工具卡。课程删除时相关表级联清理；confirmation.payload_json 仅供服务端执行，界面返回影响摘要和状态。

Course 始终是课程内容真源。历史消息里出现的“第 2 页”只是当时记录；恢复会话后，Agent 必须重新 `list_scenes/read_stage`，不能把旧工具结果当作当前数据。每个工具结果记录执行前后 revision，形成可审计修改轨迹。

context-builder 将规范化块转换为合法 assistant/tool 消息，保证每个 tool result 对应已有 tool_call_id，并保留同一模型 turn 的顺序。历史按完整用户轮次裁剪，再应用可配置总字符或 token 预算，不从工具调用链中间截断。中断或确认导致未闭合的调用，用真实的“未执行/等待确认/中断”结果闭合；无法完整恢复的旧轮次只以明确状态摘要进入上下文。Provider 续接所需协议字段按适配器契约处理。M12.0 实现基本历史转换，语义摘要和向量检索后置。

## 7. 并发、一致性与失败语义

### 7.1 revision 与写入串行化

每个写工具都从数据库重新读取 Course，并校验 `expectedRevision`。同一 run 内工具串行执行，前一个工具成功后把返回的新 revision 传给下一步。另一个浏览器标签、手动编辑器或其他会话先完成写入时，当前工具返回 `COURSE_CONFLICT`；Agent 不自动套用旧补丁，而是重新读取并决定是否能安全重试。

Agent 运行状态不复用 Course.activeOperation。新请求在短事务中锁定 session 行，检查未超时 running run，再创建记录；前端禁用按钮不能代替互斥。正常结束、失败和取消通过 finally 收口；新请求发现超过 deadline_at 的遗留 running 记录时标记 interrupted 后允许开始。运行请求使用同一 deadline 的 AbortSignal，并在启动工具和提交前检查取消/超时；等待确认不占运行槽。无需 Worker 或自动续跑。generate_scene 保留 operation lease；patch_stage/edit_deck 提交前拒绝已有 activeOperation 的课程。

### 7.2 部分成功

一次对话可能包含多个独立写工具，因此不承诺跨工具的数据库大事务。若第 1、2 页修改成功，第 3 页冲突，前两页保持已提交，工具时间线和最终回复必须明确列出部分成功。首批不实现跨页自动回滚；如后续需要，可增加 Course revision 快照与显式“恢复到某版本”，不能用内存对象假装事务回滚。

### 7.3 取消与刷新

取消通过 AbortController 传到 Agent adapter 和 generate_scene。已经进入提交的短事务允许完成，结果落库后收尾，已提交修改不回滚。SSE 断开后不再承诺向原连接返回最终状态，前端通过会话 GET 和课程 GET 恢复，若仍在收尾可短暂重查。完整消息块结束时保存，允许丢失未完成的流式内容。进程重启不续跑模型请求；遗留运行按 7.1 的 deadline 规则收口。

## 8. 安全与内容质量边界

- 课程源码、用户消息和工具结果都作为不可信数据包裹，不能覆盖 system prompt 或改变工具 Schema；
- `courseId` 从 URL 与 session 归属解析，不能由模型参数切换到其他课程；
- 工具参数先过 Zod，再进入 application service；Repository 不是唯一校验边界；
- `patch_stage` 只开放场景内 `/content` 与 `/actions` 的受限 JSON Pointer，并执行身份保护和整场复验；不开放课程根、文件系统、网络、SQL 或脚本执行；
- interactive HTML 继续通过 postProcessInteractiveHtml / html-policy；slide 使用编辑用 Schema 和文本净化，不复用会改写样式或重新生成已有 ID 的生成归一化流程；
- 工具日志只记录摘要、耗时、token、revision 和错误码，不记录 API Key、完整 Prompt 或不必要的课程全文；
- 对话记录可以保存并展示 Provider 明确返回的可见 reasoning，但不得把它与模型未提供的隐藏推理混为一谈；
- 模型对“已完成”的陈述必须由成功 tool result 支撑。没有工具结果时，只能说建议或计划。

质量验证分层：

| 层级 | 第一版能证明什么 | 不能证明什么 |
| --- | --- | --- |
| Zod / 路径边界 / SceneSchema + CourseSchema | 参数、修改范围和场景/课程结构合法 | 知识事实正确 |
| HTML/CSP/净化策略 | 互动页满足结构与运行隔离要求 | 内部 Python/JS 逻辑必然正确 |
| expectedRevision / 事务 | 没有静默覆盖并完成持久化 | 修改符合用户真实意图 |
| 再次 `read_stage` | 数据库中已出现预期字段变化 | 页面视觉必然优秀 |
| 浏览器渲染检查 | 页面能渲染、关键文本可见 | 教学效果已经得到实证 |

`render_scene_preview` 可作为 M12.4 增强：由服务端浏览器渲染场景图片再供 Agent 查看。由于当前项目没有截图服务，第一版不注册一个永远失败的空工具，而是在修改完成后引导用户在主课堂区域人工查看。

## 9. 分阶段实施

### M12.0：Agent 适配器与只读问答（已实现）

M12.0 的目标是先打通“课程内持续对话 + 模型按需读取课堂 + 思考和工具过程可追踪”的完整纵向链路，但不赋予模型任何课程写权限。这里的“只读”仅指 Course 聚合不发生变化；会话、消息和运行记录仍需写入独立的 Agent 表。

#### M12.0-A：真实模型能力探针

在正式实现 Provider 解析器前，用当前 DeepSeek/OpenAI-compatible 配置做一次最小探针：向 `/chat/completions` 发送 `stream: true` 和一个无副作用测试工具，分别观察普通回答与工具调用响应。探针只用于确认 `tool_calls`、参数分片、可见 reasoning 字段和结束事件的实际格式，不需要建设独立的兼容性框架。

实现只展示 Provider 明确返回的 reasoning；Provider 不返回时不显示空的“思考”卡。如果当前模型的标准工具调用暂时不可用，先用 Mock 完成接口、侧栏和工具循环，再单独处理 Provider 兼容问题；不使用“让模型在正文中输出 JSON”作为正式工具协议。

探针产出只需是一段开发记录和一份固定下来的 `AgentModelEvent` 示例。它不修改现有 `AIAdapter.generateText()`，大纲和场景生成链继续保持原行为。

#### M12.0-B：Agent 模型适配层

在 `lib/agent/contracts.ts` 定义模型消息、工具 Schema 与流式事件，在 `lib/ai/` 新增独立的 `AgentAdapter`、`OpenAICompatibleAgentAdapter` 和 `MockAgentAdapter`。不要把现有 `AIAdapter` 改成兼容所有用途的大接口；两个适配器可以复用 Provider 配置、鉴权头、错误归类和 usage 结构，但调用入口保持隔离。

适配器对上层只暴露归一化事件：可见 reasoning 增量、正文增量、工具调用参数增量、usage 和完成原因。参数拼接、同一响应中的多个 tool call、用户取消和 Provider 错误在适配层处理；上层不读取 Provider 原始 SSE 字段。Mock 适配器优先覆盖“直接回答”“思考后回答”“调用一个工具”“参数分片”“报错”和“收到 abort”这些真实主路径。

M12.0 不为兼容单个 Provider 把 reasoning 伪装成正文，也不持久化原始响应信封。若模型只给正文，时间线上只出现正文；若给 reasoning，前端才创建默认收起的思考块。

#### M12.0-C：会话数据与 Repository

新增幂等迁移，建立 `agent_sessions`、`agent_messages`、`agent_runs` 三张表。建议约束如下：

| 表 | 首批关键字段与约束 | 用途 |
| --- | --- | --- |
| `agent_sessions` | `id`、`course_id`、`status`、`title`、时间戳；按 `course_id, updated_at` 建索引 | 会话归属与列表 |
| `agent_messages` | `id`、`session_id`、`sequence_no`、`role`、`content_json`、时间戳；`session_id + sequence_no` 唯一 | 按顺序恢复用户、助手、思考、工具卡和确认卡 |
| `agent_runs` | `id`、`session_id`、`status`、起止 revision、`error_json`、起止时间 | 运行状态和基本审计 |

`AgentSessionRepository` 只处理 Agent 数据，不承担 Course 修改。创建会话时校验 Course 存在；读取和追加消息时校验 `session.course_id === URL courseId`。课程删除依赖外键级联清理三张表。M12.0 的界面默认恢复最近一个会话，并提供“新建对话”；会话数量清理策略和完整会话管理留到 M12.3。

用户消息在模型调用前持久化。助手本轮使用一个 `content_json` 块数组，reasoning、tool call、tool result 和 text 是有稳定 `blockId/callId` 的可见块。首版只在一个思考块、工具调用或正文块结束时保存，不做按秒检查点；浏览器刷新时允许丢失尚未完成的少量流式内容，已经完成的块仍可恢复，原模型请求不继续执行。

`content_json` 保存实际返回模型的有界结果及工具协议字段，UI 可进一步折叠或截断。M12.0 按第 6 节实现完整轮次裁剪和总上下文预算，不直接截取最近 N 条数据库消息，不引入自动语义摘要。

#### M12.0-D：三个只读课程工具

`CourseAgentQueryService` 通过现有 CourseRepository.get() 读取真源；courseId 由 URL/session 在服务端绑定，不出现在模型工具 Schema。返回 courseRevision 和稳定 sceneId。read_stage(source) 附带当前类型的 structureGuide，可选 schemaFor 获取当前页不存在的元素类型定义及示例。

`list_scenes` 返回课程标题、revision，以及按 order 排列的 `sceneId/outlineId/order/title/type/status` 和紧凑统计。它只回答课程结构，不声称内容正确。

`read_stage` 支持 `tree/text/source`：`tree` 返回紧凑结构；`text` 返回标题、摘要、可见文本和对应稳定路径；`source` 一次只允许读取一个场景的可编辑投影。互动页的 source 返回去掉平台注入运行时代码后的 author HTML，避免未来补丁重复注入；长 source 使用 `cursor/nextCursor` 分页。工具拒绝其他课程的 sceneId、非法路径和越界 cursor。

`grep_stage` 对课程内可见文本做大小写不敏感的字面量搜索，首版不开放正则。结果设置简单的数量和片段长度上限，携带 sceneId、order、字段路径和短片段。搜索对象覆盖标题、summary、slide 文本/代码、quiz 题干与选项、interactive fallback/可见文本、旁白文本，不搜索内部 ID 和注入脚本。

三个工具统一返回 `{ ok, summary, data, courseRevision, truncated? }`。首版错误只区分参数错误、目标不存在和工具执行失败，给模型的结果不包含数据库异常栈。

#### M12.0-E：只读 Agent 循环与 API

`POST /api/courses/{courseId}/agent/sessions/{sessionId}/messages` 接收用户文本、`currentSceneId` 和前端看到的 `courseRevision`，响应 `text/event-stream`。服务端校验 course/session/currentSceneId 归属；前端在运行期间禁用重复发送，首版不额外建设跨请求幂等机制。

`CourseAgentService` 的顺序固定为：保存用户消息 → 建立 Course 锚点和有限历史 → 调用模型 → 校验并串行执行只读工具 → 把结构化结果追加到模型上下文 → 继续调用模型 → 得到最终正文或终止。system prompt 明确区分“讨论、建议”和“已经修改”；M12.0 工具注册表中不存在写工具，因此模型即使生成 `patch_stage` 也只会得到 `UNKNOWN_TOOL`，不能旁路调用 application service。

运行预算统一使用 5.2 的配置，不在 Route、UI 和适配器重复写死。M12.0 只注册读取工具，同会话互斥、deadline 和收尾按 7.1 实现。

SSE 在连接建立后发送 `run_started`，随后发送 thinking、tool、text 和结束事件。客户端点击停止或离开页面时由 `AbortController` 中止当前 HTTP 请求，信号继续传给 AgentAdapter。M12.0 不新增独立 cancel API；将来若引入后台 worker，再考虑跨请求取消和心跳机制。

GET /sessions 列出会话，POST /sessions 新建或复用会话，GET /sessions/{sessionId} 返回消息块、最近 run、待确认状态和当前 Course revision。M12.0 包含正常收尾与超时遗留运行解除阻塞，跨进程继续执行仍后置。

#### M12.0-F：课堂侧栏与流式时间线

新增 `components/agent/`，至少拆为侧栏容器、消息时间线、思考块、工具组/工具卡、输入框和 SSE 状态 reducer。桌面端从课堂右侧打开抽屉，小屏使用覆盖式全宽面板；关闭侧栏不清空会话。M12.0 先新增“对话”入口，保留现有一次性“修订本场”弹窗，等 M12.1 写工具稳定后再把修订入口并入侧栏。

思考块在收到首个 reasoning delta 时出现，标题显示“思考中”或“已思考 Xs”，正文边流式追加边保持默认收起；用户展开后才展示完整内容。工具调用按同一模型 turn 聚合成“X 个工具调用”，默认收起；展开组后列出各工具，继续展开单项才显示格式化入参和结果原文。失败、截断和耗时在卡片摘要中直接可见，不以绿色完成态掩盖错误。

发送消息时捕获当下 `currentSceneId`，用户随后切页不改变已经运行请求的锚点；下一条消息再携带新页面。客户端 reducer 只消费归一化 SSE 事件，不推断工具是否成功。刷新后从 `content_json` 重建相同块结构和折叠状态默认值；折叠状态本身只保存在前端，不写数据库。

#### M12.0-G：测试与完成门槛

单元测试覆盖流式分片归一化、tool arguments 拼接、无 reasoning、工具调用、预算和 abort；查询服务覆盖三种读取投影、分页、搜索限额和跨课程拒绝；Agent 循环覆盖直接回答、读后回答、未知写工具和工具失败后解释。

MySQL 集成测试覆盖三表读写、消息顺序、删除级联、同 session 互斥、失败收尾和超时运行不阻塞新消息。Mock/E2E 覆盖两轮工具对话、刷新恢复、完整轮次裁剪、折叠详情、切页锚点、取消后 GET 恢复；M12.1 增加确认/取消更新原卡、同批剩余工具未执行用例。另做一条真实模型只读冒烟。

M12.0 的完成标准是：典型真实模型用例能调用至少一个只读工具；无 reasoning 时界面不伪造思考；只读运行前后 Course revision 不变；刷新能恢复已经完成并持久化的对话块；跨课程访问被拒绝；相关 lint、单元测试、数据库测试、构建和 E2E 通过。

### M12.1：单页最小修改（已实现）

M12.1 在 M12.0 的可审计只读循环上只增加一个写工具 `patch_stage`，目标是完成“读取目标单页 → 原子化最小修改 → 保存 → 再次读取确认”的闭环。它不处理页面新增、删除、移动或整页重新生成，这些仍属于 M12.2。

#### M12.1-A：写入协议与前置条件

`patch_stage` 对 slide、interactive 和 quiz 使用同一组 `operations`。服务端绑定 courseId，目标按稳定 `sceneId` 指定；模型先调用 `read_stage(detail: "source")` 获取真实结构、字段路径、数组下标和当前 revision，再把它作为 `expectedRevision` 提交。常驻 Prompt 不列出每种元素的字段清单。

首版不维护额外的 read receipt 状态机。写工具只需重新读取 Course 并校验 `expectedRevision`；revision 已变化时返回 `COURSE_CONFLICT`，让 Agent 重新读取后再决定是否重试。一次 `operations` 设置一个简单数量上限，按数组顺序作用于内存副本；任一项失败则全部不保存。

操作语义固定如下：`str_replace` 修改指定字符串字段，默认要求 `oldText` 恰好命中一次；`set` 可以替换现有叶子、对象或数组，`remove` 可以删除已有字段或数组项；`add_element` 接收不带 ID 的完整合法元素并由服务端生成元素及内部行 ID；`delete_element` 按元素 ID 删除。所有通用路径只能位于 `/content` 或 `/actions`，先经过受限 JSON Pointer 解析，再作用于场景副本。

`set` 替换整个元素数组时可以同时修改普通内容和样式，但已有元素的 ID/type 集合必须保持一致；新增、删除元素仍使用专用 op。actions 数组允许整体重写：已有 action ID 应保留，新 action 未提供 ID 时由服务端生成。`content.type`、元素 type、互动运行时契约等判别和身份字段由服务端比较前后值，不能借通用路径改变对象种类。

#### M12.1-B：统一编辑范围

M12.1 不再人为区分“基础字段”和“以后开放字段”。只要字段位于当前场景的 `/content` 或 `/actions`、修改后符合现有领域 Schema，并且不改变受保护身份，就属于 `patch_stage` 的可编辑范围。

slide 因而可以修改文本、形状、线条、代码、图表数据、表格单元格、背景、theme、合法 SVG path、位置尺寸、层叠顺序以及其他 Schema 已支持的元素字段。小范围修改优先定位叶子；重排可以替换完整 elements 数组，但添加和删除元素走专用 op，避免模型自行制造身份。

interactive 可以修改 author HTML、fallback 以及当前 content Schema 中的配置字段。`read_stage(source)` 返回经 `extractInteractiveAuthorHtml()` 提取的作者源码；补丁完成后再调用现有 `postProcessInteractiveHtml()` 和 HTML policy，保证 CSP、桥接脚本和运行时只注入一次。结构校验通过仍不等于页面脚本或教学逻辑正确，验收中继续保留人工运行检查。

quiz 同样使用 /content/questions/... 的 operations。已有题目保留当前引用；新增题目/选项在输入中使用本批唯一临时 ID（如 new-q1/new-o1），correctOptionIds 引用同批临时 ID，以便验证答案引用。服务端把合法问题集合映射成 options 标签与 correctOptionIndexes，再用共享函数生成最终题目/选项 ID；临时 ID 不落库。数量和引用规则写入 structureGuide。仅 questions 实际变化才执行该转换、确认和作答清理；只修改 quiz 的 actions 保留题目身份及作答。

actions 可以修改单条旁白、暂停和播放动作，也可以插入、删除、重排或整体替换数组。旁白文本发生变化时，当前项目尚无 TTS 资产，因此无需照搬 OpenMAIC 的 `generate_tts` 后续步骤；未来引入音频后再增加相应失效与重生成规则。

#### M12.1-C：`CoursePatchService` 保存链

CoursePatchService.patchScene() 负责统一保存：读取 Course → 检查 ready/partial_failed、目标 ready 场景、无 activeOperation 和 expectedRevision → 克隆并顺序应用 operations → 补齐新增元素/action ID、转换变化的 quiz 问题 → 身份校验、净化和 HTML policy → 组装完整候选 Course 并验证 CourseSchema → 必要时等待确认 → CourseRepository.save() 一次提交。保存保持 sceneId、outlineId、createdAt，更新 updatedAt；题目与 actions 同时修改时全部进入同一提交。

补丁不得调用用于模型生成结果的宽松修复逻辑来“猜测”模型意图。已有元素 ID 必须保留；新增元素 ID 只能由服务端产生；净化导致文本变化时在 tool result 中明确返回 warning。Repository 保存失败或最终 Schema 失败时不留下部分场景。

现有 QuizEditingService.edit() 会更换 Scene ID，且仅接收 questions、从 oldScene 继承 actions，不能作为通用补丁的最终保存入口。应抽取无数据库写入的题目校验/ID 重建函数供两个 service 共用；原人工入口可保持原行为，Agent 由 CoursePatchService 保存整个候选场景，按需传 clearQuizAttemptsForSceneId。Repository 已支持课程更新和作答清理同事务，不新增独立 SQL，也不先存题目再存 actions。

CourseSchema 必须在确认卡产生前验证，覆盖 action ID 唯一、至少一个 speech、quiz/interactive 末尾 learner pause 等现有规则。通用数组编辑还需在共享 Schema 补充：每个图表系列 values 长度等于 labels 长度；表格每行单元格数等于 colWidths 长度。这是基本结构一致性，不增加教学质量或视觉评分门禁。

成功结果返回 `beforeRevision/afterRevision/affectedSceneIds/changeSummary/warnings`，不把整页源码再次塞入工具卡。首版错误收敛为 `INVALID_ARGUMENT`、`COURSE_CONFLICT`、`CONFIRMATION_REQUIRED` 和 `TOOL_EXECUTION_FAILED` 四类，具体原因放在安全的错误消息中，不预先建设大量细粒度错误码。

#### M12.1-D：测验确认与恢复执行

服务端比较修改前后 questions，实际变化时才确认，不能仅凭 op.path 判断。冻结经转换、净化和完整 CourseSchema 验证后的目标场景及 base revision，记录 confirmationId、runId、callId 和影响摘要。首次调用返回 waiting_confirmation，停止同批后续工具并记录 not_executed，说明尚未完成的步骤；原 SSE 以 waiting_confirmation 结束，不占住模型请求等待用户点击。

POST /sessions/{sessionId}/confirm 接收 confirmationId、decision（confirm/cancel），返回普通 JSON：确认状态、原 runId/callId、工具结果、最新 revision 和 affectedSceneIds。确认时读取冻结场景，再检查当前 revision、课程运行状态与 CourseSchema，执行统一保存链。pending/completed/cancelled/expired 足够；并发确认由 expectedRevision 阻止第二次保存，已完成确认再次读取返回原结果。失败不显示 completed；版本冲突要求重新读取。取消只更新记录。

前端将结果更新到原确认卡/工具卡，刷新课程，并显示持久化的服务端完成、失败或取消说明。原 run 随该待确认工具收尾，剩余步骤仍标记未执行。首版不自动调用模型恢复余下计划；用户下一条消息继续，context-builder 使用更新后的实际结果重建历史。

普通 slide/interactive 单页补丁不弹确认，但工具卡在执行前必须出现真实入参，执行后展示成功、失败、revision 和 warnings。M12.1 仍以单页工具闭环为验收重点；同一对话可以逐页执行多个 `patch_stage`，每次都使用上一步返回的新 revision。跨页工具的原子事务不在本阶段实现。

#### M12.1-E：保存结果与按需核验

system prompt 鼓励读后修改与结果核验，不强制模型再次调用工具才能结束。patch_stage 以 CourseRepository.save() 返回的实际持久化版本及场景摘要为依据，返回 changedPaths、beforeRevision、afterRevision；不固定额外执行一次仅检查“revision 增长且页面存在”的弱核验。需要验证具体字段或残留文案时，模型再调用 read_stage/grep_stage。

保存与后续核验分开报告：save 成功证明候选场景已通过校验并保存；再次读取并核对目标字段才构成字段核验。后续读取失败不回滚保存，不把已保存步骤显示为失败。结构与字段核验不等于视觉、事实或互动脚本语义正确。

#### M12.1-F：前端课程刷新与入口收口

M12.1 完成后，课堂中的“对话”和“修订本场”都打开同一个 Agent 侧栏；修订入口自动带入当前 sceneId 和一条可编辑的上下文提示，但不自动发送。原有一次性修订弹窗暂时保留在代码中作为回退直到 M12.1 验收结束，验收通过后再删除其入口；不在同一个提交里同时删除旧链和新增新链。

前端收到 `course_updated` 后重新 GET Course，以稳定 sceneId 恢复当前页，并同步新的 revision。播放器在换入新场景数据前停止当前 action，避免继续播放旧旁白；目标页仍存在时保持该页，异常情况下才回到可用页。局部刷新失败时工具卡仍显示后端已经提交的 revision，并提供“重新加载课堂”，不能把 UI 刷新失败表述成保存失败。

工具卡默认只显示“编辑课堂、目标页、耗时、成功/失败”；展开后显示实际 operations 和经过限制的 tool result。课程冲突显示为可理解的“课堂已被其他操作更新”，并让 Agent 重新读取后重新规划，不在浏览器端偷偷替换 expectedRevision 重试。

#### M12.1-G：测试矩阵

补丁单元测试覆盖五种操作、`/content` 与 `/actions` 根路径边界、JSON Pointer 数组寻址、受保护身份拒绝、`str_replace` 零/多次命中、元素/action ID 保留与新增、操作中途失败原子性和文本净化 warning。slide 用例覆盖图表、表格、theme、SVG path 和 elements 重排；interactive 覆盖 author HTML 提取、补丁后单次运行时注入和策略失败；quiz 覆盖局部修改、完整数组替换、确认拒绝和 ID 重建。

服务测试覆盖 revision 冲突、保存摘要、后续读取失败不掩盖已保存结果、写工具串行与预算。MySQL 测试证明多 op 一次 revision 增长、失败时 revision 不变、并发补丁不覆盖；重点测试同批 quiz questions + actions 都被保存、Scene ID 不变、仅 actions 不清理作答、题目修改与作答清理同事务。

Playwright 使用 Mock provider 完成三条主链：修改 slide 文本并在课堂即时看到结果；修改 interactive author HTML 并能重新渲染；修改 quiz 时先出现确认卡，确认后旧作答消失。另覆盖工具卡两级展开、刷新恢复工具详情、课程冲突、前端课程刷新失败以及 Provider 无 reasoning 的写入流程。

真实模型验收至少准备一门固定课程和多种结构任务，例如修改文本、图表数据、表格单元格、主题、actions、quiz 和互动页按钮文案。每条保存用户原话、工具轨迹、前后 revision、结构 diff 和最终截图；人工分别判断意图符合、视觉可用和互动语义，不以工具返回 `ok` 代替质量结论。

#### M12.1-H：完成门槛与明确后置项

M12.1 完成必须满足：典型真实模型用例能够完成 source-read → patch 流程；所有 Course 写入只经过 application service 和 Repository；单页多操作原子提交；并发冲突不覆盖；quiz 无确认不清理作答，确认后保存与清理同事务；刷新后课程与工具轨迹一致；相关 lint、单元、数据库、构建和 E2E 通过。

本阶段明确不做页面调序/删除/新增、整页重新生成、视觉截图工具、版本历史/撤销、跨页原子事务、课程根级任意 JSON Patch、文件/网络/数据库操作。图表、表格、theme、actions 和合法 SVG path 已纳入单页通用补丁能力，不再列为后置开放项。

### M12.2：页序与生成

实现 `edit_deck` 的 rename/move/delete，以及 `generate_scene` 的重生成和新增页。所有关联数组保持一致、order 连续，页面 ID 与服务端字段由服务端生成。

验收：移动后 outlines/scenes/progress 顺序一致；删除确认与 quiz 清理正确；新增页失败不留下空 outline；重新生成失败保留原页；多步骤部分成功如实展示。

### M12.3：体验与论文证据收口

在 M12.0 基本历史转换、上下文预算和超时收尾之上，完善会话管理、上下文裁剪体验、token/工具耗时指标与论文证据。选择 3 门课程，每门完成“问答不修改”“单页局部修改”“跨页搜索后修改”“调序或重生成”四类任务，保存工具轨迹、revision 变化与最终页面截图。

不以模型自评作为成功判定。论文可报告任务完成率、平均工具调用数、冲突拦截率、无效工具参数率、人工意图符合率和人工视觉核对结果；其中结构通过率与人工质量评分分开统计。

### 后置增强

`duplicate_scene`、`generate_actions`、TTS、角色设定、图片/视频生成、上传素材、预览截图、版本历史/撤销、跨服务进程恢复、联网检索均后置。只有当相应领域对象和真实执行后端已经存在时才注册工具。

## 10. 测试计划

### 10.1 单元与服务测试

- Agent 协议：reasoning/text/tool-call 流式增量拼接、tool call 解析、未知工具、坏参数、turn/tool/write 预算和确认过期；
- 读取投影：tree/text/source 的字段边界、分页、长 HTML 与媒体占位；
- 补丁：根路径边界、原子多 op、唯一字符串替换、身份保护、图表/表格数组一致性、完整 CourseSchema 以及 quiz 题目与 actions 混合修改的事务；
- 页序：rename/move/delete 后三个数组的一致性与连续 order；
- Agent 循环：只回答、读后回答、读改读、工具错误后解释、冲突后重新读取、部分成功；
- 安全：课程内容不能覆盖 system 指令，跨课程 sceneId 和服务端字段修改被拒绝。

### 10.2 MySQL 集成测试

- 会话、消息、run 持久化与课程删除级联；
- `patch_stage/edit_deck` revision 冲突；
- quiz 修改/删除与作答清理在同一事务；
- `generate_scene` 的 operation lease 与迟到响应保护；

### 10.3 Playwright 与真实模型验收

Playwright 覆盖：打开侧栏 → 提问 → 默认收起的思考卡流式更新 → 展开后看到完整可见 reasoning → 默认收起的工具组出现 → 展开工具及其入参/结果原文 → 修改当前 slide → 主课堂刷新且仍定位该页 → 刷新浏览器恢复对话及折叠内容；删除与 quiz 修改必须出现确认卡。另测 Provider 不返回 reasoning 时不出现空思考卡，以及超长工具结果不能突破分页/大小限制。

真实模型验收至少记录：原始 revision、用户原话、模型/Prompt 版本、完整工具名称与参数摘要、每次 revision、最终 Course、页面截图和人工判断。对 code 互动场景额外执行现有静态/语义检查；不能只因 HTML/CSP 校验通过就判定代码题修复正确。

## 11. 开工顺序与文件影响

1. 先完成 M12.0 数据契约、迁移、Repository、AgentAdapter 与 Mock 测试，再做 UI；
2. 侧栏先接只读工具，确认会话/SSE/取消链路稳定；
3. 抽取 M10 修订与未来 MX 编辑器都可复用的场景校验和保存函数，再接 `patch_stage`，避免 Agent 另建旁路；
4. 最后增加 deck 与生成工具，因为它们会同时改动多个 Course 子结构；
5. 每个子阶段独立提交并执行 `pnpm lint`、`pnpm test`、`pnpm test:db`、`pnpm build`；阶段完成再运行 `pnpm test:e2e` 与 `pnpm verify:full`。

预计主要影响：classroom-runtime.tsx 增加侧栏与课程刷新协调；新增 components/agent、lib/agent、独立 AgentAdapter、application service 和 Agent Repository；迁移编号以开工时已有迁移为准。抽取 QuizEditingService 的题目转换纯函数，复用 CourseRepository.save() 的事务；保持现有 AIAdapter.generateText() 接口。

## 12. 明确不做与决策检查点

M12 第一版明确不做多 Agent 课堂讨论、不做 LangGraph、不让 Agent 操作文件系统或数据库、不做任意代码执行、不把完整 Course 每轮传给模型、不让多个写工具并行、不实现跨工具自动回滚，也不把 OpenMAIC 的平台级 Session Worker 当作毕业设计前置。

开工前还需明确两项决策：

1. 第一版是否允许删除页面；建议保留但强制确认，它能完整验证 `edit_deck`，同时风险可控；
2. 真实模型是否支持标准 OpenAI-compatible tool calls；若当前 DeepSeek 接口不支持，则 M12.0 开工时先做一次最小 capability spike。不得用“让模型输出一段自定义 JSON 文本”长期冒充可靠工具调用协议。

## 13. 与 OpenMAIC 的复用边界

直接借鉴的设计包括：`read_stage` 的 tree/text/source 投影、`grep_stage` 的有界搜索、`patch_stage` 的读后最小原子修改、写工具串行化、工具可用性与 system prompt 一致、修改后再次读取、工具执行过程可见。

不直接复制的部分包括：OpenMAIC 的持久后台 session worker、owner/lease/wakeup 体系、多 Agent 调度、Skills、媒体与语音工具、素材库、PostgreSQL document store。教学平台继续以 MySQL Course 聚合、Next.js Route、现有 AI Provider 配置和单 Agent 为主干。这样既保留 OpenMAIC 已验证的工具化编辑思想，也把实现规模控制在可开发、可测试、可作为论文工程章节说明的范围内。
