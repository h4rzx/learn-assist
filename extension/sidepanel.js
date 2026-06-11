const DEFAULT_CONNECTOR_URL = "http://127.0.0.1:48734";
const DEFAULT_COURSE_ID = "general";
const STORAGE_KEYS = {
  settings: "learnAssistSettings",
  notesByUrl: "learnAssistNotesByUrl",
  courses: "learnAssistCourses"
};

const elements = {
  pageTitle: document.querySelector("#pageTitle"),
  settingsButton: document.querySelector("#settingsButton"),
  settingsPanel: document.querySelector("#settingsPanel"),
  connectorUrl: document.querySelector("#connectorUrl"),
  connectorToken: document.querySelector("#connectorToken"),
  saveSettingsButton: document.querySelector("#saveSettingsButton"),
  courseSelect: document.querySelector("#courseSelect"),
  newCourseName: document.querySelector("#newCourseName"),
  createCourseButton: document.querySelector("#createCourseButton"),
  includeScreenshot: document.querySelector("#includeScreenshot"),
  includeReferences: document.querySelector("#includeReferences"),
  previewCaptureButton: document.querySelector("#previewCaptureButton"),
  analyzeButton: document.querySelector("#analyzeButton"),
  activityButton: document.querySelector("#activityButton"),
  exportButton: document.querySelector("#exportButton"),
  deleteCurrentButton: document.querySelector("#deleteCurrentButton"),
  exportAllMarkdownButton: document.querySelector("#exportAllMarkdownButton"),
  exportAllHtmlButton: document.querySelector("#exportAllHtmlButton"),
  clearBookButton: document.querySelector("#clearBookButton"),
  savedCount: document.querySelector("#savedCount"),
  lessonList: document.querySelector("#lessonList"),
  progressPanel: document.querySelector("#progressPanel"),
  progressMeta: document.querySelector("#progressMeta"),
  progressLog: document.querySelector("#progressLog"),
  capturePreview: document.querySelector("#capturePreview"),
  captureMeta: document.querySelector("#captureMeta"),
  captureText: document.querySelector("#captureText"),
  status: document.querySelector("#status"),
  notes: document.querySelector("#notes")
};

let activePage = null;
let currentNotes = null;
let currentUrl = "";
let courseState = {
  items: [],
  activeCourseId: DEFAULT_COURSE_ID
};
let settings = {
  connectorUrl: DEFAULT_CONNECTOR_URL,
  connectorToken: ""
};

init();

async function init() {
  settings = { ...settings, ...(await getStorage(STORAGE_KEYS.settings)) };
  elements.connectorUrl.value = settings.connectorUrl;
  elements.connectorToken.value = settings.connectorToken;
  courseState = await ensureCourseState();
  renderCourseSelector();

  elements.settingsButton.addEventListener("click", () => {
    elements.settingsPanel.classList.toggle("hidden");
  });

  elements.saveSettingsButton.addEventListener("click", saveSettings);
  elements.courseSelect.addEventListener("change", selectCourse);
  elements.createCourseButton.addEventListener("click", createCourse);
  elements.previewCaptureButton.addEventListener("click", previewCapture);
  elements.analyzeButton.addEventListener("click", analyzeLesson);
  elements.activityButton.addEventListener("click", explainActivity);
  elements.exportButton.addEventListener("click", exportMarkdown);
  elements.deleteCurrentButton.addEventListener("click", deleteCurrentLesson);
  elements.exportAllMarkdownButton.addEventListener("click", exportAllMarkdown);
  elements.exportAllHtmlButton.addEventListener("click", exportAllHtml);
  elements.clearBookButton.addEventListener("click", clearBook);

  await refreshActivePagePreview();
  await renderBook();
}

async function refreshActivePagePreview() {
  try {
    const tab = await getActiveTab();
    currentUrl = tab.url || "";
    elements.pageTitle.textContent = tab?.title || "Current tab";
  } catch (error) {
    setStatus(error.message, true);
  }
}

