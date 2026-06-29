import { createModal } from './modal.js'

/**
 * createSubtaskModal({ onSave })
 * onSave(updatedSub, parentId) called when user presses Save
 */
export function createSubtaskModal({ onSave } = {}) {
  let currentSub = null
  let parentId = null

  // Content
  const content = document.createElement('div')
  content.style.cssText = 'display:flex;flex-direction:column;gap:16px;'

  // Done row
  const doneRow = document.createElement('div')
  doneRow.className = 'tk-recur-enable-row'
  const doneCheck = document.createElement('input')
  doneCheck.type = 'checkbox'
  doneCheck.id = 'tk-sub-modal-done'
  const doneLabel = document.createElement('label')
  doneLabel.htmlFor = 'tk-sub-modal-done'
  doneLabel.textContent = 'Mark as done'
  doneRow.append(doneCheck, doneLabel)

  // Due date
  const dueGroup = document.createElement('div')
  dueGroup.className = 'tk-meta-group'
  const dueLbl = document.createElement('div')
  dueLbl.className = 'tk-meta-label'
  dueLbl.textContent = 'Due date'
  const dueInput = document.createElement('input')
  dueInput.type = 'date'
  dueInput.className = 'tk-meta-input'
  dueGroup.append(dueLbl, dueInput)

  content.append(doneRow, dueGroup)

  // Footer
  const footer = document.createElement('div')
  const cancelBtn = document.createElement('button')
  cancelBtn.className = 'tk-btn'
  cancelBtn.textContent = 'Cancel'
  const saveBtn = document.createElement('button')
  saveBtn.className = 'tk-btn is-primary'
  saveBtn.textContent = 'Save'
  footer.append(cancelBtn, saveBtn)

  const modal = createModal({ size: 'normal', title: 'Subtask', content })
  modal.addFooter(footer)

  // Replace <h2> with editable title input (same pattern as taskModal)
  const titleInput = document.createElement('input')
  titleInput.style.cssText = 'flex:1;border:none;background:transparent;font-size:15px;font-weight:600;color:var(--tk-text);outline:none;min-width:0;'
  titleInput.placeholder = 'Subtask title…'
  const headH2 = modal.card.querySelector('.tk-modal-head h2')
  headH2.replaceWith(titleInput)
  modal.card.querySelector('.tk-modal-head').append(modal.card.querySelector('.tk-modal-close'))

  saveBtn.addEventListener('click', () => {
    if (!currentSub) return
    const updated = {
      ...currentSub,
      title: titleInput.value.trim() || currentSub.title,
      done: doneCheck.checked,
      dueDate: dueInput.value || null,
    }
    onSave?.(updated, parentId)
    modal.close()
  })

  cancelBtn.addEventListener('click', () => modal.close())

  return {
    open(sub, pid) {
      currentSub = { ...sub }
      parentId = pid
      titleInput.value = sub.title || ''
      doneCheck.checked = sub.done || false
      dueInput.value = sub.dueDate || ''
      modal.open()
      requestAnimationFrame(() => titleInput.focus())
    },
  }
}
