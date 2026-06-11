import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import vm from "node:vm";

const source = await readFile(new URL("../extension/sidepanel.js", import.meta.url), "utf8");

const lessonCapture = {
  url: "https://example.test/lesson",
  storageKey: "https://example.test/lesson?learnAssist=test",
  title: "3.1 Database Relationships",
  pageTitle: "Database Relationships",
  headings: ["3.1 Database Relationships"],
  text: [
    "Database relationships connect rows across tables.",
    "Primary keys identify rows.",
    "Foreign keys refer to primary keys in related tables.",
    "Knowledge Check",
    "Submit"
  ].join("\n"),
  fingerprint: "test",
  captureMode: "test",
  captureScore: 100
};

function makeElement(selector) {
  return {
    selector,
    value: selector === "#connectorToken" ? "test-token" : "",
    checked: false,
    disabled: false,
    textContent: "",
    innerHTML: "",
    children: [],
    options: [],
    classList: {
      add() {},
      remove() {},
      toggle() {},
      contains() {
        return false;
      }
    },
    append(...items) {
      this.children.push(...items);
      if (selector === "#courseSelect") {
        this.options.push(...items);
      }
    },
    addEventListener() {},
    querySelector() {
      return null;
    },
    scrollTop: 0,
    scrollHeight: 0,
    click() {}
  };
}

function createHarness(initialStorage = {}) {
  const elementStore = new Map();
  const fetchUrls = [];
  let screenshotCaptures = 0;
  let scriptExecutions = 0;
  const storage = structuredClone(initialStorage);

  function elementFor(selector) {
    if (!elementStore.has(selector)) {
      elementStore.set(selector, makeElement(selector));
    }
    return elementStore.get(selector);
  }

  const context = {
    console,
    Blob,
    TextDecoder,
    URL: {
      createObjectURL() {
        return "blob:test";
      },
      revokeObjectURL() {}
    },
    setTimeout,
    clearTimeout,
    document: {
      querySelector: elementFor,
      createElement(tagName) {
        return makeElement(tagName);
      },
      createTextNode(text) {
        return { textContent: text };
      }
    },
    chrome: {
      storage: {
        local: {
          async get(key) {
            return { [key]: storage[key] };
          },
          async set(values) {
            Object.assign(storage, structuredClone(values));
          }
        }
      },
      tabs: {
        async query() {
          return [{ id: 1, url: lessonCapture.url, title: lessonCapture.title, windowId: 1 }];
        },
        async captureVisibleTab() {
          screenshotCaptures += 1;
          return "data:image/png;base64,test";
        }
      },
      scripting: {
        async executeScript() {
          scriptExecutions += 1;
          return [{ result: lessonCapture }];
        }
      },
      permissions: {
        async contains() {
          return true;
        },
        async request() {
          return true;
        }
      }
    },
    confirm() {
      return true;
    },
    fetch: async (url) => {
      fetchUrls.push(String(url));
      const event = String(url).endsWith("/activity/stream")
        ? {
          type: "done",
          activity: {
            activityTitle: "WAN Self Check",
            whatThisTests: "WAN characteristics.",
            keyIdeas: [],
            hints: [],
            strongHints: [],
            whereToFindAnswer: [],
            solvingSteps: [],
            selfCheckQuestions: [],
            suggestedAnswer: {
              answer: "Choose the WAN statements.",
              explanation: "WANs connect separated locations."
            },
            avoidDoing: ""
          }
        }
        : {
          type: "done",
          notes: {
            lessonTitle: "3.1 Database Relationships",
            summary: "Relationships connect tables.",
            concepts: []
          },
          mode: "single"
        };
      return {
        ok: true,
        body: {
          getReader() {
            let sent = false;
            return {
              async read() {
                if (sent) {
                  return { done: true };
                }
                sent = true;
                return {
                  done: false,
                  value: new TextEncoder().encode(`${JSON.stringify(event)}\n`)
                };
              }
            };
          }
        }
      };
    }
  };

  vm.createContext(context);
  vm.runInContext(source, context);

  return {
    context,
    elementFor,
    fetchUrls,
    get screenshotCaptures() {
      return screenshotCaptures;
    },
    get scriptExecutions() {
      return scriptExecutions;
    },
    storage,
    async ready() {
      for (let index = 0; index < 20; index += 1) {
        await new Promise((resolve) => setTimeout(resolve, 0));
        if (storage.learnAssistCourses && elementFor("#courseSelect").value === storage.learnAssistCourses.activeCourseId) {
          elementFor("#connectorToken").value = "test-token";
          return;
        }
      }
      throw new Error("Side panel did not initialize course storage.");
    }
  };
}

{
  const harness = createHarness();
  await harness.ready();

  assert.equal(harness.storage.learnAssistCourses.activeCourseId, "general");
  assert.equal(harness.storage.learnAssistCourses.items[0].name, "General");
}