async function ensureCourseState() {
  const stored = (await getStorage(STORAGE_KEYS.courses)) || {};
  const seen = new Set();
  const items = [];

  for (const item of stored.items || []) {
    const name = String(item?.name || "").trim();
    const id = String(item?.id || "").trim();
    if (!name || !id || seen.has(id)) {
      continue;
    }
    seen.add(id);
    items.push({
      id,
      name,
      createdAt: item.createdAt || new Date().toISOString()
    });
  }

  if (!seen.has(DEFAULT_COURSE_ID)) {
    items.unshift({
      id: DEFAULT_COURSE_ID,
      name: "General",
      createdAt: new Date().toISOString()
    });
  }

  const activeCourseId = items.some((item) => item.id === stored.activeCourseId)
    ? stored.activeCourseId
    : DEFAULT_COURSE_ID;
  const next = { items, activeCourseId };
  await setStorage(STORAGE_KEYS.courses, next);
  return next;
}

function renderCourseSelector() {
  elements.courseSelect.innerHTML = "";

  for (const course of courseState.items) {
    const option = document.createElement("option");
    option.value = course.id;
    option.textContent = course.name;
    elements.courseSelect.append(option);
  }

  elements.courseSelect.value = getActiveCourseId();
  elements.savedCount.textContent = `${getActiveCourseName()} | 0 saved`;
}

async function selectCourse() {
  const selectedId = elements.courseSelect.value;
  if (!courseState.items.some((item) => item.id === selectedId)) {
    return;
  }

  courseState = {
    ...courseState,
    activeCourseId: selectedId
  };
  await setStorage(STORAGE_KEYS.courses, courseState);
  currentNotes = null;
  currentUrl = "";
  elements.notes.classList.add("empty");
  elements.notes.innerHTML = "<p>Generated study notes will appear here.</p>";
  renderCourseSelector();
  await renderBook();
  setStatus(`Selected ${getActiveCourseName()}.`);
}

async function createCourse() {
  const name = elements.newCourseName.value.trim();
  if (!name) {
    setStatus("Enter a course name first.", true);
    return;
  }

  const existing = courseState.items.find((item) => item.name.toLowerCase() === name.toLowerCase());
  if (existing) {
    courseState = {
      ...courseState,
      activeCourseId: existing.id
    };
  } else {
    const id = uniqueCourseId(name, courseState.items);
    courseState = {
      items: [
        ...courseState.items,
        {
          id,
          name,
          createdAt: new Date().toISOString()
        }
      ],
      activeCourseId: id
    };
  }

  elements.newCourseName.value = "";
  await setStorage(STORAGE_KEYS.courses, courseState);
  renderCourseSelector();
  await renderBook();
  setStatus(`Selected ${getActiveCourseName()}.`);
}

function getActiveCourseId() {
  return courseState.activeCourseId || DEFAULT_COURSE_ID;
}

function getActiveCourseName() {
  return courseState.items.find((item) => item.id === getActiveCourseId())?.name || "General";
}

async function saveSettings() {
  settings = {
    connectorUrl: trimSlash(elements.connectorUrl.value || DEFAULT_CONNECTOR_URL),
    connectorToken: elements.connectorToken.value.trim()
  };
  await setStorage(STORAGE_KEYS.settings, settings);
  setStatus("Settings saved.");
}

async function analyzeLesson() {
  setBusy(true);
  setStatus("Capturing lesson context...");

  try {
    if (!elements.connectorToken.value.trim()) {
      throw new Error("Paste the connector token first.");
    }

    await saveSettings();
    const tab = await getActiveTab();
    activePage = await extractPage(tab.id);
    elements.pageTitle.textContent = activePage.title || tab.title || "Current lesson";

    let screenshotDataUrl = "";
    if (elements.includeScreenshot.checked) {
      await ensureScreenshotPermission();
      setStatus("Capturing visible screenshot...");
      screenshotDataUrl = await chrome.tabs.captureVisibleTab(tab.windowId, {
        format: "png"
      });
    }

    setStatus("Asking local Codex to build study notes...");
    resetProgressLog();
    const body = await analyzeLessonStream({
      page: activePage,
      screenshotDataUrl,
      includeReferences: elements.includeReferences.checked
    });

    currentNotes = body.notes;
    currentUrl = activePage.storageKey || tab.url || activePage.url || "";
    await saveNotesForPage(currentUrl, currentNotes, activePage);
    renderNotes(currentNotes);

    await renderBook();
    setStatus("Study notes generated.");
  } catch (error) {
    setStatus(error.message, true);
  } finally {
    setBusy(false);
  }
}

