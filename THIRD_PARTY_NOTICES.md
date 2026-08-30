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
