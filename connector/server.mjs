import { createServer } from "node:http";
import { randomBytes } from "node:crypto";
import { mkdir, readFile, writeFile, rm } from "node:fs/promises";
import { existsSync } from "node:fs";
import { homedir, tmpdir } from "node:os";
import path from "node:path";
import { spawn } from "node:child_process";

const PORT = Number(process.env.LEARN_ASSIST_PORT || 48734);
const HOST = "127.0.0.1";
const CONFIG_DIR = path.join(homedir(), ".learn-assist");
const CONFIG_PATH = path.join(CONFIG_DIR, "connector.json");
const SCHEMA_PATH = path.resolve("schemas/lesson-notes.schema.json");
const CHUNK_SCHEMA_PATH = path.resolve("schemas/chunk-notes.schema.json");
const ACTIVITY_SCHEMA_PATH = path.resolve("schemas/activity-help.schema.json");
const BACKEND = (process.env.LEARN_ASSIST_BACKEND || "codex").toLowerCase();
const CODEX_BIN = process.env.CODEX_BIN || "codex";
const HERMES_BIN = process.env.HERMES_BIN || "hermes";
const codexSessions = new Map();
const MAX_BODY_BYTES = 15 * 1024 * 1024;
const MAX_TEXT_CHARS = 120000;
const CHUNK_THRESHOLD_CHARS = 18000;
const CHUNK_TARGET_CHARS = 12000;
const CHUNK_OVERLAP_CHARS = 800;

if (process.argv.includes("--check")) {
  await check();
  process.exit(0);
}

const config = await loadConfig();

const server = createServer(async (req, res) => {
  try {
    setCors(req, res);

    if (req.method === "OPTIONS") {
      res.writeHead(204);
      res.end();
      return;
    }

    if (req.url === "/health" && req.method === "GET") {
      sendJson(res, 200, {
        ok: true,
        service: "learn-assist-connector",
        backend: BACKEND,
        hermesBin: HERMES_BIN,
        codexBin: CODEX_BIN
      });
      return;
    }

    if (req.url === "/analyze" && req.method === "POST") {
      assertAuthorized(req);
      const payload = await readJson(req);
      const result = await analyzeLesson(payload);
      sendJson(res, 200, result);
      return;
    }

    if (req.url === "/analyze/stream" && req.method === "POST") {
      assertAuthorized(req);
      const payload = await readJson(req);
      res.writeHead(200, {
        "content-type": "application/x-ndjson; charset=utf-8",
        "cache-control": "no-cache",
        "x-accel-buffering": "no"
      });

      const emit = (type, data = {}) => {
        res.write(`${JSON.stringify({ type, ...data })}\n`);
      };

      try {
        const result = await analyzeLesson(payload, emit);
        emit("done", result);
      } catch (error) {
        emit("error", { message: error.message || "Connector error" });
      } finally {
        res.end();
      }
      return;
    }

    if (req.url === "/activity/stream" && req.method === "POST") {
      assertAuthorized(req);
      const payload = await readJson(req);
      res.writeHead(200, {
        "content-type": "application/x-ndjson; charset=utf-8",
        "cache-control": "no-cache",
        "x-accel-buffering": "no"
      });

      const emit = (type, data = {}) => {
        res.write(`${JSON.stringify({ type, ...data })}\n`);
      };

      try {
        const result = await explainActivity(payload, emit);
        emit("done", result);
      } catch (error) {
        emit("error", { message: error.message || "Connector error" });
      } finally {
        res.end();
      }
      return;
    }

    sendJson(res, 404, { error: "Not found" });
  } catch (error) {
    sendJson(res, error.statusCode || 500, {
      error: error.message || "Connector error"
    });
  }
});

server.listen(PORT, HOST, () => {
  console.log("Learn Assist connector is running.");
  console.log(`URL: http://${HOST}:${PORT}`);
  console.log(`Token: ${config.token}`);
  console.log("");
  console.log("Paste this token into the Learn Assist side panel.");
});

