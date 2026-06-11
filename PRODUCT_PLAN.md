# Learn Assist Product Plan

Learn Assist is a learning companion for online lessons. It is not a scraper. It captures the current lesson context only when the learner asks, then turns that context into plain-English study notes, review questions, and a cheat sheet.

## MVP Goals

- Open as a Brave/Chrome side panel.
- Capture the active lesson as readable page text.
- Optionally include a visible-page screenshot for diagrams or awkward course layouts.
- Send the captured context to a local companion service.
- Use the user's existing local Codex CLI authentication instead of extension API keys.
- Store generated notes locally in the browser.
- Export a Markdown cheat sheet.

## Non-Goals

- Bulk downloading a course.
- Bypassing course access controls.
- Auto-answering graded quizzes or exams.
- Storing full copyrighted lesson text as a substitute for the course.

## First Learning Flow

1. Learner opens the lesson.
2. Learner opens the Learn Assist side panel.
3. Learner clicks `Analyze lesson`.
4. The extension extracts current page text and optionally captures a screenshot.
5. The local connector calls `codex exec`.
6. Learn Assist saves structured notes:
   - lesson summary
   - key concepts
   - layman explanations
   - why each concept matters
   - examples
   - common confusion points
   - review questions
7. Learner exports Markdown when ready.

## Architecture

```text
Brave side panel
  -> active tab text/screenshot capture
  -> http://127.0.0.1:48734 local connector
  -> local Codex CLI
  -> structured JSON notes
  -> browser local storage
  -> Markdown export
```

## Safety Rules

- Require an explicit click before capturing.
- Keep the connector bound to `127.0.0.1`.
- Require a bearer token for connector calls.
- Prefer summaries and short source references over storing full lesson text.
- Warn users not to use the tool for graded assessment answers.

