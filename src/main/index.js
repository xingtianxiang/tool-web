import { app, BrowserWindow, ipcMain, dialog, shell } from 'electron'
import path from 'node:path'
import electronUpdater from 'electron-updater'
import * as store from './store.js'
import * as packager from './packager.js'

const { autoUpdater } = electronUpdater

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
    backgroundColor: '#ffffff',
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

function buildRequirementsHtml(vendor, project, items) {
  const dateStr = new Date().toLocaleDateString('zh-CN')
  const totalComponents = items.reduce((sum, asm) => sum + (asm.members || []).length, 0)
  let idx = 0
  const sections = items
    .map((asm) => {
      const memberRows = (asm.members || [])
        .map((m) => {
          idx += 1
          const r = m.requirements || {}
          return `<tr>
        <td>${idx}</td>
        <td>${esc(m.code)}</td>
        <td>${fileListText(m.files)}</td>
        <td>${esc(m.qty)}</td>
        <td>${esc(r.material)}</td>
        <td>${esc(r.tolerance)}</td>
        <td>${esc(r.surface)}</td>
      </tr>`
        })
        .join('')
      const drawing = asm.assemblyFiles && asm.assemblyFiles.length ? `装配图：${fileListText(asm.assemblyFiles)}` : '无装配图'
      const deadlinePart = asm.deadline ? ` ｜ <b>交期：${esc(asm.deadline)}</b>` : ''
      const notePart = asm.note ? ` ｜ 打包备注：${esc(asm.note)}` : ''
      const asmNotePart = asm.notes ? ` ｜ 组合件备注：${esc(asm.notes)}` : ''
      const emptyRow = memberRows ? '' : '<tr><td colspan="7" style="color:#b00">（该组合件还没有小零件）</td></tr>'
      return `<tr class="group"><td colspan="7">组合件：${esc(asm.code)}（${drawing}）${deadlinePart}${notePart}${asmNotePart}</td></tr>${memberRows}${emptyRow}`
    })
    .join('')
  return `<!doctype html><html><head><meta charset="utf-8"><style>
    body{font-family:"Microsoft YaHei","PingFang SC","SimSun",sans-serif;color:#111;padding:24px;}
    h1{font-size:20px;margin:0 0 4px;}
    .meta{color:#555;font-size:12px;margin-bottom:16px;}
    table{border-collapse:collapse;width:100%;font-size:12px;}
    th,td{border:1px solid #888;padding:6px 8px;text-align:left;vertical-align:top;word-break:break-word;}
    th{background:#eef2f7;}
    tr.group td{background:#dce7f5;font-weight:bold;}
  </style></head><body>
    <h1>加工需求单 — ${esc(vendor?.name || '')}</h1>
    <div class="meta">生成日期:${dateStr} ｜ ${items.length} 个组合件 / ${totalComponents} 个小零件${project?.name ? ` ｜ 项目：${esc(project.name)}` : ''}</div>
    <table>
      <thead><tr>
        <th>#</th><th>小零件</th><th>图纸文件</th><th>数量</th>
        <th>材料</th><th>公差</th><th>表面处理</th>
      </tr></thead>
      <tbody>${sections}</tbody>
    </table>
  </body></html>`
}

// ---------- package build orchestration ----------

