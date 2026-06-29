const { buildComment, parseComment } = require('./commentUtils')

const MOCK_BASE = 'https://mock-jira.example.com/browse'

let mockIdCounter = 100
let staticUpdatedAt = new Date(Date.now() - 60000).toISOString()

const initialTasks = [
  {
    id: 'MOCK-1',
    type: 'main',
    parentId: null,
    subtasks: [
      { id: 'sub-0', title: 'Investigate token expiry edge case', text: '* Checked JWT lib — expiry comparison uses wrong timezone', dueDate: '2026-06-25', done: false, tags: ['backend'], recurring: null, subtasks: [] },
      { id: 'sub-1', title: 'Reproduce with QA steps', text: '* Steps confirmed on staging env', dueDate: '2026-06-18', done: true, tags: [], recurring: null, subtasks: [] },
    ],
    title: 'Fix authentication bug in production',
    text: '-- 19-06-2026 09:05\n\n* Reported by QA, repro steps attached',
    dueDate: '2026-06-22',
    done: false,
    tags: ['bug', 'urgent'],
    externalLink: `${MOCK_BASE}/MOCK-1`,
    recurring: null,
    connector: { type: 'mock', externalId: 'MOCK-1', commentId: 'comment-1', commentUpdatedAt: staticUpdatedAt },
  },
  {
    id: 'MOCK-2',
    type: 'main',
    parentId: null,
    subtasks: [],
    title: 'Refactor API client to use retry logic',
    text: '',
    dueDate: new Date().toISOString().slice(0, 10),
    done: false,
    tags: ['tech-debt'],
    externalLink: `${MOCK_BASE}/MOCK-2`,
    recurring: { enabled: true, unit: 'week', interval: 1, dayOfWeek: null },
    connector: { type: 'mock', externalId: 'MOCK-2', commentId: 'comment-2', commentUpdatedAt: staticUpdatedAt },
  },
  {
    id: 'MOCK-3',
    type: 'main',
    parentId: null,
    subtasks: [
      { id: 'sub-0', title: 'Write unit tests', text: '', dueDate: null, done: false, tags: [], recurring: null, subtasks: [] },
      { id: 'sub-1', title: 'Update documentation', text: '', dueDate: null, done: false, tags: [], recurring: null, subtasks: [] },
    ],
    title: 'Release v2.1.0',
    text: '-- 18-06-2026 10:00\n\n* Started release checklist',
    dueDate: '2026-06-20',
    done: false,
    tags: ['release'],
    externalLink: `${MOCK_BASE}/MOCK-3`,
    recurring: null,
    connector: { type: 'mock', externalId: 'MOCK-3', commentId: 'comment-3', commentUpdatedAt: staticUpdatedAt },
  },
]

// in-memory store — cloned from initial so we can mutate
let store = JSON.parse(JSON.stringify(initialTasks))

function deepClone(obj) {
  return JSON.parse(JSON.stringify(obj))
}

const mockConnector = {
  async testConnection() {
    await delay(300)
    return true
  },

  async fetchTasks() {
    await delay(400)
    return deepClone(store)
  },

  async createTask(title, dueDate) {
    await delay(500)
    const id = `MOCK-${++mockIdCounter}`
    const now = new Date().toISOString()
    const task = {
      id,
      type: 'main',
      parentId: null,
      subtasks: [],
      title,
      text: '',
      dueDate: dueDate || null,
      done: false,
      tags: [],
      externalLink: `${MOCK_BASE}/${id}`,
      recurring: null,
      connector: { type: 'mock', externalId: id, commentId: null, commentUpdatedAt: now },
    }
    store.push(task)
    return deepClone(task)
  },

  async getRemoteCommentMeta(task) {
    await delay(150)
    const found = store.find(t => t.id === task.id)
    if (!found) throw new Error(`Task ${task.id} not found`)
    return {
      updatedAt: found.connector.commentUpdatedAt || staticUpdatedAt,
      body: buildComment(found),
    }
  },

  async pushUpdate(task) {
    await delay(300)
    const idx = store.findIndex(t => t.id === task.id)
    const now = new Date().toISOString()
    if (idx >= 0) {
      store[idx] = { ...deepClone(task), connector: { ...task.connector, commentUpdatedAt: now } }
    } else {
      store.push({ ...deepClone(task), connector: { ...task.connector, commentUpdatedAt: now } })
    }
    return { updatedAt: now }
  },

  async fetchTransitions(_taskId) {
    return [
      { id: 'mock-todo',  name: 'To Do',       to: 'To Do' },
      { id: 'mock-prog',  name: 'In Progress', to: 'In Progress' },
      { id: 'mock-done',  name: 'Done',        to: 'Done' },
    ]
  },

  async transitionIssue(taskId, transitionId) {
    const map = { 'mock-todo': 'To Do', 'mock-prog': 'In Progress', 'mock-done': 'Done' }
    const status = map[transitionId] || ''
    const t = store.find(t => t.id === taskId)
    if (t) t.status = status
    return status
  },
}

function delay(ms) {
  return new Promise(r => setTimeout(r, ms))
}

// Dev helper: call from DevTools to simulate a remote conflict
// window.__taskerSimulateConflict = () => mockConnector.__bumpTimestamp('MOCK-1')
mockConnector.__bumpTimestamp = function(taskId) {
  const t = store.find(t => t.id === taskId)
  if (t) t.connector.commentUpdatedAt = new Date().toISOString()
}

module.exports = { mockConnector }
