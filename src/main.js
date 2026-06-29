process.env.NODE_TLS_REJECT_UNAUTHORIZED = '0'
require('dotenv').config()
const { app, BrowserWindow, ipcMain, screen, shell } = require('electron')
const path = require('path')
const fs = require('fs')
const { mockConnector } = require('./connectors/mockConnector')
const { makeJiraConnector } = require('./connectors/jiraConnector')
const { buildComment } = require('./connectors/commentUtils')
const { enqueue, dequeue, getQueue, clearQueue } = require('./sync/queue')

let win = null
// Ordered list of sections: { id, name, projectKey, issueType, canCreate, connector }
let sections = []
// taskId → sectionId, so id-only operations (transitions, reload) can find the connector.
// Jira issue keys are globally unique, so this map is unambiguous across sections.
const taskSection = new Map()
let isPinned = false

// Per-task map of last-known comment updatedAt; keyed by task id
const knownUpdatedAt = new Map()
// Per-task map of managed-comment id; survives across pushes so renderer
// doesn't need to round-trip the new id back before the next save.
const knownCommentId = new Map()
// Per-task promise chain — serializes concurrent push-update / push-force calls
// so a second push waits for the first to (potentially) populate knownCommentId
// before deciding whether to POST a new comment or PUT the existing one.
const pushChain = new Map()

function chainPush(taskId, fn) {
  const prev = pushChain.get(taskId) || Promise.resolve()
  const next = prev.catch(() => {}).then(fn)
  pushChain.set(taskId, next)
  next.finally(() => {
    if (pushChain.get(taskId) === next) pushChain.delete(taskId)
  })
  return next
}

// Read sections.json from the project root (one level above /src). Returns null
// when the file is absent or unparseable so callers can fall back to env vars.
function readSectionsFile() {
  const file = path.join(__dirname, '..', 'sections.json')
  try {
    if (!fs.existsSync(file)) return null
    const parsed = JSON.parse(fs.readFileSync(file, 'utf8'))
    if (!Array.isArray(parsed) || parsed.length === 0) return null
    return parsed
  } catch (err) {
    console.error('[tasker] Failed to read sections.json — falling back to .env:', err.message)
    return null
  }
}

function slugify(name, used) {
  let base = String(name || 'section').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'section'
  let id = base, n = 2
  while (used.has(id)) id = `${base}-${n++}`
  used.add(id)
  return id
}

// Build the ordered sections list. Each Jira section reuses the shared credentials
// from .env but carries its own jql/projectKey/issueType. Falls back to a single
// env-derived section, or a single mock section when no credentials are present.
function loadSections() {
  const { JIRA_BASE_URL, JIRA_EMAIL, JIRA_API_TOKEN, JIRA_JQL, JIRA_PROJECT_KEY, JIRA_ISSUE_TYPE } = process.env
  const hasCreds = JIRA_BASE_URL && JIRA_EMAIL && JIRA_API_TOKEN

  if (!hasCreds) {
    console.log('[tasker] No Jira credentials found — using mock connector')
    return [{ id: 'mock', name: 'Tasks', projectKey: '', issueType: 'Task', canCreate: true, showStatus: false, connector: mockConnector }]
  }

  const fromFile = readSectionsFile()
  const defs = fromFile || [{
    name:       'Tasks',
    jql:        JIRA_JQL || 'assignee = currentUser() AND statusCategory != Done',
    projectKey: JIRA_PROJECT_KEY || '',
    issueType:  JIRA_ISSUE_TYPE || 'Task',
  }]

  const used = new Set()
  return defs.map(def => {
    const projectKey = def.projectKey || ''
    const issueType  = def.issueType || 'Task'
    return {
      id:        def.id && !used.has(def.id) ? (used.add(def.id), def.id) : slugify(def.name, used),
      name:      def.name || 'Section',
      jql:        def.jql || '',
      projectKey,
      issueType,
      canCreate:  !!projectKey,
      showStatus: !!def.showStatus,
      statusOrder: Array.isArray(def.statusOrder) ? def.statusOrder : null,
      connector: makeJiraConnector({
        baseUrl:  JIRA_BASE_URL,
        email:    JIRA_EMAIL,
        apiToken: JIRA_API_TOKEN,
        jql:      def.jql || 'assignee = currentUser() AND statusCategory != Done',
        projectKey,
        issueType,
      }),
    }
  })
}

function sectionById(id) {
  return sections.find(s => s.id === id) || null
}

function connForTask(task) {
  const sid = task?.connector?.sectionId || (task?.id != null ? taskSection.get(task.id) : null)
  return sectionById(sid)?.connector || sections[0]?.connector || null
}

function connForTaskId(taskId) {
  return sectionById(taskSection.get(taskId))?.connector || sections[0]?.connector || null
}

