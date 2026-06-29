export function createTitlebar({ onPin } = {}) {
  const el = document.createElement('div')
  el.id = 'titlebar'

  const icon = document.createElement('img')
  icon.className = 'tk-app-icon'
  icon.src = '../../assets/icon.png'
  icon.alt = ''

  const name = document.createElement('span')
  name.className = 'tk-app-name'
  name.textContent = 'Tasker'

  // Two distinct glyphs make the pin state unmistakable:
  //   unpinned → outline pin (📌), pinned → filled/stuck pin (📍)
  const PIN_OFF = '📌'
  const PIN_ON  = '📍'

  const btnPin = makeBtn(PIN_OFF, 'pin-toggle', 'Pin window on top')
  const btnMin = makeBtn('–',  'minimize',   'Minimize')
  const btnCls = makeBtn('✕',  'close is-danger', 'Close')

  el.append(icon, name, btnPin, btnMin, btnCls)

  let pinned = false

  function renderPin() {
    btnPin.textContent = pinned ? PIN_ON : PIN_OFF
    btnPin.classList.toggle('is-pinned', pinned)
    btnPin.title = pinned ? 'Pinned on top — click to unpin' : 'Pin window on top'
    btnPin.setAttribute('aria-pressed', String(pinned))
  }
  renderPin()

  btnPin.addEventListener('click', async () => {
    const result = await window.taskerAPI.pin(!pinned)
    pinned = result
    renderPin()
    if (onPin) onPin(pinned)
  })

  btnMin.addEventListener('click', () => window.taskerAPI.minimize())
  btnCls.addEventListener('click', () => window.taskerAPI.close())

  return el
}

function makeBtn(label, className, title) {
  const btn = document.createElement('button')
  btn.className = `tk-tb-btn ${className}`
  btn.textContent = label
  btn.title = title
  return btn
}
