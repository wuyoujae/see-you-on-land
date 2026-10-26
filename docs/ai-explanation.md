# AI 题目讲解接口

浏览器依次加载本地 KaTeX、RichContent、SolverPrompts 和 AIExplanation；Markdown 排版沿用现有 marked 与 DOMPurify。模块初始化、翻页和读取备份不会启动模型请求。仅在当前题目已提交、同页解析面板显示且需要解析时调用 `explain`，不预取未打开或未提交的题目。下一题直接进入题目，回看已提交题自动恢复其解析面板；离题只退订界面，后台请求继续完成并缓存，旧回调不能覆盖新题面板。

```js
AIExplanation.configure({
  getSettings: () => ({ ...settings }),
  openSettings: () => openSettings()
});

const controller = new AbortController();
const result = await AIExplanation.explain({
  subjectId: question.subjectId,
  question,
  signal: controller.signal,
  onChunk(chunk) {
    // 首个 snapshot 包含已有正文；之后 text/reasoning 为增量。
    // reasoning 仅为 API 的公开摘要，不是内部推理原文。
    if (chunk.snapshot) markdown = chunk.text;
    else markdown += chunk.text || "";
    AIExplanation.renderMarkdown(host, markdown);
  }
});
AIExplanation.renderMarkdown(host, result.text);
```

`question` 接受 `id/subjectId/type/stem/stemBlocks/materialBlocks/options/answer/sourceAnswer/source/revision`。选项为 `{value,label,blocks?}`。段落可用 `parts:[{type:'text',text},{type:'image',src,alt,inline:true},...]` 保留图文顺序；存在parts时不重复text fallback。材料、题干、选项的全部必要图片按顺序去重，转成 data URL 后送到 vision。应用上限64张、每张12MB，序列化后的完整UTF-8请求上限64MiB；超过任一上限或缺图均明确报错，不截掉图片、不合成假图，也不让模型自行访问 localhost。来源参考解析中的图片仅保留alt/caption文字描述，不占题面图片预算。

## 订阅与后台请求

`signal.abort()` 只退订当前界面并使该调用以 `AbortError` 结束，不中止共享后台请求。重新打开同题可加入 pending 请求并得到已累积正文；同题只发一次请求。最多2个并行，后打开的待排题优先；已运行请求继续完成。180秒仍未完成则明确超时，不保留未完成解析。

`onChunk` 每次包含 `key/requestId/text/reasoning/cached`。首次回调包含 `snapshot:true` 和 `state`，方便界面记录请求标识。只有用户明确停止时才调用 `AIExplanation.cancel(key或requestId)`；也可按 question ID 定位停止。`getPending()` 只返回请求标识、题目关联与排队状态。

## 缓存与存储失败

成功完整结果写入 IndexedDB `summer-politics-ai-explanations` 的 `explanations` store。内容、材料/选项/图片引用、来源答案和解析、revision、科目、提示词正文及版本、模型、endpoint语义参数参与 SHA-256 key；API key、用户作答和会话不进入缓存标识。不同 key 记录共存，不按时间或条数自动淘汰。旧 `expiresAt` 数字只为兼容读取，时间本身不会使相同内容再次付费生成。

返回值包括 `text/reasoning/key/questionId/subjectId/model/promptVersion/status/completedAt/cached`。持久化成功时 `persisted:true`；浏览器 quota 或权限导致写入失败时明确返回 `memoryOnly:true/cacheWarning`，解析在当前页面内仍可用，界面不能把它显示成已永久保存。已有缓存即使暂时没有 API key 也可读取；只有缓存未命中才要求密钥。

取消、意外流结束、`response.incomplete/failed` 和空正文不写成功缓存。429不自动重试；仅服务明确拒绝 reasoning summary 字段的400请求会去掉该字段重试一次。

## 科目思路

`SolverPrompts.subjects` 只有 language/quantity/reasoning/analysis/politics/common 六类。`general`、`verbal-logical-fill` 等旧值迁移到 language。`await SolverPrompts.instructions(subjectId)` 每科读取一次 `assets/prompts/{subject}.md`，读取失败可重试。四科文件提炼对应课程笔记；政治和常识说明未提供专属笔记，使用通用知识核验方法。

提示词仅讲当前题目：答案与题型、简洁思路、必要选项辨析和本题知识。数量比例的整数限制、三段论口诀边界、年均增长期数等注意事项都保留；来源答案与严格推导冲突时要说明具体缺口，不强行证明给定答案。

## 备份

```js
const backup = await AIExplanation.exportCache(); // {version:1, entries:[...]}
const valid = AIExplanation.validateImportCache(backup); // 纯校验，不写库、不请求模型
await AIExplanation.importCache(valid, {merge:true}); // 同key保留updatedAt较新者
// 失败回滚可用之前导出的快照：importCache(previous, {merge:false})
```

记录白名单：`key/questionId/subjectId/promptVersion/model/text/reasoning/createdAt/updatedAt/expiresAt/status`，status只允许completed，expiresAt新数据为null。备份没有题库、题干、图片或凭证；导入上限50000条/256MiB，超过明确拒绝，合并不会裁剪旧记录。默认IDB导入使用单事务，验证/恢复不触发模型 API。

## 验证

```powershell
node --test tests/ai-explanation.cjs
python -m unittest discover -s tests -p test_course_public_build.py
```

Node测试全部使用 mock fetch 和存储，不调用实际付费接口。页面与浏览器检查交由 CUA 执行。