const usingMock = () => sections.length > 0 && sections[0].connector === mockConnector

function getSanitizedConfig() {
  const raw = process.env.JIRA_API_TOKEN || ''
  const masked = raw.length > 4 ? raw.slice(0, 4) + '…' + raw.slice(-2) : '****'
  return {
    baseUrl:   process.env.JIRA_BASE_URL || '(not set)',
    email:     process.env.JIRA_EMAIL    || '(not set)',
    apiToken:  masked,
    usingMock: usingMock(),
    sections:  sections.map(s => ({
      name:       s.name,
      jql:        s.jql || '(mock)',
      projectKey: s.projectKey || '(not set)',
      issueType:  s.issueType || '(not set)',
    })),
  }
}

async function flushQueue() {
  const queue = getQueue()
  const entries = Object.values(queue)
  if (entries.length === 0) return
  console.log(`[tasker] Flushing ${entries.length} queued push(es)…`)
  for (const entry of entries) {
    try {
      // We can't fully reconstruct a task from the queue; just log and discard
      // The fresh fetchTasks() right after will be the canonical state
      console.log(`[tasker] Discarding queue entry for ${entry.taskId} (Jira will be re-fetched)`)
    } catch (err) {
      console.error('[tasker] Queue flush error:', err)
    }
  }
  clearQueue()
}

// .ico on Windows (multi-resolution, crisper in taskbar/alt-tab); png elsewhere.
const APP_ICON = path.join(__dirname, '..', 'assets', process.platform === 'win32' ? 'icon.ico' : 'icon.png')

function createWindow() {
  const { width, height } = screen.getPrimaryDisplay().workAreaSize
  win = new BrowserWindow({
    width:    Math.round(width  * 0.47),
    height:   Math.round(height * 0.9),
    minWidth: 360,
    frame:    false,
    resizable: true,
    icon:     APP_ICON,
    title:    'Tasker',
    webPreferences: {
      preload:          path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration:  false,
      sandbox:          false,
    },
  })

  win.loadFile(path.join(__dirname, 'renderer', 'index.html'))

  if (process.env.TASKER_DEVTOOLS) {
    win.webContents.openDevTools({ mode: 'detach' })
  }
}

// ─── IPC handlers ─────────────────────────────────────────────────────────────

ipcMain.on('window-minimize', () => win?.minimize())
ipcMain.on('window-close',    () => win?.close())

ipcMain.handle('window-pin', (_e, pin) => {
  isPinned = !!pin
  win?.setAlwaysOnTop(isPinned, 'floating')
  return isPinned
})

ipcMain.handle('get-config', () => getSanitizedConfig())

ipcMain.handle('test-connection', async () => {
  // Credentials are shared across sections, so testing the first connector suffices.
  const conn = sections[0]?.connector
  if (!conn) return { ok: false, error: 'No connector configured' }
  try {
    const ok = await conn.testConnection()
    return { ok }
  } catch (err) {
    return { ok: false, error: err.message }
  }
})

function seedKnown(tasks) {
  for (const t of tasks) {
    if (t.connector?.commentUpdatedAt) knownUpdatedAt.set(t.id, t.connector.commentUpdatedAt)
    if (t.connector?.commentId) knownCommentId.set(t.id, t.connector.commentId)
  }
}

// Fetch every section's tasks, tag each task with its section, seed the known-state
// maps and the taskId→section routing map. Returns the renderer-facing structure.
async function fetchAllSections() {
  const results = await Promise.all(sections.map(async section => {
    const tasks = await section.connector.fetchTasks()
    for (const t of tasks) {
      t.sectionId = section.id
      if (t.connector) t.connector.sectionId = section.id
      taskSection.set(t.id, section.id)
    }
    seedKnown(tasks)
    return { id: section.id, name: section.name, canCreate: section.canCreate, showStatus: section.showStatus, statusOrder: section.statusOrder, tasks }
  }))
  return results
}

ipcMain.handle('fetch-tasks', async () => {
  return { sections: await fetchAllSections() }
})

ipcMain.handle('sync-now', async () => {
  try {
    await flushQueue()
    knownUpdatedAt.clear()
    knownCommentId.clear()
    taskSection.clear()
    const result = await fetchAllSections()
    win?.webContents.send('sync-status', { type: 'success', sections: result })
    return { ok: true, sections: result }
  } catch (err) {
    win?.webContents.send('sync-status', { type: 'error', error: err.message })
    return { ok: false, error: err.message }
  }
})

ipcMain.handle('create-task', async (_e, sectionId, title, dueDate) => {
  const section = sectionById(sectionId) || sections[0]
  const task = await section.connector.createTask(title, dueDate)
  task.sectionId = section.id
  if (task.connector) task.connector.sectionId = section.id
  taskSection.set(task.id, section.id)
  if (task.connector?.commentUpdatedAt) knownUpdatedAt.set(task.id, task.connector.commentUpdatedAt)
  if (task.connector?.commentId) knownCommentId.set(task.id, task.connector.commentId)
  return task
})

