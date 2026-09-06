# 11. M11 资源包导出与 M12 幻灯片编辑器开发方案

> 文档版本：1.0（2026-09-05）
> 状态：M11 已实现并完成结构自检（2026-09-05）；AC-E02 待人工在 PowerPoint/WPS 中打开核对；M12 为概要设计，开工前按本文档细化
> 上游依赖：M8 只读幻灯片（已完成）、M9 自包含互动页（已完成）、Course v5 契约（稳定）

## 1. 决策结论

2026-09-05 用户确认：**先做导出，两阶段编号互换**——原路线图中的 M12（资源包导出）改为 **M11**，原 M11（幻灯片编辑器）改为 **M12**。编号互换已同步至 docs/01、02、03、06、07、08、09、10 与 README。

互换理由：导出工作量约为半个里程碑（映射机械、库成熟、参考实现现成），成果可在答辩现场演示；v2.2 起的数据化元素设计（chart 只存数据、shape 走 pathFormula 预设）与 PPTX 原生能力高度契合；而编辑器是交互重活，放到后一阶段。

两个阶段共用同一 `Slide/PPTElement` 契约（docs/03 AD-X01），互不依赖、可独立交付。**解耦的关键约束：M12 编辑器的保存必须复用与生成侧相同的净化与 SlideSchema 校验边界，保证"编辑产出的数据 ⊆ 契约数据"**——M11 的导出映射因此只需覆盖契约覆盖面，不感知编辑器的存在。

本文档即路线图（docs/06 §17）要求的"M11/M12 开始前另行确认范围"。后续范围调整先改本文档，再改代码。

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
- 全客户端链路：课堂页/生成页新增"导出资源包"按钮 → 拉取课程 JSON → 生成 PPTX → 组装 ZIP → 触发浏览器下载。无服务端文件中转、无新增 API；
- PPTX 画布：16:9（对应逻辑画布 1000 × 562.5，映射系数 1 逻辑 px = 1/75 英寸）；
- 换算系数统一：位置与尺寸 1 逻辑 px = 1/75 英寸；字号 1px = 0.75pt（CSS px → PPT point）；
- 依赖登记：安装时锁定 pptxgenjs/jszip 版本，并在 THIRD_PARTY_NOTICES.md 登记来源与许可证。

### 2.3 元素映射表（核心设计）

| PPTElement | PPTX 映射 | 保真度决策 |
| --- | --- | --- |
| text | 文本框 + 文本 runs：解析净化 HTML——`p` → 段落，`strong/b` → bold，`em/i` → italic，`u` → underline，span 内联 `font-size/color/line-height/text-align` 映射到 runs 与段落属性 | 净化白名单（6 种样式属性）即解析全集，单测钉住；解析不到的结构降级为纯文本 |
| shape | `pathFormula` 预设 → PPTX 预设几何：rect→rect、roundRect→roundRect、circle→ellipse、triangle→triangle、diamond→diamond、rightArrow→rightArrow；shape `gradient`（v2.2）→ pptxgenjs 渐变填充，不支持时降级为首个色标纯色 | 手写任意 `path`（无 pathFormula）第一版降级为跳过并计数上报；不尝试任意 path 转换 |
| line | 直线连接符：start/end → 端点坐标，`width` → 线宽，`points` 端点 → arrow/dot 端头 | `curve` 二次曲线第一版展平为直线，导出完成提示中计入降级数量 |
| code | 等宽字体文本框；`fileName`/`language` 写入首行注释行，`lines` 逐行写入 | `showLineNumbers` 不导出行号（PPT 无等宽对齐需求） |
| chart | `addChart` 原生图表：column→bar（纵向）、bar→bar（横向）、line→line、pie→pie；`labels`/`series` 直传，`themeColors` → 系列配色 | 数据元素与 PPTX 原生图表天然契合，无损映射 |
| table | `addTable`：`colWidths` 比例 → 列宽，`rows` → 单元格，`header` → 首行加粗 + 底色 | 单元格纯文本（规范化已保证） |
| background | solid → 纯色填充；linear gradient → pptxgenjs 渐变（若版本不支持则取首个色标降级为纯色） | radial 渐变第一版降级纯色 |
| theme | `fontName` → 全局字体声明，`fontColor` → 默认字色，`themeColors` → 强调色序列 | 字体声明 `Microsoft YaHei`，不嵌入字体文件 |

通用保真原则：**映射不了的元素跳过并计数，绝不中断导出**；完成提示中明确列出降级/跳过数量。

### 2.4 模块结构

```text
lib/export/
├─ pptx-mapping.ts        # PPTElement × N → pptxgenjs 对象的纯函数映射（可单测）
├─ rich-text-runs.ts      # 净化 HTML → 文本 runs 解析（纯函数，可单测）
├─ filename.ts            # 标题安全化（非法字符、长度、重名）
└─ use-export-zip.ts      # 客户端 hook：课程 JSON → PPTX → ZIP → 下载
components/export/        # "导出资源包"按钮与进度提示（挂课堂页/生成页）
```

### 2.5 测试与验收

