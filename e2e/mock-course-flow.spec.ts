import { expect, test } from "@playwright/test";

test("mock 课程从创建、生成、播放到测验和刷新恢复", async ({ page, request }) => {
  const topic = `M6 自动验收 ${Date.now()}`;
  const browserErrors: string[] = [];
  let courseId: string | undefined;

  page.on("console", (message) => { if (message.type() === "error") browserErrors.push(message.text()); });
  page.on("pageerror", (error) => browserErrors.push(error.message));

  try {
    await page.goto("/");
    await expect(page.getByRole("heading", { name: /把一个主题/ })).toBeVisible();
    await page.getByLabel("这堂课要讲什么？").fill(topic);
    await page.getByRole("button", { name: "3", exact: true }).click();

    const creationResponsePromise = page.waitForResponse((response) => response.url().endsWith("/api/courses") && response.request().method() === "POST");
    await page.getByRole("button", { name: /生成课程大纲/ }).click();
    const creationResponse = await creationResponsePromise;
    expect(creationResponse.status()).toBe(201);
    courseId = ((await creationResponse.json()) as { course: { id: string } }).course.id;
    await expect(page).toHaveURL(new RegExp(`/generation/${courseId}$`));

    await page.getByRole("button", { name: "生成课程大纲" }).click();
    await expect(page.getByRole("heading", { name: "审核课程大纲" })).toBeVisible();
    await expect(page.getByText("大纲已通过解析、Schema 与语义门")).toBeVisible();

    await page.getByRole("button", { name: /确认大纲并生成场景/ }).click();
    const enterClassroom = page.getByRole("link", { name: /进入课堂/ });
    await expect(enterClassroom).toBeVisible({ timeout: 30_000 });
    await expect(page.getByText("03 / 03")).toBeVisible();
    await enterClassroom.click();

    await expect(page.getByRole("heading", { name: new RegExp(topic) })).toBeVisible();
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
    await expect(page.getByRole("button", { name: "播放讲解后作答" })).toBeDisabled();
    await page.getByRole("button", { name: /开始课堂/ }).click();
    await expect(page.getByText("等待作答", { exact: true }).first()).toBeVisible({ timeout: 20_000 });
    await page.getByRole("radio").first().check();
    await page.getByRole("button", { name: "提交答案" }).click();
    await expect(page.getByText("回答正确")).toBeVisible();
    await expect(page.getByText("本场景完成", { exact: true }).first()).toBeVisible();

    await page.reload();
    await expect(page.getByText(/REV\.8 · MOCK/)).toBeVisible();
    await expect(page.getByRole("heading", { name: new RegExp(topic) })).toBeVisible();
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
