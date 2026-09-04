# Prompt 模板

这里保存生成流程中相对稳定、需要人工审查的系统 Prompt 文本。

- `*-generation-system.md` 保存大纲、幻灯片和测验的完整生成规则。
- `*-rules.md` 保存互动场景公共规则或具体互动类型规则。
- `*-requirements.md` 保存代码场景的附加要求。
- `*-repair-system.md` 保存大纲或场景修复规则。

课程数据、场景大纲、前一场摘要、旧场景、用户修订意见和校验错误仍由 TypeScript 业务逻辑组装，不直接写入模板。布局骨架和实现示例也暂时保留在 `lib/interactive/layout-templates.ts`。

修改模板时先确认是否改变了实际生成行为；只有 Prompt 文本或组装顺序发生行为变化时才升级对应版本号。模板由 `../loader.ts` 按固定映射以 UTF-8 读取。
