# M7.0 课程质量基线

M7.0 只负责固定六个公开测试输入、保存 v0.3 生成事实，并为每个已生成场景留下一份 MHTML。它不修改生产 Prompt、Schema、Renderer 或 CSS，也不要求现在凭空给课程打分。人工评分延后到 v0.4 课程生成后，以同题目的 v0.3/v0.4 配对方式完成。

## 目录

```text
eval/
├─ README.md
├─ config/
│  └─ course-quality.v1.json       # 六个初始 Prompt、类别与生成策略
├─ scripts/
│  ├─ course-quality-lib.mjs       # 输入校验与事实摘要
│  ├─ scene-archive-lib.mjs        # Chromium MHTML 归档
│  ├─ collect-course-quality-baseline.mjs
│  └─ archive-existing-course-quality-run.mjs
└─ runs/                           # 正式运行结果，Git 忽略
```

一次完成的运行目录只有三类内容：

```text
<runId>/
├─ summary.md                      # 给人看的课程状态和数量摘要
├─ report.json                     # 课程内容、生成元数据、错误和 MHTML 清单
└─ scenes/
   └─ <topicId>/
      ├─ 01-slide.mhtml
      └─ ...
```

MHTML 由 Chromium 在 `1280×720` 桌面视口下，从真实课堂页面逐场景切换后生成。每个文件是当时场景的单文件静态归档，报告同时记录大小和 SHA-256。它用于离线阅读与后续人类对照，不代替真实浏览器功能测试，也不让模型二次审核视觉。

## 命令

```powershell
pnpm eval:validate
pnpm eval:smoke
pnpm eval:baseline
pnpm eval:archive -- eval/runs/baseline-v0.3/<runId>
```

`eval:validate` 只校验六题冻结输入。`eval:smoke` 只连接 mock，验证创建、课堂渲染与 MHTML 归档链，成功后删除临时课程和文件。`eval:baseline` 仅允许 `remote + deepseek`，会真实生成课程并产生费用。`eval:archive` 只读取数据库中已经存在的课程，为旧运行补齐 MHTML，不调用创建、大纲生成或场景生成接口。

正式采集仍支持：

```powershell
$env:EVAL_BASE_URL='http://localhost:3000'
$env:EVAL_OUTPUT_DIR='eval/runs/baseline-v0.3'
$env:EVAL_RESUME_RUN='eval/runs/baseline-v0.3/<runId>'
$env:EVAL_DELETE_COURSES='1' # 仅临时调试
```

运行中会暂存 `progress.json` 以便续跑；完整报告成功落盘后自动删除，避免最终目录重复。

## 当前基线

首次 DeepSeek v0.3 运行 ID 为 `2026-08-27T13-36-18-569Z`：4/6 门课程为 `ready`，2/6 为 `partial_failed`，保存 28/30 个场景，共记录 50 次上游调用。两个第 5 场景在有限修复后仍为 `INVALID_MODEL_OUTPUT`，继续作为真实失败样本保留，不补跑、不删除。

提交 `85be4b9f` 中的 PNG、双视口 DOM/密度观察和提前生成的 `scores.json` 已被逐场景 MHTML 方案取代。课程 ID、原始场景、narration、quiz、生成耗时、调用、token、repair 和错误仍保存在 `report.json`，因此不需要重新调用 DeepSeek。

## 后续配对评分

人工评分在 M10 统一执行：使用相同六题、Provider、模型、场景数和桌面视口生成 v0.4，然后隐藏版本标签，成对阅读 v0.3/v0.4 的场景。届时再生成一份评分表，评价事实正确性、目标匹配、结构连贯、解释与案例价值、可见内容可读性、视觉层级版式和测验对齐；其中视觉版式 5 分口径保留为“信息层级清楚”。

`criticalError`、`criticalErrorEvidence` 和 `overallNotes` 也在配对评分时填写：前两项用于标记会误导学习者的核心事实错误及其场景证据，后一项记录整门课程的主要优缺点。M7.0 不再创建空评分文件。

## M8 画布校准证据

M8 的临时真实模型校准仍收束在本目录，不新建第二套评测文档。运行目录
`runs/m8-slide-v0.4/2026-08-30T09-23-19-191Z/` 包含 3 门课程、4 个已保存场景的
`report.json` 与逐场景 MHTML；没有 PNG、DOM 密度报告或评分表。该目录被 Git 忽略，
用于本机人工查看，不属于 M7.0 六题冻结基线，也不会提前替代 M10 的同题配对评分。

## M9 互动校准证据

M9 继续使用相同结构，统一保存在 `runs/m9-interactive-v0.4/2026-08-31T01-41-38-550Z/`。
`report.json` 保存完整课程（含 HTML/fallback）、生成元数据、校准失败和运行检查；
`scenes/<样例>/` 保存逐场景 MHTML，没有新增评分表、截图或第二套验收文档。
校准发现的 SVG 越界、额外 ACK 和遗漏事件绑定也保留，不把“JSON 已保存”当作“互动可用”。
MHTML 用于静态对照；操作、重置和完成请在本机课堂中检查。

## M9 多样化增量

运行 `node eval/scripts/smoke-interactive-diversity.mjs --run-remote`（默认服务3101，可用 EVAL_BASE_URL 指定），会创建两门真实 DeepSeek 六场景课程，分别请求 simulation/code 与 diagram/game，并持续保存失败和元数据。该命令会产生费用，不自动删除或反复重试课程。

本轮证据在 `runs/m9-diversity-v0.4/2026-08-31T02-40-51.257Z/`。report.json 保留初次失败和后续重试，code-final.json 为独立原始HTML版Python课程，diagram-final.json 为最终关系探索课程，scenes/保存20份MHTML。report.json的finalCourses保存四门完整课程，runtimeChecks明确操作通过项、早期失败和残留问题。实际操作验证与生成成功分开记录。需要CDN/Pyodide的页面不承诺离线可执行，不增加评分表或截图目录。