function activityPageContext(page) {
  const text = `${page.title || ""}\n${page.text || ""}`;
  const lines = text
    .split(/\n+/)
    .map((line) => line.trim())
    .filter(Boolean)
    .filter((line) => /knowledge check|connect the idea|drag|drop here|submit|crow|erd|entity[- ]relationship|diagram|cardinality|optionality/i.test(line))
    .slice(0, 8);

  return {
    url: page.url || "",
    title: "Knowledge Check Activity",
    text: lines.join("\n")
  };
}

async function analyzeLessonStream(payload) {
  const response = await fetch(`${settings.connectorUrl}/analyze/stream`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      authorization: `Bearer ${settings.connectorToken}`
    },
    body: JSON.stringify(payload)
  });

  if (!response.ok || !response.body) {
    let body = {};
    try {
      body = await response.json();
    } catch {
      body = {};
    }
    throw new Error(body.error || "Connector stream request failed");
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  let finalEvent = null;

  while (true) {
    const { value, done } = await reader.read();
    if (done) {
      break;
    }

    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split("\n");
    buffer = lines.pop() || "";

    for (const line of lines) {
      if (!line.trim()) {
        continue;
      }

      const event = JSON.parse(line);
      if (event.type === "done") {
        finalEvent = event;
      } else if (event.type === "error") {
        throw new Error(event.message || "Connector error");
      } else {
        handleProgressEvent(event);
      }
    }
  }

  if (!finalEvent?.notes) {
    throw new Error("Connector stream ended without final notes.");
  }

  handleProgressEvent({
    type: "done",
    message: finalEvent.mode === "chunked"
      ? `Done. Chunked analysis used ${finalEvent.chunks} chunks.`
      : "Done. Single-pass analysis complete."
  });

  return finalEvent;
}

async function explainActivity() {
  setBusy(true);
  setStatus("Capturing activity screenshot...");

  try {
    if (!elements.connectorToken.value.trim()) {
      throw new Error("Paste the connector token first.");
    }

    await saveSettings();
    const tab = await getActiveTab();

    try {
      activePage = await extractPage(tab.id);
      elements.pageTitle.textContent = activePage.title || tab.title || "Current activity";
      renderCapturePreview(activePage);
    } catch {
      activePage = {
        url: tab.url || "",
        title: tab.title || "Current activity",
        text: ""
      };
    }

    await ensureScreenshotPermission();
    const screenshotDataUrl = await chrome.tabs.captureVisibleTab(tab.windowId, {
      format: "png"
    });

    resetProgressLog("Started activity helper.");
    setStatus("Asking local Codex for activity guidance...");
    const body = await activityStream({
      page: activityPageContext(activePage),
      screenshotDataUrl
    });

    renderActivityHelp(body.activity);
    setStatus("Activity guidance generated.");
  } catch (error) {
    setStatus(error.message, true);
  } finally {
    setBusy(false);
  }
}

async function activityStream(payload) {
  const response = await fetch(`${settings.connectorUrl}/activity/stream`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      authorization: `Bearer ${settings.connectorToken}`
    },
    body: JSON.stringify(payload)
  });

  if (!response.ok || !response.body) {
    let body = {};
    try {
      body = await response.json();
    } catch {
      body = {};
    }
    throw new Error(body.error || "Connector activity stream request failed");
  }

  const finalEvent = await readStreamEvents(response);
  if (!finalEvent?.activity) {
    throw new Error("Connector stream ended without activity guidance.");
  }

  handleProgressEvent({
    type: "done",
    message: "Done. Activity guidance complete."
  });

  return finalEvent;
}

async function readStreamEvents(response) {
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  let finalEvent = null;

  while (true) {
    const { value, done } = await reader.read();
    if (done) {
      break;
    }

    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split("\n");
    buffer = lines.pop() || "";

    for (const line of lines) {
      if (!line.trim()) {
        continue;
      }

      const event = JSON.parse(line);
      if (event.type === "done") {
        finalEvent = event;
      } else if (event.type === "error") {
        throw new Error(event.message || "Connector error");
      } else {
        handleProgressEvent(event);
      }
    }
  }

  return finalEvent;
}

