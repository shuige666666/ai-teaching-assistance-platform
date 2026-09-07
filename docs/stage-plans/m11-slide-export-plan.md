# 11. M11 资源包导出开发方案

> 文档版本：1.1（2026-09-07）
> 状态：M11 已实现并完成结构、浏览器链路及 PowerPoint/WPS 人工核对（2026-09-07）
> 上游依赖：M8 只读幻灯片（已完成）、M9 自包含互动页（已完成）、Course v5 契约（稳定）

## 1. 决策结论

2026-09-05 用户确认优先实现资源包导出，并将其编号确定为 **M11**。相关编号与验收状态已同步至范围、需求、架构、路线图、开发状态、验收文档和 README。

优先导出的理由是其映射过程相对机械、依赖库成熟、参考实现现成，而且成果可以在答辩现场直接演示。v2.2 起的数据化元素设计（chart 只存数据、shape 走 pathFormula 预设）也与 PPTX 原生能力高度契合。

M11 只读取既有 `Slide/PPTElement` 契约，不引入导出专用页面模型，也不反向要求生成、渲染或持久化链增加编辑状态。

本文档记录 M11 已确认的范围、实现决策和验收证据。后续若扩大导出范围，应先修改本文档，再改代码。

## 2. M11：PPTX + interactive HTML 简化资源包导出

### 2.1 范围与产物

一个 ZIP，结构固定（与 docs/01 §4.4 一致）：

```text
<安全化课程标题>.zip
├─ <安全化课程标题>.pptx        # 仅 slide 场景，按 Scene.order 排列，每场一页
└─ interactive/
   ├─ 03_<安全化标题>.html      # 自包含互动页，按原始 Scene.order 补零命名
   └─ ...
```

- quiz 场景不进入导出物（既不进 PPTX 也不生成 HTML）；
- 互动 HTML 直接取场景 `content.html` 原样写入——M9 策略已保证自包含，允许 CDN、不承诺离线；
- 导出是纯只读操作：不改数据库、不产生新 revision、不触发任何生成接口。

### 2.2 技术选型

- `pptxgenjs`：客户端（浏览器）生成 PPTX，OpenMAIC 同款库（MIT）；
- `jszip`：打包 ZIP（MIT）；
- 全客户端链路：课堂页新增"导出资源包"按钮 → 使用已加载的课程 JSON 生成 PPTX → 组装 ZIP → 触发浏览器下载。无服务端文件中转、无新增 API；生成页入口留到后续批次；
- PPTX 画布：16:9（对应逻辑画布 1000 × 562.5，映射系数 1 逻辑 px = 1/75 英寸）；
- 换算系数统一：位置与尺寸 1 逻辑 px = 1/75 英寸；字号 1px = 0.75pt（CSS px → PPT point）；
- 依赖登记：安装时锁定 pptxgenjs/jszip 版本，并在 THIRD_PARTY_NOTICES.md 登记来源与许可证。

### 2.3 元素映射表（核心设计）

| PPTElement | PPTX 映射 | 保真度决策 |
| --- | --- | --- |
| text | 文本框 + 文本 runs：解析净化 HTML——`p` → 段落，`strong/b` → bold，`em/i` → italic，`u` → underline，span 内联 `font-size/color/line-height/text-align` 映射到 runs 与段落属性；元素级 `defaultFontName` 应用到文本框和 runs，`opacity` 映射为 PPTX 透明度 | 净化白名单（6 种样式属性）即解析全集，单测钉住；解析不到的结构降级为纯文本，字体只声明名称、不嵌入字体 |
| shape | `pathFormula` 预设 → PPTX 预设几何：rect→rect、roundRect→roundRect、circle→ellipse、triangle→triangle、diamond→diamond、rightArrow→rightArrow；shape `gradient`（v2.2）取首个色标降级为纯色，并在完成提示中计数 | 手写任意 `path`（无 pathFormula）第一版降级为跳过并计数上报；不尝试任意 path 转换 |
| line | 直线连接符：start/end → 端点坐标，`width` → 线宽，`points` 端点 → arrow/dot 端头 | 当前版本导出任意角度的直线、箭头和虚线；`curve` 二次曲线按端点直线近似，并在完成提示中计入“曲线按直线近似” |
| code | 等宽字体文本框；`fileName`/`language` 写入首行元数据文本，`lines` 逐行写入；长文本启用 PPTX `shrink` 自适应 | `showLineNumbers` 不导出行号（PPT 无等宽对齐需求），优先保持代码块在页面内可读 |
| chart | `addChart` 原生图表：column→bar（纵向）、bar→bar（横向）、line→line、pie→pie；`labels`/`series` 直传，`themeColors` → 系列配色 | 数据元素与 PPTX 原生图表天然契合，无损映射 |
| table | `addTable`：`colWidths` 比例 → 列宽，`rows` → 单元格，`header` → 首行加粗 + 底色 | 单元格纯文本（规范化已保证） |
| background | solid → 纯色填充；linear/radial gradient → 取首个色标降级为纯色，并在完成提示中计数 | 当前版本不生成 PPTX 原生渐变 |
| theme | `fontName` → 全局/主题默认字体，`fontColor` → 默认字色，`themeColors` → 强调色序列；元素级 `defaultFontName` 可覆盖文本默认字体 | 只声明字体名，不嵌入字体文件；目标机器缺少字体时由 PowerPoint/WPS 自动回退 |

