# Course Books Design

## Goal

Let users choose which course a generated lesson note belongs to, and let them create courses from the side panel.

## Behavior

The side panel has an active course selector. New notes are saved into the selected course. The saved lesson list, Markdown export, HTML export, and clear action operate only on the selected course.

If no course exists, the extension creates a default course named `General`. Existing saved notes that do not have a course assignment are treated as `General`.

## Data Model

Chrome local storage keeps the existing `learnAssistNotesByUrl` object. Each saved note entry gains a `courseId` field.

A new `learnAssistCourses` key stores:

```json
{
  "items": [
    { "id": "general", "name": "General", "createdAt": "2026-06-10T00:00:00.000Z" }
  ],
  "activeCourseId": "general"
}
```

Course IDs are stable slugs derived from the course name with a short suffix when needed. Course names are trimmed and cannot be empty.

## UI

Add a compact course section above the existing action controls:

- Dropdown for the active course.
- Text input for a new course name.
- `Create` button to add and select a course.

The Book heading shows the selected course name and saved count. The export file names include the course name.

## Testing

Use the existing Node/vm side panel test style. Add coverage that verifies:

- A default `General` course exists when storage is empty.
- Creating/selecting a course causes `Analyze lesson` to save the note with that course ID.
- Saved lesson lists and exports are filtered to the active course.
