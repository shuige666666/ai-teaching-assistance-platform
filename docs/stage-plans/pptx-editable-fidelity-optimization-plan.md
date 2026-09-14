# PPT 可编辑保真优化开发方案

> 文档版本：1.0（2026-09-14）  
> 状态：已完成工程、结构、PowerPoint 渲染与用户主观验收  
> 归属：M11 已完成基线之后的独立增强，暂不占用新的主阶段编号  
> 关联能力：M8 `Slide/PPTElement`、M11 PPTX 资源包导出  
> OpenMAIC 参考版本：`f50a25644c9c3893503cf0727ccf613c0ce1e748`

## 1. 决策结论

本项工作以“继续生成可编辑的原生 PPTX，同时缩小网页课堂与 PowerPoint/WPS 的视觉差距”为目标。继续保留文本框、基础图形、自由形状、表格和图表等原生对象，不改为整页截图导出。

当前网页和 PPTX 已共用 `Slide/PPTElement` 数据，逻辑画布也都采用 16:9。现有差异主要不是整页比例错误，而是网页与 PPTX 两套渲染器使用了不同的文本内边距、段落规则、字体度量和图形映射。因此本项工作不重做 M11 导出链，也不新增导出专用页面模型，而是在现有映射层补齐保真能力。

本项工作独立于 M12 对话式课程修订 Agent。M11 已完成状态保持不变；本文记录的是后续质量增强，不把新增目标反向算作 M11 原验收缺口。正式纳入路线图时再决定使用 M11.x 或 MX 编号，编号不作为开工前置条件。

## 2. 目标与可接受边界

### 2.1 优化目标

1. 保持 1000 × 562.5 逻辑画布到 16:9 PPTX 的统一几何映射，不出现整体拉伸或位置比例漂移。
2. 统一网页和 PPTX 的文本框内边距、段落间距、行高、字距、字体、字号及水平/垂直对齐，使代表性页面中的换行和内容位置明显接近。
3. 将当前无法识别而跳过的正常 SVG path 尽可能导出为 PowerPoint 可编辑自由形状。
4. 将二次曲线、折线等路径保留为可编辑几何，不再统一按端点近似为直线。
5. 表格和图表继续导出为原生对象，并补齐影响明显的字体、边距、颜色和边框映射。
6. 无法完整保真的内容继续给出轻量降级报告，不因为局部差异阻断整份课程导出。

### 2.2 非目标

- 不追求浏览器与 PowerPoint 的逐像素一致，也不设置像素差硬门禁。
- 不把整页渲染为 PNG/SVG 背景，不牺牲整页编辑能力换取截图级一致。
- 第一批不做 PPTX 字体文件嵌入，不扫描用户操作系统字体，不因字体缺失拒绝导出。
- 第一批不手写完整 OOXML 渐变、图案、滤镜和阴影引擎。
- 不改变 `Slide/PPTElement` 主契约，不新增第二套导出专用页面数据。
- 不把 interactive、quiz、课堂动作或网页交互转换成 PPTX 页面。
- 不提前建设专业幻灯片编辑器，也不把本项工作并入 M12 Agent 工具范围。

## 3. 当前实现基线与差距

### 3.1 坐标基线与本次修正

网页 `SlideCanvas` 使用固定的 1000 × 562.5 逻辑画布，再通过统一 `scale` 适配课堂容器。PPTX 使用 13.333 × 7.5 英寸的 16:9 画布，位置与尺寸按 `1 unit = 1/75 inch` 映射，两端宽高比一致。本次实现进一步确认：课程中的字号和线宽也是逻辑画布单位，不能套用普通 CSS 的 `1px = 0.75pt`，而应与几何统一按 `72/75 = 0.96pt` 换算；旧值会让 PPT 中的字体、描边和文本内边距相对整页约小 22%。

M11 已经把文字、预设形状、直线、代码、图表和表格转换成原生 PPTX 对象，并对渐变、曲线和无法识别的 path 进行计数上报。这些能力继续复用。

### 3.2 优化前主要差距