async function check() {
  if (!["codex", "hermes"].includes(BACKEND)) {
    throw new Error("LEARN_ASSIST_BACKEND must be 'codex' or 'hermes'");
  }

  if (!existsSync(SCHEMA_PATH)) {
    throw new Error(`Missing schema at ${SCHEMA_PATH}`);
  }
  if (!existsSync(CHUNK_SCHEMA_PATH)) {
    throw new Error(`Missing schema at ${CHUNK_SCHEMA_PATH}`);
  }
  if (!existsSync(ACTIVITY_SCHEMA_PATH)) {
    throw new Error(`Missing schema at ${ACTIVITY_SCHEMA_PATH}`);
  }

  const bin = BACKEND === "hermes" ? HERMES_BIN : CODEX_BIN;
  await new Promise((resolve, reject) => {
    const child = spawn(bin, ["--version"], { stdio: ["ignore", "pipe", "pipe"] });
    let output = "";
    child.stdout.on("data", (chunk) => {
      output += chunk.toString();
    });
    child.stderr.on("data", (chunk) => {
      output += chunk.toString();
    });
    child.on("error", reject);
    child.on("close", (code) => {
      if (code === 0) {
        console.log(output.trim());
        resolve();
      } else {
        reject(new Error(output.trim() || `${bin} exited with ${code}`));
      }
    });
  });
}

async function loadConfig() {
  await mkdir(CONFIG_DIR, { recursive: true });

  if (existsSync(CONFIG_PATH)) {
    const existing = JSON.parse(await readFile(CONFIG_PATH, "utf8"));
    if (existing.token) {
      return existing;
    }
  }

  const next = {
    token: randomBytes(24).toString("base64url"),
    createdAt: new Date().toISOString()
  };

  await writeFile(CONFIG_PATH, `${JSON.stringify(next, null, 2)}\n`, { mode: 0o600 });
  return next;
}

function setCors(req, res) {
  const origin = req.headers.origin;
  if (!origin || origin.startsWith("chrome-extension://")) {
    res.setHeader("Access-Control-Allow-Origin", origin || "*");
  }
  res.setHeader("Access-Control-Allow-Headers", "content-type, authorization");
  res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
}

function assertAuthorized(req) {
  const header = req.headers.authorization || "";
  const expected = `Bearer ${config.token}`;
  if (header !== expected) {
    const error = new Error("Unauthorized connector request");
    error.statusCode = 401;
    throw error;
  }
}

async function readJson(req) {
  const chunks = [];
  let total = 0;

  for await (const chunk of req) {
    total += chunk.length;
    if (total > MAX_BODY_BYTES) {
      const error = new Error("Request body is too large");
      error.statusCode = 413;
      throw error;
    }
    chunks.push(chunk);
  }

  return JSON.parse(Buffer.concat(chunks).toString("utf8"));
}

async function analyzeLesson(payload, emit = () => {}) {
  const page = payload.page || {};
  const text = String(page.text || "").slice(0, MAX_TEXT_CHARS);
  const includeReferences = Boolean(payload.includeReferences);
  emit("status", { message: `Preparing ${text.length.toLocaleString()} characters of lesson text.` });
  const screenshotPath = await maybeWriteScreenshot(payload.screenshotDataUrl);

  try {
    const shouldChunk = text.length > CHUNK_THRESHOLD_CHARS && !screenshotPath;
    emit("status", {
      message: shouldChunk
        ? "Long lesson detected. Using chunked analysis."
        : "Using single-pass analysis."
    });

    const result = shouldChunk
      ? await analyzeLessonChunked(page, text, includeReferences, emit)
      : await analyzeLessonSingle(page, text, includeReferences, screenshotPath, emit);

    return {
      notes: result.notes,
      raw: result.raw,
      mode: result.mode,
      chunks: result.chunks || 1
    };
  } finally {
    if (screenshotPath) {
      await rm(screenshotPath, { force: true });
    }
  }
}

