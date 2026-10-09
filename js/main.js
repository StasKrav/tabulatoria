// ============================================================
// ГЛОБАЛЬНЫЕ
// ============================================================
const editor = document.getElementById('editor')
const preview = document.getElementById('preview')
const toast = document.getElementById('toast')
const chordsInput = document.getElementById('chordsInput')
const chordsButtons = document.getElementById('chordsButtons')
const folderStatus = document.getElementById('folderStatus')
const folderInfo = document.getElementById('folderInfo')
const savedDot = document.getElementById('savedDot')
const editorTitle = document.getElementById('editorTitle')

const SECTION_NAMES = [
  'Вступление',
  'Интро',
  'Куплет',
  'Припев',
  'Бридж',
  'Проигрыш',
  'Соло',
  'Кода',
  'Аутро',
  'Финал',
  'Предприпев',
  'Пре-хорус',
]
const SECTION_HEADER_RE = new RegExp('^\\s*(' + SECTION_NAMES.join('|') + ')\\s*:?\\s*$', 'i')

// Состояние файлового режима
let dirHandle = null // FileSystemDirectoryHandle
let currentFileHandle = null // FileSystemFileHandle текущей песни
let currentFileName = null
let songsCache = [] // [{name, handle}]
let isDirty = false // не сохранено
let fsSupported = 'showDirectoryPicker' in window

// ============================================================
// УТИЛИТЫ
// ============================================================
function showToast(msg, isError = false) {
  toast.textContent = msg
  toast.classList.toggle('error', isError)
  toast.classList.add('show')
  clearTimeout(showToast._t)
  showToast._t = setTimeout(() => toast.classList.remove('show'), 2200)
}

function openModal(id) {
  document.getElementById(id).classList.add('show')
}
function closeModal(id) {
  document.getElementById(id).classList.remove('show')
}

// Esc закрывает любую модалку
document.addEventListener('keydown', e => {
  if (e.key === 'Escape') {
    document.querySelectorAll('.modal-backdrop.show').forEach(m => m.classList.remove('show'))
  }
})

// ============================================================
// INDEXEDDB — для хранения хэндла папки
// ============================================================
const IDB_NAME = 'tabulatorium'
const IDB_STORE = 'handles'
const IDB_KEY = 'songsDir'

function idbOpen() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(IDB_NAME, 1)
    req.onupgradeneeded = () => {
      const db = req.result
      if (!db.objectStoreNames.contains(IDB_STORE)) {
        db.createObjectStore(IDB_STORE)
      }
    }
    req.onsuccess = () => resolve(req.result)
    req.onerror = () => reject(req.error)
  })
}

async function idbSet(key, value) {
  const db = await idbOpen()
  return new Promise((resolve, reject) => {
    const tx = db.transaction(IDB_STORE, 'readwrite')
    tx.objectStore(IDB_STORE).put(value, key)
    tx.oncomplete = () => resolve()
    tx.onerror = () => reject(tx.error)
  })
}

async function idbGet(key) {
  const db = await idbOpen()
  return new Promise((resolve, reject) => {
    const tx = db.transaction(IDB_STORE, 'readonly')
    const req = tx.objectStore(IDB_STORE).get(key)
    req.onsuccess = () => resolve(req.result)
    req.onerror = () => reject(req.error)
  })
}

async function idbDelete(key) {
  const db = await idbOpen()
  return new Promise((resolve, reject) => {
    const tx = db.transaction(IDB_STORE, 'readwrite')
    tx.objectStore(IDB_STORE).delete(key)
    tx.oncomplete = () => resolve()
    tx.onerror = () => reject(tx.error)
  })
}

// ============================================================
// ПРОВЕРКА ПОДДЕРЖКИ API
// ============================================================
function checkApiSupport() {
  const btnPick = document.getElementById('btnPickFolder')
  if (!fsSupported) {
    btnPick.disabled = true
    btnPick.title = 'Браузер не поддерживает File System Access API (нужен Chrome/Edge/Opera)'
    folderStatus.textContent = '📁 Браузер не умеет работать с папками'
    folderStatus.classList.remove('active')
  }

  if (!('showOpenFilePicker' in window)) {
    document.querySelector('button[onclick="openFile()"]').title =
      'В этом браузере файл откроется только для чтения (Ctrl+S будет скачивать копию)'
  }
}