| 维度 | 网页课堂 | 当前 PPTX | 影响 |
| --- | --- | --- | --- |
| 文本内边距 | 文本框固定 `padding: 10px` | 普通文本框 `margin: 0` | 内容起点、有效宽度和换行不同 |
| 段落间距 | `<p>` 默认下边距 7px | 没有等价段后间距 | 多段文字纵向位置不同 |
| 行高与富文本 | 浏览器按 CSS/HTML 排版 | 只映射部分 runs 属性 | 行距、列表、段落和换行可能不同 |
| 字体 | 浏览器使用 CSS 字体与 fallback | PPTX 只声明字体名 | 缺字体或两端 fallback 不同时字宽变化 |
| 普通形状 | SVG path 可直接显示 | 主要依赖 `pathFormula` 预设 | 无预设 path 可能被跳过 |
| 曲线 | SVG 按真实控制点绘制 | 端点直线近似 | 曲线形态丢失 |
| 渐变 | 浏览器按色标渲染 | 取首个色标作为纯色 | 颜色观感明显变化 |
| 图表和表格 | ECharts / HTML table | PowerPoint 原生对象 | 数据可编辑，但默认排版存在差异 |

## 4. OpenMAIC 参考与取舍

### 4.1 可直接借鉴的实现思想

OpenMAIC 同样让浏览器 Renderer 和 PPTX Exporter 共用一份 `Slide` DSL。其网页文本元素使用 10px 内边距，PPTX 导出时把同一数值换算为文本框 margin，并继续映射 `lineHeight`、`wordSpace`、`paragraphSpace`、字体、颜色、旋转、透明度、描边和阴影。

OpenMAIC 的富文本转换先将 HTML 解析为 AST，再生成 PptxGenJS text runs，已覆盖字号、颜色、高亮、粗体、斜体、上下标、删除线、下划线、超链接、列表和缩进。当前项目可借鉴这套“白名单语义转换”思路，但只增量实现真实课程会产生的标签和样式，不复制全部解析分支。

OpenMAIC 对普通 SVG path 使用以下路线：

```text
SVG path
  → 路径命令解析
  → 圆弧转换为三次贝塞尔
  → M/L/Q/C/Z 控制点归一化
  → PptxGenJS custGeom points
  → OOXML <a:custGeom>
```

该结果仍是 PowerPoint 自由形状，可以移动、缩放、调整填充与描边。特殊装饰图形才降级为 SVG 图片。当前项目已使用 `pptxgenjs 4.0.1`，其 npm 包本身已经提供 `CUSTOM_GEOMETRY/custGeom` 和 `points`，因此不需要复制 OpenMAIC 的整份 `packages/pptxgenjs`，只需适配路径解析与映射逻辑。

OpenMAIC 的表格和图表继续使用 `addTable`、`addChart` 原生对象；LaTeX 优先使用可编辑 OMML、失败才降级 SVG。这体现了“原生对象优先、无法表达时局部降级”的原则。

### 4.2 不直接照搬的部分

OpenMAIC 的文本导出默认启用 `autoFit: true`，可能让 PowerPoint 自动改变文本框尺寸；本项目优先保持元素几何不变，不把自动扩框作为普通文本默认值。代码块等确定需要容纳长内容的元素可继续局部使用 `shrink`。

OpenMAIC 网页端把 `paragraphSpace` 表达为段后间距，PPTX 端当前映射成 `paraSpaceBefore`。本项目应统一为明确的段后语义，并优先映射到 `paraSpaceAfter`，避免照搬这一偏差。

OpenMAIC 的渐变也没有原生保留，而是混合首尾颜色后降级为纯色；字体同样只声明名称而没有嵌入 PPTX。因此它不能作为像素级保真的完成答案。

OpenMAIC 的 PPTX 导出文件同时承担元素映射、媒体解析、资源嵌入和下载流程，体积较大。本项目继续保留 `pptx-mapping.ts`、`rich-text-runs.ts` 与 `build-course-package.ts` 的职责分离，不复制单文件实现。

如果后续直接裁剪 OpenMAIC 的路径解析代码，应记录上游文件、参考 commit 和本地修改，并在已有第三方许可证文档中保留 MIT 来源说明。

