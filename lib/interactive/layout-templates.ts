import type { WidgetType } from "@/lib/interactive/widget-types";

/**
 * 互动 HTML 的布局骨架只作为模型的起点，不在服务端强制套用固定 DOM。
 * 每个骨架都保留可滚动的局部区域和窄屏降级，避免内容被一个固定高度截断。
 */
const SPLIT_LAYOUT = String.raw`<!-- 主区 + 侧栏：适合关系探索、参数面板和结果说明 -->
<main class="widget-shell">
  <header class="widget-header"><p class="eyebrow">INTERACTIVE LAB</p><h1>本场景标题</h1><p class="goal">用一句话说明要完成的操作。</p></header>
  <div class="widget-main widget-main--split">
    <section class="widget-canvas" aria-label="可视化区域"><svg id="diagram" viewBox="0 0 800 450" role="img" aria-label="关系图"></svg></section>
    <aside class="widget-panel"><div class="panel-scroll">控件、步骤和反馈</div><button id="reset" type="button">重置</button></aside>
  </div>
</main>
<style>
  html,body{width:100%;height:100%;min-height:100%;margin:0;overflow-x:hidden;overflow-y:auto}
  *{box-sizing:border-box}.widget-shell{min-height:100%;display:flex;flex-direction:column;padding:20px;background:#f7f5ef;color:#20231f}
  .widget-header{flex:0 0 auto}.widget-header h1{margin:4px 0;font-size:clamp(22px,3vw,36px)}.goal{margin:0 0 14px;color:#5b625a}
  .widget-main{flex:1;min-height:0;display:grid;gap:16px}.widget-main--split{grid-template-columns:minmax(0,1fr) minmax(220px,32%)}
  .widget-canvas,.widget-panel{min-width:0;min-height:0;border:1px solid #c6c9c2;background:#fff}.widget-canvas{display:grid;place-items:center;overflow:auto;padding:12px}.widget-canvas svg{display:block;width:100%;height:auto;max-height:100%}
  .widget-panel{display:flex;flex-direction:column;padding:14px}.panel-scroll{flex:1;min-height:0;overflow:auto}.widget-panel button{flex:0 0 auto;margin-top:12px}
  @media(max-width:700px){.widget-shell{padding:14px}.widget-main--split{grid-template-columns:1fr;grid-template-rows:minmax(240px,1fr) auto}.widget-panel{max-height:38vh}}
</style>`;

const BOTTOM_CONTROLS_LAYOUT = String.raw`<!-- 主画布 + 底部控制条：适合模拟器和操作挑战 -->
<main class="widget-shell">
  <header class="widget-header"><p class="eyebrow">INTERACTIVE LAB</p><h1>本场景标题</h1><p class="goal">先读规则，再调整参数或操作对象。</p></header>
  <div class="widget-main widget-main--bottom">
    <section class="widget-canvas" aria-label="可视化区域"><div class="canvas-stage"><canvas id="canvas" aria-label="过程可视化"></canvas></div></section>
    <section class="widget-controls" aria-label="操作控制"><div class="control-row">参数、按钮和即时反馈<div id="feedback" role="status"></div></div><button id="reset" type="button">重置</button></section>
  </div>
</main>
<style>
  html,body{width:100%;height:100%;min-height:100%;margin:0;overflow-x:hidden;overflow-y:auto}
  *{box-sizing:border-box}.widget-shell{min-height:100%;display:flex;flex-direction:column;padding:20px;background:#f7f5ef;color:#20231f}
  .widget-header{flex:0 0 auto}.widget-header h1{margin:4px 0;font-size:clamp(22px,3vw,36px)}.goal{margin:0 0 14px;color:#5b625a}
  /* 画布尺寸由网格决定；Canvas 脱离文档流，不能反向撑大被观察的容器。 */
  .widget-shell{height:100%;min-height:380px}.widget-main--bottom{flex:1;min-height:0;display:grid;grid-template-rows:minmax(160px,1fr) auto;gap:14px}.widget-canvas{position:relative;min-width:0;min-height:0;overflow:hidden;border:1px solid #c6c9c2;background:#fff}.canvas-stage{position:absolute;inset:12px;overflow:hidden}.canvas-stage canvas{position:absolute;inset:0;display:block;width:100%;height:100%;padding:0;border:0}
  .widget-controls{display:flex;flex-wrap:wrap;align-items:center;gap:10px;min-width:0;padding:12px;border:1px solid #c6c9c2;background:#fff}.control-row{flex:1;min-width:220px}.widget-controls button{flex:0 0 auto}
  @media(max-width:700px){.widget-shell{padding:14px;min-height:560px}.widget-main--bottom{grid-template-rows:minmax(220px,1fr) auto}.widget-controls{align-items:stretch;flex-direction:column}.control-row{min-width:0}}
</style>`;

