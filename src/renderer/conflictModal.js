import { createModal } from './modal.js'

/**
 * Returns a conflict modal.
 * Usage: const choice = await conflictModal.show({ mine, theirs, remoteUpdatedAt })
 * Resolves with 'keep-mine' | 'use-theirs' | 'cancel'
 */
export function createConflictModal() {
  const content = document.createElement('div')

  const desc = document.createElement('p')
  desc.style.cssText = 'margin:0 0 14px;font-size:13px;color:var(--tk-text-dim);'
  desc.textContent = 'This task was modified in Jira since your last sync. Choose which version to keep.'

  const panes = document.createElement('div')
  panes.className = 'tk-conflict-panes'

  const minePane = makePane('Your version')
  const theirsPane = makePane("Jira's version")
  panes.append(minePane.el, theirsPane.el)

  content.append(desc, panes)

  const footer = document.createElement('div')
  footer.className = 'tk-modal-foot'

  const btnCancel   = makeBtn('Cancel')
  const btnTheirs   = makeBtn("Use Jira's version")
  const btnMine     = makeBtn('Keep mine', 'is-primary')
  footer.append(btnCancel, btnTheirs, btnMine)

  const modal = createModal({ size: 'large', title: 'Conflict detected', content })
  modal.addFooter(footer)

  let resolve = null

  function pick(choice) {
    modal.close()
    resolve?.(choice)
    resolve = null
  }

  btnMine.addEventListener('click',   () => pick('keep-mine'))
  btnTheirs.addEventListener('click', () => pick('use-theirs'))
  btnCancel.addEventListener('click', () => pick('cancel'))

  // Also resolve to cancel on backdrop/Escape
  modal.el.addEventListener('click', e => {
    if (e.target === modal.el) pick('cancel')
  })

  return {
    show({ mine, theirs }) {
      minePane.text.textContent   = mine
      theirsPane.text.textContent = theirs
      modal.open()
      return new Promise(res => { resolve = res })
    },
  }
}

function makePane(label) {
  const el = document.createElement('div')
  el.className = 'tk-conflict-pane'
  const lbl = document.createElement('div')
  lbl.className = 'tk-conflict-pane-label'
  lbl.textContent = label
  const text = document.createElement('pre')
  text.className = 'tk-conflict-text'
  el.append(lbl, text)
  return { el, text }
}

function makeBtn(label, extraClass = '') {
  const btn = document.createElement('button')
  btn.className = 'tk-btn' + (extraClass ? ` ${extraClass}` : '')
  btn.textContent = label
  return btn
}
