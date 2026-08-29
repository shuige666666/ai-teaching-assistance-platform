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

/** 优先精确解析；失败后只接受单个 JSON 代码围栏或首个平衡对象。 */
export function parseModelJson(text: string): unknown {
  const trimmed = text.trim();
  try { return JSON.parse(trimmed); } catch { /* 继续执行受限提取。 */ }
  const fenced = trimmed.match(/```(?:json)?\s*([\s\S]*?)\s*```/i)?.[1];
  const candidate = fenced ?? extractBalancedObject(trimmed);
  if (!candidate) throw new InvalidOutlineError([{ path: "", message: "模型输出不是 JSON 对象" }], { validationKind: "json" });
  try { return JSON.parse(candidate); } catch (error) {
    throw new InvalidOutlineError([{ path: "", message: "提取到的 JSON 对象仍无法解析" }], { cause: error, validationKind: "json" });
  }
}