async function explainActivity(payload, emit = () => {}) {
  const page = payload.page || {};
  const text = String(page.text || "").slice(0, 2500);
  const screenshotPath = await maybeWriteScreenshot(payload.screenshotDataUrl);

  if (!screenshotPath) {
    const error = new Error("Activity help requires a visible screenshot.");
    error.statusCode = 400;
    throw error;
  }

  try {
    emit("status", { message: "Preparing activity screenshot." });
    const context = {
      url: page.url || "",
      title: page.title || "",
      capturedAt: new Date().toISOString(),
      activityContextText: text
    };

    const prompt = [
      "You are Learn Assist, helping a learner understand an interactive practice activity from a course page.",
      "The screenshot is the authoritative source. Base your guidance and suggested answer on the visible activity in the screenshot.",
      "Use activityContextText only as weak supporting context. If it conflicts with the screenshot or appears to be unrelated lesson text, ignore it.",
      "For drag-and-drop matching activities, describe which visible option likely matches each visible drop zone and why, based on the diagram/question shown.",
      "If the screenshot shows ERD tables, relationship boxes, crow's foot symbols, or entity names such as Customer, Order, Item, or Product, the task is about relationship/cardinality notation. Do not answer with normalization forms such as 1NF, 2NF, or 3NF unless those terms are visibly part of the activity.",
      "Do not interact with the page, drag items, click buttons, submit answers, or claim the final result is correct.",
      "Give a concise suggested answer for the visible practice activity, then explain the underlying concept, symbols, or rule that supports it.",
      "Do not refuse the suggested answer; this helper is for course practice review and explanation.",
      "Make the hints very actionable: point to the exact concept, symbol, diagram rule, or lesson section the learner should review.",
      "Fill whereToFindAnswer with likely lesson/notes section names and the terms to search for, such as 'crow foot notation', 'cardinality', 'optionality', 'ERD relationships', or the relevant table/entity names.",
      "Fill strongHints with near-answer guidance that narrows the learner's choices while still requiring them to make the final selection.",
      "Treat ordinary course screens labeled 'Knowledge Check', 'Connect the Idea', 'practice', or 'self-check' as practice even if they contain a Submit button.",
      "Always include a concise suggestedAnswer.answer and suggestedAnswer.explanation based on the visible activity.",
      "Return only data matching the requested JSON schema."
    ].join(" ");

    const args = codexArgs({
      schemaPath: ACTIVITY_SCHEMA_PATH,
      includeReferences: false,
      screenshotPath,
      sessionKey: "activity"
    });
    args.push(prompt);

    if (BACKEND === "hermes") {
      emit("hermes-start", { message: "Starting Hermes activity helper." });
      const stdout = await runHermes({ prompt, context, schemaPath: ACTIVITY_SCHEMA_PATH, includeReferences: false, screenshotPath }, emit);
      emit("hermes-done", { message: "Hermes activity helper complete." });

      return {
        activity: parseCodexJson(stdout),
        raw: stdout,
        mode: "activity"
      };
    }

    emit("codex-start", { message: "Starting Codex activity helper." });
    const stdout = await runCodex(args, `${JSON.stringify(context, null, 2)}\n`, emit, "activity");
    emit("codex-done", { message: "Codex activity helper complete." });

    return {
      activity: parseCodexJson(stdout),
      raw: stdout,
      mode: "activity"
    };
  } finally {
    await rm(screenshotPath, { force: true });
  }
}

async function analyzeLessonSingle(page, text, includeReferences, screenshotPath, emit = () => {}) {
  const context = lessonContext(page, text);
  const prompt = finalPrompt(includeReferences);
  if (BACKEND === "hermes") {
    emit("hermes-start", { message: "Starting Hermes lesson analysis." });
    const stdout = await runHermes({ prompt, context, schemaPath: SCHEMA_PATH, includeReferences, screenshotPath }, emit);
    emit("hermes-done", { message: "Hermes lesson analysis complete." });
    return {
      mode: "single",
      notes: parseCodexJson(stdout),
      raw: stdout
    };
  }
  const args = codexArgs({ schemaPath: SCHEMA_PATH, includeReferences, screenshotPath, sessionKey: "lesson" });
  args.push(prompt);
  emit("codex-start", { message: "Starting Codex lesson analysis." });
  const stdout = await runCodex(args, `${JSON.stringify(context, null, 2)}\n`, emit, "lesson");
  emit("codex-done", { message: "Codex lesson analysis complete." });
  return {
    mode: "single",
    notes: parseCodexJson(stdout),
    raw: stdout
  };
}