## 5. 目标设计

### 5.1 共享文本布局解析

新增一个纯函数模块，建议为：

```text
lib/slides/resolve-text-layout.ts
```

它负责从文本元素和主题中得到完整的布局结果，例如：

```ts
interface ResolvedTextLayout {
  fontFamily: string;
  fontSizePx: number;
  color: string;
  lineHeight?: number;
  letterSpacingPx?: number;
  paddingPx: [number, number, number, number];
  paragraphSpacingPx: number;
  align: "left" | "center" | "right" | "justify";
  verticalAlign: "top" | "middle" | "bottom";
}
```

第一批不要求把这些字段全部持久化到课程 JSON。解析函数继续使用当前默认值，例如网页已有的 10px 文本内边距和 7px 段落间距，旧课程无需迁移。

网页 Renderer 和 PPTX Exporter 都读取该结果：网页转换成 CSS，PPTX 将 px 转成 point。普通文本框保持固定宽高，不默认扩框；只有代码块或实际确认的溢出场景才使用 `shrink`。

### 5.2 富文本 runs 增量扩展

继续以 `sanitize-html` 后的白名单内容为输入，优先补齐：

- `<p>`、`<br>` 的段落和软换行；
- `strong/b`、`em/i`、`u`；
- `font-size`、`color`、`font-family`；
- `line-height`、`text-align`；
- 当前课程契约允许的段落级属性。

段落级属性应落在段落对应的 run 上，不把所有样式提升为整个文本框默认值。无法识别的合法文本结构继续降级为纯文本，不中断导出。

### 5.3 SVG path 与曲线原生化

新增纯函数模块，建议为：

```text
lib/export/svg-path-points.ts
```

实现范围：

1. 解析绝对与相对的 M/L/H/V/C/S/Q/T/A/Z 命令。
2. 将 H/V/S/T 规范化为明确端点与控制点。
3. 将 A 圆弧转换成一个或多个三次贝塞尔片段。
4. 根据 shape 的 `viewBox` 与元素宽高缩放控制点。
5. 输出 PptxGenJS `custGeom` 的 `points`。
6. path 非法时返回可解释的降级结果，由现有完成提示计数，不让单个元素中断整份导出。

实现时优先使用成熟的小型路径库，例如 OpenMAIC 使用的 `svg-pathdata` 与 `svg-arc-to-cubic-bezier`，不自行编写完整 SVG path 语法分析器。

预设矩形、圆形、三角形、菱形和箭头继续走 PowerPoint preset shape。只有不存在可靠 `pathFormula` 或确实包含曲线的元素才走 `custGeom`，避免把所有基础对象都变成自由形状。

线条保持分流：普通直线仍使用 PowerPoint Line；曲线与折线使用 `custGeom`，同时保留颜色、宽度、虚线、透明度和箭头语义。

### 5.4 局部降级策略

优先级固定为：

```text
原生预设对象
  → 原生自由形状 custGeom
  → 局部 SVG 图片
  → 跳过并在导出结果中明确提示
```

只有无法转换且主要承担装饰作用的元素才允许使用局部 SVG。承载关键文字、数据或教学结论的元素不得因为视觉效果复杂而整体转成不可编辑图片；文字应与背景装饰拆开导出。

渐变第一批继续采用可编辑纯色近似并计数。可将“取首个色标”调整为更接近整体观感的代表色，但不在第一批手写 OOXML 渐变。如果真实课程持续出现渐变影响辨识，再单独评估原生渐变或仅背景装饰 SVG 化。

### 5.5 字体策略

网页和 PPTX 使用完全相同的规范化字体名称，元素级字体同时应用到文本框默认属性和没有显式字体的 runs。课程主题字体作为统一 fallback。

第一批不检测用户电脑字体，也不阻止导出。文档和导出提示只说明：PPTX 未嵌入字体，目标机器缺少字体时 PowerPoint/WPS 会回退，换行仍可能变化。优先使用答辩环境通常具备的中文字体，例如 `Microsoft YaHei`。

### 5.6 表格与图表

