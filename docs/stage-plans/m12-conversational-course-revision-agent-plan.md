# 12. M12 对话式课程修订 Agent 开发方案

> 文档版本：0.8（2026-09-08，M12.3 真实案例与浏览器证据已记录）
> 状态：M12.0～M12.3 工程主链已实现；M12.2/M12.3 已完成一轮隔离副本真实 DeepSeek 结构验收，教学内容与互动质量仍需人工判断
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

M12.2 已注册 `edit_deck`、`generate_scene`：目录改名/调序立即保存，删除使用一次结构化确认；slide/interactive 整页重生成直接复用 `SceneGenerationService.revise()`，quiz 重生成通过 SSE 长确认执行；新增页只在完整候选课程校验通过后登记生成租约，成功才一次插入 outline、scene、progress，失败不留下占位页。事件已经带有受影响、删除和整页替换的定位信息，关闭侧栏仍不会取消生成。视觉预览工具仍是可选后置增强，不是 M12.2 的交付要求。自动化测试与隔离副本真实 DeepSeek 证据均已记录；证据证明调用链、结构保存和确认语义，不把模型自评或 Schema 通过替代教学质量判断。

首次真实 slide 修订发现：模型完成 `list_scenes/read_stage` 后，第二轮约 1.5 万字符的可见思考耗尽原 4,096 单轮输出预算，尚未形成正文或 `patch_stage` 即以失败结束；前端当时又未展示 `run_finished.error`，用户侧表现为停在思考卡。现将 Agent 单轮总输出预算提高到 16,384，思考不设独立 token 上限，并在 Prompt 中只要求目标明确后尽快调用最小工具。侧栏进行中耗时每 0.1 秒更新；自动跟随仅在用户位于消息底部时生效，向上滚动后不再抢占滚动位置；失败结束事件会显示真实错误。

侧栏关闭只改变可见性，不取消当前 Agent Run。课堂组件始终保留 Agent Drawer 实例，关闭后仍继续消费 SSE；只有用户明确点击“停止”才中止请求。重新打开侧栏会继续显示同一 Session 中已经收到的流式块或完成后从数据库恢复的消息，目标场景仍以发送消息时记录的 `currentSceneId` 为准。

## 2. 当前实现与目标差距

### 2.1 M12 开发前的 M10 基线（历史对比）

M12 开发前，课堂页 `components/course/classroom-runtime.tsx` 的“修订本场”入口弹出一次性表单，向 `/api/courses/[courseId]/scenes/[outlineId]/revise` 提交最多 500 字意见，再由 `SceneGenerationService.revise()` 把旧场景与意见交给现有场景生成链，得到一份完整替代场景。以下描述用于解释立项背景；当前侧栏和四个已实现工具以 §1.1 为准。

这条链路已经具备四项必须保留的安全语义：

- 请求携带 `expectedRevision`，旧版本写入会得到冲突而不是覆盖新内容；
- 模型调用前登记 `activeOperation`，迟到结果只有仍持有相同 operation id 才能提交；
- 新场景完整生成、Schema/策略校验和保存全部成功后才替换旧场景；失败、取消或冲突保留旧内容；
- 修订 quiz 会更换题目 ID，因此必须明确确认，并在同一数据库事务中清理该场旧作答。

当时的缺口不在“能不能调用模型重做一页”，而在于没有对话历史和工具选择，不能先查再改、跨页搜索、局部补丁或调整页序。M12.0/M12.1 已解决前几项，剩余开发不重复建设已完成的能力。

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
| 调整页序 | `edit_deck` | 修改标题、删除、移动页面；同步大纲和页序，新增页交给 generate_scene | `CourseDeckService` |
| 生成页面 | `generate_scene` | 新增或重新生成一页，复用现有 `generateScene()` 链 | `SceneGenerationService.insert()` / `revise()` |

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
  final_course_revision, error_json, metrics_json,
  started_at, deadline_at, finished_at

agent_confirmations                  # M12.1 增加
  id, session_id, run_id, call_id, tool_name, target_revision,
  payload_json, status, expires_at, created_at, completed_at