{
  const harness = createHarness();
  await harness.ready();
  await harness.context.analyzeLesson();

  assert.deepEqual(harness.fetchUrls, ["http://127.0.0.1:48734/analyze/stream"]);
  const saved = Object.values(harness.storage.learnAssistNotesByUrl)[0];
  assert.equal(saved.courseId, "general");
}

{
  const harness = createHarness();
  await harness.ready();
  harness.elementFor("#newCourseName").value = "Databases 101";

  await harness.context.createCourse();
  await harness.context.analyzeLesson();

  assert.equal(harness.storage.learnAssistCourses.activeCourseId, "databases-101");
  const saved = Object.values(harness.storage.learnAssistNotesByUrl)[0];
  assert.equal(saved.courseId, "databases-101");
}

{
  const initialStorage = {
    learnAssistCourses: {
      activeCourseId: "databases-101",
      items: [
        { id: "general", name: "General", createdAt: "2026-06-10T00:00:00.000Z" },
        { id: "databases-101", name: "Databases 101", createdAt: "2026-06-10T00:00:00.000Z" }
      ]
    },
    learnAssistNotesByUrl: {
      "general-lesson": {
        storageKey: "general-lesson",
        url: "https://example.test/general",
        title: "General Lesson",
        courseId: "general",
        notes: { lessonTitle: "General Lesson", summary: "", concepts: [] }
      },
      "database-lesson": {
        storageKey: "database-lesson",
        url: "https://example.test/database",
        title: "Database Lesson",
        courseId: "databases-101",
        notes: { lessonTitle: "Database Lesson", summary: "", concepts: [] }
      }
    }
  };
  const harness = createHarness(initialStorage);
  await harness.ready();

  const entries = await harness.context.getSavedEntries();

  assert.equal(entries.length, 1);
  assert.equal(entries[0].title, "Database Lesson");
}

{
  const harness = createHarness({
    learnAssistCourses: {
      activeCourseId: "databases-101",
      items: [
        { id: "general", name: "General", createdAt: "2026-06-10T00:00:00.000Z" },
        { id: "databases-101", name: "Databases 101", createdAt: "2026-06-10T00:00:00.000Z" }
      ]
    },
    learnAssistNotesByUrl: {
      "general-lesson": {
        storageKey: "general-lesson",
        url: "https://example.test/general",
        title: "General Lesson",
        courseId: "general",
        notes: { lessonTitle: "General Lesson", summary: "", concepts: [] }
      },
      "database-lesson": {
        storageKey: "database-lesson",
        url: "https://example.test/database",
        title: "Database Lesson",
        courseId: "databases-101",
        notes: { lessonTitle: "Database Lesson", summary: "", concepts: [] }
      }
    }
  });
  await harness.ready();

  await harness.context.clearBook();

  assert.deepEqual(Object.keys(harness.storage.learnAssistNotesByUrl), ["general-lesson"]);
}

{
  const harness = createHarness();
  await harness.ready();

  harness.context.appendSuggestedAnswer({
    available: false,
    answer: "Use the router as the default gateway.",
    explanation: "Routers forward traffic between IP networks."
  });

  const wrapper = harness.elementFor("#notes").children.at(-1);
  const button = wrapper.children[0];

  assert.equal(button.disabled, false);
  assert.equal(button.textContent, "Reveal Suggested Answer");
}

{
  const harness = createHarness({
    learnAssistNotesByUrl: {
      [lessonCapture.storageKey]: {
        storageKey: lessonCapture.storageKey,
        url: lessonCapture.url,
        title: "Cached Lesson",
        courseId: "general",
        notes: {
          lessonTitle: "Cached Lesson",
          summary: "Loaded from cache.",
          concepts: []
        }
      }
    }
  });
  await harness.ready();

  await harness.context.analyzeLesson();

  assert.deepEqual(harness.fetchUrls, ["http://127.0.0.1:48734/analyze/stream"]);
  assert.equal(harness.scriptExecutions, 1);
}

{
  const harness = createHarness({
    learnAssistNotesByUrl: {
      "https://example.test/lesson?learnAssist=old": {
        storageKey: "https://example.test/lesson?learnAssist=old",
        url: lessonCapture.url,
        title: "Old Cached Lesson",
        courseId: "general",
        notes: {
          lessonTitle: "Old Cached Lesson",
          summary: "This should not be loaded for changed page content.",
          concepts: []
        }
      }
    }
  });
  await harness.ready();

  await harness.context.analyzeLesson();

  assert.deepEqual(harness.fetchUrls, ["http://127.0.0.1:48734/analyze/stream"]);
  assert.equal(harness.scriptExecutions, 1);
}

{
  const harness = createHarness();
  await harness.ready();

  await harness.context.explainActivity();
  await harness.context.explainActivity();

  assert.deepEqual(harness.fetchUrls, [
    "http://127.0.0.1:48734/activity/stream",
    "http://127.0.0.1:48734/activity/stream"
  ]);
  assert.equal(harness.screenshotCaptures, 2);
  assert.equal(harness.scriptExecutions, 2);
}
