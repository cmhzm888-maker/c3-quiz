(function () {
  "use strict";

  const EXAM_SIZE = 50;
  const STORE_KEY = "c3-question-practice-v1";
  const questions = Array.isArray(window.QUESTION_BANK) ? window.QUESTION_BANK : [];
  const questionById = new Map(questions.map((question) => [question.id, question]));
  const exams = Array.from({ length: Math.ceil(questions.length / EXAM_SIZE) }, (_, index) => {
    const start = index * EXAM_SIZE;
    const items = questions.slice(start, start + EXAM_SIZE);
    return {
      index,
      start: items[0]?.id || start + 1,
      end: items[items.length - 1]?.id || start,
      items,
    };
  });

  const app = document.getElementById("app");

  const defaultState = {
    view: "exam",
    examIndex: 0,
    examCursors: {},
    notebookCursor: 0,
    orders: {},
    answers: {},
    notebook: {},
    notebookOrder: [],
    drafts: {},
  };

  let state = loadState();

  function loadState() {
    try {
      const parsed = JSON.parse(localStorage.getItem(STORE_KEY) || "{}");
      return { ...defaultState, ...parsed };
    } catch {
      return { ...defaultState };
    }
  }

  function saveState() {
    try {
      localStorage.setItem(STORE_KEY, JSON.stringify(state));
    } catch {
      // Practice still works without saved progress.
    }
  }

  function escapeHtml(value) {
    return String(value ?? "")
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#039;");
  }

  function shuffle(values) {
    const result = [...values];
    for (let index = result.length - 1; index > 0; index -= 1) {
      const swapIndex = Math.floor(Math.random() * (index + 1));
      [result[index], result[swapIndex]] = [result[swapIndex], result[index]];
    }
    return result;
  }

  function createOrder(examIndex, randomized = true) {
    const ids = exams[examIndex]?.items.map((question) => question.id) || [];
    state.orders[examIndex] = randomized ? shuffle(ids) : ids;
    state.examCursors[examIndex] = 0;
    saveState();
  }

  function getExamOrder(examIndex) {
    const sourceIds = exams[examIndex]?.items.map((question) => question.id) || [];
    const existing = state.orders[examIndex] || [];
    const sameLength = existing.length === sourceIds.length;
    const sameMembers = sameLength && existing.every((id) => sourceIds.includes(Number(id)));
    if (!sameMembers) {
      createOrder(examIndex, true);
    }
    return state.orders[examIndex] || sourceIds;
  }

  function getNotebookIds() {
    const ordered = (state.notebookOrder || [])
      .map(Number)
      .filter((id) => state.notebook[id] && questionById.has(id));
    const missing = Object.keys(state.notebook || {})
      .map(Number)
      .filter((id) => questionById.has(id) && !ordered.includes(id));
    return [...ordered, ...missing];
  }

  function getCurrentSequence() {
    if (state.view === "notebook") {
      const ids = getNotebookIds();
      const cursor = Math.min(state.notebookCursor || 0, Math.max(ids.length - 1, 0));
      state.notebookCursor = cursor;
      return { ids, cursor, total: ids.length };
    }

    const ids = getExamOrder(state.examIndex);
    const cursor = Math.min(state.examCursors[state.examIndex] || 0, Math.max(ids.length - 1, 0));
    state.examCursors[state.examIndex] = cursor;
    return { ids, cursor, total: ids.length };
  }

  function setCursor(cursor) {
    const sequence = getCurrentSequence();
    const nextCursor = Math.max(0, Math.min(cursor, Math.max(sequence.total - 1, 0)));
    if (state.view === "notebook") {
      state.notebookCursor = nextCursor;
    } else {
      state.examCursors[state.examIndex] = nextCursor;
    }
    saveState();
  }

  function currentQuestion() {
    const sequence = getCurrentSequence();
    return questionById.get(Number(sequence.ids[sequence.cursor]));
  }

  function typeLabel(type) {
    return type === "judge" ? "判断题" : type === "single" ? "单选题" : "多选题";
  }

  function getSelection(question) {
    const draft = state.drafts[question.id];
    if (draft !== undefined) {
      return draft;
    }
    return state.answers[question.id]?.selected || "";
  }

  function normalizeMulti(value) {
    return [...new Set(String(value).split(""))].sort().join("");
  }

  function answerQuestion(question, selected) {
    const normalized = question.type === "multi" ? normalizeMulti(selected) : selected;
    if (!normalized) return;
    const correct = normalized === question.answer;
    state.answers[question.id] = {
      selected: normalized,
      correct,
      answeredAt: Date.now(),
    };
    delete state.drafts[question.id];
    if (!correct) {
      addNotebook(question.id, "wrong");
    }
    saveState();
    render();
  }

  function addNotebook(id, reason) {
    const key = String(id);
    if (!state.notebook[key]) {
      state.notebook[key] = { reason, addedAt: Date.now() };
      state.notebookOrder = [...(state.notebookOrder || []), Number(id)];
    } else if (state.notebook[key].reason !== "wrong") {
      state.notebook[key].reason = reason;
    }
  }

  function toggleNotebook(id) {
    const key = String(id);
    if (state.notebook[key]) {
      delete state.notebook[key];
      state.notebookOrder = (state.notebookOrder || []).filter((item) => Number(item) !== Number(id));
      if (state.view === "notebook") {
        const ids = getNotebookIds();
        state.notebookCursor = Math.min(state.notebookCursor || 0, Math.max(ids.length - 1, 0));
      }
    } else {
      addNotebook(id, "marked");
    }
    saveState();
    render();
  }

  function optionLabel(question, key) {
    const option = question.options.find((item) => item.key === key);
    return option ? `${key}. ${option.text}` : key;
  }

  function formatAnswer(question, selected) {
    if (!selected) return "";
    return String(selected)
      .split("")
      .map((key) => optionLabel(question, key))
      .join("；");
  }

  function examStats(exam) {
    const ids = exam.items.map((question) => question.id);
    const answered = ids.filter((id) => state.answers[id]).length;
    const correct = ids.filter((id) => state.answers[id]?.correct).length;
    return {
      answered,
      correct,
      total: ids.length,
      accuracy: answered ? Math.round((correct / answered) * 100) : 0,
    };
  }

  function render() {
    if (!questions.length) {
      app.className = "loading";
      app.textContent = "没有找到题库数据";
      return;
    }
    app.className = "";
    app.innerHTML = `
      <div class="app-shell">
        ${renderSidebar()}
        <main class="main">
          ${state.view === "notebook" ? renderNotebook() : renderExam()}
        </main>
      </div>
    `;
  }

  function renderSidebar() {
    const notebookCount = getNotebookIds().length;
    return `
      <aside class="sidebar">
        <div class="brand">
          <div class="brand-title">C3 题库练习</div>
          <div class="brand-meta">${questions.length} 道题 · ${exams.length} 套</div>
        </div>
        <div class="view-tabs">
          <button class="tab-button ${state.view === "exam" ? "active" : ""}" data-action="show-exams">考试</button>
          <button class="tab-button ${state.view === "notebook" ? "active" : ""}" data-action="show-notebook">错题本 ${notebookCount}</button>
        </div>
        <div class="exam-list">
          ${exams.map(renderExamButton).join("")}
        </div>
      </aside>
    `;
  }

  function renderExamButton(exam) {
    const stats = examStats(exam);
    const progress = stats.total ? Math.round((stats.answered / stats.total) * 100) : 0;
    return `
      <button class="exam-button ${state.view === "exam" && state.examIndex === exam.index ? "active" : ""}" data-action="select-exam" data-exam="${exam.index}">
        <span class="exam-index">第${exam.index + 1}套</span>
        <span>
          <span class="exam-range">${exam.start}-${exam.end}题</span>
          <span class="exam-progress"><span style="width:${progress}%"></span></span>
        </span>
        <span class="exam-score">${stats.answered}/${stats.total}</span>
      </button>
    `;
  }

  function renderExam() {
    const exam = exams[state.examIndex] || exams[0];
    const sequence = getCurrentSequence();
    const question = currentQuestion();
    const stats = examStats(exam);
    return `
      <section class="topbar">
        <div class="title-group">
          <h1 class="page-title">第${exam.index + 1}套考试</h1>
          <p class="page-subtitle">${exam.start}-${exam.end}题 · 当前 ${sequence.cursor + 1}/${sequence.total}</p>
        </div>
        <div class="toolbar">
          <button class="secondary-button" data-action="shuffle-current">打乱本套</button>
          <button class="secondary-button" data-action="order-current">按顺序</button>
        </div>
      </section>
      ${renderSummary(stats)}
      ${renderPractice(question, sequence)}
    `;
  }

  function renderNotebook() {
    const ids = getNotebookIds();
    const question = currentQuestion();
    const answered = ids.filter((id) => state.answers[id]).length;
    const correct = ids.filter((id) => state.answers[id]?.correct).length;
    const stats = {
      answered,
      correct,
      total: ids.length,
      accuracy: answered ? Math.round((correct / answered) * 100) : 0,
    };
    if (!ids.length) {
      return `
        <section class="topbar">
          <div class="title-group">
            <h1 class="page-title">错题本</h1>
            <p class="page-subtitle">0 道题</p>
          </div>
        </section>
        <section class="empty-panel">
          <div>
            <p class="empty-title">暂无错题</p>
            <p class="empty-copy">答错或手动标记的题会出现在这里。</p>
          </div>
        </section>
      `;
    }
    return `
      <section class="topbar">
        <div class="title-group">
          <h1 class="page-title">错题本</h1>
          <p class="page-subtitle">当前 ${state.notebookCursor + 1}/${ids.length}</p>
        </div>
        <div class="toolbar">
          <button class="secondary-button" data-action="clear-notebook">清空错题本</button>
        </div>
      </section>
      ${renderSummary(stats)}
      ${renderPractice(question, { ids, cursor: state.notebookCursor, total: ids.length })}
    `;
  }

  function renderSummary(stats) {
    return `
      <section class="summary-row">
        <div class="metric">
          <div class="metric-label">总题数</div>
          <div class="metric-value">${stats.total}</div>
        </div>
        <div class="metric">
          <div class="metric-label">已完成</div>
          <div class="metric-value">${stats.answered}</div>
        </div>
        <div class="metric">
          <div class="metric-label">答对</div>
          <div class="metric-value">${stats.correct}</div>
        </div>
        <div class="metric">
          <div class="metric-label">正确率</div>
          <div class="metric-value">${stats.accuracy}%</div>
        </div>
      </section>
    `;
  }

  function renderPractice(question, sequence) {
    if (!question) {
      return "";
    }
    return `
      <section class="practice-layout">
        ${renderQuestion(question, sequence)}
        ${renderQuestionMap(sequence)}
      </section>
    `;
  }

  function renderQuestion(question, sequence) {
    const answerRecord = state.answers[question.id];
    const selected = getSelection(question);
    const inNotebook = Boolean(state.notebook[question.id]);
    const feedback = answerRecord ? renderFeedback(question, answerRecord, inNotebook) : "";
    return `
      <article class="question-panel">
        <div class="question-meta">
          <span class="pill">原题 ${question.id}</span>
          <span class="pill">${typeLabel(question.type)}</span>
          <span class="pill">第 ${sequence.cursor + 1}/${sequence.total} 题</span>
          ${answerRecord ? `<span class="pill ${answerRecord.correct ? "success" : "danger"}">${answerRecord.correct ? "已答对" : "已答错"}</span>` : ""}
          ${inNotebook ? '<span class="pill warning">错题本</span>' : ""}
        </div>
        <p class="question-stem">${escapeHtml(question.stem)}</p>
        <div class="options">
          ${question.options.map((option) => renderOption(question, option, selected, answerRecord)).join("")}
        </div>
        ${feedback}
        <div class="question-actions">
          ${question.type === "multi" ? `<button class="primary-button" data-action="submit-multi" ${selected ? "" : "disabled"}>${answerRecord ? "重新提交" : "提交答案"}</button>` : ""}
          <button class="secondary-button" data-action="toggle-notebook" data-id="${question.id}">${inNotebook ? "移出错题本" : "加入错题本"}</button>
          <button class="secondary-button" data-action="prev-question" ${sequence.cursor <= 0 ? "disabled" : ""}>上一题</button>
          <button class="primary-button" data-action="next-question" ${sequence.cursor >= sequence.total - 1 ? "disabled" : ""}>下一题</button>
        </div>
      </article>
    `;
  }

  function renderOption(question, option, selected, answerRecord) {
    const selectedKeys = String(selected || "").split("");
    const isSelected = selectedKeys.includes(option.key);
    const isCorrectKey = String(question.answer).split("").includes(option.key);
    const classes = ["option-button"];
    if (isSelected) classes.push("selected");
    if (answerRecord && isCorrectKey) classes.push("correct");
    if (answerRecord && isSelected && !isCorrectKey) classes.push("wrong");
    return `
      <button class="${classes.join(" ")}" data-action="select-option" data-option="${escapeHtml(option.key)}">
        <span class="option-key">${escapeHtml(option.key)}</span>
        <span class="option-text">${escapeHtml(option.text)}</span>
      </button>
    `;
  }

  function renderFeedback(question, answerRecord, inNotebook) {
    if (answerRecord.correct) {
      return `
        <div class="feedback correct">
          回答正确
        </div>
      `;
    }
    return `
      <div class="feedback wrong">
        回答错误${inNotebook ? "，已加入错题本" : ""}
        <div class="answer-line">正确答案：${escapeHtml(formatAnswer(question, question.answer))}</div>
      </div>
    `;
  }

  function renderQuestionMap(sequence) {
    return `
      <aside class="map-panel">
        <p class="map-title">题目</p>
        <div class="question-map">
          ${sequence.ids.map((id, index) => renderMapButton(Number(id), index, sequence.cursor)).join("")}
        </div>
      </aside>
    `;
  }

  function renderMapButton(id, index, cursor) {
    const answer = state.answers[id];
    const marked = state.notebook[id];
    const classes = ["map-button"];
    if (index === cursor) classes.push("current");
    if (answer?.correct) classes.push("correct");
    if (answer && !answer.correct) classes.push("wrong");
    if (marked) classes.push("marked");
    return `<button class="${classes.join(" ")}" data-action="jump-question" data-index="${index}">${index + 1}</button>`;
  }

  app.addEventListener("click", (event) => {
    const target = event.target.closest("[data-action]");
    if (!target || target.disabled) return;

    const action = target.dataset.action;
    const question = currentQuestion();

    if (action === "show-exams") {
      state.view = "exam";
    }

    if (action === "show-notebook") {
      state.view = "notebook";
      state.notebookCursor = Math.min(state.notebookCursor || 0, Math.max(getNotebookIds().length - 1, 0));
    }

    if (action === "select-exam") {
      state.view = "exam";
      state.examIndex = Number(target.dataset.exam);
      getExamOrder(state.examIndex);
    }

    if (action === "shuffle-current") {
      createOrder(state.examIndex, true);
    }

    if (action === "order-current") {
      createOrder(state.examIndex, false);
    }

    if (action === "jump-question") {
      setCursor(Number(target.dataset.index));
    }

    if (action === "prev-question") {
      setCursor(getCurrentSequence().cursor - 1);
    }

    if (action === "next-question") {
      setCursor(getCurrentSequence().cursor + 1);
    }

    if (action === "select-option" && question) {
      const option = target.dataset.option;
      if (question.type === "multi") {
        const selected = new Set(String(getSelection(question) || "").split("").filter(Boolean));
        if (selected.has(option)) {
          selected.delete(option);
        } else {
          selected.add(option);
        }
        state.drafts[question.id] = [...selected].sort().join("");
      } else {
        answerQuestion(question, option);
        return;
      }
    }

    if (action === "submit-multi" && question) {
      answerQuestion(question, getSelection(question));
      return;
    }

    if (action === "toggle-notebook" && question) {
      toggleNotebook(Number(target.dataset.id || question.id));
      return;
    }

    if (action === "clear-notebook") {
      if (window.confirm("确定清空错题本吗？")) {
        state.notebook = {};
        state.notebookOrder = [];
        state.notebookCursor = 0;
      }
    }

    saveState();
    render();
  });

  render();
})();
