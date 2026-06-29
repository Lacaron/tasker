import { createModal } from './modal.js'

export function createSettingsModal() {
  const content = document.createElement('div')

  // Config rows — filled in when opened
  const configWrap = document.createElement('div')

  const statusMsg = document.createElement('div')
  statusMsg.className = 'tk-status-msg'

  const btnRow = document.createElement('div')
  btnRow.style.cssText = 'display:flex;gap:8px;margin-top:16px;'

  const btnTest = document.createElement('button')
  btnTest.className = 'tk-btn'
  btnTest.textContent = 'Test connection'

  const btnSync = document.createElement('button')
  btnSync.className = 'tk-btn is-primary'
  btnSync.textContent = 'Sync now'

  btnRow.append(btnTest, btnSync)
  content.append(configWrap, btnRow, statusMsg)

  const modal = createModal({ size: 'normal', title: 'Settings', content })

  function addRow(key, val, badge) {
    const row = document.createElement('div')
    row.className = 'tk-settings-row'

    const k = document.createElement('div')
    k.className = 'tk-settings-key'
    k.textContent = key

    const v = document.createElement('div')
    v.className = 'tk-settings-val'
    if (badge) {
      const b = document.createElement('span')
      b.className = `tk-settings-badge ${badge}`
      b.textContent = val
      v.appendChild(b)
    } else {
      v.textContent = val
    }

    row.append(k, v)
    configWrap.appendChild(row)
  }

  function addSectionHeader(text) {
    const h = document.createElement('div')
    h.className = 'tk-settings-section'
    h.textContent = text
    configWrap.appendChild(h)
  }

  function renderConfig(cfg) {
    configWrap.innerHTML = ''

    // Shared credentials
    addRow('Connector', cfg.usingMock ? 'Mock (no .env credentials)' : 'Jira', cfg.usingMock ? 'is-mock' : '')
    addRow('Base URL', cfg.baseUrl)
    addRow('Email', cfg.email)
    addRow('API Token', cfg.apiToken)

    // One block per section
    const list = cfg.sections || []
    for (const s of list) {
      addSectionHeader(s.name || 'Section')
      addRow('JQL', s.jql)
      addRow('Project Key', s.projectKey)
      addRow('Issue Type', s.issueType)
    }
  }

  function setStatus(msg, type = '') {
    statusMsg.textContent = msg
    statusMsg.className = 'tk-status-msg' + (type ? ` ${type}` : '')
  }

  btnTest.addEventListener('click', async () => {
    btnTest.disabled = true
    setStatus('Testing…')
    try {
      const res = await window.taskerAPI.testConnection()
      setStatus(res.ok ? '✓ Connection OK' : `✗ ${res.error}`, res.ok ? 'is-ok' : 'is-err')
    } catch (err) {
      setStatus(`✗ ${err.message}`, 'is-err')
    } finally {
      btnTest.disabled = false
    }
  })

  btnSync.addEventListener('click', async () => {
    btnSync.disabled = true
    setStatus('Syncing…')
    try {
      const res = await window.taskerAPI.syncNow()
      setStatus(res.ok ? '✓ Synced' : `✗ ${res.error}`, res.ok ? 'is-ok' : 'is-err')
    } catch (err) {
      setStatus(`✗ ${err.message}`, 'is-err')
    } finally {
      btnSync.disabled = false
    }
  })

  return {
    async open() {
      setStatus('')
      const cfg = await window.taskerAPI.getConfig()
      renderConfig(cfg)
      modal.open()
    },
    close: () => modal.close(),
  }
}
