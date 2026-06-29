/**
 * createModal({ size, title, content, onClose })
 *   size: 'normal' | 'large'
 *   title: string | HTMLElement
 *   content: HTMLElement
 *   onClose?: () => void
 * Returns { open(), close(), el, setTitle(str) }
 */
export function createModal({ size = 'normal', title = '', content, onClose } = {}) {
  const backdrop = document.createElement('div')
  backdrop.className = 'tk-modal-backdrop'

  const card = document.createElement('div')
  card.className = 'tk-modal-card' + (size === 'large' ? ' is-large' : '')

  // Head
  const head = document.createElement('div')
  head.className = 'tk-modal-head'

  const titleEl = document.createElement('h2')
  if (typeof title === 'string') {
    titleEl.textContent = title
  } else {
    titleEl.appendChild(title)
  }

  const closeBtn = document.createElement('button')
  closeBtn.className = 'tk-modal-close'
  closeBtn.innerHTML = '&#x2715;'
  closeBtn.title = 'Close'

  head.append(titleEl, closeBtn)

  // Body
  const body = document.createElement('div')
  body.className = 'tk-modal-body'
  if (content) body.appendChild(content)

  card.append(head, body)
  backdrop.appendChild(card)
  document.body.appendChild(backdrop)

  function open() {
    backdrop.classList.add('is-open')
    // Focus first focusable element
    requestAnimationFrame(() => {
      const first = card.querySelector('input, textarea, button, [tabindex]')
      if (first) first.focus()
    })
  }

  function close() {
    backdrop.classList.remove('is-open')
    if (onClose) onClose()
  }

  closeBtn.addEventListener('click', close)

  backdrop.addEventListener('click', e => {
    if (e.target === backdrop) close()
  })

  document.addEventListener('keydown', e => {
    if (e.key === 'Escape' && backdrop.classList.contains('is-open')) close()
  })

  return {
    el: backdrop,
    card,
    body,
    open,
    close,
    setTitle(text) { titleEl.textContent = text },
    setContent(el) {
      body.innerHTML = ''
      body.appendChild(el)
    },
    /** Append a footer row to the card */
    addFooter(el) {
      el.className = 'tk-modal-foot'
      card.appendChild(el)
    },
  }
}
