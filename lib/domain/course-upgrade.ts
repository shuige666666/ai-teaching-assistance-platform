import { CURRENT_SCHEMA_VERSION } from "./schemas";

const AUTO_UPGRADABLE_SCHEMA_VERSION = 4;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** 将 v4 单选题的标量正确答案转换为 v5 的答案数组，其余课程内容保持不变。 */
export function upgradeCourseV4ToV5(value: unknown): unknown {
  if (!isRecord(value) || value.schemaVersion !== AUTO_UPGRADABLE_SCHEMA_VERSION || !Array.isArray(value.scenes)) return value;

  return {
    ...value,
    schemaVersion: CURRENT_SCHEMA_VERSION,
    scenes: value.scenes.map((scene) => {
      if (!isRecord(scene) || scene.type !== "quiz" || !isRecord(scene.content) || !Array.isArray(scene.content.questions)) return scene;
      return {
        ...scene,
        content: {
          ...scene.content,
          questions: scene.content.questions.map((question) => {
            if (!isRecord(question) || typeof question.correctOptionId !== "string" || "correctOptionIds" in question) return question;
            const { correctOptionId, ...rest } = question;
            return { ...rest, correctOptionIds: [correctOptionId] };
          }),
        },
      };
    }),
  };
}