function resetProgressLog(initialMessage = "Started analysis.") {
  elements.progressPanel.classList.remove("hidden");
  elements.progressMeta.textContent = "Running";
  elements.progressLog.innerHTML = "";
  appendProgress(initialMessage, true);
}

function handleProgressEvent(event) {
  const importantTypes = new Set([
    "status",
    "chunk-plan",
    "chunk-start",
    "chunk-done",
    "merge-start",
    "merge-done",
    "codex-start",
    "codex-done",
    "done"
  ]);

  if (event.type === "done") {
    elements.progressMeta.textContent = "Complete";
  }

  if (event.type === "codex-log" && elements.progressLog.children.length > 80) {
    return;
  }

  appendProgress(event.message || event.type, importantTypes.has(event.type));
}

function appendProgress(message, important = false) {
  const li = document.createElement("li");
  li.textContent = message;
  li.classList.toggle("important", important);
  elements.progressLog.append(li);
  elements.progressLog.scrollTop = elements.progressLog.scrollHeight;
}

async function previewCapture() {
  setBusy(true);
  setStatus("Capturing lesson text...");

  try {
    const tab = await getActiveTab();
    activePage = await extractPage(tab.id);
    elements.pageTitle.textContent = activePage.title || tab.title || "Current lesson";
    renderCapturePreview(activePage);
    setStatus("Capture preview ready. Check this before analyzing.");
  } catch (error) {
    setStatus(error.message, true);
  } finally {
    setBusy(false);
  }
}

async function ensureScreenshotPermission() {
  const hasPermission = await chrome.permissions.contains({
    origins: ["<all_urls>"]
  });

  if (hasPermission) {
    return;
  }

  const granted = await chrome.permissions.request({
    origins: ["<all_urls>"]
  });

  if (!granted) {
    throw new Error("Screenshot capture needs browser permission. Disable screenshot or allow the permission prompt.");
  }
}

async function extractPage(tabId) {
  const results = await chrome.scripting.executeScript({
    target: { tabId, allFrames: true },
    files: ["content-extractor.js"]
  });

  const captures = results
    .map((item) => item.result)
    .filter((item) => item?.text)
    .sort((a, b) => captureScore(b) - captureScore(a));

  const best = captures[0];
  if (!best?.text) {
    throw new Error("Could not extract readable lesson text from this page.");
  }

  return best;
}

function captureScore(capture) {
  const text = capture.text || "";
  const navPenalty = /Bite-size lessons|My Library|Resume/.test(text) ? 5000 : 0;
  const titleBonus = /^\d+(\.\d+)?\s+/m.test(text) ? 2500 : 0;
  return Math.min(text.length, 20000) + Number(capture.captureScore || 0) + titleBonus - navPenalty;
}

function renderCapturePreview(page) {
  elements.capturePreview.classList.remove("hidden");
  elements.captureMeta.textContent = `${page.captureMode || "capture"} | ${page.text.length} chars | full preview`;
  elements.captureText.textContent = [
    `Title: ${page.title}`,
    `URL: ${page.url}`,
    `Key: ${page.storageKey}`,
    "",
    page.text
  ].join("\n");
}

async function saveNotesForPage(storageKey, notes, page) {
  const notesByUrl = (await getStorage(STORAGE_KEYS.notesByUrl)) || {};
  notesByUrl[storageKey] = {
    storageKey,
    url: page?.url || storageKey,
    title: notes.lessonTitle || page?.title || storageKey,
    courseId: getActiveCourseId(),
    pageTitle: page?.title || "",
    fingerprint: page?.fingerprint || "",
    notes,
    updatedAt: new Date().toISOString()
  };
  await setStorage(STORAGE_KEYS.notesByUrl, notesByUrl);
}

