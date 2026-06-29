# Tasker — Electron Task Manager: Build Spec (v1.4)

You are building an Electron desktop app called **Tasker**, designed to live in roughly
half a screen, frameless, and able to stay pinned above other windows. There is **no
local persistence of task data** — Jira is the only source of truth. Build UI-first
against a mock connector, then swap in the real Jira connector behind the same interface.

---

## 1. Tech stack & constraints

- **Electron**, vanilla JS renderer, **ES modules**, **no bundler / no build step**.
  Renderer code runs via `<script type="module">`.
- **Bulma CSS** for layout/components. Vendor `bulma.min.css` locally, load a
  `theme.css` after it that re-skins Bulma's components via CSS custom properties.
  Override via custom properties + targeted selectors, not Sass recompilation.
- No frontend framework, no state-management library. Direct DOM updates via small
  render functions per component.
- The previously-provided `editor.js` is **not reused verbatim** — recreate an
  equivalent CodeMirror 6 markdown editor component from the same functional spec
  (same public surface: `.value` get/set, `.readOnly`, `.addEventListener('input'|'blur'|'keydown')`,
  `.view` raw CodeMirror view exposed, `selectionStart = 0` to jump cursor to top),
  but themed for **light mode** and matching the rest of the app's design tokens
  instead of standalone dark-only CSS vars.

### Configuration — `.env` file

Connector credentials live in a `.env` file at the project root (gitignored), loaded via
`dotenv` in the **main process only** — never bundled into renderer code. Required vars:

```
JIRA_BASE_URL=https://yourcompany.atlassian.net
JIRA_EMAIL=you@company.com
JIRA_API_TOKEN=xxxxx
JIRA_JQL=assignee = currentUser() AND statusCategory != Done
JIRA_PROJECT_KEY=ABC          # used when creating new issues from Tasker
JIRA_ISSUE_TYPE=Task          # default issue type for new issues
```

This is the agreed exception to "no local storage" — it covers app *configuration*, not
task content. The renderer never sees the raw token; main process exposes a sanitized
config object (masked token) over IPC for the settings modal to display. Editing
credentials means editing `.env` and restarting the app, not a form in the UI.

### Suggested file structure

```
/src
  main.js                  # electron main process — frameless window, always-on-top IPC
  preload.js                # contextBridge: only sync-queue + connector IPC exposed
  /renderer
    index.html
    app.js                  # orchestrates UI, owns in-memory state, wires events
    editor.js                # recreated markdown/text editor (see §9)
    modal.js                 # generic reusable modal (see §4)
    taskList.js
    taskModal.js             # built on modal.js; handles both main tasks and subtasks
    settingsModal.js         # built on modal.js
    titlebar.js              # custom drag region + minimize/close/pin buttons
    /styles
      bulma.min.css
      theme.css              # light-theme tokens + Bulma overrides
  /connectors
    connector.interface.js
    mockConnector.js
    jiraConnector.js          # phase 2
  /sync
    queue.js                  # ephemeral outbound write queue (os.tmpdir()), NOT a data store
```

---

## 2. Window & layout

- `BrowserWindow`: `frame: false` (no native title bar). Width ≈ 45–50% of primary
  display's work area, height ≈ 90%, resizable, `minWidth: 360`.
- Custom titlebar strip at the very top (`-webkit-app-region: drag` on the bar itself,
  `no-drag` on buttons): app name/icon, then minimize + close buttons, plus a **pin
  button** that toggles `win.setAlwaysOnTop(bool)` via IPC — this is the "hold in front
  of everything" control. Pinned state shows a filled vs outline icon.
- Below the titlebar: search + settings + add-task row, then the scrollable task list.

---

## 3. Visual style — light theme

Same CSS-custom-property approach as before, light values instead of dark. Suggested
starting palette (adjust for contrast/accessibility, these are starting points not gospel):

```css
:root {
  --tk-bg:          #ffffff;
  --tk-surface:     #f5f6f8;
  --tk-text:        #1f2329;
  --tk-text-dim:    #6b7280;
  --tk-border:      #e2e5ea;
  --tk-accent:      #3b6fd6;   /* primary action / links / today-chip */
  --tk-danger:      #d6453b;   /* overdue chip */
  --tk-selection:   rgba(59, 111, 214, 0.15);
  --tk-font-mono:   'DM Mono', monospace;
}
```

