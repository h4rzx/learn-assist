# Course Books Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add user-created course books so generated lesson notes are saved, displayed, exported, and cleared within the selected course.

**Architecture:** Keep the current single-file side panel pattern. Add a `learnAssistCourses` storage record for course metadata and add `courseId` to saved lesson entries. Filter existing book operations by the active course.

**Tech Stack:** Chrome extension JavaScript, Chrome local storage, Node vm tests.

---

### Task 1: Course State And Creation

**Files:**
- Modify: `extension/sidepanel.html`
- Modify: `extension/sidepanel.js`
- Modify: `extension/sidepanel.css`
- Test: `tests/sidepanel-routing.test.mjs`

- [ ] Add course selector elements to the side panel HTML.
- [ ] Add `learnAssistCourses` to `STORAGE_KEYS`.
- [ ] Implement `ensureCourseState`, `renderCourseSelector`, `createCourse`, and course slug helpers.
- [ ] Initialize course state before rendering the book.
- [ ] Add a test that starts from empty storage and verifies `General` exists.

### Task 2: Save Notes Into Selected Course

**Files:**
- Modify: `extension/sidepanel.js`
- Test: `tests/sidepanel-routing.test.mjs`

- [ ] Update `saveNotesForPage` to include `activeCourseId`.
- [ ] Update the existing routing regression test to assert saved notes include the selected course ID.
- [ ] Add a test that creates a course, analyzes a lesson, and verifies the saved entry uses the new course.

### Task 3: Filter Book Actions By Course

**Files:**
- Modify: `extension/sidepanel.js`
- Modify: `extension/sidepanel.css`
- Test: `tests/sidepanel-routing.test.mjs`

- [ ] Update `getSavedEntries` to return only entries for the active course.
- [ ] Update `clearBook` to clear only the active course.
- [ ] Update export file names and titles to include the active course name.
- [ ] Add a test that entries from another course do not appear in the active course export.
