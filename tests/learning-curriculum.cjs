"use strict";
// Run with: node --test tests/learning-curriculum.cjs (no npm dependencies).
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const Core = require("../assets/js/learning-core.js");
global.katex = require("../assets/vendor/katex/katex.min.js");
const RichContent = require("../assets/js/rich-content.js");
const reviewed = require("./fixtures/learning-reviewed-answers.json");
const ROOT = path.resolve(__dirname, "..");
const COURSE_ROOT = path.join(ROOT, "data", "courses");
const manifest = JSON.parse(fs.readFileSync(path.join(COURSE_ROOT, "manifest.json"), "utf8"));
// Load the real catalog once so every test also works in isolation with
// --test-name-pattern. The validation test below verifies all identities/counts.
const lessons = manifest.subjects.flatMap(subject => subject.groups.flatMap(group =>
  group.lessons.map(entry => JSON.parse(fs.readFileSync(path.resolve(ROOT, entry.path), "utf8")))));
const questions = new Map(lessons.flatMap(lesson => lesson.cards.filter(card => card.type === "question")
  .map(card => [card.question.id, { card, lesson }])));
const unique = (seen, value, label) => {
  assert.equal(typeof value, "string", `${label} must be a string`);
  assert.match(value, /^[a-zA-Z0-9_-]+$/, `${label}: ${value}`);
  assert.ok(!seen.has(value), `duplicate ${label}: ${value}`);
  seen.add(value);
};

