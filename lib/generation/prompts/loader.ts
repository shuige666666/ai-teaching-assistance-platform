import { readFileSync } from "node:fs";
import { join } from "node:path";

const TEMPLATE_ROOT = join(process.cwd(), "lib/generation/prompts/templates");

export const PROMPT_TEMPLATE_FILES = {
  "outline-generation-system": "outline-generation-system.md",
  "outline-repair-system": "outline-repair-system.md",
  "scene-slide-generation-system": "scene-slide-generation-system.md",
  "scene-quiz-generation-system": "scene-quiz-generation-system.md",
  "scene-interactive-common-rules": "scene-interactive-common-rules.md",
  "scene-interactive-diagram-rules": "scene-interactive-diagram-rules.md",
  "scene-interactive-simulation-rules": "scene-interactive-simulation-rules.md",
  "scene-interactive-game-rules": "scene-interactive-game-rules.md",
  "scene-interactive-code-rules": "scene-interactive-code-rules.md",
  "scene-interactive-code-help-requirements": "scene-interactive-code-help-requirements.md",
  "scene-repair-system": "scene-repair-system.md",
} as const;

export type PromptTemplateId = keyof typeof PROMPT_TEMPLATE_FILES;

/** 读取服务端生成流程使用的固定 Prompt 模板。 */
export function loadPromptTemplate(id: PromptTemplateId): string {
  return readFileSync(join(TEMPLATE_ROOT, PROMPT_TEMPLATE_FILES[id]), "utf8").trim();
}