- 单元测试：映射纯函数逐类覆盖（含降级分支）、runs 解析白名单全集、文件名安全化（非法字符/超长/空标题）；
- 验收（新增 AC-E 系列，写入 docs/08 前先在本文件维护）：
  - AC-E01 真实 ready 课程导出 → 解包校验 ZIP 结构（一个 PPTX + interactive 命名规范）✅ 2026-09-05 两门真实课程通过；
  - AC-E02 PPTX 在 PowerPoint 与 WPS 中人工打开核对：文字、形状、图表、表格可读且顺序正确 ⏳ 待用户执行（ZIP 样例在 output/export-check/）；
  - AC-E03 chart 元素导出为可编辑的 PPTX 原生图表（非图片）✅ barChart 部件生成、数据无损；
  - AC-E04 含降级元素的导出在完成提示中如实列出数量 ✅ 浏览器链路显示"形状渐变降级纯色 ×1"；
  - AC-E05 导出过程不产生任何写库操作（revision 不变）✅ 纯只读转换，未调用任何写接口。
- e2e：mock 课程全流程回归新增导出按钮冒烟（结构断言，不解包内容）。

### 2.6 硬边界

不做 `.maic.zip` manifest/导入协议、不做视频/音频导出、不承诺互动页离线、不生成 manifest/README/assets、quiz 不进 PPTX、不改 `Slide/PPTElement` 契约。

### 2.7 开工前补充决策（2026-09-05）

1. **入口位置**：导出按钮放在课堂页头部区域（课程 JSON 已在客户端加载，零额外请求）；生成页入口留到第二批；
2. **可用性规则**：`ready` 与 `partial_failed` 课程均可导出（导出全部已保存场景）；`draft`/`outline_ready` 无场景可导出，按钮禁用并提示；
3. **能力 spike 前置**：全量实现前先做一个最小 spike——用 pptxgenjs 生成"文本 + 渐变圆角矩形 + 原生柱状图"的单页样张，验证渐变填充与原生图表的实际支持度，再按 §2.3 的降级路径定稿映射；
4. **降级透明化**：AC-E04 的"跳过/降级计数"在导出完成提示中按元素类型分组列出，便于发现映射盲区。

## 3. M12：PPT 式幻灯片编辑器（概要设计，开工前细化）

### 3.1 第一批范围

选择、拖拽、缩放、删除、文字编辑、撤销重做、MySQL 保存。**明确排除**：chart/table 的内容编辑（图表数据、表格单元格）、旋转编辑、复制粘贴、对齐吸附、图层管理——这些属于第二批或更远。

### 3.2 架构概要

- `components/editor/`：`EditorOverlay`（命中测试、选择框、缩放角手柄）、编辑状态机与命令栈（undo/redo）；
- 渲染继续复用只读 `SlideCanvas`，编辑交互由叠加层接管（overlay 层恢复 pointer-events，命中测试按 z 序 = 数组序倒序）；
- 坐标换算：复用现有 ResizeObserver 的 scale，screen ↔ logical（1000 × 562.5）双向映射；
- 保存：新 API `POST /api/courses/[courseId]/scenes/[outlineId]/edit`，携带 `expectedRevision` 与编辑后画布，服务端在短事务内将画布过 `SlideSchema` + sanitize（与生成侧同一边界）后整场替换——复用 quiz 手动编辑已验证的事务模式；
- 保存失败/冲突保留原版本（与修订/重生成行为一致）。

### 3.3 与 M11 的解耦约束（重申）

编辑保存走同一契约边界 ⇒ 编辑产出 ⊆ 契约数据 ⇒ M11 导出映射无需任何感知或改动。若未来编辑器需要突破契约（例如新增样式能力），必须先扩 `SlideSchema` 并同步 M11 映射，不允许绕过。

### 3.4 测试概要

命令栈与坐标换算纯函数单测；保存冲突/失败保留原版本用例（复用 repository 测试模式）；Playwright 编辑冒烟（选择→拖动→保存→刷新恢复）。开工前本节细化为与 M11 §2.5 同粒度的 AC 列表。

## 4. 实施顺序

1. M11：`pptx-mapping`/`rich-text-runs` 纯函数与单测 → 客户端导出链路 → 真实课程 AC-E01～E05 验收 → docs/07/08 登记；
2. M12：单独一轮范围确认 → 按 §3 细化 AC → 实现 → 验收；
3. 两阶段各自独立提交，均不进入 v0.4 硬门。

## 5. 风险

| 风险 | 应对 |
| --- | --- |
| pptxgenjs 渐变/自定义几何能力限制 | §2.3 已定义逐项降级路径，跳过计数透明上报 |
| 目标机器缺 Microsoft YaHei | 只声明字体名不嵌入字体，PowerPoint 自动回退 |
| 富文本 runs 解析遗漏 | 净化白名单即全集，单测钉住六种样式属性的全部合法组合 |
| 手写 path 占比过高导致 shape 大量跳过 | Prompt v2.4 已引导 pathFormula 预设；若真实课程跳过多，再评估 path → 图片降级 |
| M12 编辑交互范围膨胀 | 第一批清单锁死；chart/table 内容编辑明确排除 |

## 6. 与毕业论文的关系

M11/M12 均为工程增强，不做论文创新主张；可/export 能力可作为"系统实现"章节的演示点（现场导出 PPTX），MX 研究问题仍独立选择，不以本两阶段为前置。
