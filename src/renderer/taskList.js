const TODAY = new Date().toISOString().slice(0, 10)

export function createTaskList({ onSelect, onSelectSub, onCreate } = {}) {
  const wrap = document.createElement('div')
  wrap.id = 'task-list-wrap'

  let sections = []   // [{ id, name, canCreate, tasks }]
  let activeId = null // which section is currently shown (tab)
  let selectedId = null
  let searchQuery = ''

  function dateChip(dueDate) {
    if (!dueDate) return null
    const chip = document.createElement('span')
    chip.className = 'tk-chip is-date'
    chip.textContent = formatDate(dueDate)
    if (dueDate === TODAY) chip.classList.add('is-today')
    else if (dueDate < TODAY) chip.classList.add('is-overdue')
    return chip
  }

  function tagChips(tags) {
    return (tags || []).map(tag => {
      const chip = document.createElement('span')
      chip.className = 'tk-chip is-tag'
      chip.textContent = tag
      return chip
    })
  }

  function recurChip(task) {
    if (!task.recurring?.enabled) return null
    const r = task.recurring
    const unitChar = { day: 'd', week: 'w', month: 'm' }[r.unit] || r.unit
    const chip = document.createElement('span')
    chip.className = 'tk-chip is-recur'
    chip.textContent = `↻ ${r.interval}${unitChar}`
    return chip
  }

  function subCountChip(task) {
    if (!task.subtasks?.length) return null
    const total = task.subtasks.length
    const done  = task.subtasks.filter(s => s.done).length
    const chip = document.createElement('span')
    chip.className = 'tk-chip is-sub-count'
    chip.textContent = `${done}/${total} 👻`
    return chip
  }

  function colGhost(text = '') {
    const el = document.createElement('div')
    el.className = 'tk-col-ghost'
    if (text) el.textContent = text
    return el
  }

  function colTags(tags) {
    const el = document.createElement('div')
    el.className = 'tk-col-tags'
    tagChips(tags).forEach(c => el.appendChild(c))
    return el
  }

  function colRecur(task) {
    const el = document.createElement('div')
    el.className = 'tk-col-recur'
    const c = recurChip(task)
    if (c) el.appendChild(c)
    return el
  }

  function colDate(dueDate) {
    const el = document.createElement('div')
    el.className = 'tk-col-date'
    const c = dateChip(dueDate)
    if (c) el.appendChild(c)
    return el
  }

  function colCount(task) {
    const el = document.createElement('div')
    el.className = 'tk-col-count'
    const c = subCountChip(task)
    if (c) el.appendChild(c)
    return el
  }

  // Status column — only added to rows when the section opts in via showStatus.
  // Subtasks have no Jira status, so their cell stays empty (keeps columns aligned).
  function colStatus(task) {
    const el = document.createElement('div')
    el.className = 'tk-col-status'
    if (task.status) {
      const chip = document.createElement('span')
      chip.className = 'tk-chip is-status'
      chip.textContent = task.status
      chip.title = task.status
      el.appendChild(chip)
    }
    return el
  }

  function buildRow(task, isCreating = false, showStatus = false) {
    const row = document.createElement('div')
    row.className = 'tk-task-row' + (isCreating ? ' is-creating' : '')
    row.dataset.id = task.id

    const title = document.createElement('span')
    title.className = 'tk-task-title' + (task.done ? ' is-done' : '')
    title.textContent = isCreating ? `Creating "${task.title}"…` : task.title

    row.append(colGhost(), title)
    if (showStatus) row.appendChild(colStatus(task))
    row.append(colTags(task.tags), colRecur(task), colDate(task.dueDate), colCount(task))
    row.addEventListener('click', () => {
      if (!isCreating) onSelect?.(task.id)
    })

    return row
  }

  function buildSubtaskRow(sub, parent, showStatus = false) {
    const row = document.createElement('div')
    row.className = 'tk-task-row is-sub-row'
    row.dataset.subId = sub.id
    row.dataset.parentId = parent.id

    const ghost = colGhost('👻')

    const titleStack = document.createElement('div')
    titleStack.className = 'tk-task-title-stack'

    const parentLabel = document.createElement('div')
    parentLabel.className = 'tk-task-parent-label'
    parentLabel.textContent = parent.title

    const subTitle = document.createElement('div')
    subTitle.className = 'tk-task-title' + (sub.done ? ' is-done' : '')
    subTitle.textContent = sub.title

    titleStack.append(parentLabel, subTitle)

    row.append(ghost, titleStack)
    if (showStatus) row.appendChild(colStatus(sub))
    row.append(colTags(sub.tags), colRecur(sub), colDate(sub.dueDate), colCount({ subtasks: [] }))
    row.addEventListener('click', () => {
      onSelectSub?.(parent.id, sub.id)
    })

    return row
  }

  // Lower-case and strip diacritics so "peche" matches "pêche", "ete" matches "été", etc.
  function normalize(str) {
    return (str || '')
      .toLowerCase()
      .normalize('NFD')
      .replace(/[̀-ͯ]/g, '') // strip combining diacritical marks
  }

  function matchesTags(tags, q) {
    return (tags || []).some(tag => normalize(tag).includes(q))
  }

  function filterTasks(tasks) {
    const q = normalize(searchQuery)
    if (!q) return tasks
    return tasks.filter(t => {
      if (normalize(t.title).includes(q)) return true
      if (matchesTags(t.tags, q)) return true
      if (t.subtasks?.some(s => normalize(s.title).includes(q) || matchesTags(s.tags, q))) return true
      return false
    })
  }

  function dateCmp(da, db) {
    if (!da && !db) return 0
    if (!da) return 1
    if (!db) return -1
    return da.localeCompare(db)
  }

  // Flatten a section's tasks into display items (main rows + undone subtask rows).
  // When statusOrder (from the section config) is provided, main tasks are grouped
  // in that exact order (statuses not listed go last) and sorted by due date within
  // each group; subtasks follow their parent. Otherwise everything is sorted flat by
  // due date. The status ordering is fully driven by config — no status names here.
  function buildItems(tasks, statusOrder) {
    const mains = tasks.filter(t => t.type === 'main')

    if (Array.isArray(statusOrder) && statusOrder.length) {
      const norm = s => (s || '').toLowerCase()
      const order = statusOrder.map(norm)
      const rank = s => {
        const i = order.indexOf(norm(s))
        return i < 0 ? order.length : i
      }
      mains.sort((a, b) => (rank(a.status) - rank(b.status)) || dateCmp(a.dueDate, b.dueDate))

      const items = []
      for (const main of mains) {
        items.push({ kind: 'main', task: main })
        const subs = (main.subtasks || []).filter(s => s.title && !s.done).sort((x, y) => dateCmp(x.dueDate, y.dueDate))
        for (const sub of subs) items.push({ kind: 'sub', task: sub, parent: main })
      }
      return items
    }

    const items = []
    for (const main of mains) {
      items.push({ kind: 'main', task: main })
      for (const sub of (main.subtasks || [])) {
        if (!sub.title || sub.done) continue
        items.push({ kind: 'sub', task: sub, parent: main })
      }
    }
    items.sort((a, b) => dateCmp(a.task.dueDate, b.task.dueDate))
    return items
  }

  function buildAddRow(section) {
    const row = document.createElement('div')
    row.className = 'tk-section-add'

    const input = document.createElement('input')
    input.type = 'text'
    input.className = 'tk-section-add-input'
    input.placeholder = `＋  New task in ${section.name} — press Enter`
    input.autocomplete = 'off'
    input.addEventListener('keydown', e => {
      if (e.key !== 'Enter') return
      const title = input.value.trim()
      if (!title) return
      input.value = ''
      onCreate?.(section.id, title)
    })

    row.appendChild(input)
    return row
  }

  function activeSection() {
    return sections.find(s => s.id === activeId) || sections[0] || null
  }

  // Only the active section (selected via its tab) is rendered.
  function render() {
    wrap.innerHTML = ''

    const section = activeSection()
    if (!section) {
      const empty = document.createElement('div')
      empty.style.cssText = 'padding:24px 12px;color:var(--tk-text-dim);font-size:13px;text-align:center'
      empty.textContent = 'No sections configured.'
      wrap.appendChild(empty)
      return
    }

    const showStatus = !!section.showStatus
    const block = document.createElement('div')
    block.className = 'tk-section' + (showStatus ? ' tk-show-status' : '')
    block.dataset.sectionId = section.id

    // Grouping order comes entirely from the section's statusOrder config (if any).
    const items = buildItems(filterTasks(section.tasks), section.statusOrder)

    if (section.canCreate) block.appendChild(buildAddRow(section))

    if (items.length === 0) {
      const empty = document.createElement('div')
      empty.className = 'tk-section-empty'
      empty.textContent = searchQuery ? 'No tasks match your search.' : 'No tasks.'
      block.appendChild(empty)
    } else {
      for (const item of items) {
        if (item.kind === 'main') {
          const row = buildRow(item.task, false, showStatus)
          if (item.task.id === selectedId) row.classList.add('is-selected')
          block.appendChild(row)
        } else {
          block.appendChild(buildSubtaskRow(item.task, item.parent, showStatus))
        }
      }
    }

    wrap.appendChild(block)
  }

  return {
    el: wrap,

    setSections(newSections) {
      sections = Array.isArray(newSections) ? newSections : []
      if (!sections.some(s => s.id === activeId)) activeId = sections[0]?.id || null
      render()
    },

    setActive(id) {
      activeId = id
      render()
    },

    setSearch(q) {
      searchQuery = q
      render()
    },

    setSelected(id) {
      selectedId = id
      wrap.querySelectorAll('.tk-task-row').forEach(r => {
        r.classList.toggle('is-selected', r.dataset.id === id)
      })
    },

    // Optimistic "Creating…" row inserted into the right section until the real
    // task arrives via the next setSections().
    addCreatingRow(sectionId, tempTask) {
      const block = wrap.querySelector(`.tk-section[data-section-id="${sectionId}"]`)
      const row = buildRow(tempTask, true)
      if (!block) { wrap.prepend(row); return }
      const addRow = block.querySelector('.tk-section-add')
      const emptyHint = block.querySelector('.tk-section-empty')
      if (emptyHint) emptyHint.remove()
      if (addRow) addRow.after(row)
      else block.appendChild(row)
    },

    removeRow(id) {
      wrap.querySelector(`[data-id="${id}"]`)?.remove()
    },

    updateTask(task) {
      // Find and replace the task in whichever section holds it, then re-render.
      for (const section of sections) {
        const idx = section.tasks.findIndex(t => t.id === task.id)
        if (idx >= 0) { section.tasks[idx] = task; render(); return }
      }
      render()
    },
  }
}

function formatDate(iso) {
  const [y, m, d] = iso.split('-')
  return `${d}/${m}/${y.slice(2)}`
}
