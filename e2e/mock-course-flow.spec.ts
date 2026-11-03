import { readFile } from "node:fs/promises";
import JSZip from "jszip";
import { expect, test } from "@playwright/test";

test("mock 课程从创建、导出、互动、测验到刷新恢复", async ({ page, request }) => {
  const topic = `M11 导出验收 ${Date.now()}`;
  const browserErrors: string[] = [];
  let courseId: string | undefined;
  let interceptedCourseId: string | undefined;

  page.on("console", (message) => { if (message.type() === "error") browserErrors.push(message.text()); });
  page.on("pageerror", (error) => browserErrors.push(error.message));

  try {
    await page.goto("/");
    await expect(page.getByRole("heading", { name: /把一个主题/ })).toBeVisible();
    await page.getByLabel("这堂课要讲什么？").fill(topic);
    await page.getByRole("button", { name: "4", exact: true }).click();
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

    await page.getByRole("button", { name: /需要互动/ }).click();
    await expect(page.getByText("需要互动场景", { exact: true })).toBeVisible();

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
    await expect(page.getByText("04 / 04")).toBeVisible();
    await enterClassroom.click();

    await expect(page).toHaveURL(new RegExp(`/classroom/${courseId}$`));
    const slideCanvas = page.getByTestId("slide-canvas");
    await expect(slideCanvas).toBeVisible();
    await expect(slideCanvas.locator('[data-text-type="title"]')).toContainText(topic);
    // hook 场覆盖 text/shape(圆角+渐变)/table/chart 渲染。
    for (const elementType of ["text", "shape", "table", "chart"]) {
      await expect(slideCanvas.locator(`[data-element-type="${elementType}"]`).first()).toBeVisible();
    }
    const slideBox = await slideCanvas.boundingBox();
    expect(slideBox).not.toBeNull();
    expect(slideBox!.width / slideBox!.height).toBeCloseTo(16 / 9, 1);

    // M12：同一侧栏完成可见思考、只读工具、两级折叠和刷新恢复。
    await page.getByRole("switch", { name: "智能修订", exact: true }).click();
    const agentDrawer = page.getByRole("complementary", { name: "课程修订对话" });
    await expect(agentDrawer).toBeVisible();
    // 宽屏拖动侧栏后课堂与侧栏使用同一宽度变量，关闭重开仍保留本机偏好。
    const resizeHandle = page.locator(".agent-drawer-resize");
    // hover 等待把手位置稳定，避免入场动画期间读取的坐标在按下鼠标前已经失效。
    await resizeHandle.hover({ position: { x: 4, y: 120 } });
    const drawerBefore = await agentDrawer.boundingBox();
    const handleBox = await resizeHandle.boundingBox();
    expect(drawerBefore).not.toBeNull();
    expect(handleBox).not.toBeNull();
    await page.mouse.move(handleBox!.x + handleBox!.width / 2, handleBox!.y + 120);
    await page.mouse.down();
    await page.mouse.move(handleBox!.x - 70, handleBox!.y + 120);
    await page.mouse.up();
    await expect.poll(async () => (await agentDrawer.boundingBox())?.width).toBeGreaterThan(drawerBefore!.width + 50);
    const drawerAfter = await agentDrawer.boundingBox();
    await page.getByRole("button", { name: "关闭", exact: true }).click();
    await page.getByRole("switch", { name: "智能修订", exact: true }).click();
    await expect.poll(async () => (await agentDrawer.boundingBox())?.width).toBeCloseTo(drawerAfter!.width, 0);
    await page.getByRole("textbox", { name: "继续讨论，或描述要修改的页面内容…" }).fill("请检查当前课堂有几页，不要修改课程。");
    await page.getByRole("button", { name: /发送/ }).click();
    const answer = page.locator(".agent-answer").last();
    await expect(answer.getByText("已完成课堂读取", { exact: true })).toBeVisible();
    await expect(answer.locator("strong")).toHaveText("已完成课堂读取");
    await expect(answer.locator("table")).toContainText("页面清单");
    const thinkingCard = page.locator("details.agent-thinking");
    const toolGroup = page.locator("details.agent-tool-group");
    await expect(thinkingCard).not.toHaveAttribute("open", "");
    await expect(toolGroup).not.toHaveAttribute("open", "");
    await toolGroup.locator(":scope > summary").click();
    const toolCard = toolGroup.locator("details.agent-tool");
    await expect(toolCard).toContainText("检查当前课堂");
    await toolCard.locator(":scope > summary").click();
    await expect(toolCard.getByText("入参", { exact: true })).toBeVisible();
    await expect(toolCard.getByText("结果原文", { exact: true })).toBeVisible();
    await page.getByRole("button", { name: "关闭", exact: true }).click();
    await page.reload();
    await page.getByRole("switch", { name: "智能修订", exact: true }).click();
    await expect(page.locator("details.agent-tool-group")).toHaveCount(1);
    await page.getByRole("button", { name: "关闭", exact: true }).click();

    // 真实点击导出按钮，解包下载物并核对 PPTX 与互动 HTML 均已进入资源包。
    const downloadPromise = page.waitForEvent("download");
    await expect(page.getByTestId("export-button")).toBeEnabled();
    await page.getByTestId("export-button").click();
    const download = await downloadPromise;
    expect(download.suggestedFilename()).toMatch(/\.zip$/);
    const downloadPath = await download.path();
    expect(downloadPath).not.toBeNull();
    if (!downloadPath) throw new Error("导出下载没有可读取的临时文件");
    const packageZip = await JSZip.loadAsync(await readFile(downloadPath));
    const packageNames = Object.keys(packageZip.files);
    expect(packageNames.filter((name) => name.endsWith(".pptx"))).toHaveLength(1);
    const interactiveNames = packageNames.filter((name) => name.startsWith("interactive/") && name.endsWith(".html"));
    expect(interactiveNames).toHaveLength(1);
    expect(await packageZip.file(interactiveNames[0])!.async("string")).toContain("<!doctype html>");
    await expect(page.getByTestId("export-message")).toContainText("已导出 2 页 PPTX + 1 个互动页");
    await expect(page.getByTestId("export-message")).toHaveAttribute("role", "status");

    await page.getByRole("button", { name: /开始课堂/ }).click();
    const pause = page.getByRole("button", { name: /暂停讲解/ });
    await expect(pause).toBeVisible();
    await pause.click();
    const resume = page.getByRole("button", { name: /继续讲解/ });
    await expect(resume).toBeVisible();
    await resume.click();
    await expect(pause).toBeVisible();

    // mechanism 场覆盖连线与代码块渲染。
    await page.getByRole("button", { name: /打开场景 2/ }).click();
    await expect(slideCanvas.locator('[data-text-type="title"]')).toContainText("拆解核心机制");
    for (const elementType of ["line", "code"]) {
      await expect(slideCanvas.locator(`[data-element-type="${elementType}"]`).first()).toBeVisible();
    }

    await page.getByRole("button", { name: /打开场景 3/ }).click();
    const interactiveHost = page.getByTestId("interactive-host");
    await expect(interactiveHost).toHaveAttribute("data-runtime-state", "ready");
    const widget = page.frameLocator('[data-testid="interactive-host"] iframe');
    for (const node of await widget.locator(".node").all()) await node.click();
    await widget.getByRole("button", { name: "完成探索" }).click();
    await expect(interactiveHost).toHaveAttribute("data-runtime-state", "completed");
    await page.getByRole("button", { name: "重置互动" }).click();
    await expect(widget.getByRole("button", { name: "完成探索" })).toBeDisabled();
    await page.evaluate(() => window.postMessage({ type: "INTERACTIVE_COMPLETED", version: 1 }, "*"));
    await expect(interactiveHost).toHaveAttribute("data-runtime-state", "ready");
    const widgetFrame = page.frames().find((frame) => frame !== page.mainFrame());
    expect(widgetFrame).toBeTruthy();
    // 覆盖学生代码的终止和恢复，不依赖 CDN 或额外模型调用。
    const execution = await widgetFrame!.evaluate(async () => {
      const runtime = (window as unknown as { InteractiveRuntime: { runCode(input: { language: string; code: string; timeoutMs?: number }): Promise<{ stdout: string }> } }).InteractiveRuntime;
      let timeout = "";
      try { await runtime.runCode({ language: "javascript", code: "while(true){}", timeoutMs: 100 }); }
      catch (error) { timeout = (error as Error).message; }
      const result = await runtime.runCode({ language: "javascript", code: "console.log(6 * 7)" });
      return { timeout, stdout: result.stdout };
    });
    expect(execution.timeout).toContain("代码运行超时");
    expect(execution.stdout).toBe("42\n");
    await widgetFrame!.evaluate(() => window.parent.postMessage({ type: "UNKNOWN_MESSAGE", version: 1 }, "*"));
    await expect(interactiveHost).toHaveAttribute("data-runtime-state", "ready");
    await widgetFrame!.evaluate(() => window.parent.postMessage({ type: "INTERACTIVE_COMPLETED", version: 99 }, "*"));
    await expect(interactiveHost).toHaveAttribute("data-runtime-state", "failed");
    await expect(page.getByText("STATIC FALLBACK")).toBeVisible();
    await page.getByRole("button", { name: "跳过互动" }).click();

    await page.getByRole("button", { name: /打开场景 4/ }).click();
    await expect(page.getByText("QUIZ · SCENE 04")).toBeVisible();
    await page.getByRole("button", { name: "手动调整题目" }).click();
    await expect(page.getByRole("heading", { name: "手动调整题目" })).toBeVisible();
    await page.getByLabel("题干").first().fill("人工修改：哪项最符合课程的核心内容？");
    await page.getByRole("checkbox", { name: /确认清理本场旧作答记录/ }).check();
    await page.getByRole("button", { name: "保存题目" }).click();
    await expect(page.getByTestId("slide-canvas")).toBeVisible();
    await page.getByRole("button", { name: /打开场景 4/ }).click();
    await expect(page.getByText("人工修改：哪项最符合课程的核心内容？")).toBeVisible();
    await expect(page.getByRole("radio").first()).toBeEnabled();
    await page.getByRole("radio").first().check();
    await page.getByRole("button", { name: "提交答案" }).first().click();
    await expect(page.getByText("回答正确")).toBeVisible();
    await page.getByRole("checkbox").nth(0).check();
    await page.getByRole("checkbox").nth(1).check();
    await page.getByRole("button", { name: "提交答案" }).click();
    await expect(page.getByText("回答正确")).toHaveCount(2);
    await expect(page.getByText("本场景完成", { exact: true }).first()).toBeVisible();

    await page.reload();
    await expect(page.getByText(/REV\.12 · MOCK/)).toBeVisible();
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
