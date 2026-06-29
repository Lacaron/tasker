const { contextBridge, ipcRenderer } = require('electron')

contextBridge.exposeInMainWorld('taskerAPI', {
  // Window controls
  minimize:  ()             => ipcRenderer.send('window-minimize'),
  close:     ()             => ipcRenderer.send('window-close'),
  pin:       (pin)          => ipcRenderer.invoke('window-pin', pin),

  // Config & connectivity
  getConfig:       ()       => ipcRenderer.invoke('get-config'),
  testConnection:  ()       => ipcRenderer.invoke('test-connection'),

  // Task CRUD
  fetchTasks:      ()       => ipcRenderer.invoke('fetch-tasks'),
  createTask:      (sectionId, title, dueDate) => ipcRenderer.invoke('create-task', sectionId, title, dueDate),
  pushUpdate:      (task)   => ipcRenderer.invoke('push-update', task),
  pushUpdateForce: (task)   => ipcRenderer.invoke('push-update-force', task),
  reloadTask:      (taskId) => ipcRenderer.invoke('reload-task', taskId),
  syncNow:         ()       => ipcRenderer.invoke('sync-now'),

  // Conflict-check (used directly by renderer before force-push decision)
  getRemoteCommentMeta: (task) => ipcRenderer.invoke('get-remote-comment-meta', task),

  // Jira workflow
  fetchTransitions: (taskId)                  => ipcRenderer.invoke('fetch-transitions', taskId),
  transitionIssue:  (taskId, transitionId)    => ipcRenderer.invoke('transition-issue',  taskId, transitionId),

  // Shell
  openExternal: (url) => ipcRenderer.invoke('open-external', url),

  // Event subscriptions (renderer → main events)
  onSyncStatus: (cb) => {
    ipcRenderer.on('sync-status', (_e, data) => cb(data))
  },
})
