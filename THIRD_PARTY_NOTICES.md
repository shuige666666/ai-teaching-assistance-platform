# Third-party notices

## OpenMAIC

2026-10-23 的互动脚本语法检查参考 OpenMAIC 提交
`8a55b2dcf150b5f855e7d069b584c84c686e14a8` 的
`packages/@openmaic/generation/src/interactive-script-validator.ts`，按本项目错误契约重新实现。
使用 `parse5`（MIT）解析真实 HTML 节点，再用 Node.js `Script` 仅编译普通内联脚本；
跳过 JSON、外部及 module 脚本，不进行脚本执行或教学语义验证。

M8 的 `scene-slide.v2` 提示词裁剪自 THU-MAIC/OpenMAIC 固定提交
`59adbef03b63488a7ff1ea983cf0fbba51609f9f` 中的以下文件：

- `packages/@openmaic/generation/templates/slide-content/system.md`
- `packages/@openmaic/generation/templates/slide-content/user.md`

本项目删除了图片、视频、图表、复杂公式、模型自有 ID 和独立 Action 生成，改接
CourseBrief、SceneOutline、本项目的四类元素契约、MySQL 生成元数据与安全净化边界。
Slide/PPTElement、规范化和只读渲染的职责划分参考了同一提交中的 DSL、生成器与
Renderer，但由本项目按毕业设计范围重新实现。

`scene-slide.v2.2`（2026-09-05 视觉升级）进一步从同一提交的 `slide-content/system.md`
移植了量化排版规则（文字宽度容量估算、字号×行数高度查表、对齐公式、间距标准、
对称元素数值一致）、三种装饰线配方（标题下划线、章节分割线、文字侧竖条）、
输出前自检清单与一个整页 few-shot 示例的结构；chart/table 数据元素、主题预设体系、
shape 渐变与 pathFormula 形状预设、按场景角色的版式分支为本项目自研扩展，
非上游内容的复制。

主题预设中的颜色来源：`经典蓝橙` 的 themeColors、fontColor 与 outline 逐字取自
同一提交的 `lib/edit/slide-defaults.ts` DEFAULT_THEME；`淡彩清新` 的卡片底色与
配套深色文字（#dbeafe/#dcfce7/#fef3c7/#e8f4fd 配 #1e40af/#166534/#92400e/#333333）
取自同一提交 `slide-content/system.md` 中的卡片示例。`学术蓝青` 为本项目原有色板。

`outline.v2.4` 的 [Chart]/[Table] 可视化标记约定（大纲阶段把图表/表格需求写入
slide 页 keyPoints，经 keyPoints 透传给场景阶段执行）移植自同一提交
`packages/@openmaic/generation/templates/requirements-to-outlines/system.md` 的
"Special Element Design Guidelines"（93-122 行）；标记示例按本项目四种图表类型
（bar/column/line/pie）改写。

M11 资源包导出（scene-slide.v2.4 同期）使用 npm 分发的 `pptxgenjs`（MIT License）生成 PPTX、
`jszip`（MIT License）打包 ZIP；PPTElement → PPTX 的映射思路参考上述提交的
`lib/export/use-export-pptx.ts`，未复制其代码。两库通过 npm 安装，许可证文本见各自包内文件。

2026-09-14 的 PPT 可编辑保真优化使用 npm 分发的 `svg-pathdata 6.0.3`（MIT License）解析、
规范化 SVG path 并把圆弧转换为贝塞尔曲线，再由 `pptxgenjs` 输出可编辑 `custGeom`。
实现思路参考 OpenMAIC `f50a25644c9c3893503cf0727ccf613c0ce1e748` 的路径导出链，
未复制其解析器源码，也未引入或修改 OpenMAIC 内置的 PptxGenJS 分支。许可证文本见 npm 包内文件。

M12 的课程工具命名、`read_stage` tree/text/source 投影和“读取目标页 → 最小原子补丁 →
按需复读确认”提示词流程参考同一 OpenMAIC 代码库的
`lib/server/agent-runtime/course-tools.ts`、`dsl-tools.ts` 与课程编辑工具。实现已按本项目
Course/Scene Schema、MySQL Repository、SSE 和 quiz 作答事务重新编写；未复制其后台 Worker、
Skills、多 Agent、媒体、TTS 或跨进程运行设施。

M12.4 使用 npm 分发的 `react-markdown` 与 `remark-gfm`（均为 MIT License）渲染 Agent
最终回答中的 Markdown 与 GFM 表格；未启用原始 HTML。许可证文本见各自包内文件。

OpenMAIC is licensed under the MIT License:
M9 的 `scene-interactive.v2` 裁剪自上述提交的
`packages/@openmaic/generation/templates/` 下 `diagram-content`、`simulation-content`、
`game-content`、`code-content` 的 system.md/user.md。保留分类教学意图、玩法与布局建议，
移除 OpenMAIC 专用动作与 3D 等未实现能力，改接本项目大纲、原始 HTML 输出、scene-meta、
fallback 和 InteractiveRuntime 桥接；允许外部依赖，但 iframe 仅 `allow-scripts`。
`lib/interactive/runtime-bootstrap.ts` 的内存存储兼容与错误转发裁剪自上游
`lib/utils/iframe.ts`；后处理与宿主职责参考 `interactive-post-processor.ts`、
`InteractiveIframeHost.tsx`。可终止 Worker、超时/停止和播放器接入由本项目实现。
`lib/interactive/layout-templates.ts` 的三种布局、Canvas 尺寸隔离与数值输入示例由本项目编写，
状态切换/重置思路参考上述 simulation/game Prompt；不是上游完整模板的直接复制。
错误缓存重放参考 `lib/utils/iframe.ts`，本项目仅缓存首个错误，不接入上游编辑 Agent。
ResizeObserver 循环与其他未处理异常均降级；用户主动重新生成复用本项目 AIAdapter 和短事务保存。


MIT License

Copyright (c) 2026 THU-MAIC

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