// ============================================================
// ВЫБОР ПАПКИ
// ============================================================
async function pickFolder() {
  if (!fsSupported) {
    showToast('Браузер не поддерживает работу с папками', true)
    return
  }
  try {
    const handle = await window.showDirectoryPicker({
      mode: 'readwrite',
      id: 'tabulatoriumSongs',
      startIn: 'documents',
    })
    dirHandle = handle
    await idbSet(IDB_KEY, handle)
    await updateFolderUi()
    await refreshSongList()
    showToast('Папка выбрана: ' + handle.name)
  } catch (e) {
    if (e.name === 'AbortError') return // пользователь отменил
    console.error(e)
    showToast('Не удалось открыть папку: ' + e.message, true)
  }
}

async function updateFolderUi() {
  if (!dirHandle) {
    folderStatus.textContent = 'Папка не выбрана'
    folderStatus.classList.remove('active')
    document.getElementById('btnSongList').disabled = true
    document.getElementById('btnNewSong').disabled = true
    document.getElementById('btnRefresh').disabled = true
    return
  }
  folderStatus.textContent = '' + dirHandle.name
  folderStatus.title = dirHandle.name
  folderStatus.classList.add('active')
  document.getElementById('btnSongList').disabled = false
  document.getElementById('btnNewSong').disabled = false
  document.getElementById('btnRefresh').disabled = false
  folderInfo.textContent = 'Папка: ' + dirHandle.name
}

// ============================================================
// СПИСОК ПЕСЕН
// ============================================================
async function readSongsFromFolder() {
  if (!dirHandle) return []
  const songs = []
  for await (const [name, handle] of dirHandle.entries()) {
    if (handle.kind === 'file' && /\.txt$/i.test(name)) {
      songs.push({ name, handle })
    }
  }
  songs.sort((a, b) => a.name.localeCompare(b.name, 'ru'))
  return songs
}

async function refreshSongList() {
  if (!dirHandle) return
  try {
    songsCache = await readSongsFromFolder()
    if (document.getElementById('songListModal').classList.contains('show')) {
      renderSongListModal()
    }
  } catch (e) {
    console.error(e)
    showToast('Не удалось прочитать список песен', true)
  }
}

function renderSongListModal() {
  const container = document.getElementById('songsListContainer')
  folderInfo.textContent = 'Папка: ' + (dirHandle ? dirHandle.name : '—')

  if (!songsCache.length) {
    container.innerHTML =
      '<div class="songs-empty">В папке нет .txt файлов. Создай первую песню кнопкой ➕.</div>'
    return
  }

  container.innerHTML = ''
  const list = document.createElement('div')
  list.className = 'songs-list'

  songsCache.forEach(song => {
    const item = document.createElement('div')
    item.className = 'song-item'
    if (song.name === currentFileName) item.classList.add('current')

    const icon = document.createElement('span')
    icon.className = 'song-icon'
    icon.textContent = song.name === currentFileName ? '▶' : '♪'

    const name = document.createElement('span')
    name.className = 'song-name'
    name.textContent = song.name.replace(/\.txt$/i, '')

    const actions = document.createElement('div')
    actions.className = 'song-actions'

    const btnRename = document.createElement('button')
    btnRename.textContent = '✏️'
    btnRename.title = 'Переименовать'
    btnRename.onclick = e => {
      e.stopPropagation()
      renameSong(song)
    }

    const btnDelete = document.createElement('button')
    btnDelete.textContent = '🗑'
    btnDelete.title = 'Удалить'
    btnDelete.onclick = e => {
      e.stopPropagation()
      deleteSong(song)
    }

    actions.appendChild(btnRename)
    actions.appendChild(btnDelete)

    item.appendChild(icon)
    item.appendChild(name)
    item.appendChild(actions)
    item.onclick = () => openSong(song)

    list.appendChild(item)
  })

  container.appendChild(list)
}

function openSongList() {
  if (!dirHandle) {
    showToast('Сначала выбери папку', true)
    return
  }
  refreshSongList().then(renderSongListModal)
  openModal('songListModal')
}

