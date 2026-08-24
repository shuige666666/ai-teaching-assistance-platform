import { describe, expect, it } from "vitest";
import { POST as createCourse } from "@/app/api/courses/route";
import { POST as generateOutline } from "@/app/api/courses/[courseId]/outline/generate/route";
import { POST as submitQuiz } from "@/app/api/courses/[courseId]/quiz-attempts/route";

async function expectStandardError(response: Response, code: string) {
  const payload = await response.json();
  expect(payload).toMatchObject({
    success: false,
    error: { code, message: expect.any(String), retryable: expect.any(Boolean), requestId: expect.any(String) },
  });
  expect(Object.keys(payload).sort()).toEqual(["error", "success"]);
}

describe("API error contract", () => {
  it("课程输入错误返回统一 envelope", async () => {
    const response = await createCourse(new Request("http://local/api/courses", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ topic: "x", requestedSceneCount: 9 }),
    }));
    expect(response.status).toBe(400);
    await expectStandardError(response, "INVALID_INPUT");
  });

  it("生成接口非法 JSON 也返回相同 envelope", async () => {
    const response = await generateOutline(new Request("http://local/api/courses/course-1/outline/generate", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: "{broken",
    }), { params: Promise.resolve({ courseId: "course-1" }) });
    expect(response.status).toBe(400);
    await expectStandardError(response, "INVALID_REQUEST");
  });

  it("测验参数错误不会进入仓储", async () => {
    const response = await submitQuiz(new Request("http://local/api/courses/course-1/quiz-attempts", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ sceneId: "scene-1", questionId: "question-1", correct: true }),
    }), { params: Promise.resolve({ courseId: "course-1" }) });
    expect(response.status).toBe(400);
    await expectStandardError(response, "INVALID_QUIZ_ATTEMPT");
  });
});
