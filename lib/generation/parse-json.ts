import { InvalidOutlineError } from "./outline-schema";

function extractBalancedObject(text: string): string | null {
  const start = text.indexOf("{");
  if (start < 0) return null;
  let depth = 0;
  let inString = false;
  let escaped = false;
  for (let index = start; index < text.length; index += 1) {
    const character = text[index];
    if (inString) {
      if (escaped) escaped = false;
      else if (character === "\\") escaped = true;
      else if (character === '"') inString = false;
      continue;
    }
    if (character === '"') inString = true;
    else if (character === "{") depth += 1;
    else if (character === "}" && --depth === 0) return text.slice(start, index + 1);
  }
  return null;
}

/** 将模型文本解析为对象；纯 JSON 失败时，受限提取一个可解析的 JSON 对象。 */
export function parseModelJson(text: string): unknown {
  const trimmed = text.trim();
  // 优先处理符合输出契约的纯 JSON。
  try { return JSON.parse(trimmed); } catch { /* 继续执行受限提取。 */ }
  // 模型附带说明时，只提取一个代码围栏或首个完整平衡对象。
  const fenced = trimmed.match(/```(?:json)?\s*([\s\S]*?)\s*```/i)?.[1];
  const candidate = fenced ?? extractBalancedObject(trimmed);
  if (!candidate) throw new InvalidOutlineError([{ path: "", message: "模型输出不是 JSON 对象" }], { validationKind: "json" });
  try { return JSON.parse(candidate); } catch (error) {
    throw new InvalidOutlineError([{ path: "", message: "提取到的 JSON 对象仍无法解析" }], { cause: error, validationKind: "json" });
  }
}