const EDITOR_OUTPUT_LAYOUT = String.raw`<!-- 编辑器 + 输出：适合代码实验和可验证的文本操作 -->
<main class="widget-shell">
  <header class="widget-header"><p class="eyebrow">CODE WORKBENCH</p><h1>本场景标题</h1><p class="goal">修改 TODO，运行并观察真实输出。</p></header>
  <div class="widget-main widget-main--editor">
    <section class="editor-pane"><div class="pane-toolbar">源码 <button id="run" type="button">运行</button><button id="stop" type="button">停止</button></div><!-- CODE_HELP_MARKUP --></section>
    <section class="output-pane"><div class="pane-toolbar">输出与测试</div><pre id="output" aria-live="polite"></pre><button id="reset" type="button">重置</button></section>
  </div>
</main>
<style>
  html,body{width:100%;height:100%;min-height:100%;margin:0;overflow-x:hidden;overflow-y:auto}
  *{box-sizing:border-box}.widget-shell{min-height:100%;display:flex;flex-direction:column;padding:20px;background:#f7f5ef;color:#20231f}
  .widget-header{flex:0 0 auto}.widget-header h1{margin:4px 0;font-size:clamp(22px,3vw,36px)}.goal{margin:0 0 14px;color:#5b625a}
  .widget-main--editor{flex:1;min-height:0;display:grid;grid-template-columns:minmax(0,1fr) minmax(240px,38%);gap:14px}.editor-pane,.output-pane{display:flex;flex-direction:column;min-width:0;min-height:0;border:1px solid #c6c9c2;background:#fff;padding:12px}.pane-toolbar{display:flex;flex:0 0 auto;align-items:center;gap:8px;margin-bottom:8px}.pane-toolbar button{margin-left:auto}.pane-toolbar button+button{margin-left:0}.code-workspace{flex:1;min-height:0;display:flex;flex-direction:column}.workspace-tabs{display:flex;flex:0 0 auto;flex-wrap:wrap;gap:8px;margin-bottom:8px}.workspace-tabs button{margin:0;border:1px solid #c6c9c2;background:#f7f5ef;color:#20231f;padding:7px 11px;cursor:pointer}.workspace-tabs button[aria-selected="true"]{border-color:#2f6652;background:#2f6652;color:#fff}.workspace-panel{flex:1;min-height:0;overflow:auto}.workspace-panel[hidden]{display:none}.code-panel{display:flex;flex-direction:column;overflow:hidden}.editor-host{flex:1;min-height:0;overflow:hidden}.editor-host textarea{width:100%;height:100%;min-height:180px;resize:none;border:0;outline:0;font:14px/1.5 ui-monospace,monospace}.help-panel{padding:18px;background:#fbfcf8;color:#3f4a42;line-height:1.65}.help-panel .help-title{font-size:18px;font-weight:700}.help-text{margin-top:12px;white-space:pre-wrap}.solution-panel{display:flex;flex-direction:column;padding:18px;background:#fbfcf8;color:#3f4a42}.solution-toolbar{display:flex;flex:0 0 auto;align-items:center;gap:10px;margin-bottom:10px}.solution-toolbar button{margin-left:auto}.solution-panel pre{flex:1;min-height:0;overflow:auto;margin:0;padding:14px;background:#f0f2ed;border:1px solid #d9ded4;border-radius:6px;white-space:pre-wrap;font:13px/1.55 ui-monospace,monospace}.solution-panel p{flex:0 0 auto;margin:10px 0 0;line-height:1.5}.output-pane pre{flex:1;min-height:0;overflow:auto;margin:0;white-space:pre-wrap}.output-pane>#reset{flex:0 0 auto;margin-top:10px}
  @media(max-width:700px){.widget-shell{padding:14px}.widget-main--editor{grid-template-columns:1fr;grid-template-rows:minmax(220px,1fr) minmax(140px,.55fr)}.editor-pane,.output-pane{min-height:0}}
</style>`;

