import { Script } from "node:vm";
import { parse, type DefaultTreeAdapterTypes } from "parse5";

// 参考 OpenMAIC 的 HTML5 解析 + classic Script 编译边界，来源见 THIRD_PARTY_NOTICES.md。
const SCRIPT_TYPES = new Set([
  "", "application/ecmascript", "application/javascript", "application/x-ecmascript",
  "application/x-javascript", "text/ecmascript", "text/javascript", "text/javascript1.0",
  "text/javascript1.1", "text/javascript1.2", "text/javascript1.3", "text/javascript1.4",
  "text/javascript1.5", "text/jscript", "text/livescript", "text/x-ecmascript", "text/x-javascript",
]);
type SyntaxFailure = { scriptIndex: number; message: string };

/** 按浏览器的 HTML 解析结果检查普通内联脚本，只编译、不执行任何模型代码。 */
export function findScriptSyntaxFailure(html: string): SyntaxFailure | undefined {
  let scriptIndex = 0;
  let failure: SyntaxFailure | undefined;

  /** 遍历实际文档节点，跳过模板、外部脚本、JSON 数据及 module 语法。 */
  function visit(parent: DefaultTreeAdapterTypes.ParentNode): void {
    for (const node of parent.childNodes) {
      if (failure) return;
      if (!("tagName" in node)) continue;
      if (node.tagName === "template") continue;
      if (node.tagName === "script") {
        scriptIndex += 1;
        const attributes = new Map(node.attrs.map(({ name, value }) => [name, value]));
        const type = (attributes.get("type") ?? "").trim().toLowerCase().split(";", 1)[0].trim();
        if (attributes.has("src") || !SCRIPT_TYPES.has(type)) continue;
        const source = node.childNodes.map((child) => "value" in child ? child.value : "").join("");
        try {
          // 使用 Script 而不是 Function，顶层 return 等浏览器语法错误也会被发现。
          new Script(source);
        } catch (error) {
          failure = { scriptIndex, message: error instanceof Error ? error.message : String(error) };
        }
      } else visit(node);
    }
  }

  visit(parse(html));
  return failure;
}