---

## 4. Generic modal component

Build one reusable `modal.js` and base **both** the settings modal and the task detail
modal on it, so open/close behavior, backdrop click, Escape-to-close, and transitions are
identical everywhere instead of being re-implemented per modal.

```js
// createModal({ size, title, content, onClose }) -> { open(), close(), el }
```

- `size`: `'normal'` (settings — a standard Bulma `modal-card` width) or `'large'`
  (task detail — ~90% viewport width/height, overridden in `theme.css`).
- Backdrop click and `Escape` both close it; both modal types just supply their own
  content into the same shell rather than rolling their own backdrop/keyboard handling.

---

## 5. Data model

**Source of truth is Jira.** Tasker keeps an **in-memory** representation only, rebuilt
from a connector fetch each session (and on manual "Sync now"). Nothing about task
content is written to disk as a persistent cache.

- **Main tasks** = actual Jira issues (matched by the configured JQL).
- **Subtasks are NOT real Jira tickets.** They exist only as structured data encoded
  inside the managed comment on their parent issue (see §6), parsed back into objects
  on fetch. Subtasks are full tasks in every sense — they have notes, tags, recurring
  config — but they have no independent Jira presence and no `externalLink`.

### In-memory shape (main task)

```jsonc
{
  "id": "jira-issue-key",
  "type": "main",
  "parentId": null,
  "subtasks": [ /* see subtask shape below */ ],
  "title": "string",
  "text": "string",
  "dueDate": "YYYY-MM-DD | null",
  "done": false,
  "tags": ["string"],
  "externalLink": "https://yourcompany.atlassian.net/browse/ISSUE-123",  // set by connector, read-only
  "recurring": {
    "enabled": false,
    "unit": "day" | "week" | "month",
    "interval": 1,
    "dayOfWeek": 0-6 | null    // only for unit='week'; 0=Sun…6=Sat
  } | null,
  "connector": { "type": "jira", "externalId": "ISSUE-123", "commentId": "string|null" }
}
```

### In-memory shape (subtask)

```jsonc
{
  "id": "sub-xxx",
  "title": "string",
  "text": "string",
  "dueDate": "YYYY-MM-DD | null",
  "done": false,
  "tags": ["string"],
  "recurring": { ... } | null,
  "subtasks": []    // reserved; no nesting in UI
}
```

`externalLink` is **not present** on subtasks — they are embedded in the parent's comment
and have no independent Jira URL.

`externalLink` on main tasks is set automatically by the connector to
`${JIRA_BASE_URL}/browse/${issue.key}` and is never stored in the managed comment
(it is always derivable from the connector metadata). It is **not user-editable**.

---

## 6. Human-readable form (the managed comment)

One designated comment per issue, found via a hidden marker and fully rewritten on every
sync. The `externalLink` is never included — it is derived from the issue key.

```
<!-- tasker-managed -->
Recurring: weekly x1 on Mon
Tags: bug, urgent

## Subtasks

<!-- sub:sub-0 -->
[ ] Investigate token expiry edge case
due:2026-06-25
tags:backend

* Checked JWT lib — expiry comparison uses wrong timezone
<!-- /sub -->

<!-- sub:sub-1 -->
[x] Reproduce with QA steps
due:2026-06-18

* Steps confirmed on staging env
<!-- /sub -->

## Log
-- 20-06-2026 14:32

* Investigated root cause, looks related to token refresh timing

-- 19-06-2026 09:05

* Reported by QA, repro steps attached
```

Each subtask block encodes: done status + title (first line), then optional key:value
metadata lines (`due:`, `tags:`, `recur:`), then a blank line, then free-text notes.

The recurring line optionally includes a day specifier (`on Mon`…`on Sun`) when
`unit='week'` and `dayOfWeek` is set.

Backward compat: old-format subtasks (`- [ ] title | due:YYYY-MM-DD`) are parsed as a
fallback if no `<!-- sub: -->` blocks are found.

---

## 7. Main UI

- **Settings**: read-only display of current connector config sourced from `.env`
  (base URL, email, masked token, JQL, project key) plus "Test connection" and "Sync
  now" buttons. No credential entry form.
- **Search box**: live-filters the list by title (and subtask titles).
- **Add-task input**: creates a real Jira issue via the connector. Shows an optimistic
  "creating…" row, then the real issue key on success. **On creation, the task modal
  opens immediately for the new task.**