/** SVG 边界和箭头示例：先完成节点布局，再根据真实图形收口 viewBox。 */
export const SVG_LAYOUT_EXAMPLE = String.raw`// SVG 节点、边和箭头都使用同一坐标系；边先绘制，节点后绘制。
const svg = document.querySelector('#diagram');
const edge = document.createElementNS('http://www.w3.org/2000/svg', 'line');
edge.setAttribute('x1', String(source.x + source.width));
edge.setAttribute('y1', String(source.y + source.height / 2));
edge.setAttribute('x2', String(target.x - 10));
edge.setAttribute('y2', String(target.y + target.height / 2));
edge.setAttribute('marker-end', 'url(#arrow)');
svg.append(edge);
// 所有节点和标签插入后再收口，避免最后一个节点落在 viewBox 外。
function fitSvgToContent() {
  const box = svg.getBBox();
  if (box.width > 0 && box.height > 0) {
    const pad = 24;
    svg.setAttribute('viewBox', [box.x - pad, box.y - pad, box.width + pad * 2, box.height + pad * 2].join(' '));
  }
}
requestAnimationFrame(fitSvgToContent);`;

/** Canvas 自适应示例：只在容器变化时更新像素缓冲区，绘制函数不得修改布局。 */
export const CANVAS_RESIZE_EXAMPLE = String.raw`const canvas = document.querySelector('#canvas');
const ctx = canvas.getContext('2d');
const stage = canvas.closest('.canvas-stage'); // 独立定位、无 padding/border 的容器
let canvasSize = { width: 0, height: 0, dpr: 1 };
let resizeFrame = 0;
// render 只绘图，使用 canvasSize.width/height 作为逻辑坐标，不写 CSS 或 canvas.width/height。
function resizeCanvas(width, height) {
  width = Math.floor(width); height = Math.floor(height);
  if (width <= 0 || height <= 0) return;
  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  if (canvasSize.width === width && canvasSize.height === height && canvasSize.dpr === dpr) return;
  canvasSize = { width, height, dpr };
  canvas.width = Math.max(1, Math.round(width * dpr));
  canvas.height = Math.max(1, Math.round(height * dpr));
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  render();
}
// 合并 resize 通知；contentRect 不包含外层边框和内边距。
const canvasObserver = new ResizeObserver(([entry]) => {
  cancelAnimationFrame(resizeFrame);
  resizeFrame = requestAnimationFrame(() => resizeCanvas(entry.contentRect.width, entry.contentRect.height));
});
canvasObserver.observe(stage);
function measureCanvas() { resizeCanvas(stage.clientWidth, stage.clientHeight); }
addEventListener('resize', measureCanvas); // 同时响应设备像素比变化
addEventListener('pagehide', () => { canvasObserver.disconnect(); cancelAnimationFrame(resizeFrame); });
requestAnimationFrame(measureCanvas);`;

/** 重置示例：状态、计时器和异步回调都从一个入口恢复，避免只清空部分 UI。 */
export const RESET_STATE_EXAMPLE = String.raw`const initialState = { step: 0, score: 0, speed: 1, running: false, ended: false };
let state = structuredClone(initialState);
let animationId = 0;
let runToken = 0;
function render() { /* 根据 state 更新图形、输出、按钮和完成提示 */ }
function resetState() {
  runToken += 1;
  state = structuredClone(initialState);
  cancelAnimationFrame(animationId);
  animationId = 0;
  // 将参数控件恢复默认值，不从旧滑块读回覆盖初始状态。
  const speedInput = document.querySelector('#speed');
  if (speedInput) speedInput.value = String(initialState.speed);
  render();
}
document.querySelector('#reset').addEventListener('click', () => InteractiveRuntime.reset());
InteractiveRuntime.onReset(resetState);`;

