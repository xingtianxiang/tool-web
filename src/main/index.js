import { app, BrowserWindow, ipcMain, dialog, shell } from 'electron'
import path from 'node:path'
import * as store from './store.js'
import * as packager from './packager.js'

// Offscreen printToPDF can hang on some GPUs; software rendering is plenty for
// this app's simple UI and makes PDF generation reliable.
app.disableHardwareAcceleration()

// ---------- window ----------

function createWindow() {
  const win = new BrowserWindow({
    width: 1320,
    height: 860,
    minWidth: 1000,
    minHeight: 640,
    autoHideMenuBar: true,
    title: '加工件采购分发管理',
    backgroundColor: '#f8fafc',
    webPreferences: {
      preload: path.join(__dirname, '../preload/index.js'),
      sandbox: false,
      contextIsolation: true,
      nodeIntegration: false
    }
  })

  if (process.env['ELECTRON_RENDERER_URL']) {
    win.loadURL(process.env['ELECTRON_RENDERER_URL'])
  } else {
    win.loadFile(path.join(__dirname, '../renderer/index.html'))
  }
  return win
}

// ---------- requirements sheet (需求单) HTML ----------

function esc(s) {
  return String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c])
}

function fileListText(files) {
  if (!files || !files.length) return '<span style="color:#b00">无图纸</span>'
  return files.map((f) => esc(f.label ? `${f.label}(${f.filename})` : f.filename)).join('<br>')
}

function buildRequirementsHtml(vendor, items) {
  const dateStr = new Date().toLocaleDateString('zh-CN')
  const rows = items
    .map(
      (it, i) => `<tr>
        <td>${i + 1}</td>
        <td>${esc(it.code)}</td>
        <td>${fileListText(it.files)}</td>
        <td>${esc(it.requirements.material)}</td>
        <td>${esc(it.requirements.qty)}</td>
        <td>${esc(it.requirements.tolerance)}</td>
        <td>${esc(it.requirements.surface)}</td>
        <td>${esc(it.requirements.deadline)}</td>
        <td>${esc(it.requirements.notes)}</td>
      </tr>`
    )
    .join('')
  return `<!doctype html><html><head><meta charset="utf-8"><style>
    body{font-family:"Microsoft YaHei","PingFang SC","SimSun",sans-serif;color:#111;padding:24px;}
    h1{font-size:20px;margin:0 0 4px;}
    .meta{color:#555;font-size:12px;margin-bottom:16px;}
    table{border-collapse:collapse;width:100%;font-size:12px;}
    th,td{border:1px solid #888;padding:6px 8px;text-align:left;vertical-align:top;word-break:break-word;}
    th{background:#eef2f7;}
    tbody tr:nth-child(even){background:#fafafa;}
  </style></head><body>
    <h1>加工需求单 — ${esc(vendor?.name || '')}</h1>
    <div class="meta">生成日期:${dateStr} ｜ 共 ${items.length} 项</div>
    <table>
      <thead><tr>
        <th>#</th><th>图号/名称</th><th>图纸文件</th><th>材料</th><th>数量</th>
        <th>公差</th><th>表面处理</th><th>交期</th><th>备注</th>
      </tr></thead>
      <tbody>${rows}</tbody>
    </table>
  </body></html>`
}

// ---------- package build orchestration ----------

async function buildPackage(vendorId) {
  const preview = store.previewPackage(vendorId)
  if (preview.count === 0) throw new Error('该厂商没有指派任何零件')
  const withFiles = preview.items.filter((it) => it.hasFile)
  if (withFiles.length === 0) throw new Error('指派的零件都还没有上传图纸')

  const files = withFiles.flatMap((it) => store.resolveCurrentFiles(it.partId))

  const pdf = await packager.htmlToPdf(buildRequirementsHtml(preview.vendor, preview.items))

  const dateStr = new Date().toISOString().slice(0, 10)
  const base = `${store.sanitize(preview.vendor.name)}_${dateStr}`
  let fileName = `${base}.zip`
  let outPath = path.join(store.packagesDir(), fileName)
  let n = 2
  // avoid clobbering an earlier package made the same day
  const fs = await import('node:fs')
  while (fs.existsSync(outPath)) {
    fileName = `${base}_${n}.zip`
    outPath = path.join(store.packagesDir(), fileName)
    n++
  }

  await packager.buildZip(outPath, files, [{ buffer: pdf, nameInZip: '需求单.pdf' }])

  // auto-log the send with the exact revision packaged
  const loggedItems = preview.items.map((it) => ({ partId: it.partId, rev: it.rev }))
  store.appendSendLog(vendorId, loggedItems, fileName)

  return {
    zipPath: outPath,
    fileName,
    count: withFiles.length,
    fileCount: files.length,
    missing: preview.count - withFiles.length
  }
}

// ---------- IPC ----------

function wrap(fn) {
  return async (_evt, ...args) => fn(...args)
}

function registerIpc() {
  ipcMain.handle('state:get', wrap(() => store.getState()))

  ipcMain.handle('part:add', wrap((payload) => store.addPart(payload)))
  ipcMain.handle('part:update', wrap(({ id, fields }) => store.updatePart(id, fields)))
  ipcMain.handle('part:delete', wrap((id) => store.deletePart(id)))
  ipcMain.handle('part:addFile', wrap(({ partId, filename, bytes, label, note }) => store.addFile(partId, { filename, bytes, label, note })))
  ipcMain.handle('part:replaceFile', wrap(({ partId, fileId, filename, bytes, note }) => store.replaceFile(partId, fileId, { filename, bytes, note })))
  ipcMain.handle('part:updateFile', wrap(({ partId, fileId, label, note }) => store.updateFile(partId, fileId, { label, note })))
  ipcMain.handle('part:deleteFile', wrap(({ partId, fileId }) => store.deleteFile(partId, fileId)))

  ipcMain.handle('vendor:add', wrap((payload) => store.addVendor(payload)))
  ipcMain.handle('vendor:update', wrap(({ id, fields }) => store.updateVendor(id, fields)))
  ipcMain.handle('vendor:delete', wrap((id) => store.deleteVendor(id)))

  ipcMain.handle('assign:set', wrap(({ partId, vendorId, assigned }) => store.setAssignment(partId, vendorId, assigned)))

  ipcMain.handle('package:preview', wrap((vendorId) => store.previewPackage(vendorId)))
  ipcMain.handle('package:build', wrap((vendorId) => buildPackage(vendorId)))

  ipcMain.handle('settings:get', wrap(() => ({ dataDir: store.getDataDir() })))
  ipcMain.handle('settings:chooseDir', async () => {
    const res = await dialog.showOpenDialog({
      title: '选择数据文件夹',
      properties: ['openDirectory', 'createDirectory']
    })
    if (res.canceled || !res.filePaths[0]) return { dataDir: store.getDataDir() }
    store.setDataDir(res.filePaths[0])
    return { dataDir: store.getDataDir() }
  })

  ipcMain.handle('backup:export', async () => {
    const dateStr = new Date().toISOString().slice(0, 19).replace(/[:T]/g, '-')
    const outPath = path.join(store.backupDir(), `backup_${dateStr}.zip`)
    const r = await packager.buildBackup(store.getDataDir(), outPath)
    return { path: r.path }
  })

  ipcMain.handle('shell:reveal', wrap((p) => shell.showItemInFolder(p)))
  ipcMain.handle('shell:openPath', wrap((p) => shell.openPath(p)))
}

// ---------- lifecycle ----------

app.whenReady().then(() => {
  store.ensureData()
  registerIpc()
  createWindow()
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})
