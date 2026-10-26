(() => {
  "use strict";
  const escape = value => String(value ?? "").replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  const icon = name => `<i data-lucide="${name}" aria-hidden="true"></i>`;
  const normalize = value => String(value ?? "")
    .normalize("NFKC")
    .toLocaleLowerCase("zh-CN")
    .replace(/\u2212/g, "-")
    .replace(/\p{White_Space}/gu, "")
    // Ignore sentence punctuation and quotation/layout marks, not math operators.
    .replace(/[,，、;；!！?？。'"‘’“”「」『』【】〔〕〖〗《》〈〉()\[\]{}]/gu, "")
    .replace(/[.:]/g, (mark, index, text) => {
      const nextIsDigit = /\p{Nd}/u.test(text[index + 1] || "");
      const previousIsDigit = /\p{Nd}/u.test(text[index - 1] || "");
      // Keep decimal points (including .5) and numeric ratios/times such as 1:2.
      return mark === "." ? (nextIsDigit ? mark : "") : (previousIsDigit && nextIsDigit ? mark : "");
    });
  const isEmpty = answer => Array.isArray(answer) ? answer.length === 0 : answer === undefined || answer === null || String(answer).trim() === "";
  const booleanValue = value => value === true || value === "true" || value === "正确" ? "true" : value === false || value === "false" || value === "错误" ? "false" : normalize(value);

  function grade(question, answer) {
    if (isEmpty(answer)) return "unanswered";
    if (question.grading === "unverified" || isEmpty(question.answer)) return "ungraded";
    if (question.type === "multiple" || question.type === "multiple-choice") {
      const actual = (Array.isArray(answer) ? answer : [answer]).map(normalize).sort();
      const expected = (Array.isArray(question.answer) ? question.answer : [question.answer]).map(normalize).sort();
      return actual.length === expected.length && actual.every((value, index) => value === expected[index]) ? "correct" : "incorrect";
    }
    if (question.type === "boolean" || question.type === "true-false") {
      return booleanValue(answer) === booleanValue(question.answer) ? "correct" : "incorrect";
    }
    // Circled enumeration markers belong to the source layout of fill-in text.
    // Remove them before NFKC turns them into ordinary digits; choice IDs keep
    // their original normalization and must remain distinguishable.
    const fillIn = !question.type || ["fill", "fill-in", "fill-in-the-blank"].includes(question.type);
    const normalizeAnswer = fillIn ? value => normalize(String(value ?? "").replace(/[①-⑳]/gu, "")) : normalize;
    const accepted = [question.answer, ...(question.aliases || [])].map(normalizeAnswer);
    return accepted.includes(normalizeAnswer(answer)) ? "correct" : "incorrect";
  }

  function renderQuestion(question, answer, options = {}) {
    const type = question.type || "fill";
    const name = options.name || `question-${question.id}`;
    const locked = Boolean(options.readonly || options.submitted);
    const disabled = locked ? " disabled" : "";
    // A saved draft or a read-only preview is not a submitted attempt.
    const feedback = Boolean(options.submitted && options.feedback);
    const result = feedback ? grade(question, answer) : "";
    const expected = (Array.isArray(question.answer) ? question.answer : [question.answer]).map(value => type === "boolean" || type === "true-false" ? booleanValue(value) : normalize(value));
    const rich = value => window.RichContent ? window.RichContent.render(value) : escape(value);
    const optionBlocks = option => option.blocks?.length ? option.blocks : option.labelBlocks?.length ? option.labelBlocks : null;
    const letterOnly = ["single", "single-choice", "multiple", "multiple-choice"].includes(type) && question.options?.length > 0 && question.options.every(option => {
      if (!option || typeof option !== "object") return false;
      const blocks = optionBlocks(option), value = String(option.value ?? option.id).trim();
      return (!blocks || blocks.length === 1 && blocks[0].type === "paragraph" && String(blocks[0].text || "").trim() === value) && String(option.label ?? option.text ?? "").trim() === value;
    });
    const optionFeedback = (value, checked, multiple = false) => {
      if (!feedback) return { className: "", html: "", label: "" };
      let state = "", label = "", symbol = "";
      if (result === "ungraded") {
        if (checked) { state = "neutral"; label = "已选 · 条件待核"; symbol = "circle-help"; }
      } else if (expected.includes(type === "boolean" || type === "true-false" ? booleanValue(value) : normalize(value))) {
        state = "correct"; symbol = "check";
        label = checked ? "已选 · 正确" : multiple ? "漏选 · 正确答案" : "正确答案";
      } else if (checked) { state = "incorrect"; label = "已选 · 选错"; symbol = "x"; }
      return { className: state ? ` is-${state}` : "", html: label ? `<span class="practice-option-feedback">${icon(symbol)}<span>${label}</span></span>` : "", label };
    };
    let body;
    if (type === "boolean" || type === "true-false") {
      body = [{ value: "true", label: "正确" }, { value: "false", label: "错误" }].map(option => {
        const checked = !isEmpty(answer) && booleanValue(answer) === option.value;
        const state = optionFeedback(option.value, checked);
        return `<label class="practice-option${state.className}"><input type="radio" name="${escape(name)}" value="${option.value}"${checked ? " checked" : ""}${disabled}><span class="practice-option-main"><span class="learn-option-content">${option.label}${state.html}</span></span></label>`;
      }).join("");
    } else if (["single", "single-choice", "multiple", "multiple-choice"].includes(type)) {
      const multiple = type.startsWith("multiple");
      body = (question.options || []).map((option, index) => {
        const value = typeof option === "object" ? option.value ?? option.id ?? index : index;
        const label = typeof option === "object" ? option.label ?? option.text ?? value : option;
        const checked = multiple ? (Array.isArray(answer) ? answer : []).map(normalize).includes(normalize(value)) : !isEmpty(answer) && normalize(answer) === normalize(value);
        const state = optionFeedback(value, checked, multiple);
        return `<label class="practice-option${state.className}"><input type="${multiple ? "checkbox" : "radio"}" name="${escape(name)}" value="${escape(value)}"${letterOnly ? ` aria-label="选项 ${escape(value)}${state.label ? " · " + escape(state.label.replace(/\s*·\s*/g, "，")) : ""}"` : ""}${checked ? " checked" : ""}${disabled}><span class="practice-option-main"><b class="learn-option-letter">${escape(typeof option === "object" ? option.value ?? option.id ?? String.fromCharCode(65 + index) : String.fromCharCode(65 + index))}</b>${letterOnly ? state.html : `<span class="learn-option-content">${rich(typeof option === "object" ? optionBlocks(option) || label : label)}${state.html}</span>`}</span></label>`;
      }).join("");
    } else if (type === "text") {
      body = rich(question.blocks || []);
    } else {
      const state = feedback ? result === "correct" ? " is-correct" : result === "incorrect" ? " is-incorrect" : result === "ungraded" ? " is-neutral" : "" : "";
      body = `<input class="practice-text-input${state}" name="${escape(name)}" type="text" value="${escape(answer)}" autocomplete="off" aria-label="填写答案"${feedback && result === "incorrect" ? ' aria-invalid="true"' : ""}${locked ? " readonly" : ""}>`;
    }
    if (type === "text") return `<article class="practice-text-component" data-content-id="${escape(question.id)}">${rich(question.stemBlocks || question.stem || question.prompt || "")}${body}</article>`;
    const material = question.materialBlocks?.length ? `<section class="practice-material" aria-label="题目材料">${rich(question.materialBlocks)}</section>` : "";
    const fillIn = !["single", "single-choice", "multiple", "multiple-choice", "boolean", "true-false"].includes(type);
    const reference = type === "boolean" || type === "true-false" ? (booleanValue(question.answer) === "true" ? "正确" : "错误") : Array.isArray(question.answer) ? question.answer.join("、") : question.answer;
    const summary = !feedback ? "" : result === "ungraded" ? "本题条件待核，不计分" : result === "correct" ? "答对了" : result === "incorrect" ? `这道题还没答对${fillIn ? ` · 参考答案：${reference}` : ""}` : "未作答";
    const summaryHTML = summary ? `<p class="practice-component-feedback ${result}" role="status">${icon(result === "correct" ? "circle-check" : result === "incorrect" ? "circle-x" : "circle-help")}<span>${escape(summary)}</span></p>` : "";
    return `${material}<fieldset class="practice-question${locked ? " is-readonly" : ""}${feedback ? " has-feedback" : ""}" data-question-id="${escape(question.id)}"${feedback ? ` data-result="${result}"` : ""}><legend>${rich(question.stemBlocks || question.stem || question.prompt || "填写答案")}</legend><div class="practice-options${letterOnly ? " practice-options--letters" : ""}">${body}</div>${summaryHTML}</fieldset>`;
  }

  function mountQuestions(host, questions, options = {}) {
    const answers = { ...(options.answers || {}) };
    let submitted = Boolean(options.submitted);
    const results = () => questions.filter(question => question.type !== "text").map(question => ({ id: question.id, status: grade(question, answers[question.id]), answer: answers[question.id], correctAnswer: question.answer }));
    let submittedResult = submitted ? results() : undefined;
    host.innerHTML = questions.map(question => renderQuestion(question, answers[question.id], options)).join("");
    window.AppUI?.refresh(host);
    window.RichContent?.hydrate(host);
    const onInput = event => {
      const field = event.target.closest("[data-question-id]");
      if (!field || submitted || options.readonly) return;
      const question = questions.find(item => item.id === field.dataset.questionId);
      if (!question) return;
      answers[question.id] = ["multiple", "multiple-choice"].includes(question.type)
        ? [...field.querySelectorAll("input:checked")].map(input => input.value)
        : event.target.value;
      options.onChange?.({ ...answers }, question);
    };
    host.addEventListener("input", onInput);
    return {
      getAnswers: () => ({ ...answers }),
      submit() {
        if (submitted) return submittedResult;
        submitted = true;
        const result = results();
        submittedResult = result;
        host.innerHTML = questions.map(question => renderQuestion(question, answers[question.id], { ...options, readonly: true, submitted: true, feedback: options.feedback !== false })).join("");
        window.AppUI?.refresh(host);
        window.RichContent?.hydrate(host);
        options.onSubmit?.(result);
        return result;
      },
      destroy: () => host.removeEventListener("input", onInput)
    };
  }

  window.PracticeQuestions = { normalize, grade, render: renderQuestion, mount: mountQuestions };
})();
