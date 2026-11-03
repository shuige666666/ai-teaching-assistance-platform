# 分段讲解与画面联动

开发日期：2026-11-01，验收补充：2026-11-03。基线：`31efbd3`。第一版功能、MySQL 集成与完整浏览器回归已通过；已完成一页真实模型材料样例核对，结果与局限见文末。

## 目标与范围

幻灯片按教学步骤生成多个讲解段落，每段关联零个或多个页面元素。播放器使用同一当前 Action 驱动讲稿、语音或文本计时、画面高亮；支持暂停、上一段、下一段、点击定位和重听本段。测验和互动页保留原来的学习者等待逻辑。

第一版只聚焦整个元素，不做逐词时间戳、代码行定位、表格单元格定位或独立动画编排。旧课程无需迁移，也不会自动重新调用模型生成讲稿。

## 设计决策

1. 在现有 `speech` Action 增加可选 `focusElementIds`，存储仍使用 `Scene.actions`。不持久化第二份整页讲稿，播放态高亮不修改画布样式，也不进入静态导出。
2. 同一次模型调用生成 `content.elements` 与 `narrationSegments`。元素的临时 `ref` 只在本次响应内使用，规范化后映射为服务端分配的正式 ID。不使用数组位置关联，也不额外添加一次模型调用。
3. 仅为最终保留且引用唯一的元素建立映射。失效或有歧义的引用移除并记录规范化提示，保留讲稿；有效引用不因其他元素被过滤而偏移。旧 `narration` 响应兼容为单段。
4. 当前 Action 是高亮和讲稿的唯一来源。跳段先取消旧任务并更新执行代次，忽略迟到回调；暂停保留聚焦，切页或结束清除。当前页面内容修订后取消旧执行并回到待播放状态，其他页变化不重置当前播放。
5. Agent 删除元素时清理相关聚焦引用并提示复查讲稿。新引用必须指向本页有效元素；移动元素保持 ID 即可延续关联。教学材料 `sourceBlockIds` 与画面 `focusElementIds` 分别处理。

参考本地 OpenMAIC `packages/@openmaic/generation/src/scene-generator.ts` 的内容与讲解关联设计。上游通过独立 Action 生成阶段组合 spotlight/speech；本项目采用段落内携带聚焦目标，复用现有顺序播放器。

## 开发记录

- 已核对生成规范化、Action 装配、播放状态机、渲染器、Agent 补丁及摘要读取链路。
- 生成结构：`scene-slide.v2.6` 输出 `narrationSegments`，每项包含 `text` 与 `targetRefs`；通常 3～5 段，契约允许 1～12 段，整页文本合计最多 1500 字符，每段最多 4 个目标。开场和过渡允许无目标，不强制每页凑满段数。
- 规范化：`normalizeGeneratedSlideScene` 保留原始 ref 与规范化元素的配对，完成过滤及 40 元素上限截断后再建立映射；重复引用不猜测，失效引用记录 `normalizationIssues`。合并讲稿只在生成期供普通文本安全检查使用，不重复持久化。
- 装配与修复：`assembleScene` 将每段装成服务端 ID 的 speech；同步修改生成示例、修复 Prompt 和 mock 输出。修复模板原先限制为四种元素，本次与实际支持的 chart/table 对齐，避免修复时丢掉被讲解的图表。
- 播放：增加 SEEK 事件，定位时取消旧句柄并递增 `runId`。按当前页 content/actions 的内容签名识别修订，避免同 ID、同段数更新继续播放旧语音；不以全课程 revision 重置。文本计时取消原有 12 秒上限，按实际段落长度估算，用户可随时跳段。
- 界面：新增 `NarrationSegments`，展示段数、当前段落及导航，自动滚动仅作用于讲稿容器。段间若已有 timed pause，导航仍从最近的讲解段继续。语音开关补充可访问名称。
- 画布：当前 speech 的目标经 SceneRenderer / SlideRenderer 传入 SlideCanvas。`SlideFocus` 在相同逻辑坐标系的顶层绘制非交互聚焦框；矩形元素随自身角度旋转，线条范围按端点与控制点计算。没有改写元素样式或导出数据。
- 修订：SceneSchema 校验聚焦 ID 属于本页；Agent 删除目标时清理对应引用、记录 changedPaths 并提示复查讲稿。Agent 的读取说明补充分段与关联规则；摘要和搜索本来就汇总全部 speech，继续复用。

## 使用与兼容

新建课程并生成 slide，或重新生成已有 slide 后，课堂右侧会显示分段讲稿。单击某段可定位；正在播放时定位后继续播放，暂停或待播放时定位后保持暂停。重听本段始终从该段开头开始，并关闭跨页连续播放；普通自动推进仍沿用现有连续播放策略。暂停保留高亮，结束、切页或当前页内容更新后清除。

