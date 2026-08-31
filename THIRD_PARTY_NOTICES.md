# Third-party notices

## OpenMAIC

M8 的 `scene-slide.v2` 提示词裁剪自 THU-MAIC/OpenMAIC 固定提交
`59adbef03b63488a7ff1ea983cf0fbba51609f9f` 中的以下文件：

- `packages/@openmaic/generation/templates/slide-content/system.md`
- `packages/@openmaic/generation/templates/slide-content/user.md`

本项目删除了图片、视频、图表、复杂公式、模型自有 ID 和独立 Action 生成，改接
CourseBrief、SceneOutline、本项目的四类元素契约、MySQL 生成元数据与安全净化边界。
Slide/PPTElement、规范化和只读渲染的职责划分参考了同一提交中的 DSL、生成器与
Renderer，但由本项目按毕业设计范围重新实现。

OpenMAIC is licensed under the MIT License:
M9 的 `scene-interactive.v2` 裁剪自上述提交的
`packages/@openmaic/generation/templates/` 下 `diagram-content`、`simulation-content`、
`game-content`、`code-content` 的 system.md/user.md。保留分类教学意图、玩法与布局建议，
移除 OpenMAIC 专用动作与 3D 等未实现能力，改接本项目大纲、原始 HTML 输出、scene-meta、
fallback 和 InteractiveRuntime 桥接；允许外部依赖，但 iframe 仅 `allow-scripts`。
`lib/interactive/runtime-bootstrap.ts` 的内存存储兼容与错误转发裁剪自上游
`lib/utils/iframe.ts`；后处理与宿主职责参考 `interactive-post-processor.ts`、
`InteractiveIframeHost.tsx`。可终止 Worker、超时/停止和播放器接入由本项目实现。


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