表格继续使用原生 Table，补齐单元格内边距、字体、字号、对齐、填充、边框和列宽比例。当前 `PPTTableElement` 只表达字符串二维数组，不凭空推断合并单元格；以后主契约确有合并语义时再增量映射。图表继续使用原生 Chart，补齐系列颜色、字体、图例、坐标轴和 plot area 等当前确实影响展示的配置。

不以复刻 ECharts 的全部视觉细节为目标；验收重点是数据正确、没有遮挡、主要配色接近且可以在 PowerPoint 中编辑。

## 6. 实施增量

### 增量 A：文本布局保真

1. 建立共享文本布局解析函数，并让网页和 PPTX 使用相同默认值。
2. 将网页 10px 内边距映射成 PPTX 对应文本框 margin。
3. 将网页段后间距映射为 PPTX `paraSpaceAfter`。
4. 统一字号、字体、行高、字距、颜色和对齐转换。
5. 扩充当前富文本 runs 的核心标签与段落映射。
6. 使用当前“三栏卡片”页面完成第一轮 PowerPoint 人工对照。

增量 A 完成后，标题、卡片正文和底部结论条的内容起点、有效宽度和换行应明显接近网页课堂。

### 增量 B：自由形状与曲线

1. 引入或裁剪 SVG path 解析与圆弧转贝塞尔能力。
2. 将无 `pathFormula` 的正常 shape 输出为 `custGeom`。
3. 将曲线和折线输出为自由形状，不再统一直线近似。
4. 保持预设形状与普通直线的现有简单映射。
5. 非法 path 继续局部降级并计数。

### 增量 C：表格、图表与降级收口

1. 补齐当前表格契约已有的单元格边距、字体、边框、填充与行列尺寸映射。
2. 补齐图表主题色、字体、图例与坐标轴的核心样式。
3. 调整渐变代表色策略，并保持降级说明。
4. 汇总真实样例中仍存在的差异，只有高频问题才继续进入本项工作。

增量 C 不要求把 PowerPoint 原生图表变成 ECharts 的像素复制品。

## 7. 文件影响范围

实际修改：

```text
components/slides/slide-element.tsx
components/slides/slide-canvas.module.css
lib/export/rich-text-runs.ts
lib/export/pptx-mapping.ts
lib/export/build-course-package.ts
lib/slides/normalize-slide.ts
```

实际新增：

```text
lib/slides/resolve-text-layout.ts
lib/export/pptx-units.ts
lib/export/svg-path-points.ts
tests/domain/export-package.test.ts（补充少量纯函数与 PPTX XML 测试）
```

如实现 SVG path 解析需要新增依赖，再同步更新 `package.json`、锁文件和 `THIRD_PARTY_NOTICES.md`。不复制 OpenMAIC 整个导出 hook 或 vendored PptxGenJS。

## 8. 核心测试与人工验收

### 8.1 自动化测试

只增加与本次风险直接相关的核心测试：

1. 共享文本布局默认值及 px → pt 转换。
2. 段落、软换行、字体、字号、颜色和常用行内格式的 runs 映射。
3. M/L/Q/C/A/Z 路径转换，包含一个圆弧转贝塞尔案例。
4. 解包生成的 PPTX，确认自由形状包含 `<a:custGeom>`，曲线包含相应控制点。
5. 现有坐标、旋转、层级、图表和表格导出不回归。

不建立所有富文本样式的笛卡尔积测试，不对不同 PowerPoint/WPS 版本设置像素差阈值，也不因缺少少见字体增加环境门禁。

### 8.2 人工样例

保留三到四个代表性样例即可：

- 标题、三栏卡片和底部结论条页面；
- 包含任意 path、折线或曲线的页面；
- 表格页面；
- 图表页面。

在网页课堂与 PowerPoint 中只比较中间的 16:9 页面，不比较课堂侧栏、PowerPoint 工具栏或不同窗口缩放。PowerPoint 作为主要检查环境，WPS 做一次兼容性冒烟。

### 8.3 完成标准