function renderNotes(notes) {
  elements.notes.classList.remove("empty");
  elements.notes.innerHTML = "";

  const summary = document.createElement("p");
  summary.className = "lesson-summary";
  summary.textContent = notes.summary || "";
  elements.notes.append(summary);

  for (const concept of notes.concepts || []) {
    const section = document.createElement("article");
    section.className = "concept";

    const title = document.createElement("h2");
    title.textContent = concept.name;
    section.append(title);

    const details = document.createElement("dl");
    appendDetail(details, "Simple explanation", concept.simpleExplanation);
    appendDetail(details, "Why it matters", concept.whyItMatters);
    appendDetail(details, "Example", concept.example);
    appendDetail(details, "Common confusion", concept.commonConfusion);
    appendDetail(details, "Review question", concept.reviewQuestion);
    section.append(details);

    elements.notes.append(section);
  }

  if (notes.likelyTestPoints?.length) {
    appendList("Likely Test Points", notes.likelyTestPoints);
  }

  if (notes.externalReferences?.length) {
    appendReferences(notes.externalReferences);
  }
}

function renderActivityHelp(activity, options = {}) {
  elements.notes.classList.remove("empty");
  if (!options.append) {
    elements.notes.innerHTML = "";
  } else {
    const divider = document.createElement("hr");
    divider.className = "activity-divider";
    elements.notes.append(divider);
  }

  const title = document.createElement("h2");
  title.className = "activity-title";
  title.textContent = activity.activityTitle || "Activity Help";
  elements.notes.append(title);

  const summary = document.createElement("p");
  summary.className = "lesson-summary";
  summary.textContent = activity.whatThisTests || "";
  elements.notes.append(summary);

  if (activity.keyIdeas?.length) {
    appendList("Key Ideas", activity.keyIdeas);
  }

  if (activity.hints?.length) {
    appendList("Hints", activity.hints);
  }

  if (activity.strongHints?.length) {
    appendList("Strong Hints", activity.strongHints);
  }

  if (activity.whereToFindAnswer?.length) {
    appendWhereToFind(activity.whereToFindAnswer);
  }

  if (activity.solvingSteps?.length) {
    appendList("How To Work Through It", activity.solvingSteps);
  }

  if (activity.selfCheckQuestions?.length) {
    appendList("Self Check", activity.selfCheckQuestions);
  }

  if (activity.suggestedAnswer) {
    appendSuggestedAnswer(activity.suggestedAnswer);
  }

  if (activity.avoidDoing) {
    const heading = document.createElement("h2");
    heading.className = "section-title";
    heading.textContent = "Avoid";
    const paragraph = document.createElement("p");
    paragraph.className = "lesson-summary";
    paragraph.textContent = activity.avoidDoing;
    elements.notes.append(heading, paragraph);
  }
}

function appendSuggestedAnswer(suggestedAnswer) {
  const heading = document.createElement("h2");
  heading.className = "section-title";
  heading.textContent = "Suggested Answer";

  const wrapper = document.createElement("div");
  wrapper.className = "answer-reveal";

  const button = document.createElement("button");
  button.type = "button";
  button.textContent = "Reveal Suggested Answer";

  const content = document.createElement("div");
  content.className = "answer-content hidden";

  const answer = document.createElement("p");
  answer.textContent = suggestedAnswer.answer || "";
  const explanation = document.createElement("p");
  explanation.textContent = suggestedAnswer.explanation || "";
  content.append(answer, explanation);

  button.addEventListener("click", () => {
    content.classList.toggle("hidden");
    button.textContent = content.classList.contains("hidden")
      ? "Reveal Suggested Answer"
      : "Hide Suggested Answer";
  });

  wrapper.append(button, content);
  elements.notes.append(heading, wrapper);
}

function appendWhereToFind(items) {
  const heading = document.createElement("h2");
  heading.className = "section-title";
  heading.textContent = "Where To Find It";
  const list = document.createElement("ul");

  for (const item of items) {
    const li = document.createElement("li");
    li.textContent = `${item.section}: search for "${item.lookFor}" - ${item.whyRelevant}`;
    list.append(li);
  }

  elements.notes.append(heading, list);
}

function appendDetail(parent, label, value) {
  const dt = document.createElement("dt");
  dt.textContent = label;
  const dd = document.createElement("dd");
  dd.textContent = value || "";
  parent.append(dt, dd);
}

function appendList(title, items) {
  const heading = document.createElement("h2");
  heading.className = "section-title";
  heading.textContent = title;
  const list = document.createElement("ul");
  for (const item of items) {
    const li = document.createElement("li");
    li.textContent = item;
    list.append(li);
  }
  elements.notes.append(heading, list);
}

