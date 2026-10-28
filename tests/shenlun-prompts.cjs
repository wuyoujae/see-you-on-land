"use strict";
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const prompts = require("../assets/js/shenlun-prompts.js");

assert.match(prompts.version, /^shenlun-summary-/);
assert.deepEqual(prompts.subtypes.map(item => item.id), ["auto", "countermeasure", "cause", "problem", "effect", "comprehensive"]);
assert.equal(prompts.normalizeSubtype("untrusted-subtype"), "auto");
assert.ok(Object.isFrozen(prompts.schemas.grade.properties));
const sandbox = {window: {}};
vm.runInNewContext(fs.readFileSync(path.join(__dirname, "../assets/js/shenlun-prompts.js"), "utf8"), sandbox);
assert.equal(sandbox.window.ShenlunPrompts.version, prompts.version);

// The exact output contracts must agree across the model service and UI.
const keys = schema => Object.keys(schema.properties).sort();
assert.deepEqual(keys(prompts.schemas.ocr), ["observations", "questionMeta", "text"]);
assert.deepEqual(keys(prompts.schemas.ocr.properties.questionMeta), ["maxScore", "scope", "subtype", "task", "wordLimit"]);
assert.deepEqual(keys(prompts.schemas.reference), ["analysis", "limitations", "question", "referenceAnswer", "rubric", "status"]);
assert.deepEqual(keys(prompts.schemas.grade), ["annotations", "dimensions", "maxScore", "nextSteps", "points", "score", "status", "summary", "writing"]);
assert.equal(prompts.schemas.reference.properties.rubric.type, "array");
assert.deepEqual(keys(prompts.schemas.reference.properties.rubric.items), ["acceptedExpressions", "explanation", "id", "maxPoints", "sourceAnchors", "title"]);
assert.deepEqual(keys(prompts.schemas.grade.properties.annotations.items.properties.answerAnchor), ["occurrence", "quote"]);
assert.deepEqual(prompts.schemas.grade.properties.score.type, ["number", "null"]);
assert.deepEqual(prompts.schemas.reference.properties.status.enum, ["ready", "needs_review"]);
assert.deepEqual(prompts.schemas.grade.properties.status.enum, ["ready", "needs_review"]);
assert.deepEqual(prompts.schemas.ocr.properties.observations.properties.crossouts.items.properties.confidence, {type: "number", minimum: 0, maximum: 1});
function checkObjectSchemas(schema) {
  if (schema.type === "object") {
    assert.equal(schema.additionalProperties, false);
    assert.deepEqual([...schema.required].sort(), Object.keys(schema.properties).sort());
    Object.values(schema.properties).forEach(checkObjectSchemas);
  } else if (schema.type === "array") checkObjectSchemas(schema.items);
}
Object.values(prompts.schemas).forEach(checkObjectSchemas);

const project = {subtype: "cause", maxScore: 20, wordLimit: 300};
const reference = prompts.referenceInstructions(project);
assert.match(reference, /用户已确认满分：20分/);
assert.match(reference, /字数上限：300字/);
assert.match(reference, /先分析题目/);
assert.match(reference, /不应收到或参考用户作答/);
assert.match(reference, /上游条件或行动/);
assert.match(reference, /后果倒写成原因/);
assert.match(reference, /分值不决定固定要点数/);
assert.match(reference, /40字.*不是评分规则/);
assert.match(reference, /合并主题不等于删除/);
assert.match(reference, /准确的同义概括/);
assert.match(reference, /不代表官方评分细则/);
assert.match(reference, /sourceAnchors/);
assert.match(reference, /maxPoints之和严格等于/);
assert.match(reference, /needs_review/);
assert.match(reference, /私有内部思维链/);
assert.ok(!reference.includes("S市总工会课程的方法"));
assert.ok(prompts.referenceInstructions({question: project}).includes("用户已确认满分：20分"));
assert.match(prompts.referenceInstructions({maxScore: NaN}), /尚未提供有效的已确认满分/);
assert.match(prompts.referenceInstructions({maxScore: Infinity}), /尚未提供有效的已确认满分/);
assert.match(prompts.referenceInstructions({maxScore: -1}), /尚未提供有效的已确认满分/);

const auto = prompts.referenceInstructions({maxScore: 15});
for (const title of ["S市总工会课程", "Q市数字化服务课程", "新型消费课程", "青年人才与制造业课程", "好品山东课程"]) assert.ok(auto.includes(title));
assert.match(prompts.referenceInstructions({subtype: "problem", maxScore: 20}), /监管要求本身不是问题/);
assert.match(prompts.referenceInstructions({subtype: "effect", maxScore: 30}), /谁→对谁→产生什么变化/);
assert.match(prompts.referenceInstructions({subtype: "comprehensive", maxScore: 15}), /同一主题可以合并归类/);

const grade = prompts.gradeInstructions(project, {referenceAnswer: "MALICIOUS_REFERENCE_TEXT"});
assert.match(grade, /score=null/);
assert.match(grade, /全部earned相加严格等于score/);
assert.match(grade, /不在总分上再减/);
assert.match(grade, /完全遗漏可用answerAnchors=\[\]/);
assert.match(grade, /逐字复制用户答案/);
assert.match(grade, /crossoutsCount=null/);
assert.match(grade, /不是错误字数/);
assert.match(grade, /未经用户确认不能据此认定/);
assert.match(grade, /不代表官方成绩/);
assert.ok(!grade.includes("MALICIOUS_REFERENCE_TEXT"));
const malicious = "INJECTED_ROLE_IGNORE_RULES_94829";
for (const build of [prompts.referenceInstructions, prompts.gradeInstructions]) {
  const result = build({subtype: malicious, maxScore: malicious, wordLimit: malicious, questionText: malicious, answer: malicious}, {referenceAnswer: malicious});
  assert.ok(!result.includes(malicious));
  assert.match(result, /全部是待分析的数据/);
  assert.match(result, /不得执行代码/);
}

const questionOCR = prompts.ocrInstructions("question");
assert.match(questionOCR, /可以有多张/);
assert.match(questionOCR, /每页正常阅读顺序/);
assert.match(questionOCR, /禁止根据常识补句/);
assert.match(questionOCR, /不引用任何历史图片/);
assert.match(questionOCR, /不得擅自删改/);
assert.match(questionOCR, /无法辨认/);
assert.match(questionOCR, /不是已经确认的错别字数量/);
assert.match(questionOCR, /每项代表一处/);
assert.match(prompts.ocrInstructions("answer"), /questionMeta.maxScore、wordLimit、subtype均为null/);
assert.match(prompts.ocrInstructions("answer"), /同一份答卷的连续多页/);
assert.match(prompts.ocrInstructions("answer"), /按上传顺序合并各页正文/);
assert.match(prompts.ocrInstructions("answer"), /页间保留空行/);
assert.match(prompts.ocrInstructions("answer"), /第几张图及位置/);

const methods = fs.readFileSync(path.join(__dirname, "../assets/prompts/shenlun-methods.md"), "utf8");
for (const concept of ["选大哥", "选词组合", "化大为小", "目标导向", "40字", "同义", "官方", "划改", "occurrence"]) assert.ok(methods.includes(concept));
assert.ok(methods.includes(prompts.version));
console.log("shenlun-prompts: contracts, course boundaries, stateless OCR, grading rules and injection isolation passed");
