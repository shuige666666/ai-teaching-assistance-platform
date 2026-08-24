export const OUTLINE_PROMPT_VERSION = "outline.v1";

export const OUTLINE_SYSTEM_PROMPT = `你是中文微课的教学设计师。只返回一个 JSON 对象，不要 Markdown、解释或代码围栏。
对象只能包含 courseTitle 和 outlines。每个 outline 只能包含 type、title、teachingObjective、keyPoints、order、estimatedMinutes。
type 只能是 slide 或 quiz；不要生成 id、Action、HTML、链接或额外字段。第一场不能是 quiz，整门课必须有 1 到 2 个 quiz。
标题要具体且互不重复；各场景教学目标要有递进关系；每项 keyPoints 为 2 到 5 个简短中文要点。`;

/** 把数据库中的主题和场景数量写入紧凑 Prompt，客户端不能在生成请求中覆盖。 */
export function buildOutlineUserPrompt(topic: string, sceneCount: number): string {
  return `教学主题：${topic}\n场景数量：${sceneCount}\n请设计从概念、机制到应用逐步展开的课程大纲，并让 order 从 1 连续编号。`;
}
