import { $typst, loadFonts } from '@myriaddreamin/typst.ts'
import compilerWasm from '@myriaddreamin/typst-ts-web-compiler/wasm?url'
import rendererWasm from '@myriaddreamin/typst-ts-renderer/wasm?url'
import { invoke, isTauri } from '@tauri-apps/api/core'
import { open } from '@tauri-apps/plugin-dialog'
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

const editor = document.querySelector('#editor')
const preview = document.querySelector('#preview')
const status = document.querySelector('#status')
const fileName = document.querySelector('#file-name')
const fileList = document.querySelector('#file-list')
const openFolder = document.querySelector('#open-folder')

editor.value = starter
let activePath = null
let dirty = false
let timer
let revision = 0

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
    const svg = await $typst.svg({ mainContent: editor.value })
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
    editor.value = await invoke('read_typ_file', { path })
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
    await invoke('save_typ_file', { path: activePath, contents: editor.value })
    dirty = false
    updateFileName()
    setStatus('Saved')
  } catch (error) { setStatus(error.message || String(error)) }
}

openFolder.addEventListener('click', chooseFolder)
editor.addEventListener('input', () => {
  dirty = Boolean(activePath)
  updateFileName()
  clearTimeout(timer)
  timer = setTimeout(render, 250)
})
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
