const MARKER = '<!-- tasker-managed -->'
const SUB_BEGIN = /<!-- sub:([\w-]+) -->/
const SUB_END   = '<!-- /sub -->'

const RECURRING_TO_LABEL = { day: 'daily', week: 'weekly', month: 'monthly' }
const LABEL_TO_UNIT = { daily: 'day', weekly: 'week', monthly: 'month' }
const DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']

// ── Recurring helpers ──────────────────────────────────────────────────────────

function buildRecurStr(r) {
  if (!r?.enabled) return null
  const label = RECURRING_TO_LABEL[r.unit] || r.unit
  let s = `${label} x${r.interval}`
  if (r.unit === 'week' && r.dayOfWeek != null) s += ` on ${DAYS[r.dayOfWeek]}`
  return s
}

function parseRecurStr(val) {
  const m = val.match(/^(\w+)\s+x(\d+)(?:\s+on\s+(\w+))?$/)
  if (!m) return null
  const unit = LABEL_TO_UNIT[m[1]] || m[1]
  const dayIdx = m[3] ? DAYS.indexOf(m[3]) : -1
  return { enabled: true, unit, interval: parseInt(m[2], 10), dayOfWeek: dayIdx >= 0 ? dayIdx : null }
}

// ── Subtask block builder ──────────────────────────────────────────────────────

function buildSubBlock(sub) {
  const lines = [`<!-- sub:${sub.id} -->`]
  const check = sub.done ? '[x]' : '[ ]'
  lines.push(`${check} ${sub.title}`)
  if (sub.dueDate)      lines.push(`due:${sub.dueDate}`)
  if (sub.tags?.length) lines.push(`tags:${sub.tags.join(',')}`)
  const rs = buildRecurStr(sub.recurring)
  if (rs)               lines.push(`recur:${rs}`)
  if (sub.text)         lines.push('', sub.text)
  lines.push(SUB_END)
  return lines.join('\n')
}

function parseSubBlock(id, raw) {
  const lines = raw.trim().split('\n')
  if (!lines.length) return null

  const headerM = lines[0].match(/^\[([x ])\]\s+(.+)$/)
  if (!headerM) return null

  const done  = headerM[1] === 'x'
  const title = headerM[2].trim()

  let dueDate = null, tags = [], recurring = null
  let textStart = lines.length // default: no text

  for (let i = 1; i < lines.length; i++) {
    const l = lines[i]
    if (l === '') { textStart = i + 1; break }
    if      (l.startsWith('due:'))   dueDate   = l.slice(4).trim() || null
    else if (l.startsWith('tags:'))  tags      = l.slice(5).trim().split(',').map(s => s.trim()).filter(Boolean)
    else if (l.startsWith('recur:')) recurring = parseRecurStr(l.slice(6).trim())
    else { textStart = i; break } // non-key line → text starts here
  }

  const text = lines.slice(textStart).join('\n').trim()

  return { id, title, text, dueDate, done, tags, recurring, subtasks: [] }
}

// ── buildComment ───────────────────────────────────────────────────────────────

function buildComment(task) {
  const lines = [MARKER]

  if (task.dueDate)      lines.push(`Due: ${task.dueDate}`)
  const rs = buildRecurStr(task.recurring)
  if (rs)                lines.push(`Recurring: ${rs}`)
  if (task.tags?.length) lines.push(`Tags: ${task.tags.join(', ')}`)

  lines.push('')
  lines.push('## Subtasks')
  for (const sub of (task.subtasks || [])) {
    lines.push('')
    lines.push(buildSubBlock(sub))
  }

  lines.push('')
  lines.push('## Log')
  if (task.text) lines.push(task.text)

  return lines.join('\n')
}

// ── parseComment ───────────────────────────────────────────────────────────────

function parseComment(body) {
  const empty = { subtasks: [], tags: [], recurring: null, text: '', dueDate: null }
  if (!body || !body.includes(MARKER)) return empty

  const afterMarker = body.slice(body.indexOf(MARKER) + MARKER.length).replace(/^\n/, '')
  const subtasksIdx = afterMarker.search(/^## Subtasks/m)
  const logIdx      = afterMarker.search(/^## Log/m)

  const headerSection   = subtasksIdx >= 0 ? afterMarker.slice(0, subtasksIdx)
                        : afterMarker.slice(0, logIdx >= 0 ? logIdx : undefined)
  const subtasksSection = subtasksIdx >= 0 ? afterMarker.slice(subtasksIdx + '## Subtasks\n'.length, logIdx >= 0 ? logIdx : undefined) : ''
  const logSection      = logIdx >= 0 ? afterMarker.slice(logIdx + '## Log\n'.length) : ''

  // Header fields
  let recurring = null, tags = [], dueDate = null
  for (const line of headerSection.split('\n')) {
    const t = line.trim()
    if      (t.startsWith('Due:'))       dueDate   = t.slice('Due:'.length).trim() || null
    else if (t.startsWith('Recurring:')) recurring = parseRecurStr(t.slice('Recurring:'.length).trim())
    else if (t.startsWith('Tags:'))      tags      = t.slice('Tags:'.length).trim().split(',').map(s => s.trim()).filter(Boolean)
  }

  // Subtasks — new format: <!-- sub:id --> blocks
  const subtasks = []
  const subRe = /<!-- sub:([\w-]+) -->([\s\S]*?)<!-- \/sub -->/g
  let m
  while ((m = subRe.exec(subtasksSection)) !== null) {
    const parsed = parseSubBlock(m[1], m[2])
    if (parsed) subtasks.push(parsed)
  }

  // Fallback: old format "- [ ] title | due:YYYY-MM-DD"
  if (subtasks.length === 0) {
    let idx = 0
    for (const line of subtasksSection.split('\n')) {
      const om = line.match(/^-\s+\[([x ])\]\s+(.+)$/)
      if (om) {
        const done = om[1] === 'x'
        const parts = om[2].split(' | due:')
        subtasks.push({
          id: `sub-${idx++}`,
          title: parts[0].trim(),
          text: '', dueDate: parts[1]?.trim() || null,
          done, tags: [], externalLink: null, recurring: null, subtasks: [],
        })
      }
    }
  }

  return { subtasks, tags, recurring, text: logSection.trim(), dueDate }
}

module.exports = { buildComment, parseComment, MARKER }