async function analyzeLessonChunked(page, text, includeReferences, emit = () => {}) {
  const chunks = chunkText(text, CHUNK_TARGET_CHARS, CHUNK_OVERLAP_CHARS);
  const chunkNotes = [];
  const rawChunks = [];
  emit("chunk-plan", {
    message: `Split lesson into ${chunks.length} chunks.`,
    chunks: chunks.length
  });

  for (let index = 0; index < chunks.length; index += 1) {
    emit("chunk-start", {
      message: `Summarizing chunk ${index + 1} of ${chunks.length}.`,
      chunk: index + 1,
      chunks: chunks.length
    });

    const context = {
      ...lessonContext(page, chunks[index]),
      chunkNumber: index + 1,
      chunkCount: chunks.length
    };

    const prompt = [
      "You are Learn Assist, a study-note assistant.",
      "Summarize this chunk of a longer lesson into compact study material.",
      "Do not solve graded quizzes, exams, or assessment questions.",
      "Do not reproduce the lesson verbatim.",
      "Keep only concepts, plain-English explanations, likely test points, and review questions that matter.",
      "Do not search the web for chunk summaries.",
      "Return only data matching the requested JSON schema."
    ].join(" ");

    const args = codexArgs({ schemaPath: CHUNK_SCHEMA_PATH, includeReferences: false, sessionKey: "lesson-chunk" });
    args.push(prompt);
    const stdout = BACKEND === "hermes"
      ? await runHermes({ prompt, context, schemaPath: CHUNK_SCHEMA_PATH, includeReferences: false }, emit)
      : await runCodex(args, `${JSON.stringify(context, null, 2)}\n`, emit, "lesson-chunk");
    rawChunks.push(stdout);
    chunkNotes.push(parseCodexJson(stdout));
    emit("chunk-done", {
      message: `Chunk ${index + 1} complete.`,
      chunk: index + 1,
      chunks: chunks.length
    });
  }

  const mergeContext = {
    url: page.url || "",
    title: page.title || "",
    capturedAt: new Date().toISOString(),
    chunkCount: chunks.length,
    chunkNotes
  };

  const mergePrompt = [
    "You are Learn Assist, a study-note assistant.",
    "Merge these chunk-level notes into one coherent lesson note.",
    "Deduplicate repeated concepts.",
    "Keep the final result concise but complete enough for review.",
    "Do not solve graded quizzes, exams, or assessment questions.",
    includeReferences
      ? "Find 2 to 4 reputable external references that help the learner understand the topic. Prefer official docs, vendor docs, university pages, or strong educational sources. Include URLs."
      : "Do not search the web. Return externalReferences as an empty array.",
    "Return only data matching the requested JSON schema."
  ].join(" ");

  const mergeArgs = codexArgs({ schemaPath: SCHEMA_PATH, includeReferences, sessionKey: "lesson-merge" });
  mergeArgs.push(mergePrompt);
  emit("merge-start", { message: "Merging chunk notes into final study guide." });
  const mergedStdout = BACKEND === "hermes"
    ? await runHermes({ prompt: mergePrompt, context: mergeContext, schemaPath: SCHEMA_PATH, includeReferences }, emit)
    : await runCodex(mergeArgs, `${JSON.stringify(mergeContext, null, 2)}\n`, emit, "lesson-merge");
  emit("merge-done", { message: "Merged final study guide." });

  return {
    mode: "chunked",
    chunks: chunks.length,
    notes: parseCodexJson(mergedStdout),
    raw: JSON.stringify({ chunks: rawChunks, merged: mergedStdout })
  };
}