async function buildPackage(vendorId) {
  const preview = store.previewPackage(vendorId)
  if (preview.count === 0) throw new Error('该厂商没有指派任何组合件')
  const withFiles = preview.items.filter((it) => it.hasFile)
  if (withFiles.length === 0) throw new Error('指派的组合件都还没有任何图纸')

  const files = withFiles.flatMap((it) => store.resolveAssemblyFiles(it.assemblyId))

  const pdf = await packager.htmlToPdf(buildRequirementsHtml(preview.vendor, preview.project, preview.items))

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

  // auto-log the send with the exact version signature packaged
  const loggedItems = preview.items.map((it) => ({ assemblyId: it.assemblyId, sig: it.sig }))
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

  ipcMain.handle('project:add', wrap((payload) => store.addProject(payload)))
  ipcMain.handle('project:update', wrap(({ id, fields }) => store.updateProject(id, fields)))
  ipcMain.handle('project:setActive', wrap((id) => store.setActiveProject(id)))
  ipcMain.handle('project:archive', wrap((id) => store.archiveProject(id)))
  ipcMain.handle('project:unarchive', wrap((id) => store.unarchiveProject(id)))
  ipcMain.handle('project:delete', wrap((id) => store.deleteProject(id)))
  ipcMain.handle('project:addVendors', wrap((vendorIds) => store.addProjectVendors(vendorIds)))
  ipcMain.handle('project:removeVendor', wrap((vendorId) => store.removeProjectVendor(vendorId)))

  ipcMain.handle('component:add', wrap((payload) => store.addComponent(payload)))
  ipcMain.handle('component:update', wrap(({ id, fields }) => store.updateComponent(id, fields)))
  ipcMain.handle('component:delete', wrap((id) => store.deleteComponent(id)))
  ipcMain.handle('component:addFile', wrap(({ componentId, filename, bytes, label, note }) => store.addComponentFile(componentId, { filename, bytes, label, note })))
  ipcMain.handle('component:replaceFile', wrap(({ componentId, fileId, filename, bytes, note }) => store.replaceComponentFile(componentId, fileId, { filename, bytes, note })))
  ipcMain.handle('component:updateFile', wrap(({ componentId, fileId, label, note }) => store.updateComponentFile(componentId, fileId, { label, note })))
  ipcMain.handle('component:deleteFile', wrap(({ componentId, fileId }) => store.deleteComponentFile(componentId, fileId)))

  ipcMain.handle('assembly:add', wrap((payload) => store.addAssembly(payload)))
  ipcMain.handle('assembly:update', wrap(({ id, fields }) => store.updateAssembly(id, fields)))
  ipcMain.handle('assembly:delete', wrap((id) => store.deleteAssembly(id)))
  ipcMain.handle('assembly:addMembers', wrap(({ assemblyId, componentIds }) => store.addAssemblyMembers(assemblyId, componentIds)))
  ipcMain.handle('assembly:removeMember', wrap(({ assemblyId, componentId }) => store.removeAssemblyMember(assemblyId, componentId)))
  ipcMain.handle('assembly:setMemberQty', wrap(({ assemblyId, componentId, qty }) => store.setMemberQty(assemblyId, componentId, qty)))
  ipcMain.handle('assembly:addFile', wrap(({ assemblyId, filename, bytes, label, note }) => store.addAssemblyFile(assemblyId, { filename, bytes, label, note })))
  ipcMain.handle('assembly:replaceFile', wrap(({ assemblyId, fileId, filename, bytes, note }) => store.replaceAssemblyFile(assemblyId, fileId, { filename, bytes, note })))
  ipcMain.handle('assembly:updateFile', wrap(({ assemblyId, fileId, label, note }) => store.updateAssemblyFile(assemblyId, fileId, { label, note })))
  ipcMain.handle('assembly:deleteFile', wrap(({ assemblyId, fileId }) => store.deleteAssemblyFile(assemblyId, fileId)))

  ipcMain.handle('vendor:add', wrap((payload) => store.addVendor(payload)))
  ipcMain.handle('vendor:update', wrap(({ id, fields }) => store.updateVendor(id, fields)))
  ipcMain.handle('vendor:delete', wrap((id) => store.deleteVendor(id)))

  ipcMain.handle('assign:set', wrap(({ assemblyId, vendorId, assigned }) => store.setAssignment(assemblyId, vendorId, assigned)))
  ipcMain.handle('assign:setMeta', wrap(({ assemblyId, vendorId, meta }) => store.setAssignmentMeta(assemblyId, vendorId, meta)))

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

  ipcMain.handle('import:preview', wrap((bytesList) => store.previewImport(bytesList)))
  ipcMain.handle('import:apply', wrap((bytesList) => store.applyImport(bytesList)))
  ipcMain.handle('import:downloadTemplate', async () => {
    const res = await dialog.showSaveDialog({
      title: '保存导入模板',
      defaultPath: path.join(app.getPath('documents'), '导入模板.xlsx'),
      filters: [{ name: 'Excel 工作簿', extensions: ['xlsx'] }]
    })
    if (res.canceled || !res.filePath) return { canceled: true }
    return store.writeImportTemplate(res.filePath)
  })

  ipcMain.handle('shell:reveal', wrap((p) => shell.showItemInFolder(p)))
  ipcMain.handle('shell:openPath', wrap((p) => shell.openPath(p)))
}

// ---------- auto-update ----------

// Installed builds only: fetch the latest GitHub release, download just the
// changed blocks (differential), and offer a restart. Silent on failure so an
// offline machine is never nagged.
function setupAutoUpdate(win) {
  if (!app.isPackaged) return
  autoUpdater.autoDownload = true
  autoUpdater.on('update-downloaded', async (info) => {
    if (!win || win.isDestroyed()) return
    const res = await dialog.showMessageBox(win, {
      type: 'info',
      buttons: ['立即重启更新', '稍后'],
      defaultId: 0,
      cancelId: 1,
      title: '有新版本',
      message: `新版本 ${info.version} 已下载完成`,
      detail: '点击「立即重启更新」应用会重启并装好新版；选「稍后」则在你下次关闭应用时自动安装。'
    })
    if (res.response === 0) autoUpdater.quitAndInstall()
  })
  autoUpdater.on('error', (err) => {
    console.error('[auto-update]', err == null ? 'unknown' : err.message || err)
  })
  autoUpdater.checkForUpdates().catch(() => {})
}

// ---------- lifecycle ----------

app.whenReady().then(() => {
  store.ensureData()
  registerIpc()
  const win = createWindow()
  setupAutoUpdate(win)
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})
