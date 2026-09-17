import { $typst, loadFonts } from '@myriaddreamin/typst.ts'
import compilerWasm from '@myriaddreamin/typst-ts-web-compiler/wasm?url'
import rendererWasm from '@myriaddreamin/typst-ts-renderer/wasm?url'
import { invoke, isTauri } from '@tauri-apps/api/core'
import { open } from '@tauri-apps/plugin-dialog'
import { EditorState } from '@codemirror/state'
import { EditorView, keymap, lineNumbers, drawSelection, highlightActiveLine, highlightActiveLineGutter } from '@codemirror/view'
import { StreamLanguage, syntaxHighlighting, HighlightStyle } from '@codemirror/language'
import { defaultKeymap, history, historyKeymap, indentWithTab } from '@codemirror/commands'
import { tags } from '@lezer/highlight'
import liberationSansRegular from './assets/fonts/LiberationSans-Regular.ttf'
import liberationSansBold from './assets/fonts/LiberationSans-Bold.ttf'
import liberationSansItalic from './assets/fonts/LiberationSans-Italic.ttf'
import liberationSansBoldItalic from './assets/fonts/LiberationSans-BoldItalic.ttf'
import './style.css'

$typst.setCompilerInitOptions({
  getModule: () => compilerWasm,
  beforeBuild: [loadFonts([
    liberationSansRegular,
    liberationSansBold,
    liberationSansItalic,
    liberationSansBoldItalic,
  ])],
})
$typst.setRendererInitOptions({ getModule: () => rendererWasm })

const starter = `= My Typst document

Open a folder to edit a .typ file.

== Math

$ sum_(k=1)^n k = (n(n+1)) / 2 $
`

const editorHost = document.querySelector('#editor')
const preview = document.querySelector('#preview')
const status = document.querySelector('#status')
const fileName = document.querySelector('#file-name')
const fileList = document.querySelector('#file-list')
const openFolder = document.querySelector('#open-folder')

let activePath = null
let dirty = false
let timer
let revision = 0
let applyingEditorContent = false