通用保真原则：**已识别但无法完整映射的元素采用明确的近似或跳过策略并计数，绝不中断导出**；完成提示中明确列出降级/跳过数量。PPTX 原生直线可以表达斜线，因此斜线不计降级；`curve` 仅保留端点并按直线近似，统一计入降级清单。

### 2.4 模块结构

```text
lib/export/
├─ pptx-mapping.ts        # PPTElement × N → pptxgenjs 对象的纯函数映射（可单测）
├─ rich-text-runs.ts      # 净化 HTML → 文本 runs 解析（纯函数，可单测）
├─ filename.ts            # 标题安全化（非法字符、长度、重名）
└─ use-export-zip.ts      # 客户端 hook：课程 JSON → PPTX → ZIP → 下载
components/export/        # "导出资源包"按钮与进度提示（当前挂课堂页）
```

### 2.5 测试与验收

- 单元测试：映射纯函数逐类覆盖（含主要降级分支）、runs 解析核心标签与样式、文件名安全化（非法字符/超长/空标题）；
- 验收（新增 AC-E 系列，写入 docs/08 前先在本文件维护）：
  - AC-E01 真实 ready 课程导出 → 解包校验 ZIP 结构（一个 PPTX + interactive 命名规范）✅ 2026-09-05 两门真实课程通过；
  - AC-E02 PPTX 在 PowerPoint 与 WPS 中人工打开核对：文字、形状、图表、表格可读且顺序正确 ✅ 2026-09-07 用户人工核对通过（ZIP 样例在 output/export-check/）；
  - AC-E03 chart 元素导出为可编辑的 PPTX 原生图表（非图片）✅ barChart 部件生成、数据无损；
  - AC-E04 含降级元素的导出在完成提示中如实列出数量 ✅ 浏览器链路显示"形状渐变降级纯色 ×1"；曲线近似单测计数，斜线不误报；
  - AC-E05 导出过程不产生任何写库操作（revision 不变）✅ 纯只读转换，未调用任何写接口。
- 自动化验证：`pnpm test:e2e` 已将导出按钮的真实点击、下载、解包和完成提示并入 mock 课程全流程；`pnpm check:export` 对两门真实课程执行 ZIP/PPTX/HTML 结构检查，`scripts/export-browser-check.mjs` 继续作为独立浏览器探针保留。

### 2.6 硬边界

不做 `.maic.zip` manifest/导入协议、不做视频/音频导出、不承诺互动页离线、不生成 manifest/README/assets、quiz 不进 PPTX、不改 `Slide/PPTElement` 契约。

### 2.7 开工前补充决策（2026-09-05）

1. **入口位置**：导出按钮放在课堂页头部区域（课程 JSON 已在客户端加载，零额外请求）；生成页入口留到第二批；
2. **可用性规则**：`ready` 与 `partial_failed` 课程均可导出（导出全部已保存场景）；`draft`/`outline_ready` 无场景可导出，按钮禁用并提示；
3. **能力 spike 前置**：已完成最小 spike，确认原生柱状图可用；当前版本的页面/形状渐变按首个色标降级为纯色，并按 §2.3 的降级路径实现；
4. **降级透明化**：AC-E04 的"跳过/降级计数"在导出完成提示中按元素类型分组列出，便于发现映射盲区。

### 2.8 M11 后续可用性与兼容性修正（2026-09-07）

在不扩大 `Slide/PPTElement` 契约、也不为低概率输入增加严格门禁的前提下，补齐以下收尾项：文本元素的 `defaultFontName` 与 `opacity` 分别映射到 PPTX 字体和透明度；代码块使用 `shrink` 适配较长内容；浏览器下载对象 URL 延迟释放 1 秒，降低下载接管时序差异；完成提示使用 `role="status"` + `aria-live="polite"`；移动端允许课堂头部按内容增高，并将较长提示约束在导出按钮下方；`app/globals.css` 清理 M11 之外的历史格式化噪声，保留现有语义和本次移动端规则。

Windows 保留设备名不纳入本次处理：文件名仍只做常规非法字符、长度与重名安全化，不把几乎不会出现的输入变成导出硬门禁。

## 3. 风险

| 风险 | 应对 |
| --- | --- |
| pptxgenjs 渐变/自定义几何能力限制 | §2.3 已定义逐项降级路径，跳过计数透明上报 |
| 目标机器缺 Microsoft YaHei | 只声明字体名不嵌入字体，PowerPoint 自动回退 |
| 富文本 runs 解析遗漏 | 净化白名单即全集，单测钉住六种样式属性的全部合法组合 |
| 手写 path 占比过高导致 shape 大量跳过 | Prompt v2.4 已引导 pathFormula 预设；若真实课程跳过多，再评估 path → 图片降级 |

## 4. 与毕业论文的关系

M11 是工程增强，不做论文创新主张；导出能力可作为“系统实现”章节的演示点（现场导出 PPTX），MX 研究问题仍独立选择，不以 M11 为前置。