function appendReferences(items) {
  const heading = document.createElement("h2");
  heading.className = "section-title";
  heading.textContent = "References";
  const list = document.createElement("ul");

  for (const item of items) {
    const li = document.createElement("li");
    const link = document.createElement("a");
    link.href = item.url;
    link.target = "_blank";
    link.rel = "noreferrer";
    link.textContent = item.title;
    li.append(link, document.createTextNode(` - ${item.whyUseful}`));
    list.append(li);
  }

  elements.notes.append(heading, list);
}

function exportMarkdown() {
  if (!currentNotes) {
    setStatus("Generate notes before exporting.", true);
    return;
  }

  const markdown = toMarkdown(currentNotes);
  const blob = new Blob([markdown], { type: "text/markdown" });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = `${safeFileName(currentNotes.lessonTitle || "lesson")}-cheat-sheet.md`;
  anchor.click();
  URL.revokeObjectURL(url);
  setStatus("Markdown exported.");
}

async function exportAllMarkdown() {
  const entries = await getSavedEntries();
  if (!entries.length) {
    setStatus("No saved lessons to export.", true);
    return;
  }

  const courseName = getActiveCourseName();
  const lines = [
    `# ${courseName} Notes`,
    "",
    `Exported: ${new Date().toLocaleString()}`,
    "",
    "## Lessons",
    ""
  ];

  entries.forEach((entry, index) => {
    lines.push(`${index + 1}. [${entry.notes.lessonTitle || entry.title}](#${markdownAnchor(entry.notes.lessonTitle || entry.title)})`);
  });

  for (const entry of entries) {
    lines.push("", "---", "", toMarkdown(entry.notes, entry.url));
  }

  downloadFile(`${safeFileName(courseName)}-course-notes.md`, lines.join("\n"), "text/markdown");
  setStatus(`Exported ${entries.length} saved lessons as Markdown.`);
}

async function exportAllHtml() {
  const entries = await getSavedEntries();
  if (!entries.length) {
    setStatus("No saved lessons to export.", true);
    return;
  }

  const courseName = getActiveCourseName();
  const body = entries.map((entry) => markdownToBasicHtml(toMarkdown(entry.notes, entry.url))).join("<hr>");
  const html = [
    "<!doctype html>",
    "<html>",
    "<head>",
    "<meta charset=\"utf-8\">",
    `<title>${escapeHtml(courseName)} Notes</title>`,
    "<style>",
    "body{font-family:Arial,sans-serif;line-height:1.5;max-width:820px;margin:40px auto;padding:0 24px;color:#17202a}",
    "h1,h2,h3{line-height:1.25}",
    "a{color:#1559c7}",
    "hr{border:0;border-top:1px solid #d9dee7;margin:32px 0}",
    "li{margin:6px 0}",
    "@media print{body{margin:0;max-width:none}.lesson{break-after:page}}",
    "</style>",
    "</head>",
    "<body>",
    `<h1>${escapeHtml(courseName)} Notes</h1>`,
    `<p>Exported: ${escapeHtml(new Date().toLocaleString())}</p>`,
    body,
    "</body>",
    "</html>"
  ].join("");

  downloadFile(`${safeFileName(courseName)}-course-notes.html`, html, "text/html");
  setStatus(`Exported ${entries.length} saved lessons as HTML.`);
}

function toMarkdown(notes) {
  const lines = [
    `# ${notes.lessonTitle || "Lesson Cheat Sheet"}`,
    "",
    "## Summary",
    "",
    notes.summary || "",
    "",
    "## Key Concepts",
    ""
  ];

  if (arguments.length > 1 && arguments[1]) {
    lines.push(`Source: ${arguments[1]}`, "");
  }

  for (const concept of notes.concepts || []) {
    lines.push(
      `### ${concept.name}`,
      "",
      `- Simple explanation: ${concept.simpleExplanation}`,
      `- Why it matters: ${concept.whyItMatters}`,
      `- Example: ${concept.example}`,
      `- Common confusion: ${concept.commonConfusion}`,
      `- Review question: ${concept.reviewQuestion}`,
      ""
    );
  }

  lines.push("## Likely Test Points", "");
  for (const point of notes.likelyTestPoints || []) {
    lines.push(`- ${point}`);
  }

  if (notes.externalReferences?.length) {
    lines.push("", "## References", "");
    for (const reference of notes.externalReferences) {
      lines.push(`- [${reference.title}](${reference.url}) - ${reference.whyUseful}`);
    }
  }

  lines.push("", "## Cheat Sheet", "", notes.cheatSheet || "", "");
  return lines.join("\n");
}

