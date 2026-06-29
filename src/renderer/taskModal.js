import { createModal } from './modal.js'
import { createEditor } from './editor.js'
import { createConflictModal } from './conflictModal.js'

const TODAY = new Date().toISOString().slice(0, 10)
const DAYS_SHORT = ['Su', 'Mo', 'Tu', 'We', 'Th', 'Fr', 'Sa']

export function createTaskModal({ onUpdate, onNavigateToParent, onOpenSubtask } = {}) {
  let task       = null  // the task (or subtask) currently shown
  let parentTask = null  // set when task is a subtask; used for push routing
  let editor     = null
  let pushTimer  = null
  let conflictModal = null

  // ── Outer shell ──────────────────────────────────────────────────────────
  const shell = document.createElement('div')
  shell.className = 'tk-task-detail'

  // ── Left meta panel ──────────────────────────────────────────────────────
  const meta = document.createElement('div')
  meta.className = 'tk-task-meta'

  // Parent link (shown when viewing a subtask)
  const parentLink = document.createElement('a')
  parentLink.className = 'tk-parent-link'
  parentLink.style.display = 'none'
  parentLink.innerHTML = '↑ <span class="tk-parent-title"></span>'
  parentLink.addEventListener('click', () => {
    if (parentTask) {
      modal.close()
      onNavigateToParent?.(parentTask.id)
    }
  })
  meta.appendChild(parentLink)

  // Due date
  const dueGroup = metaGroup('Due date')
  const dueInput = metaInput('date')
  dueGroup.appendChild(dueInput)
  meta.appendChild(dueGroup)

  // Jira status (main tasks only) — dropdown of available transitions
  const statusGroup = metaGroup('Status')
  const statusCurrent = document.createElement('div')
  statusCurrent.className = 'tk-meta-status-current'
  const statusSelect = document.createElement('select')
  statusSelect.className = 'tk-meta-input'
  statusGroup.append(statusCurrent, statusSelect)
  meta.appendChild(statusGroup)

  // Done toggle (subtasks only) — also reused by recurring advance logic
  const doneGroup = metaGroup('Done')
  const doneLabel = document.createElement('label')
  doneLabel.className = 'tk-recur-enable-row'
  const doneCheck = document.createElement('input')
  doneCheck.type = 'checkbox'
  doneCheck.id = 'tk-done-toggle'
  const doneText = document.createElement('span')
  doneText.textContent = 'Mark as done'
  doneLabel.append(doneCheck, doneText)
  doneGroup.appendChild(doneLabel)
  meta.appendChild(doneGroup)

  // Tags
  const tagsGroup = metaGroup('Tags')
  const tagList = document.createElement('div')
  tagList.className = 'tk-tag-list'
  const tagInput = document.createElement('input')
  tagInput.className = 'tk-meta-input'
  tagInput.placeholder = 'Add tag, press Enter'
  tagInput.style.marginTop = '4px'
  tagsGroup.append(tagList, tagInput)
  meta.appendChild(tagsGroup)

  // Recurring
  const recurGroup = metaGroup('Recurring')

  const recurEnableRow = document.createElement('div')
  recurEnableRow.className = 'tk-recur-enable-row'
  const recurCheck = document.createElement('input')
  recurCheck.type = 'checkbox'
  recurCheck.id = 'tk-recur-enabled'
  const recurLabel = document.createElement('label')
  recurLabel.htmlFor = 'tk-recur-enabled'
  recurLabel.textContent = 'Enabled'
  recurEnableRow.append(recurCheck, recurLabel)

  const recurRow = document.createElement('div')
  recurRow.className = 'tk-recurring-row'
  const recurUnitLabel = document.createElement('span')
  recurUnitLabel.className = 'tk-recur-prefix'
  recurUnitLabel.textContent = 'Every'
  const recurInterval = document.createElement('input')
  recurInterval.type = 'number'; recurInterval.min = '1'; recurInterval.value = '1'
  const recurUnit = document.createElement('select')
  for (const u of ['day', 'week', 'month']) {
    const o = document.createElement('option')
    o.value = u; o.textContent = u
    recurUnit.appendChild(o)
  }
  recurRow.append(recurUnitLabel, recurInterval, recurUnit)

  const dayPickerRow = document.createElement('div')
  dayPickerRow.className = 'tk-day-picker'
  const dayBtns = DAYS_SHORT.map((d, i) => {
    const btn = document.createElement('button')
    btn.type = 'button'
    btn.className = 'tk-day-btn'
    btn.textContent = d
    btn.dataset.day = String(i)
    dayPickerRow.appendChild(btn)
    return btn
  })

  recurGroup.append(recurEnableRow, recurRow, dayPickerRow)
  meta.appendChild(recurGroup)

  // Subtasks (hidden when viewing a subtask)
  const subGroup = metaGroup('Subtasks')
  const subList = document.createElement('div')
  subList.className = 'tk-subtask-list'
  const addSubBtn = document.createElement('button')
  addSubBtn.className = 'tk-btn'
  addSubBtn.style.cssText = 'margin-top:6px;width:100%;font-size:12px;'
  addSubBtn.textContent = '+ Add subtask'
  subGroup.append(subList, addSubBtn)
  meta.appendChild(subGroup)

  // ── Right editor panel ───────────────────────────────────────────────────
  const editorWrap = document.createElement('div')
  editorWrap.className = 'tk-task-editor-wrap'

  const editorToolbar = document.createElement('div')
  editorToolbar.className = 'tk-editor-toolbar'

  const entryBtn = document.createElement('button')
  entryBtn.className = 'tk-btn'
  entryBtn.textContent = '+ Entry'
  entryBtn.title = 'Prepend new log entry with current date/time'

  const syncDot = document.createElement('span')
  syncDot.className = 'tk-sync-dot'

  editorToolbar.append(entryBtn, syncDot)

  const cmWrap = document.createElement('div')
  cmWrap.className = 'tk-cm-wrap'

  editorWrap.append(editorToolbar, cmWrap)
  shell.append(meta, editorWrap)

  // ── Modal ────────────────────────────────────────────────────────────────
  const modal = createModal({
    size: 'large',
    title: '',
    content: shell,
    onClose: () => {
      clearTimeout(pushTimer)
      if (task) flushNow()
      if (editor) { editor.destroy(); editor = null }
    },
  })

  modal.body.style.padding = '0'
  modal.body.style.overflow = 'hidden'
  modal.body.style.height = 'calc(100% - 56px)'
  shell.style.height = '100%'

  // ── Title in modal head ──────────────────────────────────────────────────
  // titleLink: shown for main tasks — click opens externalLink
  const titleLink = document.createElement('button')
  titleLink.className = 'tk-modal-title-link'
  titleLink.title = 'Open in Jira'

  // titleInput: shown for subtasks (always) or main tasks in edit mode
  const titleInput = document.createElement('input')
  titleInput.className = 'tk-modal-title-input'
  titleInput.placeholder = 'Task title…'

  // pencil button to enter edit mode on main tasks
  const titleEditBtn = document.createElement('button')
  titleEditBtn.className = 'tk-title-edit-btn'
  titleEditBtn.textContent = '✎'
  titleEditBtn.title = 'Edit title'

  const titleWrap = document.createElement('div')
  titleWrap.className = 'tk-modal-title-wrap'
  titleWrap.append(titleLink, titleInput, titleEditBtn)

  modal.card.querySelector('.tk-modal-head h2').replaceWith(titleWrap)
  modal.card.querySelector('.tk-modal-head').append(modal.card.querySelector('.tk-modal-close'))

  titleLink.addEventListener('click', () => {
    if (task?.externalLink) window.taskerAPI.openExternal(task.externalLink)
  })

  titleEditBtn.addEventListener('click', () => enterTitleEdit())

  titleInput.addEventListener('input', () => {
    if (!task) return
    task.title = titleInput.value
    schedulePush()
  })
  titleInput.addEventListener('blur', () => {
    if (!task) return
    task.title = titleInput.value
    if (task.externalLink && !parentTask) exitTitleEdit()
    else flushNow()
  })
  titleInput.addEventListener('keydown', e => {
    if (e.key === 'Escape' || e.key === 'Enter') titleInput.blur()
  })

  function enterTitleEdit() {
    titleLink.style.display = 'none'
    titleEditBtn.style.display = 'none'
    titleInput.style.display = ''
    titleInput.focus()
    titleInput.select()
  }

  function exitTitleEdit() {
    titleLink.textContent = task?.title || ''
    titleLink.style.display = ''
    titleEditBtn.style.display = ''
    titleInput.style.display = 'none'
    flushNow()
  }

  function updateTitleDisplay(t) {
    titleInput.value = t.title || ''
    titleLink.textContent = t.title || ''
    if (t.externalLink && !parentTask) {
      // main task with a Jira link — show as clickable
      titleLink.style.display = ''
      titleEditBtn.style.display = ''
      titleInput.style.display = 'none'
    } else {
      // subtask or no link — always show editable input
      titleLink.style.display = 'none'
      titleEditBtn.style.display = 'none'
      titleInput.style.display = ''
    }
  }

  // ── Wire events ──────────────────────────────────────────────────────────

  dueInput.addEventListener('change', () => {
    if (!task) return
    task.dueDate = dueInput.value || null
    schedulePush()
    notifyUpdate()
  })

  statusSelect.addEventListener('change', async () => {
    if (!task || parentTask) return
    const transitionId = statusSelect.value
    if (!transitionId) return
    setSyncDot('saving')
    try {
      const res = await window.taskerAPI.transitionIssue(task.id, transitionId)
      if (res?.ok) {
        task.status = res.status || task.status
        statusCurrent.textContent = task.status || ''
      } else {
        console.error('[taskModal] transition failed:', res?.error)
      }
      // Restore "(change status…)" placeholder
      statusSelect.value = ''
      setSyncDot('')
      notifyUpdate()
    } catch (err) {
      console.error('[taskModal] transition error:', err)
      setSyncDot('error')
    }
  })

  doneCheck.addEventListener('change', () => {
    if (!task) return
    task.done = doneCheck.checked
    schedulePush()
    notifyUpdate()
  })

  tagInput.addEventListener('keydown', e => {
    if (e.key === 'Enter' && tagInput.value.trim()) {
      e.preventDefault()
      const t = tagInput.value.trim()
      if (!task.tags.includes(t)) {
        task.tags.push(t)
        renderTags()
        schedulePush()
      }
      tagInput.value = ''
    }
  })

  recurCheck.addEventListener('change', () => {
    if (!task) return
    if (!task.recurring) task.recurring = { enabled: false, unit: 'week', interval: 1, dayOfWeek: null }
    task.recurring.enabled = recurCheck.checked
    updateRecurUI()
    schedulePush()
  })

  recurUnit.addEventListener('change', () => {
    if (!task?.recurring) return
    task.recurring.unit = recurUnit.value
    updateRecurUI()
    schedulePush()
  })

  recurInterval.addEventListener('change', () => {
    if (!task?.recurring) return
    task.recurring.interval = parseInt(recurInterval.value, 10) || 1
    schedulePush()
  })

  dayBtns.forEach((btn, i) => {
    btn.addEventListener('click', () => {
      if (!task?.recurring) return
      task.recurring.dayOfWeek = (task.recurring.dayOfWeek === i) ? null : i
      updateDayBtns()
      schedulePush()
    })
  })

  addSubBtn.addEventListener('click', () => {
    if (!task) return
    showAddSubtaskInput()
  })

  entryBtn.addEventListener('click', () => {
    editor?.prependEntry()
  })

  // ── Push logic ───────────────────────────────────────────────────────────

  function schedulePush() {
    clearTimeout(pushTimer)
    setSyncDot('saving')
    pushTimer = setTimeout(() => doPush(task), 2500)
  }

  function flushNow() {
    clearTimeout(pushTimer)
    if (task) doPush(task)
  }

  // Returns the task to push (parent if viewing a subtask) and updates parent state.
  function buildPushTarget(t) {
    if (!parentTask) return t
    const p = JSON.parse(JSON.stringify(parentTask))
    const idx = p.subtasks.findIndex(s => s.id === t.id)
    if (idx >= 0) p.subtasks[idx] = t
    else p.subtasks.push(t)
    return p
  }

  async function doPush(t) {
    if (!t) return
    setSyncDot('saving')
    const pushTarget = buildPushTarget(t)
    try {
      const res = await window.taskerAPI.pushUpdate(pushTarget)
      if (res?.conflict) {
        setSyncDot('error')
        showConflict(t, res.conflict)
        return
      }
      if (!res?.ok) throw new Error(res?.error || 'Unknown error')
      if (res.updatedAt && pushTarget.connector) {
        pushTarget.connector.commentUpdatedAt = res.updatedAt
        if (parentTask) parentTask.connector.commentUpdatedAt = res.updatedAt
      }
      if (res.commentId && pushTarget.connector) {
        pushTarget.connector.commentId = res.commentId
        if (parentTask) parentTask.connector.commentId = res.commentId
        if (task?.connector && !parentTask) task.connector.commentId = res.commentId
      }
      setSyncDot('')
      if (parentTask) {
        // keep parentTask's subtasks in sync
        const idx = parentTask.subtasks.findIndex(s => s.id === t.id)
        if (idx >= 0) parentTask.subtasks[idx] = t
      }
      notifyUpdate()
    } catch (err) {
      setSyncDot('error')
      console.error('[taskModal] Push failed:', err)
    }
  }

  function setSyncDot(state) {
    syncDot.className = 'tk-sync-dot' + (state ? ` is-${state}` : '')
    syncDot.textContent = state === 'saving' ? '● Saving…' : state === 'error' ? '● Sync error' : ''
  }

  // Notify app.js with the right thing: parent when pushing a subtask.
  function notifyUpdate() {
    if (parentTask) {
      const p = JSON.parse(JSON.stringify(parentTask))
      const idx = p.subtasks.findIndex(s => s.id === task?.id)
      if (idx >= 0 && task) p.subtasks[idx] = task
      onUpdate?.(p)
    } else {
      onUpdate?.(task)
    }
  }

  // ── Conflict modal ───────────────────────────────────────────────────────

  async function showConflict(t, conflict) {
    if (!conflictModal) conflictModal = createConflictModal()
    const choice = await conflictModal.show(conflict)
    if (choice === 'keep-mine') {
      const pushTarget = buildPushTarget(t)
      const res = await window.taskerAPI.pushUpdateForce(pushTarget)
      if (res?.updatedAt && pushTarget.connector) {
        pushTarget.connector.commentUpdatedAt = res.updatedAt
        if (parentTask) parentTask.connector.commentUpdatedAt = res.updatedAt
      }
      if (res?.commentId && pushTarget.connector) {
        pushTarget.connector.commentId = res.commentId
        if (parentTask) parentTask.connector.commentId = res.commentId
        if (task?.connector && !parentTask) task.connector.commentId = res.commentId
      }
      setSyncDot('')
      notifyUpdate()
    } else if (choice === 'use-theirs') {
      const reloadId = parentTask ? parentTask.id : t.id
      const fresh = await window.taskerAPI.reloadTask(reloadId)
      if (fresh) {
        if (parentTask) {
          parentTask = fresh
          const freshSub = fresh.subtasks?.find(s => s.id === t.id)
          if (freshSub) { Object.assign(task, freshSub); populateFields(task) }
        } else {
          Object.assign(task, fresh)
          populateFields(task)
        }
        setSyncDot('')
        notifyUpdate()
      }
    }
  }

  // ── Render helpers ───────────────────────────────────────────────────────

  function updateDayBtns() {
    const day = task?.recurring?.dayOfWeek ?? null
    dayBtns.forEach((btn, i) => btn.classList.toggle('is-active', day === i))
  }

  function updateRecurUI() {
    const enabled = recurCheck.checked
    recurRow.style.display = enabled ? 'flex' : 'none'
    dayPickerRow.style.display = (enabled && recurUnit.value === 'week') ? 'flex' : 'none'
    updateDayBtns()
  }

  function renderTags() {
    tagList.innerHTML = ''
    for (const tag of (task?.tags || [])) {
      const chip = document.createElement('span')
      chip.className = 'tk-tag'
      const label = document.createElement('span')
      label.textContent = tag
      const rm = document.createElement('span')
      rm.className = 'tk-tag-rm'; rm.textContent = '×'
      rm.addEventListener('click', () => {
        task.tags = task.tags.filter(t => t !== tag)
        renderTags()
        schedulePush()
      })
      chip.append(label, rm)
      tagList.appendChild(chip)
    }
  }

  function buildSubRow(sub) {
    const row = document.createElement('div')
    row.className = 'tk-subtask-item'
    row.dataset.subId = sub.id

    const titleEl = document.createElement('span')
    titleEl.className = 'tk-subtask-title-text' + (sub.done ? ' is-done' : '')
    titleEl.textContent = sub.title || '(untitled)'

    const badges = document.createElement('div')
    badges.className = 'tk-subtask-badges'
    if (sub.dueDate) {
      const chip = document.createElement('span')
      chip.className = 'tk-subtask-chip'
      chip.textContent = formatDate(sub.dueDate)
      if (sub.dueDate === TODAY) chip.classList.add('is-today')
      else if (sub.dueDate < TODAY) chip.classList.add('is-overdue')
      badges.appendChild(chip)
    }
    if (sub.tags?.length) {
      const tc = document.createElement('span')
      tc.className = 'tk-subtask-chip'
      tc.textContent = sub.tags[0] + (sub.tags.length > 1 ? ` +${sub.tags.length - 1}` : '')
      badges.appendChild(tc)
    }

    const rmBtn = document.createElement('button')
    rmBtn.className = 'tk-subtask-rm'
    rmBtn.textContent = '×'
    rmBtn.addEventListener('click', e => {
      e.stopPropagation()
      task.subtasks = task.subtasks.filter(s => s.id !== sub.id)
      row.remove()
      schedulePush()
      notifyUpdate()
    })

    row.append(titleEl, badges, rmBtn)
    row.style.cursor = 'pointer'

    // Click opens the subtask in the full task modal (closes current first)
    row.addEventListener('click', e => {
      if (e.target === rmBtn) return
      modal.close()
      onOpenSubtask?.(sub, task)
    })

    return row
  }

  function showAddSubtaskInput() {
    if (subList.querySelector('.is-adding')) return

    const row = document.createElement('div')
    row.className = 'tk-subtask-item is-adding'

    const input = document.createElement('input')
    input.className = 'tk-subtask-add-input'
    input.placeholder = 'Subtask name, then Enter…'

    let submitted = false
    const done = () => {
      if (submitted) return
      submitted = true
      const title = input.value.trim()
      row.remove()
      if (title) {
        const sub = {
          id: `sub-${Date.now()}`,
          title, text: '', dueDate: null,
          done: false, tags: [], recurring: null, subtasks: [],
        }
        task.subtasks.push(sub)
        renderSubtasks()
        schedulePush()
        notifyUpdate()
        // Open the new subtask immediately (closes this modal, pushes parent first)
        modal.close()
        onOpenSubtask?.(sub, task)
      }
    }
    const cancel = () => {
      if (submitted) return
      submitted = true
      row.remove()
    }

    input.addEventListener('keydown', e => {
      if (e.key === 'Enter') { e.preventDefault(); done() }
      if (e.key === 'Escape') cancel()
    })
    input.addEventListener('blur', () => done())

    row.appendChild(input)
    subList.appendChild(row)
    input.focus()
  }

  function renderSubtasks() {
    subList.innerHTML = ''
    for (const sub of (task?.subtasks || [])) {
      subList.appendChild(buildSubRow(sub))
    }
  }

  async function loadTransitions(taskId) {
    statusSelect.innerHTML = ''
    const placeholder = document.createElement('option')
    placeholder.value = ''
    placeholder.textContent = '(change status…)'
    statusSelect.appendChild(placeholder)
    try {
      const transitions = await window.taskerAPI.fetchTransitions(taskId)
      for (const tr of transitions) {
        const o = document.createElement('option')
        o.value = tr.id
        o.textContent = tr.to ? `→ ${tr.to}` : tr.name
        statusSelect.appendChild(o)
      }
    } catch (err) {
      console.error('[taskModal] fetchTransitions failed:', err)
    }
  }

  function populateFields(t) {
    updateTitleDisplay(t)
    dueInput.value = t.dueDate || ''

    // Status dropdown for main tasks; done toggle for subtasks. Mutually exclusive.
    if (parentTask) {
      statusGroup.style.display = 'none'
      doneGroup.style.display = ''
      doneCheck.checked = !!t.done
    } else {
      statusGroup.style.display = ''
      doneGroup.style.display = 'none'
      statusCurrent.textContent = t.status || ''
      loadTransitions(t.id)
    }

    const r = t.recurring
    recurCheck.checked = r?.enabled || false
    recurUnit.value    = r?.unit    || 'week'
    recurInterval.value = String(r?.interval || 1)
    updateRecurUI()

    renderTags()

    // Show/hide subtasks section and parent link based on whether we're in a subtask
    if (parentTask) {
      parentLink.style.display = 'inline-flex'
      parentLink.querySelector('.tk-parent-title').textContent = parentTask.title
      subGroup.style.display = 'none'
    } else {
      parentLink.style.display = 'none'
      subGroup.style.display = ''
      renderSubtasks()
    }

    // (Re-)create editor
    if (editor) { editor.destroy(); editor = null }
    cmWrap.innerHTML = ''
    editor = createEditor({ parent: cmWrap, initialValue: t.text || '' })

    let inputTimer = null
    editor.addEventListener('input', () => {
      if (!task) return
      clearTimeout(inputTimer)
      inputTimer = setTimeout(() => { task.text = editor.value; schedulePush() }, 800)
    })
    editor.addEventListener('blur', () => {
      if (!task) return
      clearTimeout(inputTimer)
      task.text = editor.value
      flushNow()
    })
  }

  // ── Public API ───────────────────────────────────────────────────────────

  return {
    /**
     * open(t, parent?)
     * When parent is set, t is treated as a subtask of parent.
     * Push is routed through the parent task.
     */
    open(t, parent = null) {
      task       = JSON.parse(JSON.stringify(t))
      parentTask = parent ? JSON.parse(JSON.stringify(parent)) : null
      clearTimeout(pushTimer)
      setSyncDot('')
      populateFields(task)
      modal.open()
      if (parent) titleInput.focus()  // subtasks start in edit mode
      else editor?.focus()
    },

    close: () => modal.close(),

    /** Refresh from external update (e.g. sync). Pass the main task — finds subtask if needed. */
    refresh(t) {
      if (!task) return
      if (parentTask && t.id === parentTask.id) {
        parentTask = JSON.parse(JSON.stringify(t))
        const freshSub = t.subtasks?.find(s => s.id === task.id)
        if (freshSub) { task = JSON.parse(JSON.stringify(freshSub)); populateFields(task) }
      } else if (!parentTask && t.id === task.id) {
        task = JSON.parse(JSON.stringify(t))
        populateFields(task)
      }
    },

    updateSubtask(sub) {
      if (!task || parentTask) return
      const idx = task.subtasks?.findIndex(s => s.id === sub.id)
      if (idx >= 0) { task.subtasks[idx] = sub; renderSubtasks() }
    },
  }
}

// ── Helpers ────────────────────────────────────────────────────────────────────

function metaGroup(label) {
  const g = document.createElement('div')
  g.className = 'tk-meta-group'
  const l = document.createElement('div')
  l.className = 'tk-meta-label'
  l.textContent = label
  g.appendChild(l)
  return g
}

function metaInput(type = 'text') {
  const i = document.createElement('input')
  i.type = type
  i.className = 'tk-meta-input'
  return i
}

function formatDate(iso) {
  const [y, m, d] = iso.split('-')
  return `${d}/${m}/${y.slice(2)}`
}
