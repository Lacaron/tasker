import { createTitlebar }      from './titlebar.js'
import { createTaskList }      from './taskList.js'
import { createTaskModal }     from './taskModal.js'
import { createSettingsModal } from './settingsModal.js'

// ── State ─────────────────────────────────────────────────────────────────────
let sections = []   // [{ id, name, canCreate, tasks }]
let activeSectionId = null
let selectedTaskId = null

// ── DOM refs ──────────────────────────────────────────────────────────────────
const appEl       = document.getElementById('app')
const toastArea   = document.getElementById('toast-area')
const statusSync  = document.getElementById('status-sync')
const statusCount = document.getElementById('status-count')
const tabsEl      = document.getElementById('section-tabs')

// ── Titlebar ──────────────────────────────────────────────────────────────────
const titlebarEl = createTitlebar()
appEl.prepend(titlebarEl)

// ── Task modal ────────────────────────────────────────────────────────────────
const taskModal = createTaskModal({
  onUpdate(updated) {
    // updated may be a main task or a parent task (when a subtask was edited)
    for (const section of sections) {
      const idx = section.tasks.findIndex(t => t.id === updated.id)
      if (idx >= 0) { section.tasks[idx] = updated; break }
    }
    taskList.updateTask(updated)
  },
  onNavigateToParent(parentId) {
    const parent = findTask(parentId)
    if (parent) {
      selectedTaskId = parentId
      taskList.setSelected(parentId)
      taskModal.open(parent)
    }
  },
  // Called when user clicks a subtask row inside the task modal.
  // The task modal already closes itself before calling this.
  onOpenSubtask(sub, parentTaskSnapshot) {
    // parentTaskSnapshot is the task's current in-memory state at the moment of click.
    // Re-fetch from tasks[] to get the latest version (in case it was updated elsewhere).
    const parent = findTask(parentTaskSnapshot.id) || parentTaskSnapshot
    taskModal.open(sub, parent)
  },
})

// ── Task list ─────────────────────────────────────────────────────────────────
const taskList = createTaskList({
  onSelect(id) {
    selectedTaskId = id
    taskList.setSelected(id)
    const t = findTask(id)
    if (t) taskModal.open(t)
  },
  onSelectSub(parentId, subId) {
    const parent = findTask(parentId)
    const sub    = parent?.subtasks?.find(s => s.id === subId)
    if (sub && parent) taskModal.open(sub, parent)
  },
  onCreate(sectionId, title) {
    createTaskInSection(sectionId, title)
  },
})

document.getElementById('task-list-wrap').replaceWith(taskList.el)

// ── Settings modal ────────────────────────────────────────────────────────────
const settingsModal = createSettingsModal()

window.taskerAPI.onSyncStatus(data => {
  if (data.type === 'success' && data.sections) {
    setSections(data.sections)
    setSyncStatus('success', `Synced ${nowTime()}`)
    toast('Synced')
    if (selectedTaskId) {
      const fresh = findTask(selectedTaskId)
      if (fresh) taskModal.refresh(fresh)
    }
  } else if (data.type === 'error') {
    setSyncStatus('error', 'Sync failed')
    toast(data.error, true)
  }
})

// ── Toolbar wiring ────────────────────────────────────────────────────────────
const searchInput = document.getElementById('search-input')
searchInput.addEventListener('input', () => taskList.setSearch(searchInput.value))

const syncBtn = document.getElementById('sync-btn')
syncBtn.addEventListener('click', async () => {
  if (syncBtn.classList.contains('is-spinning')) return
  syncBtn.classList.add('is-spinning')
  setSyncStatus('syncing', 'Syncing…')
  try {
    const res = await window.taskerAPI.syncNow()
    // Success path (tasks + status + toast) is handled by onSyncStatus.
    if (res && res.ok === false) setSyncStatus('error', 'Sync failed')
  } catch (err) {
    setSyncStatus('error', 'Sync failed')
    toast(err.message || 'Sync failed', true)
  } finally {
    syncBtn.classList.remove('is-spinning')
  }
})

const settingsBtn = document.getElementById('settings-btn')
settingsBtn.addEventListener('click', () => settingsModal.open())