```

`content_json` 保存规范化消息块及工具协议字段：modelTurnId、callId、工具名称、有效参数、实际返回模型的有界结果、顺序和状态，以及用户可见正文和 Provider 公开返回的 reasoning。前端由这些块生成折叠卡片，不能把 UI 进一步截断的文案作为模型历史。API Key、system Prompt、堆栈及 Provider 原始响应信封不落库。agent_messages.run_id 和 confirmation 的 run_id/call_id 定位原工具卡。课程删除时相关表级联清理；confirmation.payload_json 仅供服务端执行，界面返回影响摘要和状态。

Course 始终是课程内容真源。历史消息里出现的“第 2 页”只是当时记录；恢复会话后，Agent 必须重新 `list_scenes/read_stage`，不能把旧工具结果当作当前数据。每个工具结果记录执行前后 revision，形成可审计修改轨迹。

context-builder 将规范化块转换为合法 assistant/tool 消息，保证每个 tool result 对应已有 tool_call_id，并保留同一模型 turn 的顺序。历史按完整用户轮次裁剪，再应用可配置总字符或 token 预算，不从工具调用链中间截断。中断或确认导致未闭合的调用，用真实的“未执行/等待确认/中断”结果闭合；无法完整恢复的旧轮次只以明确状态摘要进入上下文。Provider 续接所需协议字段按适配器契约处理。M12.3 已将上述裁剪落到完整用户轮次和 120,000 字符默认预算；GET 会话返回本轮的裁剪数量，UI 只提示较早轮次未发送给模型，不删除数据库历史。语义摘要和向量检索仍后置。

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

### M12.2：页序与生成（已实现，真实结构验收已记录）

目标是让 Agent 完成“调整课程组织结构”和“确有需要时整页生成”。只增加 `edit_deck`、`generate_scene` 两个工具，不顺带建设编辑器、通用任务平台或媒体系统。以下子步骤是同一阶段的实施切片，不新增里程碑编号。

#### M12.2-A：先补齐新工具需要的接口衔接

当前 `tool-registry.ts` 的工具执行接口只有 courseId 和参数，确认结果直接依赖 `PreparedCoursePatch`；`CourseAgentService.confirm()` 也只会提交补丁。先扩展这些确实阻挡新工具的接口，不重写 AgentAdapter、历史记录或整个 Service。

- 工具执行上下文由服务端传入 `signal`、runId 和 deadline；courseId 仍绑定当前路由，不能成为模型可切换的参数。调用生成 Service 时传递同一个取消信号，不通过 HTTP 调用本站 API。
- 待确认 payload 改成带类型的联合：`patch` 保存已准备的候选页，`delete` 保存目标与删除意图，`regenerate_quiz` 保存目标与重生成指令；公共字段包含 courseId、baseRevision 和目标身份。不要把不同操作强转成补丁。
- 保留已有补丁/删除等短确认的 JSON 返回；quiz 重生成确认采用 SSE 返回长工具生命周期，前端按响应 Content-Type 使用已有 SSE 解析器。确认接口文档和测试同步补充这一区别，不能继续对所有确认直接调用 response.json()。
- 长确认执行创建独立 run，关联原 confirmationId/callId，复用同会话互斥、截止时间和取消；更新原工具卡，不伪造用户消息、不自动恢复原 run 未执行的模型计划。完成后下一条用户消息再继续讨论。

已完成确认重复提交只返回原结果；仍 pending 的确认在执行前重新检查版本，长生成还需先取得课程 lease，阻止重复生成。取消或过期不改课程；失败不标记 completed。短确认保留现有流程，长确认执行失败后将本次确认终结为可解释的失效结果，重新执行需要用户重新提出请求，不复用旧版本意图盲目重试。

Agent 主循环要在启动每个工具前检查停止信号。工具已经提交后再收到停止，不回滚，也不把该工具标成未执行。成功写工具的结果及时更新到同一条 assistant 记录，随后继续追加文本/工具；不要只等整轮结束才保存全部轨迹，也不要每个 token 写数据库。若课程已提交但轨迹保存失败，应提示“课程已保存，记录同步失败”，以重新读取的 Course 为准；不为此增加跨表长事务或后台补偿平台。

#### M12.2-B：先实现 `edit_deck` 的 rename / move

建议由新增 `CourseDeckService` 负责准备候选 Course 与提交，工具层只做参数解析、结果适配。一次调用执行一个页级操作，不提供任意 Course JSON Patch 或多操作事务数组。

| 操作 | 模型参数（另带 expectedRevision） | 明确语义 |
| --- | --- | --- |
| rename | sceneId、title | 同步 Scene.title 与关联 Outline.title；不修改画布里的标题文本 |
| move | sceneId、toPosition | toPosition 是移动完成后的 1-based 页码，范围 1..N；先移除目标再插入 |
| delete | sceneId | 删除目标与关联 outline/progress；必须走下一节确认流程 |

例如把目录标题改为“函数入门”用 rename；把页面中可见文本改名仍用 patch_stage，需要两者都改就分别调用。不要把目录标题和画布文本的同步藏在 rename 里。

本阶段 edit_deck 只对无有效生成任务的 ready 课程开放。以 sceneId 找页面，不能把用户说的“第 3 页”直接当永久标识；模型先读取列表确定身份。move 后统一排列 outlines、scenes、sceneProgress，并连续重算 outline/scene.order；progress 本身没有 order 字段，只跟随 outline 顺序。rename/move 保留 sceneId、outlineId、题目/action/元素 ID 和旧作答，不改生成元数据。

保留现有 CourseSchema 的 4～8 页、测验数量/位置、slide 数量和互动页排列约束，不增加教学质量门禁。不合法的移动或删除直接说明具体原因，不擅自重排其他页、补课或删除其他测验。移动到原位置、重命名为原值按 no-op 返回，revision 不增长。

每次有效短修改只调用一次 Repository.save，返回操作、目标身份、前后位置/标题、beforeRevision、afterRevision 与 changed。冲突时不在工具内部自动改用新 revision 重试；由 Agent 重读并决定下一步。

#### M12.2-C：删除与通用确认卡

delete 准备阶段读取目标和关联数据，验证删除后的候选课程是否合法，然后展示“删除第 X 页《标题》”，quiz 额外说明将清理该页旧作答。所有页面删除均确认一次，不能把用户聊天里的“确认”当成结构化确认，也不增加第二次确认弹窗。

确认保存的是目标 sceneId/outlineId 与 baseRevision，而不是易变化的页码。用户确认后重新检查课程版本与目标，删除 outline、scene、progress，同步 requestedSceneCount 并重排。quiz 作答清理与课程保存使用现有 Repository 的同一个事务；其他页作答不受影响。用户取消、确认过期、版本冲突时均不删除。

前端移除目前固定的“确认并清理旧作答”按钮文案，按操作显示“确认删除”“确认修改测验”“确认重新生成测验”。确认摘要与按钮由受控操作类型生成；显示目标页名及影响，不把整份候选 Course 堆给用户。

#### M12.2-D：整页重新生成，先复用现有链路

`generate_scene` 使用 mode 区分操作。`regenerate` 参数为 sceneId、expectedRevision、instruction（沿用现有最多 500 字）；`add` 参数见下一节。不允许模型填写 requestId、generation、服务端时间戳或绕过确认的布尔值。

regenerate 支持 ready/partial_failed 课程中已存在且 progress 为 ready 的 slide、interactive、quiz。缺失/失败的初始生成页继续走现有生成工作区，不把初始生成重试也塞进第一版工具。无有效生成 lease 才能开始。

优先扩展/复用 `SceneGenerationService.revise()` 的完整替换链：旧内容作为参考、用户指令驱动整页重构，仍经 generateScene、现有 repair/校验、assembleScene 和 Repository。不要调用仅支持 interactive 的 `regenerateFailedInteractive()` 来实现通用重生成。首版不另做“忽略全部旧内容”的独立生成模式，不改变页面 type、outlineId 或互动 widgetType；改变场景类型是后置能力。

slide/interactive 明确要求重做时直接执行；quiz 在发起生成模型请求之前确认，说明会更换题目并清理旧作答。确认冻结的是指令和旧版本，不是尚未生成的页面。成功后新场景与旧作答清理一起提交；失败或取消既不替换旧页，也不清理作答。

保留现有整页替换会产生新 sceneId 的语义，以便重置播放器；outlineId 保持稳定。不能照搬 patch_stage 保留 sceneId 的定位假设。返回 oldSceneId、newSceneId、outlineId，并说明 content/actions 被整页替换。目录标题以已有 outline 为基准，需要改名时先调用 rename，不让生成内容无意改写课程目录。

#### M12.2-E：新增页，不落库半成品

add 参数为 expectedRevision、position（插入后 1-based 页码，1..N+1）、outline 和 instruction。outline 复用 SceneOutlineSchema 去掉服务端生成的 id/order：保留 type、role、title、teachingObjective、keyPoints，以及原 Schema 的可选字段；interactive 按已有规则提供 widgetType/widgetOutline。不要另造一套“标题和目标”的映射规范，也不要求模型提交整份 Course 或完整 Scene。

仅 ready 且当前少于 8 页的课程支持 add。先在内存构造 outline、候选目录及进度，检查最终数量与排列规则，再登记生成 lease；不额外调用一次“大纲规划模型”。随后用候选课程上下文和新 outline 生成一页，成功后一次事务插入完整 outline、scene、ready progress，并更新 requestedSceneCount 和连续页序。旧页面 ID、内容、作答全部保留。instruction 必须进入实际生成输入，不能只出现在工具卡上。

新增不能直接复用要求已有 pending outline 的 `SceneGenerationService.generate()`。在该 Service 内增加明确的插页入口，复用底层生成链和提交规则。持久化的生成中 Course 仍保留旧目录、旧数量和旧 progress；新增 outline 只在内存候选中存在，成功之前不保存占位页。

lease 继续使用 activeOperation.stage=scene，并增加可选 purpose=insert 标识新增；outlineId 可记录待生成的新 ID，不意味着该 ID 已存在于持久化目录。旧记录缺省保持原语义。实现时同步处理所有读取 activeOperation 的生成入口、状态展示和过期清理，不能拿任意已有页作为插页占位目标；此兼容性扩展不另建任务表，也不要求迁移历史课程内容。

生成失败、停止或超时，在仍持有 operation id 与 revision 时清理自己的 lease、恢复 ready，旧三组数组与 requestedSceneCount 不变；如果操作所有权已丢失，绝不清理别人的任务。进程异常退出由后续请求按现有租约过期规则清理，不续跑、不从半成品恢复。恢复时只释放任务状态，不凭空插页。

#### M12.2-F：长工具反馈、revision 与页面定位

生成沿用现有单页约 120 秒超时，Agent 总预算先沿用 300 秒。单页请求使用“单页超时与本轮剩余时限取小”的信号；总预算不足时停止新步骤并报告部分完成，不默认延长到无限等待。保持已提高的 16,384 单轮输出预算，不重新加入独立思考 token 上限。

生成工具至少展示正在生成、成功或失败、真实耗时；如增加准备/校验/保存阶段，必须来自服务端实际事件，不展示模拟百分比。关闭侧栏继续运行，明确点击停止才取消；取消信号必须传至生成 Provider 和提交前检查。停止不会撤销已提交的前几个工具，也不能阻止已经开始的短事务安全收尾。

注意生成登记 lease 和最终保存/失败清理都会增长 revision，因此一次生成不是固定 +1，失败也未必 revision 不变。无论成功还是已登记后的失败，都同步当前持久化 revision 给 Agent 与前端，避免下一次 patch 使用过期版本；分别返回 contentChanged 与实际 before/afterRevision，不能把 lease 变化说成内容已修改。

扩展 course_updated 与工具结果的定位信息，至少包含 affectedSceneIds、removedSceneIds 以及整页替换的 oldSceneId/newSceneId/outlineId 映射。前端收到事件重新 GET Course，不能继续用 affectedSceneIds[0] 无条件跳页：当前页仍存在则保持；当前页被替换则跟随稳定 outlineId；当前页被删除则选择原位置的下一页，没有则前一页。新增默认不抢走当前页，工具卡可提供“查看新增页”。

课程内容换入前停止旧 action；纯目录改名/调序不必强制把未变页面从头播放。刷新失败显示“已保存，课堂刷新失败”并提供重新加载；对话工具卡中的成功结果不改成保存失败。

#### M12.2-G：Prompt、文件影响与完成标准

Prompt 只追加工具选择和结果语义：局部修改用 patch，目录/位置用 edit_deck，整页重做或不存在的页用 generate；页码先解析成稳定 ID；写工具按返回 revision 串行执行；遇到确认结束本轮，其他计划标记未执行；失败说明已保存与未完成部分。不把 CourseSchema 每条规则重复写进 system prompt，也不强制每次生成后追加视觉工具调用。

主要改动预计集中在 lib/agent 的 contracts/tool-registry/course-agent-service/system-prompt、新增 CourseDeckService、扩展 SceneGenerationService、activeOperation 的 Schema 与消费方、确认路由、Agent Drawer 和 classroom-runtime。复用现有 Repository 事务与场景生成 Provider 配置；除确有字段需要，不另建模型配置、任务表和生成引擎。两工具分别完成执行器和测试后才注册，不提前向模型宣传不可用能力。

验收聚焦常见成功路径和真实破坏风险：rename/move 身份与作答不变；delete 取消不写入、确认后关联数据同事务删除；新增成功完整插入、失败无占位；三类页重生成成功替换、失败保留旧页；quiz 无确认不调用生成模型；重复确认、版本冲突、停止与迟到结果不重复提交；多工具部分成功及前端定位正确。用单元测试覆盖变换、MySQL 验证事务/lease、Mock E2E 串起确认和刷新，再各选一条真实模型调序、新增、重生成任务人工核对。不要把罕见故障组合、固定成功率或模型自评设成上线门禁。

当前实现已完成本节 A～G 的工程主链：`CourseDeckService` 负责 rename/move/delete，`SceneGenerationService.insert()` 负责不落库半成品的新增页，`generate_scene` 复用现有场景 Prompt、repair、装配和 operation lease；删除和 quiz 重生成的确认 payload 已按操作类型区分，quiz 长确认通过 SSE 启动独立 run 并更新原工具卡。前端按 `oldSceneId/newSceneId/outlineId` 处理整页替换，删除当前页时落到原位置附近。当前仍没有 `duplicate_scene`、视觉预览、撤销历史或额外教学质量门禁；下一步只需用固定课程调用真实 DeepSeek 验收调序、新增和三类重生成，并将结果记录到 M12.3 案例证据。

### M12.3：体验与论文证据收口

目标是把已有六工具闭环做成可持续使用、可解释和可复现实验的成果，不以增加工具数量为目标。以 M12.2 主流程可用为输入；M12.0/M12.1 的真实写入质量检查尚未完成的部分一起收口，不能把“只读真实冒烟成功”当作修订能力已验证。

#### M12.3-A：会话切换与真实运行状态

复用已有 list/create/getSession 接口，提供当前课程历史会话列表、新建对话和切换。只显示当前课程会话；同一会话正在运行或提交确认时禁用切换/新建并提示先停止，避免首版同时管理多个流。关侧栏仍不停止。会话重命名、删除、全文检索、自动清理和跨课程迁移均不作为必做项。

刷新浏览器后从数据库恢复完成轨迹，未完成 run 按现有 deadline 标记/收尾；明确提示刷新不会自动续跑模型。等待确认恢复为可操作确认卡，过期/取消/失败不可伪装完成。区分模型失败、工具失败、用户停止、课程冲突与“保存成功但显示刷新失败”，不为每类状态新建复杂状态机。

#### M12.3-B：长对话上下文与详情可读性

沿用已有 context-builder 预算裁剪，不引入向量库、LLM 摘要服务或长期记忆。UI 可提示“较早对话未全部发送给模型”，数据库中的历史记录不因此删除。裁剪按完整消息/工具调用及其结果成组进行，不能留下孤立 tool result；待确认内容不作为已执行结果。新一轮以实际 Course revision 为准，旧 source 只作历史参考，不能冒充当前版本。

思考卡、工具组和入参/结果继续默认收起，只展示 Provider 明确提供的可公开内容或摘要，不尝试推导未提供的内部推理，也不伪造思考流。保留现有耗时更新与滚动行为，详情限高、可滚动；长工具结果明确截断位置及继续读取方式。工具执行后的结果摘要要比巨量原文更容易看到，但原有字段读取和通用 patch 能力不收缩。

#### M12.3-C：轻量指标，不建设监控平台

按 run 汇总模型调用数、工具成功/失败/等待确认次数、总耗时和可获得的 input/output tokens；逐工具保留真实耗时、操作与 revision。优先扩展现有 run 记录的可选统计字段，需要迁移时使用下一可用编号，不回写已执行迁移。没有 Provider usage 时记为未知，不填 0，也不按字符串长度伪装真实 token。

Agent 对话模型与 generate_scene 内部生成调用分开统计：前者来自 AgentModelEvent.finish.usage，后者复用 Scene.generation 的 usage/upstreamCalls 等实际数据。生成失败若没有拿到 usage 就注明缺失，不从旧场景 generation 读取成本；Provider 将 reasoning 计入 output 时不要重复相加。工具等待时间包含内部生成，不再加一遍作为总运行耗时。确认等待是用户时间，与模型执行时间分开；长确认的新 run 可通过 confirmationId 关联到原任务。

仅提供日志/轻量报告供开发和论文整理；不要求专门仪表盘、价格换算、分布式 tracing 或全量请求持久化。记录模型/Prompt 版本与测试标识即可，不保存密钥和 Authorization 等请求凭据。

#### M12.3-D：固定案例与人工证据

建议选择 3 门固定课程，每门执行问答不修改、单页局部修改、跨页搜索修改、调序或重生成四类任务，形成 12 条核心案例；另补新增页与删除确认案例覆盖两种结构变化。尽量使用隔离的测试副本，记录初始 Course、用户原话、实际工具参数/结果、前后 revision、内容 diff 和关键截图。此数量是便于毕业设计复现的推荐样本，不是每次提交都必须重跑的门禁。

每条案例分别判断：执行是否完成、保存结构是否合法、是否符合用户意图、页面是否可用；code 互动页另执行语言/示例测试，普通互动页人工操作控件核对效果。结构通过不等于教学正确，模型最终说“改好了”不作为证据。失败案例同样保留，不通过临时改提示词反复重跑后只报告最佳结果。

报告任务完成率时给出实际样本数、成功定义与失败原因，工具调用数/耗时可报告均值和范围。冲突拦截率只在确实构造冲突的测试集中计算，正常用例没有冲突不能填 100%；无效参数率以实际工具调用为分母。真实模型小样本只能说明工程可行性，不外推为通用能力排名，也不新增同题 A/B 或冻结历史阶段的重测要求。

2026-09-08 已在两个隔离副本上执行一轮真实 DeepSeek 结构验收：8 页副本 `9fb86c2f-68cc-49f0-9da7-e4b92efcd4d0` 完成只读查询/搜索、调序（REV.0→1）、明确 `str_replace` 补丁（REV.1→2）、slide 重生成（REV.2→4）、interactive 重生成（REV.4→6）、quiz 等待确认及确认重生成（REV.6→8）；删除案例在 7 页副本 `f0776b0f-1a19-4519-a75f-4c589f230d57` 上到达确认后取消，课程保持 REV.2。新增页在 6 页容量副本上成功插入第 7 页（REV.0→2）；同一请求在 8 页副本上如实返回容量已满并未写入。每个案例保存用户原话、SSE 事件、工具参数/结果摘要、前后页序与 revision；脚本为 `eval/scripts/m12-3-deepseek-acceptance.mjs`，结构报告见 `eval/runs/m12-3-real-deepseek-*`，最终页面 MHTML 见 `eval/runs/m12-3-final-8p/` 与 `eval/runs/m12-3-final-7p-add/`。浏览器证据保存在 `output/playwright/m12-3-*.png`，覆盖会话新建/切换、默认收起详情、展开入参与结果以及消息容器滚动。一次含歧义的补丁请求被模型停下并请求澄清，保留为失败/未执行事实；这些记录只证明工程行为和当前样例结构可读，页面教学质量、视觉审美与 interactive 运行语义仍需人工判断。

#### M12.3-E：交付与停止范围

完成会话选择与状态恢复、上下文裁剪提示、必要统计和案例记录后，更新 docs/07 的实际验证结果、docs/06 与 README 的能力边界。对实际修改运行相关自动化测试，阶段结束再执行现有完整验证；不要求每个文案提交都跑全部数据库/E2E/构建。真实模型人工验证可以独立于日常 CI，不设成本高且波动大的固定成功率门槛。

M12 收口以“可持续讨论 → 读取/搜索 → 局部修改或页级操作 → 如实反馈 → 恢复查看”为终点。删除和整页重生成目前没有撤销，确认与结果中清楚说明；不把补版本历史、视觉 Agent 或专业编辑器作为完成 M12 的前提。

当前工程实现已覆盖本节 A～C 的最小主链：会话列表只按当前课程显示，侧栏支持新建/切换并在运行或等待确认时锁定切换；会话 GET 会收尾已过期 run、返回最近 run、待确认记录和上下文裁剪信息，刷新不会自动续跑模型。`context-builder` 按完整用户轮次和字符预算裁剪，工具调用与结果不会被拆开；`agent_runs.metrics_json`（迁移 006）保存模型/工具计数、总耗时和 Provider 实际提供的 token，未知 usage 保持缺失。前端继续沿用默认收起详情、流式思考计时和滚动行为，并提示裁剪与刷新状态。

M12.3-D 的一轮固定副本真实 DeepSeek 调序/新增/重生成和浏览器证据已归档；推荐的多课程扩展样本与人工页面/互动质量判断仍是后续论文工作。本次工程实现不把 Mock 单测或结构 Schema 通过冒充真实内容质量证据，也未增加固定成功率门禁。

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

当前已明确的决策与剩余边界：

1. M12.2 保留页面删除并强制一次结构化确认，不再作为待定开工条件；页数和排列限制沿用现有 CourseSchema，不增加新的教学质量门禁。
2. M12.0 已验证真实 DeepSeek 标准 tool calls，只读能力不必重复 spike；后续需要补充真实写入、调序和生成案例。新增 Provider 时再核对其能力，不用自定义正文 JSON 冒充 tool calls。
3. 后续顺序为 M12.2-A 接口衔接 → B/C 页序与删除 → D 重生成 → E 新增 → F/G 联调验收；M12.3 再做会话体验和证据收口。M12.0/M12.1 章节保留其设计历史，涉及后续扩展时以本版 M12.2/M12.3 的明确规则为准。

## 13. 与 OpenMAIC 的复用边界

直接借鉴的设计包括：`read_stage` 的 tree/text/source 投影、`grep_stage` 的有界搜索、`patch_stage` 的读后最小原子修改、写工具串行化、工具可用性与 system prompt 一致、修改后再次读取、工具执行过程可见。

不直接复制的部分包括：OpenMAIC 的持久后台 session worker、owner/lease/wakeup 体系、多 Agent 调度、Skills、媒体与语音工具、素材库、PostgreSQL document store。教学平台继续以 MySQL Course 聚合、Next.js Route、现有 AI Provider 配置和单 Agent 为主干。这样既保留 OpenMAIC 已验证的工具化编辑思想，也把实现规模控制在可开发、可测试、可作为论文工程章节说明的范围内。