/** 裁剪 OpenMAIC 的 running/ended 与重置思路，补上数值输入和正常失败分支。 */
export const SIMULATION_CONTROL_EXAMPLE = String.raw`// 与上面的 initialState/state/resetState 合并；DOM 全部创建后再绑定事件。
const speedInput = document.querySelector('#speed');
if (speedInput) speedInput.addEventListener('input', () => {
  const value = speedInput.valueAsNumber; // input.value 是字符串，不能直接 toFixed
  if (!Number.isFinite(value)) return;
  state.speed = value;
  render(); // 标签使用 state.speed.toFixed(1)，参数也必须进入 advance 的真实计算
});
let previousTime = 0;
function advance(dt) { /* 实现本场计算，例如 position += velocity * state.speed * dt */ }
function frame(now) {
  if (!state.running || state.ended) return;
  const dt = Math.min((now - previousTime) / 1000, 0.05);
  previousTime = now;
  advance(dt);
  render();
  if (state.running && !state.ended) animationId = requestAnimationFrame(frame);
}
function start() {
  if (state.running) return; // 重复点击不能启动多个动画循环
  if (state.ended) InteractiveRuntime.reset();
  state.running = true;
  previousTime = performance.now();
  animationId = requestAnimationFrame(frame);
  render();
}
function pause() { state.running = false; cancelAnimationFrame(animationId); render(); }
function finish(won, explanation) {
  state.running = false; state.ended = true;
  cancelAnimationFrame(animationId);
  render();
  document.querySelector('#feedback').textContent = explanation;
  if (won) InteractiveRuntime.complete();
  // 输掉游戏、预算耗尽都是正常结果；保留页面供重来，绝不调用 InteractiveRuntime.error。
}
// 按实际按钮绑定 start/pause；render 从 state 更新按钮、参数标签和输出。
// 最后注册重置、绘制初始画面，再 InteractiveRuntime.ready()。`;

const LAYOUT_BY_WIDGET: Record<WidgetType, string> = {
  diagram: SPLIT_LAYOUT,
  simulation: BOTTOM_CONTROLS_LAYOUT,
  game: BOTTOM_CONTROLS_LAYOUT,
  code: EDITOR_OUTPUT_LAYOUT,
};

const CODE_HELP_MARKUP = String.raw`<div id="code-workspace" class="code-workspace" aria-label="代码输入与辅助内容">
  <div class="workspace-tabs" role="tablist" aria-label="代码工作区">
    <button id="code-view" type="button" role="tab" aria-selected="true" aria-controls="code-panel">代码</button>
    <button id="hint" type="button" role="tab" aria-selected="false" aria-controls="hint-panel">提示</button>
    <button id="solution-toggle" type="button" role="tab" aria-selected="false" aria-controls="solution-panel">参考答案</button>
  </div>
  <section id="code-panel" class="workspace-panel code-panel" role="tabpanel" aria-label="代码编辑">
    <div class="editor-host"><textarea id="editor" spellcheck="false"></textarea></div>
  </section>
  <section id="hint-panel" class="workspace-panel help-panel" role="tabpanel" aria-label="渐进提示" hidden>
    <div class="help-title">提示</div>
    <div id="hint-text" class="help-text" aria-live="polite">点击“提示”查看下一条。</div>
  </section>
  <section id="solution-panel" class="workspace-panel solution-panel" role="tabpanel" aria-label="参考答案" hidden>
    <div class="solution-toolbar"><strong>参考答案</strong><button id="copy-solution" type="button">复制答案</button></div>
    <pre id="solution"></pre>
    <p id="solution-explanation"></p>
    <p id="copy-status" role="status" aria-live="polite"></p>
  </section>
</div>`;

/** 按类型提供可改写的布局起点；分类影响提示词，不会锁死最终玩法。 */
export function getInteractiveLayoutTemplate(widgetType: WidgetType): string {
  const layout = LAYOUT_BY_WIDGET[widgetType];
  if (widgetType !== "code") return layout;
  // 代码场景把代码、提示和答案放入左侧同一工作区，具体内容仍由模型结合题目生成。
  return layout
    .replace('<!-- CODE_HELP_MARKUP -->', CODE_HELP_MARKUP);
}

/** 只注入当前类型需要的实现提醒，控制 Prompt 体积并保持示例可读。 */
export function getInteractiveImplementationExamples(widgetType: WidgetType): string {
  const examples = [RESET_STATE_EXAMPLE];
  if (widgetType === 'diagram') examples.unshift(SVG_LAYOUT_EXAMPLE);
  if (widgetType === 'simulation' || widgetType === 'game') {
    examples.unshift(CANVAS_RESIZE_EXAMPLE);
    examples.push(SIMULATION_CONTROL_EXAMPLE);
  }
  return examples.join('\n\n');
}