async function renderBook() {
  const entries = await getSavedEntries();
  elements.savedCount.textContent = `${getActiveCourseName()} | ${entries.length} saved`;
  elements.lessonList.innerHTML = "";

  for (const entry of entries) {
    const li = document.createElement("li");
    li.className = "lesson-row";
    const button = document.createElement("button");
    button.type = "button";
    button.className = "lesson-load";
    button.textContent = entry.notes.lessonTitle || entry.title || entry.url;
    button.title = entry.url;
    button.addEventListener("click", () => {
      currentNotes = entry.notes;
      currentUrl = entry.storageKey;
      elements.pageTitle.textContent = entry.pageTitle || entry.title || "Saved lesson";
      renderNotes(entry.notes);
      setStatus("Loaded saved lesson.");
    });

    const deleteButton = document.createElement("button");
    deleteButton.type = "button";
    deleteButton.className = "lesson-delete";
    deleteButton.title = "Delete saved lesson";
    deleteButton.textContent = "Delete";
    deleteButton.addEventListener("click", async (event) => {
      event.preventDefault();
      event.stopPropagation();
      await deleteSavedLesson(entry.storageKey);
    });

    li.append(button, deleteButton);
    elements.lessonList.append(li);
  }
}

async function deleteSavedLesson(url) {
  const notesByUrl = (await getStorage(STORAGE_KEYS.notesByUrl)) || {};
  const deleteKey = findSavedLessonKey(notesByUrl, url, getActiveCourseId());
  const entry = deleteKey ? notesByUrl[deleteKey] : null;
  if (!entry) {
    setStatus("Could not find that saved lesson. Try reloading the extension, or use Clear Book.", true);
    return;
  }

  const title = entry.notes?.lessonTitle || entry.title || "this saved lesson";
  const confirmed = confirm(`Delete "${title}" from your Learn Assist book?`);
  if (!confirmed) {
    return;
  }

  delete notesByUrl[deleteKey];
  await setStorage(STORAGE_KEYS.notesByUrl, notesByUrl);

  if (currentUrl === deleteKey || currentUrl === entry.url || currentUrl === url) {
    currentNotes = null;
    currentUrl = "";
    elements.notes.classList.add("empty");
    elements.notes.innerHTML = "<p>Generated study notes will appear here.</p>";
  }

  await renderBook();
  setStatus("Saved lesson deleted.");
}

function findSavedLessonKey(notesByUrl, keyOrUrl, courseId = "") {
  if (keyOrUrl && notesByUrl[keyOrUrl] && matchesCourse(notesByUrl[keyOrUrl], courseId)) {
    return keyOrUrl;
  }

  return Object.entries(notesByUrl).find(([storageKey, entry]) => {
    return matchesCourse(entry, courseId) && (storageKey === keyOrUrl || entry?.url === keyOrUrl);
  })?.[0] || "";
}

async function deleteCurrentLesson() {
  if (!currentUrl && activePage?.url) {
    currentUrl = activePage.url;
  }

  if (!currentUrl) {
    setStatus("No current saved lesson selected.", true);
    return;
  }

  await deleteSavedLesson(currentUrl);
}

async function clearBook() {
  const entries = await getSavedEntries();
  if (!entries.length) {
    setStatus("No saved lessons to clear.", true);
    return;
  }

  const confirmed = confirm(`Delete all ${entries.length} saved lessons from ${getActiveCourseName()}?`);
  if (!confirmed) {
    return;
  }

  const notesByUrl = (await getStorage(STORAGE_KEYS.notesByUrl)) || {};
  for (const entry of entries) {
    delete notesByUrl[entry.storageKey];
  }
  await setStorage(STORAGE_KEYS.notesByUrl, notesByUrl);

  currentNotes = null;
  currentUrl = "";
  elements.notes.classList.add("empty");
  elements.notes.innerHTML = "<p>Generated study notes will appear here.</p>";
  await renderBook();
  setStatus("Book cleared.");
}

