import { EditorView, keymap } from '@codemirror/view'
import { EditorState, Compartment, Transaction } from '@codemirror/state'
import { defaultKeymap, history, historyKeymap, indentWithTab } from '@codemirror/commands'
import { markdown } from '@codemirror/lang-markdown'
import { HighlightStyle, syntaxHighlighting, defaultHighlightStyle } from '@codemirror/language'
import { tags } from '@lezer/highlight'

// ── Light theme matching design tokens ───────────────────────────────────────

const tkTheme = EditorView.theme({
  '&': {
    height: '100%',
    background: 'var(--tk-bg)',
    color: 'var(--tk-text)',
  },
  '.cm-content': {
    caretColor: 'var(--tk-accent)',
    padding: '14px',
    fontFamily: 'var(--tk-font-mono)',
    fontSize: '13px',
    lineHeight: '1.65',
  },
  '.cm-cursor, .cm-dropCursor': {
    borderLeftColor: 'var(--tk-accent)',
  },
  '&.cm-focused .cm-selectionBackground, .cm-selectionBackground, ::selection': {
    background: 'var(--tk-selection)',
  },
  '.cm-activeLine': {
    background: 'rgba(59,111,214,0.04)',
  },
  '.cm-gutters': { display: 'none' },
  '.cm-scroller': { overflow: 'auto' },
  '&.cm-focused': { outline: 'none' },
}, { dark: false })

const tkHighlight = HighlightStyle.define([
  { tag: tags.heading1, fontWeight: '700', fontSize: '1.15em', color: 'var(--tk-text)' },
  { tag: tags.heading2, fontWeight: '700', fontSize: '1.05em', color: 'var(--tk-text)' },
  { tag: tags.heading3, fontWeight: '600', color: 'var(--tk-text)' },
  { tag: tags.strong,   fontWeight: '700' },
  { tag: tags.emphasis, fontStyle: 'italic' },
  { tag: tags.strikethrough, textDecoration: 'line-through' },
  { tag: tags.link,     color: 'var(--tk-accent)', textDecoration: 'underline' },
  { tag: tags.url,      color: 'var(--tk-accent)' },
  { tag: tags.monospace, fontFamily: 'var(--tk-font-mono)', fontSize: '0.92em',
    background: 'rgba(59,111,214,0.08)', padding: '0 3px', borderRadius: '3px' },
  { tag: tags.comment,  color: 'var(--tk-text-dim)', fontStyle: 'italic' },
  { tag: tags.punctuation, color: 'var(--tk-text-dim)' },
  { tag: tags.keyword,  color: 'var(--tk-accent)', fontWeight: '600' },
])

// ── createEditor({ parent, initialValue, readOnly }) ─────────────────────────

export function createEditor({ parent, initialValue = '', readOnly = false } = {}) {
  const listeners = { input: [], blur: [], keydown: [] }
  const readOnlyCompartment = new Compartment()

  const extensions = [
    history(),
    keymap.of([...defaultKeymap, ...historyKeymap, indentWithTab]),
    markdown(),
    syntaxHighlighting(tkHighlight),
    syntaxHighlighting(defaultHighlightStyle, { fallback: true }),
    tkTheme,
    EditorView.lineWrapping,
    readOnlyCompartment.of(EditorState.readOnly.of(readOnly)),
    EditorView.updateListener.of(update => {
      if (update.docChanged) {
        listeners.input.forEach(fn => fn({ target: api }))
      }
      if (update.focusChanged && !update.view.hasFocus) {
        listeners.blur.forEach(fn => fn({ target: api }))
      }
    }),
    EditorView.domEventHandlers({
      keydown(e) {
        listeners.keydown.forEach(fn => fn(e))
      },
    }),
  ]

  const state = EditorState.create({
    doc: initialValue,
    extensions,
  })

  const view = new EditorView({ state, parent })

  const api = {
    get value() {
      return view.state.doc.toString()
    },
    set value(v) {
      view.dispatch({
        changes: { from: 0, to: view.state.doc.length, insert: v },
        annotations: Transaction.remote.of(true),
      })
    },

    get readOnly() {
      return view.state.facet(EditorState.readOnly)
    },
    set readOnly(v) {
      view.dispatch({ effects: readOnlyCompartment.reconfigure(EditorState.readOnly.of(v)) })
    },

    addEventListener(type, fn) {
      if (listeners[type]) listeners[type].push(fn)
    },
    removeEventListener(type, fn) {
      if (listeners[type]) listeners[type] = listeners[type].filter(f => f !== fn)
    },

    get view() { return view },

    set selectionStart(n) {
      view.dispatch({ selection: { anchor: n, head: n } })
      view.focus()
    },

    focus() { view.focus() },

    /** Prepend a new dated log entry and place cursor after the bullet */
    prependEntry() {
      const now = new Date()
      const dd   = String(now.getDate()).padStart(2, '0')
      const mm   = String(now.getMonth() + 1).padStart(2, '0')
      const yyyy = now.getFullYear()
      const HH   = String(now.getHours()).padStart(2, '0')
      const min  = String(now.getMinutes()).padStart(2, '0')
      const stamp = `${yyyy}-${mm}-${dd} ${HH}:${min}`

      // `entry` ends with "- " — cursor goes right after the bullet
      const entry = `# ${stamp}\n\n- `
      const existing = view.state.doc.toString()
      const insert = existing.length > 0 ? `${entry}\n\n${existing}` : entry
      const cursorPos = entry.length

      view.dispatch({
        changes: { from: 0, to: view.state.doc.length, insert },
        selection: { anchor: cursorPos, head: cursorPos },
      })
      view.focus()
    },

    destroy() { view.destroy() },
  }

  return api
}
