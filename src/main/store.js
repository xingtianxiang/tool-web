import { app } from 'electron'
import fs from 'node:fs'
import path from 'node:path'

// ---------- low-level helpers ----------

function readJsonSafe(file, fallback) {
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8'))
  } catch {
    return fallback
  }
}

function writeJsonAtomic(file, obj) {
  fs.mkdirSync(path.dirname(file), { recursive: true })
  const tmp = file + '.tmp'
  fs.writeFileSync(tmp, JSON.stringify(obj, null, 2), 'utf8')
  fs.renameSync(tmp, file)
}

function uid(prefix) {
  return prefix + '_' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6)
}

function sanitize(name) {
  return String(name ?? '').replace(/[\\/:*?"<>|]/g, '_').replace(/\s+/g, ' ').trim() || '未命名'
}

// ---------- config (where the data folder lives) ----------
// Stored in userData so it survives even if the data folder moves.

let config = null

function configPath() {
  return path.join(app.getPath('userData'), 'config.json')
}

function defaultDataDir() {
  return path.join(app.getPath('documents'), '加工件管理')
}

function loadConfig() {
  config = readJsonSafe(configPath(), null)
  if (!config || !config.dataDir) {
    config = { dataDir: defaultDataDir() }
    writeJsonAtomic(configPath(), config)
  }
  return config
}

export function getDataDir() {
  return (config || loadConfig()).dataDir
}

export function setDataDir(dir) {
  config = { ...(config || {}), dataDir: dir }
  writeJsonAtomic(configPath(), config)
  ensureData(true)
  return config
}

// ---------- data folder layout ----------

function dataFile() {
  return path.join(getDataDir(), 'data.json')
}
export function drawingsDir() {
  return path.join(getDataDir(), 'drawings')
}
export function packagesDir() {
  return path.join(getDataDir(), 'packages')
}
export function backupDir() {
  return path.join(getDataDir(), 'backup')
}

const EMPTY = { schemaVersion: 2, parts: [], vendors: [], assignments: [], sendLog: [] }

let data = null

// Convert the old single-file-per-version model into the new model where a part
// holds a SET of files plus an overall revision counter. Idempotent.
function migrateData(d) {
  let changed = false
  for (const p of d.parts) {
    if (Array.isArray(p.files)) continue // already new model
    changed = true
    const cur = p.currentVersion || 0
    p.rev = cur
    p.files = []
    p.archivedFiles = []
    for (const v of p.versions || []) {
      const f = {
        id: uid('f'),
        label: '',
        filename: v.filename,
        storedPath: v.storedPath,
        addedAt: v.addedAt || p.createdAt,
        note: v.note || ''
      }
      if (v.v === cur) p.files.push(f)
      else p.archivedFiles.push({ ...f, removedAt: v.addedAt || null, reason: '旧版本' })
    }
    delete p.versions
    delete p.currentVersion
  }
  for (const e of d.sendLog || []) {
    for (const it of e.items || []) {
      if (it.rev == null && it.version != null) {
        it.rev = it.version
        changed = true
      }
    }
  }
  if (d.schemaVersion !== 2) {
    d.schemaVersion = 2
    changed = true
  }
  return changed
}

export function ensureData(reload = false) {
  fs.mkdirSync(getDataDir(), { recursive: true })
  fs.mkdirSync(drawingsDir(), { recursive: true })
  fs.mkdirSync(packagesDir(), { recursive: true })
  if (data && !reload) return data
  data = readJsonSafe(dataFile(), null)
  if (!data) {
    data = JSON.parse(JSON.stringify(EMPTY))
    persist()
  }
  for (const k of ['parts', 'vendors', 'assignments', 'sendLog']) {
    if (!Array.isArray(data[k])) data[k] = []
  }
  if (migrateData(data)) persist()
  return data
}

function getData() {
  return data || ensureData()
}

function persist() {
  writeJsonAtomic(dataFile(), data)
}

// ---------- read ----------

export function getState() {
  const d = getData()
  return {
    parts: d.parts,
    vendors: d.vendors,
    assignments: d.assignments,
    sendLog: d.sendLog,
    dataDir: getDataDir()
  }
}

// ---------- parts ----------

export function addPart({ code, requirements }) {
  const d = getData()
  const part = {
    id: uid('p'),
    code: sanitize(code),
    requirements: requirements || {},
    files: [], // current set of drawing files (2D, 3D, sub-parts, ...)
    archivedFiles: [], // replaced/removed files kept for history
    rev: 0, // overall revision; bumps on any add/replace/delete
    createdAt: new Date().toISOString()
  }
  d.parts.push(part)
  persist()
  return part
}

export function updatePart(id, fields) {
  const d = getData()
  const p = d.parts.find((x) => x.id === id)
  if (!p) throw new Error('零件不存在')
  if (fields.code != null) p.code = sanitize(fields.code)
  if (fields.requirements) p.requirements = { ...p.requirements, ...fields.requirements }
  persist()
  return p
}

export function deletePart(id) {
  const d = getData()
  d.parts = d.parts.filter((x) => x.id !== id)
  d.assignments = d.assignments.filter((a) => a.partId !== id)
  persist()
  // best-effort remove stored drawings
  try {
    fs.rmSync(path.join(drawingsDir(), id), { recursive: true, force: true })
  } catch {
    /* ignore */
  }
  return true
}

// write transferred bytes (Uint8Array) to drawings/<partId>/<fileId>/<name>
function writeFileBytes(partId, fileId, filename, bytes) {
  const safeName = sanitize(filename || '图纸')
  const relDir = path.join('drawings', partId, fileId)
  const absDir = path.join(getDataDir(), relDir)
  fs.mkdirSync(absDir, { recursive: true })
  fs.writeFileSync(path.join(absDir, safeName), Buffer.from(bytes))
  return { filename: safeName, storedPath: path.join(relDir, safeName).split(path.sep).join('/') }
}

// add a NEW drawing file to the part (does not overwrite existing files)
export function addFile(partId, { filename, bytes, label, note }) {
  const d = getData()
  const p = d.parts.find((x) => x.id === partId)
  if (!p) throw new Error('零件不存在')
  const fileId = uid('f')
  const { filename: safeName, storedPath } = writeFileBytes(partId, fileId, filename, bytes)
  p.files.push({ id: fileId, label: label || '', filename: safeName, storedPath, addedAt: new Date().toISOString(), note: note || '' })
  p.rev = (p.rev || 0) + 1
  persist()
  return p
}

// revise one file in place: archive the old, store the new, keep its label
export function replaceFile(partId, fileId, { filename, bytes, note }) {
  const d = getData()
  const p = d.parts.find((x) => x.id === partId)
  if (!p) throw new Error('零件不存在')
  const idx = p.files.findIndex((f) => f.id === fileId)
  if (idx < 0) throw new Error('文件不存在')
  const old = p.files[idx]
  p.archivedFiles.push({ ...old, removedAt: new Date().toISOString(), reason: '被替换' })
  const newId = uid('f')
  const { filename: safeName, storedPath } = writeFileBytes(partId, newId, filename, bytes)
  p.files[idx] = { id: newId, label: old.label || '', filename: safeName, storedPath, addedAt: new Date().toISOString(), note: note || '' }
  p.rev = (p.rev || 0) + 1
  persist()
  return p
}

// rename a file's label / note — not a drawing change, so no rev bump
export function updateFile(partId, fileId, { label, note }) {
  const d = getData()
  const p = d.parts.find((x) => x.id === partId)
  if (!p) throw new Error('零件不存在')
  const f = p.files.find((x) => x.id === fileId)
  if (!f) throw new Error('文件不存在')
  if (label != null) f.label = label
  if (note != null) f.note = note
  persist()
  return p
}

export function deleteFile(partId, fileId) {
  const d = getData()
  const p = d.parts.find((x) => x.id === partId)
  if (!p) throw new Error('零件不存在')
  const idx = p.files.findIndex((f) => f.id === fileId)
  if (idx < 0) return p
  const [old] = p.files.splice(idx, 1)
  p.archivedFiles.push({ ...old, removedAt: new Date().toISOString(), reason: '已删除' })
  p.rev = (p.rev || 0) + 1
  persist()
  return p
}

// resolve all current files of a part for packaging (each under a part-code folder)
export function resolveCurrentFiles(partId) {
  const d = getData()
  const p = d.parts.find((x) => x.id === partId)
  if (!p || !p.files.length) return []
  const used = new Map()
  return p.files.map((f) => {
    const ext = path.extname(f.filename)
    const baseName = f.label ? sanitize(f.label) : path.basename(f.filename, ext)
    let leaf = baseName + ext
    const n = (used.get(leaf) || 0) + 1
    used.set(leaf, n)
    if (n > 1) leaf = `${baseName}(${n})${ext}`
    return {
      absPath: path.join(getDataDir(), f.storedPath),
      nameInZip: `${sanitize(p.code)}/${leaf}`
    }
  })
}

// ---------- vendors ----------

export function addVendor({ name, contact }) {
  const d = getData()
  const vendor = {
    id: uid('v'),
    name: sanitize(name),
    contact: contact || '',
    createdAt: new Date().toISOString()
  }
  d.vendors.push(vendor)
  persist()
  return vendor
}

export function updateVendor(id, fields) {
  const d = getData()
  const v = d.vendors.find((x) => x.id === id)
  if (!v) throw new Error('厂商不存在')
  if (fields.name != null) v.name = sanitize(fields.name)
  if (fields.contact != null) v.contact = fields.contact
  persist()
  return v
}

export function deleteVendor(id) {
  const d = getData()
  d.vendors = d.vendors.filter((x) => x.id !== id)
  d.assignments = d.assignments.filter((a) => a.vendorId !== id)
  persist()
  return true
}

// ---------- assignments ----------

export function setAssignment(partId, vendorId, assigned) {
  const d = getData()
  const exists = d.assignments.find((a) => a.partId === partId && a.vendorId === vendorId)
  if (assigned && !exists) d.assignments.push({ partId, vendorId })
  if (!assigned && exists) d.assignments = d.assignments.filter((a) => !(a.partId === partId && a.vendorId === vendorId))
  persist()
  return true
}

// ---------- send log / packaging support ----------

export function lastSentRev(vendorId, partId) {
  let r = null
  for (const e of getData().sendLog) {
    if (e.vendorId !== vendorId) continue
    const it = (e.items || []).find((i) => i.partId === partId)
    if (it) r = it.rev != null ? it.rev : it.version
  }
  return r
}

export function previewPackage(vendorId) {
  const d = getData()
  const vendor = d.vendors.find((v) => v.id === vendorId)
  if (!vendor) throw new Error('厂商不存在')
  const partIds = d.assignments.filter((a) => a.vendorId === vendorId).map((a) => a.partId)
  const items = partIds
    .map((pid) => {
      const p = d.parts.find((x) => x.id === pid)
      if (!p) return null
      const last = lastSentRev(vendorId, pid)
      const rev = p.rev || 0
      const files = (p.files || []).map((f) => ({ label: f.label, filename: f.filename }))
      return {
        partId: p.id,
        code: p.code,
        rev,
        fileCount: files.length,
        files,
        lastSentRev: last,
        status: last == null ? 'new' : last === rev ? 'sent' : 'stale',
        hasFile: files.length > 0,
        requirements: p.requirements || {}
      }
    })
    .filter(Boolean)
  return { vendor, items, count: items.length }
}

export function appendSendLog(vendorId, items, zipName) {
  const d = getData()
  d.sendLog.push({
    id: uid('s'),
    vendorId,
    at: new Date().toISOString(),
    items,
    zipName
  })
  persist()
}

export { sanitize }
