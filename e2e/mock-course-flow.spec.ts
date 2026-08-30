import { expect, test } from "@playwright/test";

test("mock 课程从创建、生成、播放到测验和刷新恢复", async ({ page, request }) => {
  const topic = `M6 自动验收 ${Date.now()}`;
  const browserErrors: string[] = [];
  let courseId: string | undefined;
  let interceptedCourseId: string | undefined;

  page.on("console", (message) => { if (message.type() === "error") browserErrors.push(message.text()); });
  page.on("pageerror", (error) => browserErrors.push(error.message));

  try {
    await page.goto("/");
    await expect(page.getByRole("heading", { name: /把一个主题/ })).toBeVisible();
    await page.getByLabel("这堂课要讲什么？").fill(topic);
    await page.getByRole("button", { name: "3", exact: true }).click();
    await page.getByText("高级课程要求").click();
    await page.getByLabel("目标受众").fill("有 Java 基础的本科生");
    await page.getByLabel("学习目标").fill("能够解释核心机制并辨析常见误区");

    // 暂存成功响应，确保用户在真实等待期间能看到阶段、耗时和请求编号。
    await page.route("**/api/courses", async (route) => {
      if (route.request().method() !== "POST") return route.continue();
      const response = await route.fetch();
      const body = await response.body();
      interceptedCourseId = (JSON.parse(body.toString()) as { course: { id: string } }).course.id;
      await new Promise((resolve) => setTimeout(resolve, 500));
      await route.fulfill({ response, body });
    });

    const creationResponsePromise = page.waitForResponse((response) => response.url().endsWith("/api/courses") && response.request().method() === "POST");
    await page.getByRole("button", { name: /生成课程大纲/ }).click();
    await expect(page.getByText("正在写入 MySQL")).toBeVisible();
    await expect(page.getByText(/requestId:/)).toBeVisible();
    const creationResponse = await creationResponsePromise;
    expect(creationResponse.status()).toBe(201);
    expect(interceptedCourseId).toBeTruthy();
    courseId = interceptedCourseId;
    await expect(page).toHaveURL(new RegExp(`/generation/${courseId}$`));
    await expect(page.getByRole("heading", { name: "系统采用的课程要求" })).toBeVisible();
    await expect(page.getByText("有 Java 基础的本科生", { exact: true })).toBeVisible();
    await expect(page.getByText("高级设置", { exact: true }).first()).toBeVisible();

    // 暂存大纲成功响应，验证用户在等待远端调用时能看到心跳、预算和 requestId。
    await page.route(`**/api/courses/${courseId}/outline/generate`, async (route) => {
      const response = await route.fetch();
      const body = await response.body();
      await new Promise((resolve) => setTimeout(resolve, 500));
      await route.fulfill({ response, body });
    });
    await page.getByRole("button", { name: "生成课程大纲" }).click();
    await expect(page.getByText(/4 次总预算内自动重试/)).toBeVisible();
    await expect(page.getByText(/requestId:/)).toBeVisible();
    await expect(page.getByRole("heading", { name: "审核课程大纲" })).toBeVisible();
    await expect(page.getByText("大纲已通过解析、Schema 与语义门")).toBeVisible();

    await page.getByRole("button", { name: /确认大纲并生成场景/ }).click();
    const enterClassroom = page.getByRole("link", { name: /进入课堂/ });
    await expect(enterClassroom).toBeVisible({ timeout: 30_000 });
    await expect(page.getByText("03 / 03")).toBeVisible();
    await enterClassroom.click();

    await expect(page).toHaveURL(new RegExp(`/classroom/${courseId}$`));
    const slideCanvas = page.getByTestId("slide-canvas");
    await expect(slideCanvas).toBeVisible();
    await expect(slideCanvas.locator('[data-text-type="title"]')).toContainText(topic);
    for (const elementType of ["text", "shape", "line", "code"]) {
      await expect(slideCanvas.locator(`[data-element-type="${elementType}"]`).first()).toBeVisible();
    }
    const slideBox = await slideCanvas.boundingBox();
    expect(slideBox).not.toBeNull();
    expect(slideBox!.width / slideBox!.height).toBeCloseTo(16 / 9, 1);
    await page.getByRole("button", { name: /开始课堂/ }).click();
    const pause = page.getByRole("button", { name: /暂停讲解/ });
    await expect(pause).toBeVisible();
    await pause.click();
    const resume = page.getByRole("button", { name: /继续讲解/ });
    await expect(resume).toBeVisible();
    await resume.click();
    await expect(pause).toBeVisible();

    await page.getByRole("button", { name: /打开场景 3/ }).click();
    await expect(page.getByText("QUIZ · SCENE 03")).toBeVisible();
    await expect(page.getByRole("radio").first()).toBeEnabled();
    await page.getByRole("radio").first().check();
    await page.getByRole("button", { name: "提交答案" }).click();
    await expect(page.getByText("回答正确")).toBeVisible();
    await expect(page.getByText("本场景完成", { exact: true }).first()).toBeVisible();

    await page.reload();
    await expect(page.getByText(/REV\.8 · MOCK/)).toBeVisible();
    await expect(page.getByTestId("slide-canvas")).toBeVisible();
    await expect(page.getByTestId("slide-canvas").locator('[data-text-type="title"]')).toContainText(topic);
    await page.goto("/");
    await expect(page.getByText(topic, { exact: true }).first()).toBeVisible();

    const configHealth = await request.get("/api/health/config");
    expect(await configHealth.json()).toMatchObject({ status: "ok", mode: "mock", provider: "mock" });
    const storageSnapshot = await page.evaluate(() => ({ localStorage: { ...window.localStorage }, sessionStorage: { ...window.sessionStorage } }));
    expect(JSON.stringify(storageSnapshot)).not.toMatch(/DATABASE_URL|API_KEY|mysql:\/\/|sk-/i);
    expect(browserErrors).toEqual([]);
  } finally {
    if (courseId) {
      const cleanup = await request.delete(`/api/courses/${courseId}`);
      expect(cleanup.status()).toBe(204);
    }
  }
});