旧课程没有 `focusElementIds` 时仍能播放，不会自动产生高亮，也不会隐式重新调用模型。可选字段直接进入现有 v5 课程 JSON，不新增表、不回填历史课程。测验与互动页保留原有讲稿与 learner pause 行为。

```text
模型：content.elements(ref) + narrationSegments(targetRefs)
  → normalizeGeneratedSlideScene：过滤元素、分配正式 ID、解析关联
  → assembleScene：多个 speech(text, focusElementIds)
  → 现有 SceneGenerationService / Repository 保存
  → usePlaybackController.currentAction
      ├─ 语音 / 可暂停文本计时 → 完成后推进下一段
      ├─ NarrationSegments：当前段、点击定位、重听
      └─ SlideCanvas / SlideFocus：对应元素高亮
```

## 验证计划

验证元素被过滤或截断后的引用映射、重复与不存在引用、旧模型响应和课程兼容、快速跳段的迟到回调、暂停/恢复、Agent 删除与修订、缩放后的高亮位置。运行适用的单元测试、Lint、TypeScript、生产构建及 mock 浏览器流程。mock 仅验证工程链路，不替代真实模型讲稿与画面语义对齐的质量评估。

## 验证结果

2026-11-01：242 项单元测试通过，包含新增的引用过滤/截断/歧义、分段预算、一次修复、旧课程、mock 生成、Agent 删除与非法聚焦、快速跳段和同页重置用例。ESLint、TypeScript 和 Next.js 生产构建通过；最终代码复核后重跑了这些检查。

浏览器验收使用生产构建、`AI_MODE=mock`、`COURSE_REPOSITORY=memory` 和隔离端口 3101，没有修改 `.env.local`。实际完成从课程创建、大纲生成、逐页生成到进入课堂的流程，并验证：

- 文本模式暂停一分钟后仍停留原段，恢复后消费剩余时间；最后一段结束清除高亮。
- 快速前后定位不会被旧计时器推进，切页并等待后没有旧高亮或自动播放残留。
- 调整讲稿面板宽度以及 960 / 1280 宽视口后，聚焦框与图表同帧测量的位置和尺寸误差小于 1 CSS 像素；截图已目视复核。
- 可控语音桩执行真实 BrowserSpeechAdapter / hook：暂停、恢复、完成推进、取消后迟到 onend 均符合预期。此项验证事件协议，不代表已验证操作系统实际音频输出。
- 模拟 Agent `course_updated` 与后续 GET 响应，保持 scene ID、Action 数量及时间戳不变，仅更新讲稿与目标：旧语音被取消、页面回到待播放，重听使用新讲稿和新目标。服务端实际补丁另由单元测试覆盖。
- 用同一前端刷新链路加载没有新字段的历史单段数据，可以正常播放和结束，没有错误聚焦。
- 对含 timed pause 的讲稿，暂停动作期间清除聚焦，“下一段”正确跳到后续 speech，没有退回第一段。

本地验收脚本及截图保存在忽略目录 `output/playwright/segmented-narration/`，包括 `verify-playback.js`、`verify-speech.js`、`verify-revision.js`、`paused-chart.png`、`narrow-chart.png` 和最终构建的 `final-preview.png`。几何检查在同一浏览器帧内读取目标与高亮框，避免 resize 期间两次跨进程测量产生时间差。验收结束关闭隔离浏览器和服务，内存测试课程随进程退出清理。

### 2026-11-03：MySQL 与完整回归补验

11 月 1 日的阻塞原因为 MySQL80 未启动，25 项集成测试中 24 项连接失败。用户启动服务后，原有 25 项全部通过；本次再增加一项实际持久化用例，最终 **26/26 通过**。新增用例从生成管线取得三段讲稿，核对完整数据库往返，提交删除关联图表的真实 Agent 补丁，再由新仓储读取，确认仅清理被删除目标的引用、保留讲稿顺序及其他页面，并返回复查讲稿的提示。

完整 E2E 使用 `AI_MODE=mock`、`COURSE_REPOSITORY=mysql` 与生产服务端口 3100，覆盖课程创建、逐页生成、课堂、Agent 对话、PPTX/互动资源导出、互动、测验和刷新恢复。首次发现原有拖拽测试在侧栏 240ms 入场动画尚未结束时读取坐标，导致鼠标错过把手；改为先 hover 等待位置稳定，再拖动并等待宽度提交。修正后的完整流程通过，最终渲染调整后重新运行仍通过（1/1，11.1 秒）。这次没有扩展测验功能。

最终代码检查：242/242 单元测试、26/26 MySQL 集成测试、完整 E2E、全量 ESLint、TypeScript 与生产构建通过，`git diff --check` 无空白错误。可在项目根目录复验：