function lessonContext(page, text) {
  return {
    url: page.url || "",
    title: page.title || "",
    capturedAt: new Date().toISOString(),
    text
  };
}

function finalPrompt(includeReferences) {
  return [
    "You are Learn Assist, a study-note assistant.",
    "Help the learner understand and remember the current lesson.",
    "Do not solve graded quizzes, exams, or assessment questions.",
    "Do not reproduce the lesson verbatim or create a replacement for the course.",
    "Create concise study notes in plain English.",
    "Prefer concepts, explanations, examples, likely test points, and self-review questions.",
    includeReferences
      ? "Find 2 to 4 reputable external references that help the learner understand the topic. Prefer official docs, vendor docs, university pages, or strong educational sources. Include URLs."
      : "Do not search the web. Return externalReferences as an empty array.",
    "Return only data matching the requested JSON schema."
  ].join(" ");
}

function codexArgs({ schemaPath, includeReferences, screenshotPath = "", sessionKey = "" }) {
  const args = [];
  const sessionId = sessionKey ? codexSessions.get(sessionKey)?.id || "" : "";

  if (includeReferences) {
    args.push("--search");
  }

  args.push("exec");
  if (sessionId) {
    args.push("resume");
  }

  args.push("--skip-git-repo-check");

  if (!sessionId) {
    args.push("--sandbox", "read-only");
  }

  args.push(
    "--output-schema",
    schemaPath,
    "--json"
  );

  if (screenshotPath) {
    args.push("--image", screenshotPath);
  }

  if (sessionId) {
    args.push(sessionId);
  }

  return args;
}

function chunkText(text, targetChars, overlapChars) {
  const paragraphs = text
    .split(/\n{1,}/)
    .map((item) => item.trim())
    .filter(Boolean);

  const chunks = [];
  let current = "";

  for (const paragraph of paragraphs) {
    const next = current ? `${current}\n${paragraph}` : paragraph;
    if (next.length > targetChars && current.length > 0) {
      chunks.push(current);
      current = `${tailText(current, overlapChars)}\n${paragraph}`;
    } else {
      current = next;
    }
  }

  if (current.trim()) {
    chunks.push(current.trim());
  }

  return chunks;
}

function tailText(value, maxChars) {
  if (value.length <= maxChars) {
    return value;
  }

  const tail = value.slice(-maxChars);
  const firstBreak = tail.indexOf("\n");
  return firstBreak >= 0 ? tail.slice(firstBreak + 1) : tail;
}

async function maybeWriteScreenshot(dataUrl) {
  if (!dataUrl) {
    return null;
  }

  const match = String(dataUrl).match(/^data:image\/(png|jpeg);base64,(.+)$/);
  if (!match) {
    const error = new Error("Screenshot must be a PNG or JPEG data URL");
    error.statusCode = 400;
    throw error;
  }

  const extension = match[1] === "jpeg" ? "jpg" : "png";
  const dir = path.join(tmpdir(), "learn-assist");
  await mkdir(dir, { recursive: true });
  const filePath = path.join(dir, `lesson-${Date.now()}-${randomBytes(6).toString("hex")}.${extension}`);
  await writeFile(filePath, Buffer.from(match[2], "base64"));
  return filePath;
}

