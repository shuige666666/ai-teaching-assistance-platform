import { describe, expect, it } from "vitest";
import type { AIAdapter, GenerateTextInput } from "@/lib/ai/contracts";
import { MockAIAdapter } from "@/lib/ai/mock-adapter";
import { CourseMaterialService } from "@/lib/application/course-material-service";
import { OutlineGenerationService } from "@/lib/application/outline-generation-service";
import { SceneGenerationService } from "@/lib/application/scene-generation-service";
import { createCourseDraft } from "@/lib/domain/fixture";
import { SceneOutlineSchema } from "@/lib/domain/schemas";
import { extractCourseMaterial, parsePageRange, splitMaterialText } from "@/lib/materials/extract";
import { buildMaterialContext, selectSceneMaterialContext } from "@/lib/materials/context";
import { InMemoryCourseRepository } from "@/lib/repository/in-memory-course-repository";
import { CourseConflictError } from "@/lib/repository/course-repository";
import { MATERIAL_FACT, textMaterial, textPdf } from "./material-fixtures";

/** 记录真实管线传给适配器的输入，避免只检查生成结果是否包含几个字段。 */
function recordingAdapter() {
  const calls: GenerateTextInput[] = [];
  const mock = new MockAIAdapter();
  const adapter: AIAdapter = { async generateText(input) { calls.push(input); return mock.generateText(input); } };
  return { adapter, calls };
}

async function materialDraft() {
  const repository = new InMemoryCourseRepository();
  const draft = await repository.create(createCourseDraft("慢启动实验", 4, { interactionMode: "required" }));
  const service = new CourseMaterialService(repository);
  const saved = await service.replace(draft.id, draft.revision, [{ file: textMaterial(), pageRange: "" }]);
  return { repository, service, ...saved };
}

describe("教学材料解析与状态", () => {
  it("真实 PDF 只提取选定页，保留 PDF 实际页码且不泄漏未选内容", async () => {
    const material = await extractCourseMaterial("course", textPdf(["FIRST PAGE SECRET", "Threshold is 37 MSS.", "THIRD PAGE SECRET"]), "2");
    expect(material.selectedPages).toEqual([2]);
    expect(material.pageCount).toBe(3);
    expect(material.blocks).toEqual([expect.objectContaining({ pageNumber: 2, text: "Threshold is 37 MSS." })]);
    expect(JSON.stringify(material.blocks)).not.toContain("SECRET");
  });

  it("空 PDF 明确报告无文字；混合 PDF 显示未识别页而不虚构内容", async () => {
    await expect(extractCourseMaterial("course", textPdf([""]))).rejects.toMatchObject({ code: "MATERIAL_TEXT_EMPTY" });
    const mixed = await extractCourseMaterial("course", textPdf(["Text page", ""]));
    expect(mixed.warnings[0]).toContain("第 2 页");
    expect(mixed.blocks).toHaveLength(1);
  });

  it("Markdown 保留标题和原文，长段落切片后可以完整还原", async () => {
    const material = await extractCourseMaterial("course", textMaterial());
    expect(material.blocks[0]).toMatchObject({ heading: "慢启动实验" });
    expect(material.blocks[0].text).toContain(MATERIAL_FACT);
    const long = "甲".repeat(1599) + "😀" + "乙".repeat(1601);
    const blocks = splitMaterialText(long, "id");
    expect(blocks.every((block) => block.text.length <= 1600)).toBe(true);
    expect(blocks.map((block) => block.text).join("")).toBe(long);
    expect(blocks.every((block) => !/[\uD800-\uDBFF]$/.test(block.text))).toBe(true);
  });

  it("页码范围去重排序，对越界和反向范围给出明确错误", () => {
    expect(parsePageRange("3,1-3，5", 5)).toEqual([1, 2, 3, 5]);
    for (const input of ["0", "1-6", "3-1", "abc", "1,"]) expect(() => parsePageRange(input, 5)).toThrow();
  });

  it("伪装 PDF、空文本和超预算正文不会进入课程材料", async () => {
    await expect(extractCourseMaterial("course", new File(["not a pdf"], "fake.pdf"))).rejects.toMatchObject({ code: "INVALID_PDF" });
    await expect(extractCourseMaterial("course", new File(["   "], "empty.txt"))).rejects.toMatchObject({ code: "MATERIAL_TEXT_EMPTY" });
    await expect(extractCourseMaterial("course", new File(["字".repeat(40_001)], "long.txt"))).rejects.toMatchObject({ code: "MATERIAL_TOO_LONG" });
  });

  it("批量中一份失败或合计超预算时，原材料、大纲和版本均保留", async () => {
    const { repository, service, course, materials } = await materialDraft();
    const outlined = await new OutlineGenerationService(repository, new MockAIAdapter()).generate(course.id, course.revision, "outline");
    await expect(service.replace(course.id, outlined.revision, [{ file: textMaterial(), pageRange: "" }, { file: new File([""], "empty.txt"), pageRange: "" }])).rejects.toThrow();
    await expect(service.replace(course.id, outlined.revision, [1, 2].map((i) => ({ file: new File(["字".repeat(22_000)], `${i}.txt`), pageRange: "" })))).rejects.toMatchObject({ code: "MATERIAL_TOO_LONG" });
    expect(await repository.get(course.id)).toEqual(outlined);
    expect(await repository.listMaterials(course.id)).toEqual(materials);
  });

  it("更换材料使旧大纲失效，旧版本提交不能覆盖新材料；删除课程同步清理", async () => {
    const { repository, service, course } = await materialDraft();
    const outlined = await new OutlineGenerationService(repository, new MockAIAdapter()).generate(course.id, course.revision, "outline");
    const changed = await service.replace(course.id, outlined.revision, [{ file: new File(["新实验门限为 53 MSS。"], "new.txt"), pageRange: "" }]);
    expect(changed.course).toMatchObject({ status: "draft", outlines: [], scenes: [], outlineGeneration: undefined });
    await expect(service.remove(course.id, outlined.revision, changed.materials[0].id)).rejects.toBeInstanceOf(CourseConflictError);
    const removed = await service.remove(course.id, changed.course.revision, changed.materials[0].id);
    expect(removed.materials).toEqual([]);
    await repository.delete(course.id);
    expect(await repository.listMaterials(course.id)).toEqual([]);
  });
});