```powershell
node node_modules/vitest/vitest.mjs run
node --env-file=.env.local node_modules/vitest/vitest.mjs run --config vitest.integration.config.mjs
node node_modules/eslint/bin/eslint.js .
node node_modules/next/dist/bin/next build
$env:COURSE_REPOSITORY = 'mysql'
node node_modules/@playwright/test/cli.js test
```

### 2026-11-03：真实模型与材料对应核对

使用项目配置的 DeepSeek 模型（请求名 `deepseek-v4-flash`，服务端响应名 `deepseek-flash`），只生成一页，输入为人工编写、事实可逐项核对的 Markdown 教学样例。材料明确注明：两组各 100 次相同查询，平均响应时间为 240 / 80 毫秒，减少 160 毫秒、降幅约 66.7%，均为示意数据，不能外推到所有系统。大纲固定，其余三页用 mock 补齐，仅用于课堂导航；没有把它们计入真实模型结果。

实际远端调用 **2 次**（首轮生成 + 一次修复），调用合计约 15 秒。首轮 JSON 缺少结构闭合，现有修复流程返回了有效结构，最终得到四段讲稿、九个元素及四个材料块来源，段落聚焦目标数为 `[2, 1, 1, 1]`。逐段对照原文、持久化数据与渲染结果：

| 段落 | 讲解内容 | 实际聚焦 | 人工核对 |
| --- | --- | --- | --- |
| 1 | 示意性质、各 100 次查询、比较单位 | 步骤文字与数据表 | 与材料一致；双目标同时高亮 |
| 2 | 未启用/启用缓存为 240 / 80 毫秒 | 对应柱状图 | 组别、数值、单位一致 |
| 3 | 减少 160 毫秒、降幅 66.7%、三分之一 | 包含计算过程的文字块 | 计算正确，没有混淆减少量与倍数 |
| 4 | 结论边界与真实测量条件 | “示意数据，非真实性能基准”提示 | 保留材料限制，没有夸大收益 |

一次性验收脚本最初使用 Node 严格对象比较，将数据库 JSON 会省略的 `undefined` 键误判成差异；产品数据未丢失。脚本改为比较 JSON 可持久化内容后，复用已经取得的两份模型响应重建验收课程，未再次付费调用。`report.json` 明确记录 `usedCapturedResponsesForBrowser: true`；重放场景的 `durationMs` 不作为真实模型耗时。原始调用耗时与响应单独保存在 `model-call-*.json`。

课程由独立脚本写入 MySQL，脚本退出后通过独立 Next.js 进程读取；重新构建并重启 Web 进程后再次核验。浏览器验证四段文字及目标完整恢复、双目标高亮、各目标几何误差小于 1 CSS 像素、暂停一分钟不推进、恢复及结束清理、切页清理、刷新恢复，未出现 console.error 或 pageerror。

### 截图发现的问题与本次修复

模型给三行表格分配的高度只有 56 逻辑像素。原渲染器的固定字号和内边距使表格超出声明高度，最后一行被画布裁切，高亮只能覆盖上部；只比较元素外框无法发现这一问题。

`TableElement` 现在优先保留常规排版；发生溢出时先压缩单元格留白，再根据实际换行后的表格高度寻找能容纳内容的字号。该适配不改写持久化元素坐标。验收增加实际 table、全部单元格文字与画布边界检查；最终三行完整显示且全部处于高亮区域。该样例适配后的字号约 10.34 逻辑像素，说明“没有裁切”仍不等于排版质量理想；后续可让模型为表格预留更大空间，提升可读性。当前适配验证针对课堂显示，未据此声称所有表格的 PPTX 排版也经过同等验证。

本次证据保存在忽略目录 `output/playwright/segmented-narration-mysql/`：`source.md`、`input.json`、`model-call-1.json`、`model-call-2.json`、`course.json`、`report.json`、`browser-report.json`，以及修复前的 `before-table-fit.png`、四段截图和 `final-preview.png`。其中 `verify-remote.mjs` 会调用真实模型，`recover-captured.mjs` 只重放已有响应，`verify-browser.js` 检查课堂。验收结束清理本次临时课程并关闭隔离浏览器/服务，MySQL 保持运行，未修改 `.env.local`。

### 尚待扩大验证的范围

目前完成的是一页真实模型样例核对，不能据此推断任意教材都能稳定生成高质量关联。后续适合增加不同密度的图表、代码、概念流程与教材样例，分别统计首次通过、修复、无效引用及人工语义对应情况。逐词/代码行/表格单元格级联动仍不在第一版范围内。操作系统实际语音音频尚未人工听验；已有语音检查覆盖的是浏览器适配器事件协议。