// ============================================================
// ОТКРЫТИЕ / СОХРАНЕНИЕ ПЕСНИ
// ============================================================
async function openSong(song) {
  if (isDirty && !confirm('Текущая песня не сохранена. Открыть другую без сохранения?')) {
    return
  }
  try {
    const file = await song.handle.getFile()
    const fileText = await file.text()
    const draftText = loadDraft(song.name)

    let textToUse = fileText
    let restoredFromDraft = false

    // Если есть черновик, отличающийся от файла — спрашиваем
    if (draftText !== null && draftText !== fileText) {
      const useDraft = confirm(
        'Для этой песни есть несохранённый черновик.\n\n' +
          'OK — восстановить черновик (файл на диске останется как есть)\n' +
          'Отмена — открыть версию из файла (черновик будет удалён)',
      )
      if (useDraft) {
        textToUse = draftText
        restoredFromDraft = true
      } else {
        clearDraft(song.name)
      }
    }

    editor.value = textToUse
    currentFileHandle = song.handle
    currentFileName = song.name
    isDirty = restoredFromDraft // если восстановили черновик — есть несохранёнка

    updateSavedIndicator()
    updateEditorTitle()
    refresh()
    closeModal('songListModal')

    if (restoredFromDraft) {
      showToast('Черновик восстановлен: ' + song.name.replace(/\.txt$/i, ''))
    } else {
      showToast('Открыто: ' + song.name.replace(/\.txt$/i, ''))
    }
  } catch (e) {
    console.error(e)
    showToast('Не удалось открыть файл: ' + e.message, true)
  }
}

async function saveCurrentSong() {
  // Внешний файл — сохраняем как .txt через браузерный download
  if (!currentFileHandle) {
    if (currentFileName) {
      saveAs('txt')
      return true
    }
    return false
  }

  // Обычный файл из папки — пишем через File System Access API
  try {
    const writable = await currentFileHandle.createWritable()
    await writable.write(editor.value)
    await writable.close()
    isDirty = false
    clearDraft(currentFileName)
    updateSavedIndicator()
    updateEditorTitle()
    showToast('Сохранено: ' + currentFileName.replace(/\.txt$/i, ''))
    return true
  } catch (e) {
    console.error(e)
    showToast('Не удалось сохранить: ' + e.message, true)
    return false
  }
}

function updateSavedIndicator() {
  // Кнопки btnSave в шапке больше нет — состояние показываем только точкой.
  if (!currentFileHandle && !currentFileName) {
    savedDot.classList.remove('visible', 'dirty', 'external');
    return;
  }

  savedDot.classList.add('visible');

  if (currentFileHandle) {
    savedDot.classList.remove('external');
    savedDot.classList.toggle('dirty', isDirty);
    savedDot.title = isDirty ? 'Не сохранено' : 'Сохранено';
    return;
  }

  // Внешний файл
  savedDot.classList.remove('dirty');
  savedDot.classList.add('external');
  savedDot.title = 'Внешний файл (не привязан к папке)';
}

function updateEditorTitle() {
  if (currentFileName) {
    editorTitle.textContent = '' + currentFileName.replace(/\.txt$/i, '') + (isDirty ? ' ●' : '')
  } else {
    editorTitle.textContent = 'Редактор'
  }
}

// ============================================================
// НОВАЯ ПЕСНЯ
// ============================================================
function newSong() {
  if (!dirHandle) {
    showToast('Сначала выбери папку', true)
    return
  }
  document.getElementById('newSongName').value = ''
  openModal('newSongModal')
  setTimeout(() => document.getElementById('newSongName').focus(), 50)
}

