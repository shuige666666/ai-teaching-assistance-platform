# M7.0 课程质量基线

评测所需的配置、工具、运行结果和评分说明全部收束在本目录。M7.0 只建立 v0.3 对照基线，不修改生产 Prompt、Schema、Renderer 或 CSS。

## 1. 目录只分四类

```text
eval/
├─ README.md                  # 唯一总说明：命令、量表、阈值和验收方法
├─ config/                    # 冻结输入，不随运行改变
│  ├─ course-quality.v1.json    # 6 个用户初始 Prompt 与生成策略
│  └─ slide-density.v1.json     # 密度、双视口和溢出规则
├─ scripts/                   # 校验、采集和汇总脚本
└─ runs/                      # 每次正式运行的结果（Git 忽略）
```

每个正式运行目录只保留：

- `summary.md`：给人看的结果和验收步骤；
- `scores.json`：唯一需要人工填写的文件；
- `report.json`：机器采集的完整原始证据，不手工修改；
- `progress.json`：中断后续跑的检查点；
- `evidence/`：按主题存放双视口截图和采集错误图。

## 2. 运行与续跑

```powershell
pnpm eval:validate
pnpm eval:smoke
pnpm eval:baseline
pnpm eval:summarize -- eval/runs/baseline-v0.3/<runId>
```

`eval:validate` 校验两份冻结 JSON。`eval:smoke` 只用 mock 验证采集链，成功后自动清理临时产物。`eval:baseline` 必须连接 `remote + deepseek`，依次调用正式创建、大纲和逐场景 API；不做业务级手动重试，失败样本也必须保留。

可选参数：

```powershell
$env:EVAL_BASE_URL='http://127.0.0.1:3000'
$env:EVAL_OUTPUT_DIR='eval/runs/baseline-v0.3'
$env:EVAL_RESUME_RUN='eval/runs/baseline-v0.3/<runId>'
$env:EVAL_DELETE_COURSES='1' # 仅临时调试；正式基线必须保留 MySQL 课程
```

评价集、量表、密度阈值、`1280×720`/`390×844` 视口和退出阈值已于 `2026-08-27T13:24:42.566Z` 冻结。如需改变，必须升级协议版本，不能根据 v0.4 结果临时放宽。

## 3. 人工评分量表

每门课程先阅读所有已保存场景、narration、quiz 和双视口截图，再在 `scores.json` 中对七个维度给 1～5 分。无法判断时应在 `overallNotes` 说明，不要默认填 3。

| 维度 | 1 分 | 3 分 | 5 分 |
| --- | --- | --- | --- |
| `factualCorrectness` | 核心结论错误或严重误导 | 核心基本正确，有边界遗漏 | 事实、条件和适用边界准确 |
| `goalAlignment` | 偏离受众或学习目标 | 覆盖目标，但部分场景联系较弱 | 场景、例子和测验共同服务目标 |
| `structureCoherence` | 重复、跳跃或缺少前置 | 顺序可理解，但递进或收束较弱 | 动机、概念、机制、应用和检查递进清楚 |
| `explanationCaseValue` | 定义堆砌，案例无效 | 有解释和示例，但因果或边界不足 | 能解释原因和边界，并支持知识迁移 |
| `visibleReadability` | 长段落过密或字号过小 | 大部分可读，局部过密 | 可见内容精炼可扫读，细节合理下沉 |
| `visualHierarchyLayout` | 主次混乱或关键内容裁切 | 层级基本清楚，但版式单一或窄屏一般 | 信息层级清楚，桌面和窄屏均自然可读 |
| `quizAlignment` | 题目无关、答案错误或只考无意义记忆 | 覆盖课程，但区分度或解析较弱 | 检查关键目标，选项、答案和解析准确 |

`criticalError` 是独立于平均分的事实红线：未检查填 `null`，没有发现填 `false`，发现会让学习者形成错误核心概念、执行错误代码或作出错误安全决策的问题时填 `true`，并在 `criticalErrorEvidence` 记录场景序号、错误内容和理由。`overallNotes` 记录这门课的主要优点、缺陷和缺失场景的影响。

## 4. 退出阈值和当前基线

M7.4 使用同一主题、Provider、模型、场景数和截图视口对 v0.3/v0.4 做隐藏版本标签的成对评分。五个产品质量维度（目标、结构、案例、可读性、视觉版式）平均提升至少 0.5/5；事实正确性不下降且不新增关键错误；两个标准视口无未声明硬溢出；至少 70% 有效课程对更偏好 v0.4。同时必须报告完成率、调用数、repair、耗时和 token，不能用质量分数隐藏成本。

首次 v0.3 基线位于 `runs/baseline-v0.3/2026-08-27T13-36-18-569Z/`：4/6 课程 `ready`，28/30 场景保存，50 次上游调用，44 张截图。两个第 5 场景保留为 `partial_failed`，人工七维评分尚未完成。这 6 个主题只用于产品开发退出，不用于宣称统计显著或直接形成论文结论。
