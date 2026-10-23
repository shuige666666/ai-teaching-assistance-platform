import { describe, expect, it } from "vitest";
import { postProcessInteractiveHtml } from "@/lib/interactive/html-policy";
import { findScriptSyntaxFailure } from "@/lib/interactive/script-syntax";
import { createFixtureCourse } from "@/lib/domain/fixture";
import { MockAIAdapter } from "@/lib/ai/mock-adapter";
import { generateScene } from "@/lib/generation/scene-pipeline";

const document = (body: string) => `<!doctype html><html><head></head><body>${body}</body></html>`;

describe("互动脚本保存前语法检查", () => {
  it("语法失败进入现有一次 repair，修复仍错误时终止生成", async () => {
    const course = createFixtureCourse("互动语法修复", 4);
    const outline = { ...course.outlines[1], type: "interactive" as const, role: "practice" as const, widgetType: "diagram" as const };
    const bad = document("<script>const value = ;</script>");
    const good = document("<script>const value = 1;</script>");
    const input = { course, outline, requestId: "syntax-repair", signal: new AbortController().signal };
    const scene = await generateScene(new MockAIAdapter([bad, good]), input);
    expect(scene.generation).toMatchObject({ repaired: true, upstreamCalls: 2 });
    await expect(generateScene(new MockAIAdapter([bad, bad]), input)).rejects.toMatchObject({
      code: "INVALID_MODEL_OUTPUT", upstreamCalls: 2,
    });
  });

  it.each(["const value = ;", "return 1;", "function broken( {"])("拒绝普通内联脚本错误：%s", (source) => {
    expect(() => postProcessInteractiveHtml(document(`<script>${source}</script>`))).toThrow("INVALID_INTERACTIVE_HTML");
  });

  it("只编译而不执行脚本，不把运行时行为当成语法错误", () => {
    expect(() => postProcessInteractiveHtml(document('<script>throw new Error("不得执行"); document.body.dataset.checked = "yes";</script>'))).not.toThrow();
  });

  it.each([
    '<script type="application/json">{"narration":"说明"}</script>',
    '<script type="module">import value from "./external.js"; await value();</script>',
    '<script src="https://example.com/a.js">const value = ;</script>',
    '<template><script>const value = ;</script></template>',
    '<!-- <script>const value = ;</script> -->',
    '<textarea><script>const value = ;</script></textarea>',
  ])("不误判非普通可执行内联脚本：%s", (body) => {
    expect(() => postProcessInteractiveHtml(document(body))).not.toThrow();
  });

  it("HTML5 解析保留脚本文本中的字符实体，不以正则截取脚本", () => {
    expect(findScriptSyntaxFailure(document('<script>const text = "&lt;script&gt;";</script>'))).toBeUndefined();
    expect(findScriptSyntaxFailure(document('<script TYPE="text/javascript; charset=utf-8">const value = ;</script>'))?.scriptIndex).toBe(1);
  });
});
