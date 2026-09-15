# 课程文件夹删除与课程库密度 Design QA

- source visual truth path: `C:\Users\21051\AppData\Local\Temp\codex-clipboard-c5904ead-7769-4021-a15b-803e3e9d5aff.png`、`C:\Users\21051\AppData\Local\Temp\codex-clipboard-33b93197-c8e0-452f-8446-4d51038e2a1e.png`
- implementation screenshot path: Codex computer-use 本轮内联捕获；浏览器接口未暴露可持久化的本地截图路径
- implementation URL: `http://localhost:3000/`
- viewport: 1699×780 CSS px，devicePixelRatio 1.5
- source pixels: 438×294 px、2145×810 px；第二张在会话中按比例缩放至 2048×773 展示
- state: 22 门课程、包含 3 门课程的长名称文件夹；默认课程库、文件夹删除选择菜单、危险删除确认态

## Full-view comparison evidence

参考图仅提供删除语义和密度目标，不作为视觉复刻稿。实现保留本平台的浅蓝网格背景、深蓝直角描边、衬线课程标题和方形操作控件。1699px 视口下 `.course-grid` 实测为四个 319.5px 网格列；课程卡片实测约 320×242px，一行稳定显示四门课程，没有页面级横向溢出。

## Focused region comparison evidence

- 长文件夹名：筛选项总宽度实测 269px，名称可见区域 204px、内容滚动宽度 305px，确认发生单行省略；按钮 `title` 保留完整名称。
- 删除选择：276px 直角描边菜单显示“仅删除文件夹”和“删除文件夹和 3 门课程”，危险项使用平台既有 danger surface 与红色文本，没有照搬参考图的圆角浮层。
- 确认状态：危险项点击后替换为同位置确认面板，明确显示课程数量、永久删除说明、取消和红色确认按钮；删除选择菜单和二次确认状态均可通过点击外部区域收起，自动验收没有执行真实删除。
- 响应式：桌面四列，1080px 以下三列，860px 以下两列，700px 以下一列。

## Required fidelity surfaces

- Fonts and typography: 沿用项目 `--font-display`、`--font-body`、`--font-mono`；课程标题收紧到 20px，菜单主次文案分别为 11px/9px，长文本均有明确截断策略。
- Spacing and layout rhythm: 卡片间距 14px、卡片内容边距 18px；菜单与文件夹筛选项仍遵循项目直角边框和 5px 偏移阴影。
- Colors and visual tokens: 普通动作使用 `--ink`、`--muted` 和 `--paper-deep`，危险动作使用 `--danger-surface`、`--danger-ink`，红色只承担不可逆操作语义。
- Image quality and asset fidelity: 本区域没有位图素材；文件夹与删除图标使用 `lucide-react` 矢量图标，缩放清晰。
- Copy and content: 两种删除结果、课程数量和永久删除后果均显式写出；没有使用含糊的单个“删除”入口。

## Comparison history

首轮代码检查发现原实现只有“删除文件夹”单一路径、长名称无限扩张且桌面仅三列。修正后增加两种删除模式与危险确认，将文件夹筛选项限制到 270px，并把课程区改为四列紧凑布局。浏览器复查确认四列宽度、名称截断、两种菜单项与确认态均可见，控制台 warning/error 为 0。

## Findings

没有遗留 P0、P1 或 P2 问题。实现与参考图在圆角、背景和卡片形态上的差异是遵循本平台设计系统的有意选择。

## Implementation checklist

- [x] 非空文件夹提供保留课程和连课程删除两种模式
- [x] 危险模式显示课程数量并进行第二次确认
- [x] 长文件夹名称省略并保留完整悬停提示
- [x] 桌面四列及三、二、一列响应式降级
- [x] 取消删除不产生数据写入
- [x] 点击菜单外部可退出删除选择和二次确认
- [x] 浏览器控制台无 warning/error

final result: passed