- **Task list** — table-like grid layout with fixed columns:

  ```
  [👻] [title              ] [tags    ] [recur] [date ] [done/total 👻]
  ```

  Column breakdown:
  - **Ghost** (22 px): `👻` for subtask rows, empty for main task rows.
  - **Title** (flex): main tasks show the summary; subtask rows show a two-line stack —
    parent task title (small, dimmed) on top, subtask title below.
  - **Tags** (160 px): tag chips for the row's own tags, italic style.
  - **Recur** (56 px): `↻ Nunit` chip (e.g. `↻ 1w`) when recurring is enabled, accent
    color. Empty otherwise.
  - **Date** (76 px): due date chip. Accent color when today, danger color when overdue.
    Empty if no date.
  - **Count** (68 px): `done/total 👻` chip for main tasks that have subtasks (e.g.
    `2/3 👻`). Empty for subtask rows.

  Behaviour:
  - All rows (main tasks + undone subtasks) sorted together by due date ascending;
    no-date rows at the end. Subtasks are not grouped under their parent.
  - **Done subtasks are hidden.** Manage them inside the task detail modal.
  - No checkboxes anywhere in the list — done status is toggled only inside the modal.
  - Clicking any row opens the task modal (or subtask modal with parent context).

---

## 8. Task detail modal

Built on `modal.js`, size `'large'`. The same modal is used for both main tasks and
subtasks — the `open(task, parentTask?)` signature determines the mode.

### Title area (modal head)

- **Main task**: title is displayed as a styled clickable button. Clicking it opens the
  Jira issue in the system browser via `shell.openExternal(task.externalLink)`. A pencil
  icon (✎) appears on hover to enter edit mode; blur or Enter exits back to link display.
- **Subtask**: title is always an editable input (no Jira URL). Focused automatically
  when the modal opens.

### Left meta panel

- **Due date** picker.
- **Tags**: inline tag chips + "add tag" input.
- **Recurring** controls:
  - "Enabled" checkbox + label in a proper flex row.
  - When enabled: "Every N [day|week|month]" controls.
  - When unit = `week`: compact day-of-week picker (Su Mo Tu We Th Fr Sa buttons).
    Toggling selects/deselects a specific weekday. Stored as `dayOfWeek` (0–6).
- **Subtasks** list (main tasks only, hidden when viewing a subtask):
  - Each row: title label + due date chip + tags summary. No checkbox — click the row
    to open the subtask in the full modal. A `×` remove button appears on hover.
  - "+ Add subtask": shows an inline name input. Enter confirms and **immediately opens
    the new subtask** in the modal. Escape cancels.
- **"↑ Parent: {title}"** link (subtask mode only) — closes this modal and opens the
  parent task.

### Right editor panel

- CodeMirror 6 markdown editor bound to `task.text`.
- "+ Entry" button prepends a dated log entry (see §9).
- Sync status indicator (saving / error).

### Push routing for subtasks

When viewing a subtask, all pushes go through the parent: the subtask is spliced into
a copy of `parentTask.subtasks` and `pushUpdate(parent)` is called. Conflict detection
runs against the parent comment's `updatedAt`. "Use Jira's version" reloads the parent
and finds the fresh subtask within it.

---

## 9. Editor "new entry" button

1. Take current date/time as `DD-MM-YYYY HH:mm`.
2. Prepend to the top of the document:
   ```
   -- DD-MM-YYYY HH:mm

   * 
   ```
   cursor placed right after `* `.
3. Existing content shifts down, untouched.

Use `view.dispatch(...)` directly so undo history and cursor placement behave correctly.

---

## 10. Auto-save & sync flow

No manual save button. Flow:

1. Debounced ~800ms on editor input, immediate on blur. Same pattern for title, tags,
   due date, recurring, and subtask edits.
2. Any in-memory change triggers a **debounced push** (~2.5s). Before pushing, run the
   conflict check (§11).
3. Pending comment body is written to the **ephemeral sync queue** (`os.tmpdir()`) before
   the network call, deleted on success.
4. On app launch, flush and discard any leftover queue entries, then re-fetch from Jira.

---

## 11. Conflict detection & resolution

Before every debounced push:

1. `connector.getRemoteCommentMeta(task)` → `{ updatedAt, body }`.
2. Compare `updatedAt` to the last-known timestamp.
3. **Match** → push normally.
4. **Mismatch** → show conflict modal: side-by-side "Your version" vs "Jira's version".
   - **Keep mine** → force-push.
   - **Use Jira's version** → reload and repopulate.
   - **Cancel** → leave queued.
5. Update the locally-tracked `updatedAt` after resolution.

---

## 12. Recurring tasks

When a recurring task or subtask is checked off:

1. Advance `dueDate` by `interval × unit` from the previous due date.
2. If `unit='week'` and `dayOfWeek` is set, snap forward to that weekday.
3. Reset `done` to `false`.
4. Push (via parent if subtask).

---

## 13. Connector abstraction

```js
/**
 * @typedef {Object} TaskConnector
 * @property {() => Promise<boolean>} testConnection
 * @property {() => Promise<Task[]>} fetchTasks
 *    Sets externalLink = `${baseUrl}/browse/${issue.key}` on every returned task.
 * @property {(title: string, dueDate: string|null) => Promise<Task>} createTask
 *    Sets externalLink on the returned task.
 * @property {(task: Task) => Promise<{updatedAt: string, body: string}>} getRemoteCommentMeta
 * @property {(task: Task) => Promise<{ok: boolean, updatedAt?: string}>} pushUpdate
 */
```

Main process exposes `open-external` IPC (`shell.openExternal`) for the renderer to open
Jira URLs without Node access.

### Mock connector
Returns hardcoded in-memory tasks. `externalLink` is set to
`https://mock-jira.example.com/browse/MOCK-X`. Subtasks have no `externalLink`.

### Jira connector
Sets `externalLink = ${baseUrl}/browse/${issue.key}`. Auth: HTTP Basic. Comment
read/write via `/rest/api/3/issue/{key}/comment`.

---

## 14. Build phases

1. **Scaffold** — frameless window, titlebar, vendored Bulma + theme.css, `.env` loading.
2. **Generic modal + static UI** — search, settings shell, add-task input, task list.
3. **Task detail modal** — editor, subtask list, parent-link navigation, "+ Entry".
4. **Auto-save plumbing** — debounce/blur, comment round-trip, sync queue, conflict modal.
5. **Jira connector** — real API calls, settings modal pulls live config.

---

## Changelog

### v1.4
- Task list uses a CSS grid table layout: fixed columns for ghost, title, tags, recur,
  date, and subtask count — all rows align vertically like a spreadsheet
- Tags, recurring indicator, and subtask count (`done/total 👻`) shown in the main list
- Subtask rows marked with `👻` in the ghost column
- No checkboxes anywhere in the main list or the in-modal subtask list — done status
  is edited only inside the task modal
- Task list add-input has more top padding for visual separation from the list above

### v1.3
- Task list is a single flat sorted list — subtasks sorted by their own due date, not
  grouped under their parent
- Always-on-top (`setAlwaysOnTop`) now uses `'floating'` level for Linux compatibility

### v1.2
- Done subtasks hidden from the main task list (still visible inside the task modal)
- Subtask rows in main list no longer indented; use two-line layout: parent title (small,
  dimmed) above subtask title
- Creating a new main task or subtask immediately opens it in the task modal
- `externalLink` is no longer user-editable; set automatically by the connector to the
  Jira browse URL (`${baseUrl}/browse/${key}`) — never stored in the managed comment
- Subtasks have no `externalLink` field (they have no Jira issue)
- Task modal title: main tasks show title as a Jira link (click opens browser); pencil
  icon to edit. Subtasks always show an editable input.
- Subtasks are full tasks: `text`, `tags`, `recurring`, `dueDate`, `done` — stored in
  the managed comment via `<!-- sub:id --> … <!-- /sub -->` blocks
- Subtask push routes through the parent task (`pushUpdate(parent)`)

### v1.1
- Subtask rows added to main task list
- Subtask detail opens in the full task modal (same modal, `open(sub, parent)` mode)
- "+ Add subtask" prompts for name inline before creating
- Recurring "Enabled" checkbox layout fixed
- Recurring unit=week shows day-of-week picker (Su Mo Tu We Th Fr Sa)
- `dayOfWeek` in recurring config, encoded as `on Mon` etc. in managed comment
- `advanceRecurring` snaps to selected weekday for weekly tasks
