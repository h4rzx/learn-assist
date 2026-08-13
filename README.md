# Learn Assist

Learn Assist is a local-first Brave/Chrome extension that helps turn the lesson you are currently reading into study notes, plain-English explanations, review questions, and a Markdown cheat sheet.

The connector can use either your local `codex` CLI or `hermes` CLI, so you do not need to put an API key inside the extension.

## Requirements

- Brave or Chrome
- Node.js 18+
- Codex CLI installed and logged in, or Hermes Agent installed and configured

Check Codex:

```bash
codex --version
codex login
```

Check Hermes:

```bash
hermes --version
hermes doctor
```

## Run The Local Connector

From this project:

```bash
npm run connector
```

To run it through Hermes Agent instead of Codex:

```bash
LEARN_ASSIST_BACKEND=hermes npm run connector
```

On this Mac, `/usr/local/bin/node` is too old for the test runner. If needed, prefer Homebrew Node:

```bash
PATH=/opt/homebrew/bin:$PATH LEARN_ASSIST_BACKEND=hermes npm run connector
```

The connector prints a local URL and token. Keep it running while using the extension.

## Load The Extension

1. Open `brave://extensions`.
2. Enable Developer mode.
3. Click `Load unpacked`.
4. Select the `extension` folder in this project.
5. Open a lesson page.
6. Click the Learn Assist extension button.
7. Paste the connector token if it is not already set.

## Use It

- `Analyze lesson` extracts readable page text and asks Codex for study notes.
- Enable `Include screenshot` when the lesson has diagrams, tables, or slide-like content.
- Saved lessons stay in browser local storage.
- `Export Markdown` downloads a cheat sheet for the current lesson.

## Academic Boundary

Use this to understand and remember lessons. Do not use it to auto-answer graded quizzes, exams, or assessments.