describe("材料进入生成与来源记录", () => {
  it("大纲、所有场景类型、整页修订和插页收到原文，保存真实来源且页面生成后锁定材料", async () => {
    const { repository, service, course: draft, materials } = await materialDraft();
    const { adapter, calls } = recordingAdapter();
    let course = await new OutlineGenerationService(repository, adapter).generate(draft.id, draft.revision, "outline");
    expect(calls[0].userPrompt).toContain(MATERIAL_FACT);
    expect(calls[0].systemPrompt).toContain("不可信参考数据");
    expect(calls[0].systemPrompt).toContain("每个 outline 必须包含 sourceBlockIds");
    const scenes = new SceneGenerationService(repository, adapter);
    for (const outline of course.outlines) course = await scenes.generate(course.id, outline.id, course.revision, `scene-${outline.order}`);
    expect(new Set(course.scenes.map((scene) => scene.type))).toEqual(new Set(["slide", "interactive", "quiz"]));
    for (const scene of course.scenes) {
      const outline = course.outlines.find((item) => item.id === scene.outlineId)!;
      expect(scene.sourceBlockIds).toEqual(outline.sourceBlockIds);
      const call = calls.find((item) => item.requestId === `scene-${scene.order}`)!;
      const expectedBlock = buildMaterialContext(materials).find((block) => block.id === scene.sourceBlockIds?.[0])!;
      expect(call.userPrompt).toContain(JSON.stringify(expectedBlock.text));
      expect(call.systemPrompt).toContain("不可信参考数据");
    }
    await expect(service.remove(course.id, course.revision, materials[0].id)).rejects.toMatchObject({ code: "MATERIALS_LOCKED" });
    const first = course.scenes[0];
    course = await scenes.revise(course.id, first.outlineId, course.revision, "revise", { instruction: "保留原文数值，精简讲解" });
    expect(calls.find((item) => item.requestId === "revise")?.userPrompt).toContain(MATERIAL_FACT);
    expect(course.scenes[0].sourceBlockIds).toEqual(first.sourceBlockIds);
    const added = SceneOutlineSchema.parse({ ...course.outlines[0], id: "added", title: "慢启动实验数值", role: "worked_example", sourceBlockIds: undefined, order: 2 });
    course = await scenes.insert(course.id, course.revision, "insert", added, 2, "补充 37 MSS 的实验案例");
    expect(calls.find((item) => item.requestId === "insert")?.userPrompt).toContain(MATERIAL_FACT);
    expect(course.scenes.find((item) => item.outlineId === "added")?.sourceBlockIds?.length).toBeGreaterThan(0);
  });

  it("虚构来源进入已有修复预算，修复后的 ID 必须属于当前材料", async () => {
    const { repository, course } = await materialDraft();
    const mock = new MockAIAdapter();
    const calls: GenerateTextInput[] = [];
    const adapter: AIAdapter = { async generateText(input) {
      calls.push(input);
      const result = await mock.generateText(input);
      if (calls.length === 1) {
        const output = JSON.parse(result.text);
        output.outlines[0].sourceBlockIds = ["other-course-block"];
        return { ...result, text: JSON.stringify(output) };
      }
      return result;
    } };
    const saved = await new OutlineGenerationService(repository, adapter).generate(course.id, course.revision, "repair");
    expect(saved.outlineGeneration).toMatchObject({ repaired: true, upstreamCalls: 2 });
    expect(calls[1].userPrompt).toContain("不能虚构或引用其他课程");
    expect(JSON.stringify(saved.outlines)).not.toContain("other-course-block");
    const forged = saved.outlines.map((outline) => ({ ...outline, sourceBlockIds: ["other-course-block"] }));
    await expect(new OutlineGenerationService(repository, mock).edit(saved.id, saved.revision, saved.title, forged)).rejects.toThrow();
  });

  it("丢失来源时阻止生成；没有相关原文的新增页不伪造引用", async () => {
    const { materials } = await materialDraft();
    const outline = SceneOutlineSchema.parse({ id: "x", type: "slide", role: "concept", title: "Astronomy", teachingObjective: "Explain galaxies", keyPoints: ["Stellar nucleosynthesis", "Orbital resonance"], order: 1 });
    expect(selectSceneMaterialContext(materials, outline)).toEqual([]);
    expect(() => selectSceneMaterialContext(materials, { ...outline, sourceBlockIds: ["missing"] })).toThrow();
  });
});
