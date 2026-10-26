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

  function grade(question, answer) {
    if (isEmpty(answer)) return "unanswered";
    if (question.grading === "unverified") return "ungraded";
    if (question.type === "multiple" || question.type === "multiple-choice") {
      const actual = (Array.isArray(answer) ? answer : [answer]).map(normalize).sort();
      const expected = (Array.isArray(question.answer) ? question.answer : [question.answer]).map(normalize).sort();
      return actual.length === expected.length && actual.every((value, index) => value === expected[index]) ? "correct" : "incorrect";
    }
    if (question.type === "boolean" || question.type === "true-false") {
      const booleanValue = value => value === true || value === "true" || value === "正确" ? "true" : value === false || value === "false" || value === "错误" ? "false" : normalize(value);
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
    const disabled = options.readonly ? " disabled" : "";
    const rich = value => window.RichContent ? window.RichContent.render(value) : escape(value);
    const letterOnly = ["single", "single-choice", "multiple", "multiple-choice"].includes(type) && question.options?.length > 0 && question.options.every(option => typeof option === "object" && (!option.blocks?.length || option.blocks.length === 1 && option.blocks[0].type === "paragraph" && String(option.blocks[0].text || "").trim() === String(option.value ?? option.id)) && String(option.label ?? option.text ?? "").trim() === String(option.value ?? option.id).trim());
    let body;
    if (type === "boolean" || type === "true-false") {
      body = [{ value: "true", label: "正确" }, { value: "false", label: "错误" }].map(option => `<label class="practice-option"><input type="radio" name="${escape(name)}" value="${option.value}"${String(answer) === option.value ? " checked" : ""}${disabled}><span>${option.label}</span></label>`).join("");
    } else if (["single", "single-choice", "multiple", "multiple-choice"].includes(type)) {
      const multiple = type.startsWith("multiple");
      body = (question.options || []).map((option, index) => {
        const value = typeof option === "object" ? option.value ?? option.id ?? index : index;
        const label = typeof option === "object" ? option.label ?? option.text ?? value : option;
        const checked = multiple ? (Array.isArray(answer) ? answer : []).map(String).includes(String(value)) : !isEmpty(answer) && String(answer) === String(value);
        return `<label class="practice-option"><input type="${multiple ? "checkbox" : "radio"}" name="${escape(name)}" value="${escape(value)}"${letterOnly ? ` aria-label="选项 ${escape(value)}"` : ""}${checked ? " checked" : ""}${disabled}><span><b class="learn-option-letter">${escape(typeof option === "object" ? option.value ?? option.id ?? String.fromCharCode(65 + index) : String.fromCharCode(65 + index))}</b>${letterOnly ? "" : `<span class="learn-option-content">${rich(typeof option === "object" ? option.blocks || label : label)}</span>`}</span></label>`;
      }).join("");
    } else if (type === "text") {
      body = rich(question.blocks || []);
    } else {
      body = `<input class="practice-text-input" name="${escape(name)}" type="text" value="${escape(answer)}" autocomplete="off" aria-label="填写答案"${options.readonly ? " readonly" : ""}>`;
    }
    if (type === "text") return `<article class="practice-text-component" data-content-id="${escape(question.id)}">${rich(question.stemBlocks || question.stem || question.prompt || "")}${body}</article>`;
    const material = question.materialBlocks?.length ? `<section class="practice-material" aria-label="题目材料">${rich(question.materialBlocks)}</section>` : "";
    return `${material}<fieldset class="practice-question" data-question-id="${escape(question.id)}"><legend>${rich(question.stemBlocks || question.stem || question.prompt || "填写答案")}</legend><div class="practice-options${letterOnly ? " practice-options--letters" : ""}">${body}</div></fieldset>`;
  }

  function mountQuestions(host, questions, options = {}) {
    const answers = { ...(options.answers || {}) };
    let submitted = false;
    let submittedResult;
    host.innerHTML = questions.map(question => renderQuestion(question, answers[question.id], options)).join("");
    window.AppUI?.refresh(host);
    window.RichContent?.hydrate(host);
    const onInput = event => {
      const field = event.target.closest("[data-question-id]");
      if (!field || submitted) return;
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
        const result = questions.filter(question => question.type !== "text").map(question => ({ id: question.id, status: grade(question, answers[question.id]), answer: answers[question.id], correctAnswer: question.answer }));
        submittedResult = result;
        host.querySelectorAll("input").forEach(input => { input.disabled = true; });
        result.forEach(item => {
          const field = [...host.querySelectorAll("[data-question-id]")].find(element => element.dataset.questionId === item.id);
          if (field) {
            field.dataset.result = item.status;
            const feedback = document.createElement("p");
            feedback.className = `practice-component-feedback ${item.status}`;
            feedback.textContent = item.status === "ungraded" ? "本题条件待核，不计分" : `${{ correct: "正确", incorrect: "错误", unanswered: "未作答" }[item.status]} · 答案：${Array.isArray(item.correctAnswer) ? item.correctAnswer.join("、") : item.correctAnswer}`;
            field.append(feedback);
          }
        });
        options.onSubmit?.(result);
        return result;
      },
      destroy: () => host.removeEventListener("input", onInput)
    };
  }

  window.PracticeQuestions = { normalize, grade, render: renderQuestion, mount: mountQuestions };
})();