ipcMain.handle('get-remote-comment-meta', async (_e, task) => {
  return connForTask(task).getRemoteCommentMeta(task)
})

ipcMain.handle('push-update', async (_e, task) => {
  return chainPush(task.id, async () => {
    // Back-fill commentId from the cache *after* any prior in-flight push has finished —
    // this is what prevents duplicate POSTs when two saves race.
    if (task.connector && !task.connector.commentId && knownCommentId.has(task.id)) {
      task.connector.commentId = knownCommentId.get(task.id)
    }
    // First-time push (no managed comment yet) → skip conflict check
    if (!task.connector?.commentId) {
      return pushTaskNow(task)
    }
    // Conflict check
    try {
      const remote = await connForTask(task).getRemoteCommentMeta(task)
      const known = knownUpdatedAt.get(task.id)

      // No remote managed comment (empty body) → not a conflict, just push to (re)create it
      if (!remote.body || !remote.body.trim()) {
        console.log(`[tasker] No managed comment body on ${task.id} — pushing without conflict check`)
      } else if (known && remote.updatedAt !== known) {
        console.log(`[tasker] Conflict on ${task.id}: known=${known} remote=${remote.updatedAt}`)
        const mine = buildComment(task)
        return { conflict: { mine, theirs: remote.body, remoteUpdatedAt: remote.updatedAt } }
      }
    } catch (err) {
      console.warn('[tasker] Conflict check failed (proceeding):', err.message)
    }

    return pushTaskNow(task)
  })
})

ipcMain.handle('push-update-force', async (_e, task) => {
  return chainPush(task.id, async () => {
    if (task.connector && !task.connector.commentId && knownCommentId.has(task.id)) {
      task.connector.commentId = knownCommentId.get(task.id)
    }
    return pushTaskNow(task)
  })
})

ipcMain.handle('open-external', (_e, url) => {
  if (typeof url === 'string' && (url.startsWith('https://') || url.startsWith('http://'))) {
    shell.openExternal(url)
  }
})

ipcMain.handle('fetch-transitions', async (_e, taskId) => {
  const conn = connForTaskId(taskId)
  if (!conn?.fetchTransitions) return []
  try { return await conn.fetchTransitions(taskId) }
  catch (err) { console.error('[tasker] fetchTransitions:', err.message); return [] }
})

ipcMain.handle('transition-issue', async (_e, taskId, transitionId) => {
  const conn = connForTaskId(taskId)
  if (!conn?.transitionIssue) return { ok: false, error: 'Connector has no transitions support' }
  try {
    const status = await conn.transitionIssue(taskId, transitionId)
    return { ok: true, status }
  } catch (err) {
    console.error('[tasker] transitionIssue:', err.message)
    return { ok: false, error: err.message }
  }
})

ipcMain.handle('reload-task', async (_e, taskId) => {
  const section = sectionById(taskSection.get(taskId)) || sections[0]
  const tasks = await section.connector.fetchTasks()
  const found = tasks.find(t => t.id === taskId)
  if (found) {
    found.sectionId = section.id
    if (found.connector) found.connector.sectionId = section.id
    knownUpdatedAt.set(found.id, found.connector?.commentUpdatedAt)
  }
  return found || null
})

async function pushTaskNow(task) {
  enqueue(task.id, buildComment(task), task.connector?.commentId)
  try {
    const result = await connForTask(task).pushUpdate(task)
    dequeue(task.id)
    if (result?.updatedAt) {
      knownUpdatedAt.set(task.id, result.updatedAt)
      task.connector.commentUpdatedAt = result.updatedAt
    }
    // pushUpdate sets task.connector.commentId after a fresh POST; cache it so
    // the next push doesn't create another duplicate comment.
    if (task.connector?.commentId) knownCommentId.set(task.id, task.connector.commentId)
    return { ok: true, updatedAt: result?.updatedAt, commentId: task.connector?.commentId || null }
  } catch (err) {
    console.error('[tasker] Push failed (queued for retry):', err)
    return { ok: false, error: err.message }
  }
}

// ─── App lifecycle ─────────────────────────────────────────────────────────────

app.whenReady().then(async () => {
  // Distinct AppUserModelID so Windows groups the app under its own taskbar
  // icon instead of the generic electron.exe one.
  if (process.platform === 'win32') app.setAppUserModelId('com.tasker.jira')
  sections = loadSections()
  console.log(`[tasker] Loaded ${sections.length} section(s): ${sections.map(s => s.name).join(', ')}`)
  await flushQueue()
  createWindow()
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})

app.on('activate', () => {
  if (BrowserWindow.getAllWindows().length === 0) createWindow()
})