async function getSavedEntries() {
  const notesByUrl = (await getStorage(STORAGE_KEYS.notesByUrl)) || {};
  return Object.entries(notesByUrl)
    .map(([storageKey, entry]) => ({
      ...entry,
      storageKey,
      url: entry?.url || storageKey
    }))
    .filter((entry) => entry?.notes && matchesCourse(entry, getActiveCourseId()))
    .sort((a, b) => lessonSortKey(a).localeCompare(lessonSortKey(b), undefined, { numeric: true }));
}

function matchesCourse(entry, courseId) {
  if (!courseId) {
    return true;
  }
  return (entry?.courseId || DEFAULT_COURSE_ID) === courseId;
}

function lessonSortKey(entry) {
  return `${entry.notes?.lessonTitle || entry.title || ""} ${entry.url || ""}`;
}

function downloadFile(fileName, content, type) {
  const blob = new Blob([content], { type });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = fileName;
  anchor.click();
  URL.revokeObjectURL(url);
}

function markdownAnchor(value) {
  return safeFileName(value || "lesson");
}

function markdownToBasicHtml(markdown) {
  const lines = markdown.split("\n");
  const html = [];
  let inList = false;

  for (const line of lines) {
    if (line.startsWith("- ")) {
      if (!inList) {
        html.push("<ul>");
        inList = true;
      }
      html.push(`<li>${inlineMarkdown(escapeHtml(line.slice(2)))}</li>`);
      continue;
    }

    if (inList) {
      html.push("</ul>");
      inList = false;
    }

    if (line.startsWith("# ")) {
      html.push(`<section class="lesson"><h1>${escapeHtml(line.slice(2))}</h1>`);
    } else if (line.startsWith("## ")) {
      html.push(`<h2>${escapeHtml(line.slice(3))}</h2>`);
    } else if (line.startsWith("### ")) {
      html.push(`<h3>${escapeHtml(line.slice(4))}</h3>`);
    } else if (line.trim() === "---") {
      html.push("</section><hr>");
    } else if (line.trim()) {
      html.push(`<p>${inlineMarkdown(escapeHtml(line))}</p>`);
    }
  }

  if (inList) {
    html.push("</ul>");
  }

  html.push("</section>");
  return html.join("\n");
}

function inlineMarkdown(value) {
  return value.replace(/\[([^\]]+)\]\((https?:\/\/[^)]+)\)/g, "<a href=\"$2\">$1</a>");
}

function escapeHtml(value) {
  return String(value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

async function getActiveTab() {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tab?.id) {
    throw new Error("No active tab found.");
  }
  return tab;
}

function getStorage(key) {
  return chrome.storage.local.get(key).then((result) => result[key]);
}

function setStorage(key, value) {
  return chrome.storage.local.set({ [key]: value });
}

function setBusy(isBusy) {
  elements.courseSelect.disabled = isBusy;
  elements.newCourseName.disabled = isBusy;
  elements.createCourseButton.disabled = isBusy;
  elements.previewCaptureButton.disabled = isBusy;
  elements.analyzeButton.disabled = isBusy;
  elements.activityButton.disabled = isBusy;
  elements.exportButton.disabled = isBusy;
  elements.deleteCurrentButton.disabled = isBusy;
  elements.exportAllMarkdownButton.disabled = isBusy;
  elements.exportAllHtmlButton.disabled = isBusy;
  elements.clearBookButton.disabled = isBusy;
}

function setStatus(message, isError = false) {
  elements.status.textContent = message;
  elements.status.classList.toggle("error", isError);
}

function trimSlash(value) {
  return value.replace(/\/+$/, "");
}

function safeFileName(value) {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 80) || "lesson";
}

function uniqueCourseId(name, courses) {
  const base = safeFileName(name);
  const used = new Set(courses.map((course) => course.id));
  if (!used.has(base)) {
    return base;
  }

  let index = 2;
  while (used.has(`${base}-${index}`)) {
    index += 1;
  }
  return `${base}-${index}`;
}