const typstLanguage = StreamLanguage.define({
  startState: () => ({ blockComment: false, inMath: false }),
  token(stream, state) {
    if (state.blockComment) {
      if (stream.skipTo('*/')) {
        stream.pos += 2
        state.blockComment = false
      } else stream.skipToEnd()
      return 'comment'
    }
    if (stream.match('/*')) {
      state.blockComment = true
      return 'comment'
    }
    if (stream.match('//')) {
      stream.skipToEnd()
      return 'comment'
    }
    if (stream.sol() && stream.match(/={1,6}(?=\s)/)) return 'heading'
    if (stream.match('"')) {
      let escaped = false
      while (!stream.eol()) {
        const character = stream.next()
        if (character === '"' && !escaped) break
        escaped = character === '\\' && !escaped
        if (character !== '\\') escaped = false
      }
      return 'string'
    }
    if (stream.match(/`{1,3}/)) {
      const delimiter = stream.current()
      if (stream.skipTo(delimiter)) stream.pos += delimiter.length
      else stream.skipToEnd()
      return 'string'
    }
    if (stream.match('#')) {
      if (stream.match(/(?:let|set|show|import|include|if|else|for|while|return|break|continue)\b/)) return 'keyword'
      if (stream.match(/[A-Za-z_][\w-]*/)) return 'variableName'
      return 'operator'
    }
    if (stream.match('$')) {
      state.inMath = !state.inMath
      return 'operator'
    }
    if (stream.match(/\(|\)|\[|\]|\{|\}|=>|->|==|!=|<=|>=|[-+*/%=<>]/)) return 'operator'
    if (state.inMath && stream.match(/\b\d+(?:\.\d+)?(?:[a-z%]+)?\b/)) return 'number'
    if (stream.match(/[A-Za-z_][\w-]*/)) {
      const word = stream.current()
      if (['none', 'auto', 'true', 'false'].includes(word)) return 'atom'
      return 'variableName'
    }
    stream.next()
    return null
  },
})

const typstHighlighting = HighlightStyle.define([
  { tag: tags.keyword, color: '#6f42c1' },
  { tag: tags.atom, color: '#9a4d00' },
  { tag: tags.string, color: '#0b6b2f' },
  { tag: tags.number, color: '#9a4d00' },
  { tag: tags.comment, color: '#57606a', fontStyle: 'italic' },
  { tag: tags.operator, color: '#0550ae' },
  { tag: tags.heading, color: '#0756a3', fontWeight: '700' },
  { tag: tags.variableName, color: '#1f2328' },
])

function editorContents() { return editorView.state.doc.toString() }

function setEditorContents(contents) {
  applyingEditorContent = true
  editorView.dispatch({ changes: { from: 0, to: editorView.state.doc.length, insert: contents } })
  applyingEditorContent = false
}

const editorView = new EditorView({
  state: EditorState.create({
    doc: starter,
    extensions: [
      lineNumbers(),
      highlightActiveLineGutter(),
      history(),
      drawSelection(),
      highlightActiveLine(),
      keymap.of([...defaultKeymap, ...historyKeymap, indentWithTab]),
      typstLanguage,
      syntaxHighlighting(typstHighlighting),
      EditorView.lineWrapping,
      EditorView.updateListener.of((update) => {
        if (!update.docChanged || applyingEditorContent) return
        dirty = Boolean(activePath)
        updateFileName()
        clearTimeout(timer)
        timer = setTimeout(render, 250)
      }),
    ],
  }),
  parent: editorHost,
})

function setStatus(message) { status.textContent = message }
function updateFileName() { fileName.textContent = activePath ? `${activePath}${dirty ? ' •' : ''}` : 'No file selected' }

function escapeHtml(value) {
  const node = document.createElement('div')
  node.textContent = value
  return node.innerHTML
}

async function render() {
  const currentRevision = ++revision
  setStatus('Rendering…')
  try {
    const svg = await $typst.svg({ mainContent: editorContents() })
    if (currentRevision !== revision) return
    preview.innerHTML = svg
    setStatus(!isTauri() ? 'Preview only — use `npm run tauri dev` for files' : dirty ? 'Unsaved changes' : 'Up to date')
  } catch (error) {
    if (currentRevision !== revision) return
    preview.innerHTML = `<pre class="error">${escapeHtml(error.message || String(error))}</pre>`
    setStatus('Fix errors to preview')
  }
}

function renderFileList(files) {
  fileList.innerHTML = files.length
    ? files.map(({ path }) => `<button class="file" data-path="${escapeHtml(path)}">${escapeHtml(path)}</button>`).join('')
    : '<p>No .typ files in this folder.</p>'
  fileList.querySelectorAll('.file').forEach((button) => button.addEventListener('click', () => loadFile(button.dataset.path)))
}

async function loadFile(path) {
  if (dirty && !confirm('Discard unsaved changes?')) return
  try {
    setEditorContents(await invoke('read_typ_file', { path }))
    activePath = path
    dirty = false
    updateFileName()
    fileList.querySelectorAll('.file').forEach((file) => file.classList.toggle('active', file.dataset.path === path))
    render()
  } catch (error) { setStatus(error.message || String(error)) }
}

async function chooseFolder() {
  if (!isTauri()) {
    setStatus('Native file access requires `npm run tauri dev`')
    return
  }
  try {
    const path = await open({ directory: true, multiple: false, title: 'Open Typst folder' })
    if (!path || Array.isArray(path)) return
    const files = await invoke('set_workspace', { path })
    activePath = null
    dirty = false
    updateFileName()
    renderFileList(files)
    setStatus(files.length ? 'Choose a file' : 'No .typ files found')
  } catch (error) { setStatus(error.message || String(error)) }
}

async function save() {
  if (!activePath || !dirty) return
  try {
    await invoke('save_typ_file', { path: activePath, contents: editorContents() })
    dirty = false
    updateFileName()
    setStatus('Saved')
  } catch (error) { setStatus(error.message || String(error)) }
}

openFolder.addEventListener('click', chooseFolder)
window.addEventListener('keydown', (event) => {
  if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 's') {
    event.preventDefault()
    save()
  }
})

if (!isTauri()) {
  setStatus('Preview mode — start the desktop app with `npm run tauri dev`')
  openFolder.title = 'Native folder access is available in the Tauri desktop app'
}

render()