function runCodex(args, stdin, emit = () => {}, sessionKey = "") {
  return new Promise((resolve, reject) => {
    const child = spawn(CODEX_BIN, args, {
      cwd: process.cwd(),
      stdio: ["pipe", "pipe", "pipe"]
    });

    let stdout = "";
    let stderr = "";

    child.stdout.on("data", (chunk) => {
      stdout += chunk.toString();
    });

    let stderrBuffer = "";
    child.stderr.on("data", (chunk) => {
      const text = chunk.toString();
      stderr += text;
      stderrBuffer += text;
      const lines = stderrBuffer.split(/\r?\n/);
      stderrBuffer = lines.pop() || "";
      for (const line of lines) {
        const message = line.trim();
        const safeMessage = safeCodexLogLine(message);
        if (safeMessage) {
          emit("codex-log", { message: safeMessage });
        }
      }
    });

    child.on("error", reject);

    child.on("close", (code) => {
      if (code === 0) {
        try {
          const parsed = parseCodexExecJson(stdout);
          if (sessionKey && parsed.threadId) {
            codexSessions.set(sessionKey, {
              id: parsed.threadId,
              updatedAt: new Date().toISOString()
            });
          }
          resolve(parsed.finalMessage || stdout.trim());
          return;
        } catch (error) {
          reject(error);
          return;
        }
      }

      reject(new Error(stderr.trim() || stdout.trim() || `codex exited with ${code}`));
    });

    child.stdin.write(stdin);
    child.stdin.end();
  });
}

async function runHermes({ prompt, context, schemaPath, includeReferences, screenshotPath }, emit = () => {}) {
  const schema = JSON.parse(await readFile(schemaPath, "utf8"));
  const fullPrompt = [
    prompt,
    "Return only valid JSON. Do not wrap it in Markdown fences.",
    "The JSON must conform to this schema:",
    JSON.stringify(schema),
    "Input context:",
    JSON.stringify(context, null, 2)
  ].join("\n\n");

  const args = screenshotPath
    ? ["chat", "--query", fullPrompt, "--image", screenshotPath, "--quiet", "--source", "learn-assist"]
    : ["--oneshot", fullPrompt, "--ignore-rules"];

  if (includeReferences) {
    args.push("--toolsets", "web");
  }

  return new Promise((resolve, reject) => {
    const child = spawn(HERMES_BIN, args, {
      cwd: process.cwd(),
      stdio: ["ignore", "pipe", "pipe"]
    });

    let stdout = "";
    let stderr = "";

    child.stdout.on("data", (chunk) => {
      stdout += chunk.toString();
    });

    child.stderr.on("data", (chunk) => {
      stderr += chunk.toString();
    });

    child.on("error", reject);

    child.on("close", (code) => {
      if (code === 0) {
        emit("hermes-log", { message: "Hermes returned a response." });
        resolve(stdout.trim());
        return;
      }

      reject(new Error(stderr.trim() || stdout.trim() || `hermes exited with ${code}`));
    });
  });
}

function parseCodexExecJson(stdout) {
  let threadId = "";
  let finalMessage = "";

  for (const line of stdout.split(/\r?\n/)) {
    const text = line.trim();
    if (!text || !text.startsWith("{")) {
      continue;
    }

    const event = JSON.parse(text);
    if (event.type === "thread.started" && event.thread_id) {
      threadId = event.thread_id;
    }

    if (event.type === "item.completed" && event.item?.type === "agent_message") {
      finalMessage = event.item.text || finalMessage;
    }
  }

  return { threadId, finalMessage };
}

function safeCodexLogLine(message) {
  if (!message) {
    return "";
  }

  if (message === "Reading additional input from stdin...") {
    return message;
  }

  if (/^(model|provider|sandbox|reasoning effort):\s/.test(message)) {
    return message;
  }

  if (message === "tokens used" || /^\d{1,3}(,\d{3})*$/.test(message)) {
    return message;
  }

  if (/^(summarizing|analyzing|merging|searching)\b/i.test(message)) {
    return message.slice(0, 180);
  }

  return "";
}

function parseCodexJson(stdout) {
  try {
    return JSON.parse(stdout);
  } catch {
    const start = stdout.indexOf("{");
    const end = stdout.lastIndexOf("}");
    if (start >= 0 && end > start) {
      return JSON.parse(stdout.slice(start, end + 1));
    }
    throw new Error("Codex did not return valid JSON");
  }
}

function sendJson(res, statusCode, body) {
  res.writeHead(statusCode, { "content-type": "application/json; charset=utf-8" });
  res.end(`${JSON.stringify(body)}\n`);
}
