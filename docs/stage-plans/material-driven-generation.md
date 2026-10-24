# 教学材料驱动生成

实现日期：2026-10-24。目标是让 4～8 页微型课程基于用户选定的材料生成，并保留可查看的原文依据。

## 使用方式

首页填写课程要求，选择文字型 PDF、Markdown 或 TXT。PDF 可输入 `1-5,8` 一类的页码范围；编号指 PDF 实际页序，不是书中印刷页码。创建时先保存课程草稿，再解析材料。上传失败保留草稿和当前选择，可以重试或进入草稿处理。

大纲页的“教学材料”可以展开查看已保存的解析原文。开始生成页面之前，可以重新上传全部材料或删除某份材料；材料更新成功会清空旧大纲，要求重新规划。解析或提交失败保留原材料和大纲。开始生成页面之后固定材料，重生成仍使用同一份原文。

课堂的“参考材料”展示本页生成时实际提供给模型的文件名、PDF 页码或 Markdown 标题，以及对应片段。来源由服务端写入。页面后来经过编辑时，会提示来源记录属于生成时刻；来源关联不代表每一句输出都经过事实核验。

## 第一版范围

- 最多 3 份材料，单份 10 MB，选中正文合计 40,000 个 JavaScript 字符；每份 PDF 最多选择 80 页。
- 原文按段落拆为最多 1,600 字符的片段；每页大纲选取 1～10 个片段。
- 超预算明确提示减少材料或缩小范围，不静默截掉后半章。不额外调用模型做摘要。
- 支持本地文字层提取。扫描页无文字时提示；混合 PDF 显示未提取文字的页码。复杂公式、表格和多栏排版的解析质量需查看预览确认。
- 保存材料元数据、内容指纹和所选原文；不保存上传原件，不提供原件下载。删除课程通过外键级联删除材料。
- 沿用纯主题生成；没有材料时使用原有提示词分支。OCR、图片复用、Office 文档导入、跨课程知识库和向量检索后置。

## 实际调用链

```text
HomeWorkspace / CourseMaterialsPanel
  → POST /api/courses/{id}/materials（multipart 文件、页码、expectedRevision）
  → CourseMaterialService → extractCourseMaterial（unpdf 1.4.0 / 文本解码）
  → CourseRepository.save({ replaceMaterials })
  → courses 大纲失效 + course_materials 替换，同一短事务提交

OutlineGenerationService → 读取课程材料 → buildMaterialContext
  → outline.v2.5 → 校验每页 sourceBlockIds → 原有 repair 预算 → 保存大纲

SceneGenerationService.generate / revise / regenerateFailedInteractive / insert
  → 按大纲来源读取原文；插页无预先来源时按标题、目标、关键点和指令匹配
  → generateScene → 材料事实约束 + 本页原文 → 原有校验和 repair
  → 服务端记录实际 sourceBlockIds → MySQL 保存

SceneMaterialSources → GET /api/courses/{id}/materials → 展示本页参考原文
```

新页匹配是确定性的关键词匹配，不是向量检索；未命中则不记录来源，不承诺该页受到原文支持。已有大纲引用丢失时明确失败，不静默改用无材料生成。匹配结果可能需要人工判断相关性。

`SceneOutline.sourceBlockIds` 与 `Scene.sourceBlockIds` 是向后兼容的可选字段。旧课程继续使用 v5，无需回写历史 JSON。材料正文位于独立表，不增加首页课程列表载荷。远端模型模式下，选定的原文和文件名会作为生成请求上下文发送给当前配置的模型服务。

## 部署与验证

先执行 `pnpm db:migrate`，新增 `009_course_materials.sql`。本次已在本机 `ai_teaching` 应用 009，既有 001～008 未重复执行；迁移仅创建材料表，不修改历史课程。

自动验证使用 mock 模型，不产生远端模型调用。当前验证：229 项单元测试、25 项 MySQL 集成测试、Lint、TypeScript 和生产构建通过；最后调整大纲来源约束后，补跑的 26 项材料与大纲测试通过。测试覆盖真实 PDF 的选页提取、空页提示、中文 Markdown、长段落完整保留、错误文件与预算、失败时保留原内容、revision 冲突、材料变更使大纲失效、三类场景接收原文、重生成与插页、非法来源修复、数据库恢复和级联删除。

生产构建配合本机 MySQL、mock 模型完成浏览器验收：错误 PDF 页码保留草稿并可重试；选择第 2 页时排除第 1 页原文；替换材料使旧大纲失效；四个场景生成并保存对应来源；重启服务及刷新后可恢复材料，并在课堂查看 PDF 页码与中文 Markdown 标题、原文。来源弹窗支持关闭按钮和 Escape；截图复核后修正了全局样式重置导致的定位偏移，课堂控制台无错误。验收截图保存在本地忽略目录 `output/playwright/materials/pdf-source.png` 和 `output/playwright/materials/markdown-source.png`，临时验收课程已清理。

mock 测试验证工程链路和输入来源，不证明真实模型的教学忠实度。后续可用带特定数字、适用条件与案例的教材节选，对真实模型输出做独立内容检查。

## 参考关系

参考本地 OpenMAIC 的 `app/generation-preview/page.tsx`、`lib/document/bundle.ts`、`lib/pdf/pdf-providers.ts`、`packages/@openmaic/generation/src/outline-generator.ts` 的纵向流程。本次按现有 AIAdapter、CourseRepository 和 MySQL 结构独立实现，使用同版本 unpdf 1.4.0；没有迁入 OpenMAIC 的浏览器材料存储、解析 Provider 平台或 RAG 模块。

适配上的主要变化是从提取时保留片段位置，并在场景阶段重新提供原文；来源仅代表实际生成上下文，不将它描述为自动事实核验。