async function confirmNewSong() {
  const rawName = document.getElementById('newSongName').value.trim()
  if (!rawName) {
    showToast('Введи имя файла', true)
    return
  }
  const safeName = rawName.replace(/[\\/:*?"<>|]/g, '_')
  const fileName = safeName.toLowerCase().endsWith('.txt') ? safeName : safeName + '.txt'

  try {
    const handle = await dirHandle.getFileHandle(fileName, { create: true })
    const writable = await handle.createWritable()
    await writable.write('')
    await writable.close()

    currentFileHandle = handle
    currentFileName = fileName
    editor.value = ''
    isDirty = false
    updateSavedIndicator()
    updateEditorTitle()
    refresh()
    closeModal('newSongModal')
    await refreshSongList()
    showToast('Создано: ' + fileName.replace(/\.txt$/i, ''))
  } catch (e) {
    console.error(e)
    showToast('Не удалось создать файл: ' + e.message, true)
  }
}

// ============================================================
// ПЕРЕИМЕНОВАНИЕ / УДАЛЕНИЕ
// ============================================================
async function renameSong(song) {
  const oldName = song.name.replace(/\.txt$/i, '')
  const newName = prompt('Новое имя файла:', oldName)
  if (!newName || newName.trim() === '' || newName === oldName) return

  const safe = newName.trim().replace(/[\\/:*?"<>|]/g, '_')
  const newFile = safe.toLowerCase().endsWith('.txt') ? safe : safe + '.txt'

  try {
    // File System Access API не умеет rename — копируем содержимое,
    // удаляем старый файл.
    const oldFile = await song.handle.getFile()
    const text = await oldFile.text()

    const newHandle = await dirHandle.getFileHandle(newFile, { create: true })
    const writable = await newHandle.createWritable()
    await writable.write(text)
    await writable.close()

    await dirHandle.removeEntry(song.name)

    // Если переименовывали текущий открытый файл — обновляем состояние
    if (currentFileName === song.name) {
      currentFileName = newFile
      currentFileHandle = newHandle
      updateEditorTitle()
      updateSavedIndicator()
    }

    // Переносим черновик: старый под старым именем удаляем,
    // новый создаём под новым именем ТОЛЬКО если есть несохранёнка.
    clearDraft(song.name)
    if (currentFileName === newFile && isDirty) {
      saveDraft()
    }

    await refreshSongList()
    renderSongListModal()
    showToast('Переименовано: ' + newFile.replace(/\.txt$/i, ''))
  } catch (e) {
    console.error(e)
    showToast('Не удалось переименовать: ' + e.message, true)
  }
}

async function deleteSong(song) {
  const name = song.name.replace(/\.txt$/i, '')
  if (
    !confirm(
      'Удалить песню «' + name + '»?\nФайл будет удалён с диска без возможности восстановления.',
    )
  )
    return
  try {
    await dirHandle.removeEntry(song.name)
    if (currentFileName === song.name) {
      currentFileName = null
      currentFileHandle = null
      updateEditorTitle()
      updateSavedIndicator()
    }
    await refreshSongList()
    renderSongListModal()
    clearDraft(song.name)
    showToast('Удалено: ' + name)
  } catch (e) {
    console.error(e)
    showToast('Не удалось удалить: ' + e.message, true)
  }
}

// ============================================================
// ВОССТАНОВЛЕНИЕ ПАПКИ ПРИ ЗАПУСКЕ
// ============================================================
async function restoreFolder() {
  if (!fsSupported) return
  try {
    const handle = await idbGet(IDB_KEY)
    if (!handle) return

    // Проверяем/запрашиваем разрешение
    const opts = { mode: 'readwrite' }
    let perm = await handle.queryPermission(opts)
    if (perm !== 'granted') {
      perm = await handle.requestPermission(opts)
    }
    if (perm !== 'granted') {
      folderStatus.textContent = '📁 Нет доступа к папке'
      return
    }

    dirHandle = handle
    await updateFolderUi()
    await refreshSongList()
  } catch (e) {
    console.error('restoreFolder error:', e)
  }
}

// ============================================================
// АВТОПРОВЕРКА ПРИ ФОКУСЕ
// ============================================================
let focusRefreshTimer = null
function scheduleFocusRefresh() {
  if (!dirHandle) return
  clearTimeout(focusRefreshTimer)
  focusRefreshTimer = setTimeout(() => {
    refreshSongList()
  }, 500)
}

window.addEventListener('focus', scheduleFocusRefresh)
document.addEventListener('visibilitychange', () => {
  if (!document.hidden) scheduleFocusRefresh()
})

// ============================================================
// РЕНДЕР ПРЕВЬЮ
// ============================================================
function renderLine(line) {
  const strippedOfChords = line.replace(/\[[^\]]+\]/g, '').trim()
  const isChordOnlyLine = strippedOfChords === ''

  if (isChordOnlyLine) {
    const chords = [...line.matchAll(/\[([^\]]+)\]/g)].map(m => m[1])
    if (!chords.length) return { chordLine: '', textLine: '' }
    return { chordLine: chords.join(' '), textLine: '' }
  }

  let chordLine = ''
  let textLine = ''
  let i = 0
  let visibleLen = 0

  while (i < line.length) {
    if (line[i] === '[') {
      const close = line.indexOf(']', i)
      if (close !== -1) {
        const chord = line.slice(i + 1, close)
        while (chordLine.length < visibleLen) chordLine += ' '
        chordLine = chordLine.slice(0, visibleLen) + chord
        i = close + 1
        continue
      }
    }
    const ch = line[i]
    while (chordLine.length < visibleLen) chordLine += ' '
    if (chordLine.length === visibleLen) chordLine += ' '
    textLine += ch
    visibleLen++
    i++
  }

  const len = Math.max(chordLine.length, textLine.length)
  chordLine = chordLine.padEnd(len, ' ')
  textLine = textLine.padEnd(len, ' ')

  return { chordLine, textLine }
}

function escapeHtml(s) {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
}

function updatePreview() {
  const text = editor.value
  const lines = text.split('\n')
  let html = ''
  let chordTotal = 0

  for (const raw of lines) {
    if (raw.trim() === '') {
      html += '<span class="empty-line">\n</span>'
      continue
    }
    if (SECTION_HEADER_RE.test(raw)) {
      html += `<span class="section-header">${escapeHtml(raw.replace(/:$/, ''))}</span>\n`
      continue
    }
    const { chordLine, textLine } = renderLine(raw)
    chordTotal += (raw.match(/\[[^\]]+\]/g) || []).length
    if (chordLine.trim()) html += `<span class="chord-line">${escapeHtml(chordLine)}</span>\n`
    if (textLine.trim()) html += `<span class="text-line">${escapeHtml(textLine)}</span>\n`
  }

  preview.innerHTML = html
  document.getElementById('chordCount').textContent = chordTotal
}

// ============================================================
// СТАТИСТИКА
// ============================================================
function updateStats() {
  const text = editor.value
  const pos = editor.selectionStart
  const before = text.slice(0, pos)
  const line = before.split('\n').length
  const col = pos - before.lastIndexOf('\n')
  document.getElementById('statLines').textContent = text.split('\n').length
  document.getElementById('statChars').textContent = text.length
  document.getElementById('statCursor').textContent = `${line}:${col}`
}

// ============================================================
// ВСТАВКА В РЕДАКТОР
// ============================================================
function insertAtCursor(text) {
  const s = editor.selectionStart
  const e = editor.selectionEnd
  editor.setRangeText(text, s, e, 'end')
  editor.focus()
  refresh()
}

function insertChord(chord) {
  insertAtCursor(`[${chord}]`)
}

function insertSection(name) {
  const pos = editor.selectionStart
  const lineStart = editor.value.lastIndexOf('\n', pos - 1) + 1
  const insertion = `${name}:\n`
  editor.value = editor.value.slice(0, lineStart) + insertion + editor.value.slice(lineStart)
  const cursor = lineStart + insertion.length
  editor.setSelectionRange(cursor, cursor)
  editor.focus()
  refresh()
  showToast(`Секция «${name}» добавлена`)
}

// ============================================================
// ПАНЕЛЬ АККОРДОВ
// ============================================================
let chordList = []

function parseChordList(str) {
  return str
    .split(/[\s,]+/)
    .map(s => s.trim())
    .filter(Boolean)
}

function applyChords() {
  chordList = parseChordList(chordsInput.value)
  renderChordButtons()
  safeSetItem('chordsList', chordsInput.value)
  showToast(chordList.length ? `Аккордов: ${chordList.length}` : 'Список пуст')
}

function renderChordButtons() {
  chordsButtons.innerHTML = ''
  chordList.forEach((chord, idx) => {
    const b = document.createElement('button')
    b.className = 'chord-btn'
    b.type = 'button'
    if (idx < 9) {
      const k = document.createElement('span')
      k.className = 'key'
      k.textContent = String(idx + 1)
      b.appendChild(k)
    }
    const label = document.createElement('span')
    label.textContent = chord
    b.appendChild(label)
    b.onclick = () => insertChord(chord)
    chordsButtons.appendChild(b)
  })
}

function restoreChordsFromStorage() {
  const saved = localStorage.getItem('chordsList')
  if (saved) {
    chordsInput.value = saved
    chordList = parseChordList(saved)
    renderChordButtons()
  }
}

// ============================================================
// ХРАНИЛИЩЕ С ЗАЩИТОЙ ОТ ПЕРЕПОЛНЕНИЯ
// ============================================================
let storageBroken = false
let storageWarned = false

function safeSetItem(key, value) {
  if (storageBroken) return
  try {
    localStorage.setItem(key, value)
  } catch (e) {
    storageBroken = true
    if (!storageWarned) {
      storageWarned = true
      showToast('⚠️ Автосохранение переполнено — сохрани файл вручную', true)
    }
  }
}

// ============================================================
// ОТКРЫТИЕ ВНЕШНЕГО ФАЙЛА
// ============================================================
async function openFile() {
  if (isDirty && !confirm('Текущая песня не сохранена. Открыть другую без сохранения?')) {
    return
  }

  // --- Chrome / Edge / Opera: настоящий read-write handle
  if ('showOpenFilePicker' in window) {
    try {
      const [handle] = await window.showOpenFilePicker({
        types: [
          {
            description: 'Текст',
            accept: { 'text/plain': ['.txt', '.md'] },
          },
        ],
        multiple: false,
        excludeAcceptAllOption: false,
      })

      const file = await handle.getFile()
      const fileText = await file.text()
      const draftText = loadDraft(handle.name)

      let textToUse = fileText
      let restoredFromDraft = false

      if (draftText !== null && draftText !== fileText) {
        const useDraft = confirm(
          'Для этого файла есть несохранённый черновик.\n\n' +
            'OK — восстановить черновик\n' +
            'Отмена — открыть версию с диска (черновик будет удалён)',
        )
        if (useDraft) {
          textToUse = draftText
          restoredFromDraft = true
        } else {
          clearDraft(handle.name)
        }
      }

      editor.value = textToUse
      currentFileHandle = handle // ← настоящий handle, read-write
      currentFileName = handle.name
      isDirty = restoredFromDraft

      updateSavedIndicator()
      updateEditorTitle()
      refresh()

      showToast(
        restoredFromDraft
          ? 'Черновик восстановлен: ' + handle.name.replace(/\.txt$/i, '')
          : 'Открыто: ' + handle.name.replace(/\.txt$/i, ''),
      )
    } catch (e) {
      if (e.name === 'AbortError') return // пользователь отменил диалог
      console.error(e)
      showToast('Не удалось открыть файл: ' + e.message, true)
    }
    return
  }

  // --- Firefox / Safari: fallback через <input type="file">, только чтение
  document.getElementById('fileInput').click()
}

// Fallback-обработчик (срабатывает только там, где нет showOpenFilePicker)
document.getElementById('fileInput').addEventListener('change', e => {
  const file = e.target.files[0]
  if (!file) return

  const reader = new FileReader()
  reader.onload = ev => {
    const fileText = ev.target.result
    const draftText = loadDraft(file.name)

    let textToUse = fileText
    let restoredFromDraft = false

    // Если есть черновик, отличающийся от файла — спрашиваем
    if (draftText !== null && draftText !== fileText) {
      const useDraft = confirm(
        'Для этого файла есть несохранённый черновик.\n\n' +
          'OK — восстановить черновик (файл на диске останется как есть)\n' +
          'Отмена — открыть версию из файла (черновик будет удалён)',
      )
      if (useDraft) {
        textToUse = draftText
        restoredFromDraft = true
      } else {
        clearDraft(file.name)
      }
    }

    editor.value = textToUse
    currentFileHandle = null // fallback: писать некуда
    currentFileName = file.name
    isDirty = true // всё равно некуда сохранять — считаем «есть изменения»

    updateEditorTitle()
    updateSavedIndicator()
    refresh()

    showToast(
      restoredFromDraft
        ? 'Черновик восстановлен: ' + file.name
        : 'Загружено (только чтение): ' + file.name,
    )
  }
  reader.readAsText(file)
  e.target.value = ''
})

function saveAs(ext) {
  const mime =
    { txt: 'text/plain', pdf: 'application/pdf', png: 'image/png' }[ext] ||
    'application/octet-stream'
  const blob = new Blob([editor.value], { type: `${mime};charset=utf-8` })
  const a = document.createElement('a')
  a.href = URL.createObjectURL(blob)
  const base = currentFileName ? currentFileName.replace(/\.[^.]+$/, '') : `song-${Date.now()}`
  a.download = `${base}.${ext}`
  a.click()
  URL.revokeObjectURL(a.href)
  showToast('Сохранено как .' + ext)
}

async function copyToClipboard() {
  try {
    await navigator.clipboard.writeText(editor.value)
    showToast('Скопировано в буфер')
  } catch {
    editor.select()
    document.execCommand('copy')
    showToast('Скопировано')
  }
}

function clearAll() {
  if (editor.value && !confirm('Очистить текст?')) return
  editor.value = ''
  isDirty = true
  updateEditorTitle()
  updateSavedIndicator()
  refresh()
}

// ============================================================
// ПРИМЕР
// ============================================================
function loadExample() {
  editor.value = `Вступление:
[Am] [Dm] [G] [C]

Куплет:
[Am]Как здорово, что [F]все мы здесь се[C]годня собра[G]лись
[Am]Как здорово, что [F]все мы здесь се[C]годня собра[G]лись
[F]Подумать только, [C]все мы здесь се[G]годня собра[Am]лись

Припев:
[Am]Я помню чудное мгно[F]венье
[C]Передо мной явилась [G]ты
[Am]Как мимолётное виде[F]нье
[C]Как гений чистой красо[G]ты

Проигрыш:
[Dm] [Am] [E] [Am]`
  chordsInput.value = 'Am F C G Dm E'
  applyChords()
  isDirty = true
  updateEditorTitle()
  updateSavedIndicator()
  refresh()
  showToast('Пример загружен')
}

// ============================================================
// ОБЩЕЕ ОБНОВЛЕНИЕ
// ============================================================
function refresh() {
  updatePreview()
  updateStats()
  // Текст в localStorage только если мы НЕ в файловом режиме
  if (!currentFileHandle) {
    safeSetItem('chordsEditorText', editor.value)
  }
}

editor.addEventListener('input', () => {
  if (currentFileHandle && !isDirty) {
    isDirty = true
    updateSavedIndicator()
    updateEditorTitle()
  }
  refresh()
  saveDraft() // ← добавили: пишем черновик на каждый ввод
})
editor.addEventListener('click', updateStats)
editor.addEventListener('keyup', updateStats)
editor.addEventListener('select', updateStats)

// Горячие клавиши в редакторе
editor.addEventListener('keydown', e => {
  if (e.key === 'Tab') {
    e.preventDefault()
    insertAtCursor('  ')
    return
  }
  if ((e.ctrlKey || e.metaKey) && e.code === 'KeyS') {
    e.preventDefault()
    if (currentFileHandle) {
      saveCurrentSong()
    } else {
      saveAs('txt')
    }
    return
  }
  const m = /^Digit([1-9])$/.exec(e.code)
  if (m && !e.ctrlKey && !e.metaKey && !e.altKey) {
    const idx = parseInt(m[1], 10) - 1
    if (idx < chordList.length) {
      e.preventDefault()
      insertChord(chordList[idx])
    }
  }
})

// Ctrl+S при фокусе не в редакторе
document.addEventListener('keydown', e => {
  if ((e.ctrlKey || e.metaKey) && e.code === 'KeyS') {
    if (document.activeElement !== editor) {
      e.preventDefault()
      if (currentFileHandle) saveCurrentSong()
      else saveAs('txt')
    }
  }
})

chordsInput.addEventListener('keydown', e => {
  if (e.key === 'Enter') {
    e.preventDefault()
    applyChords()
  }
})

// ============================================================
// ЧЕРНОВИКИ: сохраняем несохранённый текст по имени файла
// ============================================================

const DRAFT_PREFIX = 'draft:' // ключ: draft:<имя файла>

function saveDraft() {
  // Ключ черновика — имя файла. Handle не обязателен:
  // в fallback-режиме (Firefox/Safari) его нет, но черновик нужен.
  if (!currentFileName || !isDirty) return
  try {
    localStorage.setItem(DRAFT_PREFIX + currentFileName, editor.value)
  } catch (e) {
    // Тихо игнорируем — черновик это «бонус», не критично
  }
}

function loadDraft(fileName) {
  try {
    return localStorage.getItem(DRAFT_PREFIX + fileName)
  } catch {
    return null
  }
}

function clearDraft(fileName) {
  try {
    localStorage.removeItem(DRAFT_PREFIX + fileName)
  } catch {}
}

// ============================================================
// ХЕЛП
// ============================================================
function openHelp() {
  openModal('helpModal')
}

// ============================================================
// МЕНЮ ГАМБУРГЕРА
// ============================================================
const mainMenu = document.getElementById('mainMenu');
const menuBackdrop = document.getElementById('menuBackdrop');

function toggleMenu(e) {
  if (e) e.stopPropagation();
  const isOpen = mainMenu.classList.contains('show');
  if (isOpen) closeMenu();
  else openMenu();
}

function openMenu() {
  // Синхронизируем состояние пункта "Сохранить"
  const btnMenuSave = document.getElementById('menuSave');
  if (btnMenuSave) {
    // Сохранить активна, если есть что сохранять
    const canSave = currentFileHandle || currentFileName;
    btnMenuSave.disabled = !canSave || (currentFileHandle && !isDirty);
  }
  mainMenu.classList.add('show');
  menuBackdrop.classList.add('show');
}

function closeMenu() {
  mainMenu.classList.remove('show');
  
  menuBackdrop.classList.remove('show');
}

// Роутинг кликов по пунктам меню
function menuAction(action) {
  closeMenu();
  switch (action) {
    case 'open':   openFile(); break;
    case 'save':   saveCurrentSong(); break;
    case 'saveAs': saveAs('txt'); break;
    case 'pdf':    exportPDF(); break;
    case 'png':    exportPNG(); break;
    case 'plain':  exportPlainText(); break;
    case 'copy':   copyToClipboard(); break;
    case 'clear':  clearAll(); break;
  }
}

// Esc закрывает меню
document.addEventListener('keydown', e => {
  if (e.key === 'Escape' && mainMenu.classList.contains('show')) {
    closeMenu();
  }
});

// Ctrl+O — открыть файл
document.addEventListener('keydown', e => {
  if ((e.ctrlKey || e.metaKey) && e.code === 'KeyO') {
    e.preventDefault();
    openFile();
  }
});

// ============================================================
// ИНИЦИАЛИЗАЦИЯ
// ============================================================
;(async function init() {
  checkApiSupport()
  restoreChordsFromStorage()

  // Восстанавливаем «черновик» из localStorage (только если файлового нет)
  const savedText = localStorage.getItem('chordsEditorText')
  if (savedText) editor.value = savedText

  refresh()

  // Пробуем восстановить папку
  await restoreFolder()
})()

// ============================================================
// ЭКСПОРТ (PDF / PNG / Plain)
// ============================================================
function buildFinalText() {
  const lines = editor.value.split('\n')
  const out = []
  for (const raw of lines) {
    if (raw.trim() === '') {
      out.push('')
      continue
    }
    if (SECTION_HEADER_RE.test(raw)) {
      out.push(raw.trim())
      out.push('')
      continue
    }
    const { chordLine, textLine } = renderLine(raw)
    if (chordLine.trim()) out.push(chordLine.replace(/\s+$/, ''))
    if (textLine.trim()) out.push(textLine.replace(/\s+$/, ''))
  }
  return out.join('\n')
}

function exportPDF() {
  const content = buildFinalText()
  const iframe = document.createElement('iframe')
  iframe.style.position = 'fixed'
  iframe.style.right = '0'
  iframe.style.bottom = '0'
  iframe.style.width = '0'
  iframe.style.height = '0'
  iframe.style.border = '0'
  document.body.appendChild(iframe)

  const doc = iframe.contentDocument
  doc.open()
  doc.write(`<!DOCTYPE html>
<html>
<head>
<meta charset="UTF-8">
<title>Песня с аккордами</title>
<style>
  @page { size: A4; margin: 20mm; }
  body {
    font-family: "Courier New", Consolas, monospace;
    font-size: 13px;
    line-height: 1.4;
    color: #000;
    white-space: pre;
    margin: 0;
  }
</style>
</head>
<body>${content.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')}</body>
</html>`)
  doc.close()

  iframe.onload = () => {
    iframe.contentWindow.focus()
    iframe.contentWindow.print()
    setTimeout(() => document.body.removeChild(iframe), 1000)
  }
  showToast('Диалог печати → «Сохранить как PDF»')
}

function exportPNG() {
  const content = buildFinalText()
  const lines = content.split('\n')
  const fontSize = 18
  const lineHeight = 26
  const padding = 24
  const font = `${fontSize}px "Courier New", Consolas, monospace`

  const measurer = document.createElement('canvas').getContext('2d')
  measurer.font = font
  const maxWidth = Math.max(400, ...lines.map(l => measurer.measureText(l).width)) + padding * 2
  const height = lines.length * lineHeight + padding * 2

  const canvas = document.createElement('canvas')
  const dpr = window.devicePixelRatio || 2
  canvas.width = maxWidth * dpr
  canvas.height = height * dpr

  const ctx = canvas.getContext('2d')
  ctx.scale(dpr, dpr)
  ctx.fillStyle = '#ffffff'
  ctx.fillRect(0, 0, maxWidth, height)
  ctx.font = font
  ctx.textBaseline = 'top'

  const chordRegex = /^[\sA-Ha-h#b0-9\/\+\-()xX.]+$/
  let y = padding
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]
    const next = lines[i + 1] || ''
    const isChordLine =
      line.trim() !== '' && chordRegex.test(line) && next.trim() !== '' && !chordRegex.test(next)
    ctx.fillStyle = isChordLine ? '#b03a5b' : '#111111'
    ctx.fillText(line, padding, y)
    y += lineHeight
  }

  canvas.toBlob(blob => {
    const a = document.createElement('a')
    a.href = URL.createObjectURL(blob)
    a.download = `song-${Date.now()}.png`
    a.click()
    URL.revokeObjectURL(a.href)
    showToast('PNG сохранён')
  }, 'image/png')
}

function exportPlainText() {
  const content = buildFinalText()
  navigator.clipboard
    .writeText(content)
    .then(() => showToast('Чистый текст скопирован в буфер'))
    .catch(() => {
      const blob = new Blob([content], { type: 'text/plain;charset=utf-8' })
      const a = document.createElement('a')
      a.href = URL.createObjectURL(blob)
      a.download = `song-${Date.now()}.txt`
      a.click()
      URL.revokeObjectURL(a.href)
      showToast('Текст сохранён как .txt')
    })
}