// ── Add-task (per section) ──────────────────────────────────────────────────────
async function createTaskInSection(sectionId, title) {
  const tempId   = `creating-${Date.now()}`
  const tempTask = { id: tempId, type: 'main', title, subtasks: [], dueDate: null, done: false }
  taskList.addCreatingRow(sectionId, tempTask)

  try {
    const created = await window.taskerAPI.createTask(sectionId, title, null)
    taskList.removeRow(tempId)
    const section = sections.find(s => s.id === sectionId) || sections[0]
    if (section) section.tasks.push(created)
    setSections(sections)
    toast('Task created')
    selectedTaskId = created.id
    taskList.setSelected(created.id)
    taskModal.open(created)
  } catch (err) {
    taskList.removeRow(tempId)
    toast(err.message || 'Failed to create task', true)
  }
}

// ── Status bar ──────────────────────────────────────────────────────────────────
function nowTime() {
  const d = new Date()
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`
}

// state: 'idle' | 'syncing' | 'success' | 'error'
function setSyncStatus(state, text) {
  statusSync.innerHTML = ''
  const dot = document.createElement('span')
  dot.className = 'tk-status-dot' + (state === 'idle' ? '' : ` is-${state}`)
  const label = document.createElement('span')
  label.textContent = text
  statusSync.append(dot, label)
}

function allTasks() {
  return sections.flatMap(s => s.tasks)
}

function updateCounts() {
  const all = allTasks()
  const issues = all.length
  const ghosts = all.reduce((n, t) => n + (t.subtasks?.length || 0), 0)
  statusCount.textContent =
    `${issues} issue${issues === 1 ? '' : 's'} · ${ghosts} 👻`
}

// Tab bar: one tab per section; hidden when there is only one section.
function renderTabs() {
  tabsEl.innerHTML = ''
  if (sections.length <= 1) { tabsEl.style.display = 'none'; return }
  tabsEl.style.display = ''
  for (const s of sections) {
    const btn = document.createElement('button')
    btn.className = 'tk-tab' + (s.id === activeSectionId ? ' is-active' : '')
    btn.dataset.sectionId = s.id

    const name = document.createElement('span')
    name.className = 'tk-tab-name'
    name.textContent = s.name

    const count = document.createElement('span')
    count.className = 'tk-tab-count'
    count.textContent = s.tasks.length

    btn.append(name, count)
    btn.addEventListener('click', () => setActiveSection(s.id))
    tabsEl.appendChild(btn)
  }
}

function setActiveSection(id) {
  activeSectionId = id
  taskList.setActive(id)
  renderTabs()
}

// Single entry point for refreshing the list + tabs + counts from a sections payload.
function setSections(newSections) {
  sections = Array.isArray(newSections) ? newSections : []
  if (!sections.some(s => s.id === activeSectionId)) activeSectionId = sections[0]?.id || null
  taskList.setSections(sections)
  taskList.setActive(activeSectionId)
  renderTabs()
  updateCounts()
}

setSyncStatus('idle', 'Not synced yet')
updateCounts()

// ── Boot ──────────────────────────────────────────────────────────────────────
async function boot() {
  try {
    const data = await window.taskerAPI.fetchTasks()
    setSections(data.sections || [])
    setSyncStatus('success', `Loaded ${nowTime()}`)
  } catch (err) {
    setSyncStatus('error', 'Load failed')
    toast(`Failed to load tasks: ${err.message}`, true)
  }
}

boot()

// ── Recurring advancement ─────────────────────────────────────────────────────
function advanceRecurring(t) {
  const r = t.recurring
  if (!r?.enabled || !t.dueDate) return
  const d = new Date(t.dueDate + 'T00:00:00')
  if (r.unit === 'day') {
    d.setDate(d.getDate() + r.interval)
  } else if (r.unit === 'week') {
    d.setDate(d.getDate() + r.interval * 7)
    if (r.dayOfWeek != null) {
      const diff = (r.dayOfWeek - d.getDay() + 7) % 7
      d.setDate(d.getDate() + diff)
    }
  } else if (r.unit === 'month') {
    d.setMonth(d.getMonth() + r.interval)
  }
  t.dueDate = d.toISOString().slice(0, 10)
  t.done = false
}

// ── Helpers ───────────────────────────────────────────────────────────────────
function findTask(id) {
  return allTasks().find(t => t.id === id) || null
}

function toast(msg, isError = false) {
  const el = document.createElement('div')
  el.className = 'tk-toast' + (isError ? ' is-error' : '')
  el.textContent = msg
  toastArea.appendChild(el)
  requestAnimationFrame(() => {
    el.classList.add('is-visible')
    setTimeout(() => {
      el.classList.remove('is-visible')
      setTimeout(() => el.remove(), 250)
    }, 2800)
  })
}