- 页面整体比例、元素位置和宽高没有回归。
- 在相同字体可用的环境下，代表性文本框的内边距、段落间距和换行明显接近网页；不存在文字丢失、严重溢出或遮挡。
- 普通文本、基础形状、自由形状、表格和图表可以在 PowerPoint 中继续编辑。
- 正常 SVG path 不再因为缺少 `pathFormula` 而直接消失。
- 曲线页面不再统一退化为直线。
- 仍然无法完整映射的元素在导出完成提示中如实说明，不阻断其他页面导出。
- 相关 lint、TypeScript、核心单元测试、资源包导出 E2E 和一次 PowerPoint/WPS 人工核对通过。

抗锯齿、字体引擎造成的细微字宽差异、PowerPoint 原生图表内部间距以及自由形状控制点实现差异不作为失败条件。

## 9. 实施顺序与停止条件

按“增量 A 文本 → 增量 B 自由形状与曲线 → 增量 C 表格图表收口”的顺序实施。每个增量完成后用代表性页面检查真实改善，再决定是否进入下一项，不先建设完整视觉比较平台。

当代表性页面达到内容不丢失、主要对象可编辑、文字与几何差异不影响正常演示后，本项工作即可停止。剩余低频渐变、特殊字体和装饰性 path 差异进入后续清单，不继续扩大首轮开发范围。

## 10. 2026-09-14 实施结果

本次已完成增量 A、B 以及增量 C 的当前契约部分。新增共享 `resolveTextLayout`，网页和 PPTX 现在共用 18 unit 默认字号、1.2 倍默认行高、10 unit 文本内边距、7 unit 段后间距和垂直对齐；PPTX 的字号、线宽、内边距与段距统一使用 `72/75` 换算。富文本继续维持现有安全标签集合，新增白名单内 `font-family` 的 run 级映射，没有借机开放链接、原始 HTML 或任意 CSS。

SVG path 使用 npm `svg-pathdata 6.0.3` 完成绝对/相对命令、H/V、S/T 和 A 圆弧的规范化；没有采用要求 Node 22.16+ 的 v8，以保持项目既有 Node 20.9+ 部署边界。可靠 `pathFormula` 仍导出为 PowerPoint 预设对象，其他合法 path 导出为 PptxGenJS `custGeom` 自由形状；二次曲线保留控制点，不再按端点直线近似。非法 path 仍只跳过当前元素并计入现有降级报告。PptxGenJS 4.0.1 的运行时已支持 `custGeom`，但公开 TypeScript 枚举缺少该成员，因此本地只做了有注释的窄类型适配，没有复制或修改第三方包源码。

表格继续是原生 Table，现按网页的 14 unit 字号、7×12 unit 单元格边距、行高、表头/正文填充和边框颜色导出；图表继续是原生 Chart，轴标签、图例、轴线与网格线按网页核心样式收口。页面与形状渐变仍降级为可编辑纯色，但代表色由“固定取首色”调整为 50% 位置插值色，并继续如实提示。

自动验收结果：`pnpm lint`、`pnpm build`、完整 `pnpm test`（34 个文件、197 项）通过；新增核心用例解包 PPTX 后确认 `<a:custGeom>`、`<a:quadBezTo>`、文本框 margin、1.2 倍行距和段后距已写入 OOXML。`EXPORT_BASE_URL=http://localhost:3000 pnpm check:export` 对现有两门真实 ready 课程通过，分别生成 3 页与 4 页 PPTX，表格和原生柱状图部件仍完整，当前样例只报告预期的“形状渐变降级纯色”。导出样例已更新到 `output/export-check/`。

本机未安装 LibreOffice，但已使用本机 Microsoft PowerPoint 只读打开 TCP 样例，并导出 3 张 `1600×900` PNG 做渲染冒烟；标题、卡片、表格和底部结论未见截断或越界。课程第 2 页的空白表格列来自保存的四列课程数据（每行第 4 个单元格为空），不是导出新增。2026-09-14，用户进一步检查了 `output/export-check/` 中的样例，并自行下载、打开多门课程进行主观对照，确认新版效果较旧版明显更和谐；本项工作据此完成最终人工验收。字体引擎的细微字宽、渐变纯色近似和原生图表内部间距仍属于既定边界，不因本次验收被解释为逐像素一致。