function localFile(resource, label) {
  assert.equal(typeof resource, "string", `${label} needs a local resource`);
  assert.ok(resource.trim(), `${label} has an empty resource`);
  assert.doesNotMatch(resource, /^(?:[a-z]+:|\/\/)|[\\\u0000-\u001f]/i, `${label} must be a public local file`);
  let clean;
  assert.doesNotThrow(() => { clean = decodeURIComponent(resource.split(/[?#]/)[0]); }, label);
  const absolute = path.resolve(ROOT, clean.replace(/^\//, ""));
  assert.ok(absolute.startsWith(ROOT + path.sep), `${label} escapes the site root: ${resource}`);
  assert.ok(fs.existsSync(absolute) && fs.statSync(absolute).isFile(), `${label} missing: ${resource}`);
  return absolute;
}

test("every offered subject/group/lesson resolves to complete and unique course data", () => {
  assert.equal(manifest.version, 1);
  assert.ok(Array.isArray(manifest.subjects) && manifest.subjects.length > 0);
  const subjectIds = new Set(), groupIds = new Set(), lessonIds = new Set(), cardIds = new Set(), questionIds = new Set();
  let cardCount = 0;
  for (const subject of manifest.subjects) {
    unique(subjectIds, subject.id, "subject id");
    assert.ok(subject.title?.trim(), subject.id);
    assert.ok(Array.isArray(subject.groups) && subject.groups.length > 0, subject.id);
    for (const group of subject.groups) {
      unique(groupIds, group.id, "group id");
      assert.ok(group.title?.trim(), group.id);
      assert.ok(Array.isArray(group.lessons) && group.lessons.length > 0, group.id);
      for (const entry of group.lessons) {
        unique(lessonIds, entry.id, "lesson id");
        const file = localFile(entry.path, entry.id);
        assert.ok(file.startsWith(COURSE_ROOT + path.sep), `${entry.id} is outside data/courses`);
        const lesson = JSON.parse(fs.readFileSync(file, "utf8"));
        assert.equal(lesson.id, entry.id);
        assert.equal(lesson.subjectId, subject.id);
        assert.equal(lesson.groupId, group.id);
        assert.ok(lesson.title?.trim(), entry.id);
        assert.ok(Array.isArray(lesson.cards) && lesson.cards.length > 0, entry.id);
        assert.equal(entry.cardCount, lesson.cards.length, entry.id);
        assert.deepEqual(entry.cardIds, lesson.cards.map(card => card.id), `${entry.id}: catalog progress card IDs must match the lesson exactly`);
        assert.deepEqual(entry.questionIds, lesson.cards.filter(card => card.type === "question").map(card => card.question.id), `${entry.id}: catalog question IDs must match the lesson exactly`);
        let count = 0;
        for (const card of lesson.cards) {
          unique(cardIds, card.id, "card id");
          assert.ok(card.title?.trim(), card.id);
          assert.ok(["text", "question"].includes(card.type), `${card.id}: unsupported ${card.type}`);
          if (card.type === "question") {
            unique(questionIds, card.question?.id, "question id");
            count++;
          }
        }
        assert.equal(entry.questionCount, count, entry.id);
        cardCount += lesson.cards.length;
      }
    }
  }
  assert.deepEqual(manifest.totals, {
    subjectCount: subjectIds.size, groupCount: groupIds.size, lessonCount: lessonIds.size,
    cardCount, questionCount: questionIds.size
  });
});

test("each question has usable stem, complete options and an answer belonging to its question type", () => {
  assert.ok(questions.size > 0);
  const choiceTypes = ["single", "single-choice", "multiple", "multiple-choice"];
  const types = [...choiceTypes, "boolean", "true-false", "fill", "fill-in", "fill-in-the-blank"];
  for (const [qid, { card }] of questions) {
    const question = card.question;
    assert.ok(types.includes(question.type), `${qid}: ${question.type}`);
    assert.ok((typeof question.stem === "string" && question.stem.trim()) || question.stemBlocks?.length, `${qid}: missing question stem`);
    assert.equal(Core.isAnswered(question.answer), true, `${qid}: missing answer`);
    // Answers are kept as grading data, while solution content belongs on gated
    // explanation cards. UI rendering is tested by the real-browser checks.
    for (const key of ["explanation", "analysis", "solution", "correctAnswer", "answerText"]) {
      assert.equal(Object.hasOwn(card, key), false, `${qid}: ${key} outside the gated explanation`);
      assert.equal(Object.hasOwn(question, key), false, `${qid}: ${key} attached to the question`);
    }
    if (choiceTypes.includes(question.type)) {
      assert.ok(Array.isArray(question.options) && question.options.length >= 2, `${qid}: options`);
      const values = new Set();
      for (const option of question.options) {
        assert.ok(option && typeof option === "object", `${qid}: structured option required`);
        const value = String(option.value ?? option.id ?? "");
        assert.ok(value && !values.has(value), `${qid}: duplicate/empty option ${value}`);
        values.add(value);
        assert.ok((typeof option.label === "string" && option.label.trim()) || option.blocks?.length || option.labelBlocks?.length, `${qid}: empty option ${value}`);
      }
      const answers = question.type.startsWith("multiple") ? question.answer : [question.answer];
      assert.ok(Array.isArray(answers) && answers.length > 0, qid);
      assert.equal(new Set(answers.map(String)).size, answers.length, `${qid}: duplicate expected choices`);
      for (const answer of answers) assert.ok(values.has(String(answer)), `${qid}: answer ${answer} not in its options`);
    } else if (["boolean", "true-false"].includes(question.type)) {
      assert.ok([true, false, "true", "false", "正确", "错误"].includes(question.answer), `${qid}: boolean answer`);
    }
  }
});

test("all solution cards are locked to an existing preceding question and every question has its own solution", () => {
  for (const lesson of lessons) {
    const preceding = new Set(), explained = new Set();
    for (const card of lesson.cards) {
      if (card.type === "question") preceding.add(card.question.id);
      if (card.role === "explanation" || card.questionId) {
        assert.equal(card.type, "text", `${card.id}: solution must be a text card`);
        assert.equal(card.role, "explanation", `${card.id}: question-bound text must be gated`);
        assert.ok(preceding.has(card.questionId), `${card.id}: missing/forward/cross-lesson question binding ${card.questionId}`);
        assert.ok(Array.isArray(card.blocks) && card.blocks.length > 0, `${card.id}: empty solution`);
        assert.equal(Core.canVisit(card, Core.createRecord()), false, `${card.id}: exposed before submission`);
        const saved = { ...Core.createRecord(), answers: { [card.questionId]: { answer: "test", status: "incorrect", submittedAt: 1 } } };
        assert.equal(Core.canVisit(card, saved), true, `${card.id}: wrong answers must still permit learning`);
        explained.add(card.questionId);
      }
    }
    for (const qid of preceding) assert.ok(explained.has(qid), `${qid}: no attached solution`);
  }
});

test("all mixed formula/image/text blocks render and every referenced local image exists", () => {
  let formulas = 0;
  function inspect(value, label) {
    if (value === null || value === undefined) return;
    if (typeof value === "string") {
      for (const match of value.matchAll(/!\[[^\]]*\]\(([^)]+)\)/g)) localFile(match[1], label);
      const html = RichContent.render(value);
      assert.doesNotMatch(html, /data-rich-math-state="(?:error|pending)"/, `${label}: broken inline math`);
      return;
    }
    if (Array.isArray(value)) { value.forEach((item, i) => inspect(item, `${label}[${i}]`)); return; }
    if (typeof value !== "object") return;
    if (value.type === "image") {
      localFile(value.src, label);
      assert.ok(value.alt?.trim(), `${label}: image requires accessible text`);
    }
    if (value.type === "formula") {
      const expression = value.latex ?? value.tex ?? value.text;
      assert.ok(typeof expression === "string" && expression.trim(), `${label}: empty formula`);
      assert.doesNotMatch(RichContent.render(value), /data-rich-math-state="(?:error|pending)"/, `${label}: invalid formula ${expression}`);
      formulas++;
    }
    for (const [key, child] of Object.entries(value)) {
      if (!["source", "src", "answer", "aliases", "latex", "tex"].includes(key)) inspect(child, `${label}.${key}`);
    }
  }
  for (const lesson of lessons) for (const card of lesson.cards) {
    if (card.type === "text") inspect(card.blocks, card.id);
    else {
      inspect(card.question.stemBlocks ?? card.question.stem, `${card.id}.stem`);
      for (const option of card.question.options || []) inspect(option.blocks ?? option.labelBlocks ?? option.label, `${card.id}.option-${option.value}`);
    }
    const source = card.source ?? lesson.source;
    if (source?.type === "pdf") {
      assert.ok(Array.isArray(source.pages) && source.pages.length > 0, `${card.id}: PDF physical page reference required`);
      assert.ok(source.pages.every(page => Number.isInteger(page) && page > 0), `${card.id}: invalid PDF source pages`);
      assert.ok(Core.sourceReference(source), `${card.id}: PDF source pages must be visible`);
      for (const [index, image] of (source.originalImages || []).entries()) {
        localFile(image.src, `${card.id}.originalImages[${index}]`);
        assert.ok(image.alt?.trim(), `${card.id}: original question needs accessible text`);
      }
    }
  }
  // The source set has quantitative formulas. Every actual image is validated
  // above; rich-content.cjs separately exercises mixed image/formula fixtures.
  assert.ok(formulas > 0, "formula source content was lost");
});

test("the independently reviewed source inventory and answer/ordering keys match the shipped curriculum", () => {
  // The authoring audit belongs in ignored tmp/, not in the deployed course.
  // This independent source inventory keeps the permanent tests portable.
  const sourceIds = Object.entries(reviewed.sourceQuestionCounts).flatMap(([subject, count]) =>
    reviewed.sourceQuestionIds?.[subject] || Array.from({ length: count }, (_, index) => `${subject}-q${String(index + 1).padStart(3, "0")}`));
  assert.deepEqual([...questions.keys()].sort(), sourceIds.sort(), "formal source questions were lost, duplicated or replaced");
  for (const [qid, expected] of Object.entries(reviewed.answers)) {
    assert.ok(questions.has(qid), `${qid}: reviewed source question missing`);
    assert.equal(questions.get(qid).card.question.answer, expected, `${qid}: reviewed answer changed`);
  }
  for (const [qid, sequence] of Object.entries(reviewed.ordering)) {
    const question = questions.get(qid).card.question;
    assert.equal(question.type, "single", `${qid}: sequence selection is single-choice`);
    const option = question.options.find(option => option.value === question.answer);
    const normalized = option.label.replace(/[\s、,，.．:：]/g, "");
    assert.ok(normalized.includes(sequence), `${qid}: expected ${sequence}, got ${option.label}`);
  }
});
