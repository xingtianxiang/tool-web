import { app } from 'electron'
import fs from 'node:fs'
import path from 'node:path'
import * as XLSX from 'xlsx'

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

function todayLabel() {
  return new Date().toLocaleDateString('zh-CN')
}

function sanitize(name) {
  return String(name ?? '').replace(/[\\/:*?"<>|]/g, '_').replace(/\s+/g, ' ').trim() || '未命名'
}

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

const EMPTY = { schemaVersion: 6, activeProjectId: null, vendors: [], components: [], movements: [], projects: [] }

let data = null

function createProject(name = `项目 ${todayLabel()}`) {
  const now = new Date().toISOString()
  return {
    id: uid('proj'),
    name: sanitize(name),
    status: 'active',
    createdAt: now,
    archivedAt: null,
    vendorIds: [],
    assemblies: [],
    assignments: [],
    sendLog: []
  }
}

// ---------- effective revision signature ----------
// An assembly's "version" must change when its assembly drawing changes,
// when its membership changes (both captured by assembly.rev), OR when any
// member small-part's drawing is revised (captured by each component's rev).
// The signature is compared against what was last sent to flag 需重发.
// IMPORTANT: this exact format is also reproduced by the migration and by the
// renderer (src/renderer/src/lib/state.js) — keep them identical.
function assemblySignature(assembly, compMap) {
  const members = (assembly.members || [])
    .map((m) => `${m.componentId}:${(compMap.get(m.componentId) || {}).rev ?? 'x'}`)
    .sort()
    .join(',')
  return `${assembly.rev || 0}#${members}`
}

function compMapOf(d) {
  const map = new Map()
  for (const component of d.components || []) map.set(component.id, component)
  return map
}

// ---------- legacy migration (versions[] -> files[]) ----------
function migratePartFiles(project) {
  let changed = false
  for (const part of project.parts || []) {
    if (Array.isArray(part.files)) continue
    changed = true
    const cur = part.currentVersion || 0
    part.rev = cur
    part.files = []
    part.archivedFiles = []
    for (const version of part.versions || []) {
      const file = {
        id: uid('f'),
        label: '',
        filename: version.filename,
        storedPath: version.storedPath,
        addedAt: version.addedAt || part.createdAt,
        note: version.note || ''
      }
      if (version.v === cur) part.files.push(file)
      else part.archivedFiles.push({ ...file, removedAt: version.addedAt || null, reason: '旧版本' })
    }
    delete part.versions
    delete part.currentVersion
  }
  return changed
}

// ---------- migration 4 -> 5: split per-project parts[] into a global small-part
// library (components) + per-project assemblies that reference them ----------
function splitPartsIntoAssemblies(d, project) {
  const idMap = {}
  const assemblies = []
  for (const part of project.parts || []) {
    const component = {
      id: uid('c'),
      code: part.code,
      requirements: part.requirements || {},
      files: part.files || [],
      archivedFiles: part.archivedFiles || [],
      rev: part.rev || 0,
      createdAt: part.createdAt || new Date().toISOString()
    }
    d.components.push(component)
    const assembly = {
      id: uid('a'),
      code: part.code,
      assemblyFiles: [],
      archivedAssemblyFiles: [],
      members: [{ componentId: component.id, qty: 1 }],
      notes: '',
      rev: 0,
      createdAt: part.createdAt || new Date().toISOString()
    }
    assemblies.push(assembly)
    idMap[part.id] = { assemblyId: assembly.id, componentId: component.id }
  }
  project.assemblies = assemblies
  delete project.parts
  project.assignments = (project.assignments || [])
    .map((a) => {
      const mapped = idMap[a.partId]
      return mapped ? { assemblyId: mapped.assemblyId, vendorId: a.vendorId } : null
    })
    .filter(Boolean)
  // Rebuild sendLog items as {assemblyId, sig}. The reconstructed signature
  // `0#<componentId>:<oldRev>` matches the runtime signature of a single-member
  // assembly, so a vendor that had the latest version stays "已发", an old one
  // stays "需重发" — preserving status across the migration.
  for (const entry of project.sendLog || []) {
    entry.items = (entry.items || [])
      .map((it) => {
        const mapped = idMap[it.partId]
        if (!mapped) return null
        const rev = it.rev != null ? it.rev : it.version != null ? it.version : 0
        return { assemblyId: mapped.assemblyId, sig: `0#${mapped.componentId}:${rev}` }
      })
      .filter(Boolean)
  }
}

function migrateData(d) {
  let changed = false
  if (!Array.isArray(d.vendors)) {
    d.vendors = []
    changed = true
  }
  if (!Array.isArray(d.components)) {
    d.components = []
    changed = true
  }
  if (!Array.isArray(d.movements)) {
    d.movements = []
    changed = true
  }
  if (!Array.isArray(d.projects)) {
    const project = createProject('默认项目')
    project.parts = Array.isArray(d.parts) ? d.parts : []
    project.assignments = Array.isArray(d.assignments) ? d.assignments : []
    project.sendLog = Array.isArray(d.sendLog) ? d.sendLog : []
    project.vendorIds = d.vendors.map((vendor) => vendor.id)
    d.projects = [project]
    d.activeProjectId = project.id
    delete d.parts
    delete d.assignments
    delete d.sendLog
    changed = true
  }
  if (d.projects.length === 0) {
    const project = createProject()
    d.projects.push(project)
    d.activeProjectId = project.id
    changed = true
  }
  for (const project of d.projects) {
    if (!Array.isArray(project.assignments)) {
      project.assignments = []
      changed = true
    }
    if (!Array.isArray(project.sendLog)) {
      project.sendLog = []
      changed = true
    }
    // Projects predating per-project vendor membership: keep showing every
    // vendor (current behavior) so nothing disappears; the user can trim later.
    if (!Array.isArray(project.vendorIds)) {
      project.vendorIds = d.vendors.map((vendor) => vendor.id)
      changed = true
    }
    if (!project.status) {
      project.status = 'active'
      changed = true
    }
    if (!project.createdAt) {
      project.createdAt = new Date().toISOString()
      changed = true
    }
    // Old one-level parts -> components + assemblies. Run the versions[]->files[]
    // upgrade first so the components inherit the file-based shape.
    if (Array.isArray(project.parts)) {
      if (migratePartFiles(project)) changed = true
      splitPartsIntoAssemblies(d, project)
      changed = true
    }
    if (!Array.isArray(project.assemblies)) {
      project.assemblies = []
      changed = true
    }
  }
  if (!d.projects.some((project) => project.id === d.activeProjectId)) {
    d.activeProjectId = (d.projects.find((project) => project.status === 'active') || d.projects[0]).id
    changed = true
  }
  if (d.schemaVersion !== 6) {
    d.schemaVersion = 6
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
    // data.json 存在但解析失败(损坏/半写):先留底再重建,绝不静默清空用户数据
    if (fs.existsSync(dataFile())) {
      const stamp = new Date().toISOString().slice(0, 19).replace(/[:T]/g, '-')
      try {
        fs.copyFileSync(dataFile(), dataFile() + '.corrupt-' + stamp)
        console.error('[store] data.json 解析失败,原文件已留底为 data.json.corrupt-' + stamp)
      } catch {
        /* ignore */
      }
    }
    data = JSON.parse(JSON.stringify(EMPTY))
    const project = createProject()
    data.projects.push(project)
    data.activeProjectId = project.id
    persist()
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

function currentProject() {
  const d = getData()
  const project = d.projects.find((item) => item.id === d.activeProjectId)
  if (!project) throw new Error('当前项目不存在')
  return project
}

function ensureWritableProject(project) {
  if (project.status === 'archived') throw new Error('历史项目只读，不能修改')
}

function findAssembly(project, id) {
  const assembly = (project.assemblies || []).find((item) => item.id === id)
  if (!assembly) throw new Error('组合件不存在')
  return assembly
}

function findComponent(id) {
  const component = getData().components.find((item) => item.id === id)
  if (!component) throw new Error('小零件不存在')
  return component
}

// Remove the on-disk folder that holds each given file. storedPath looks like
// `drawings/.../<fileId>/<name>`, so its dirname is the per-file folder. This
// works for both new (drawings/components|assemblies/<id>/...) and migrated
// (drawings/<oldPartId>/...) layouts without needing to know the owning root.
function removeFileDirs(files) {
  for (const file of files || []) {
    if (!file || !file.storedPath) continue
    try {
      fs.rmSync(path.dirname(path.join(getDataDir(), file.storedPath)), { recursive: true, force: true })
    } catch {
      /* ignore */
    }
  }
}

function projectSummary(project) {
  return {
    id: project.id,
    name: project.name,
    status: project.status,
    createdAt: project.createdAt,
    archivedAt: project.archivedAt || null,
    vendorIds: project.vendorIds || [],
    assemblyCount: (project.assemblies || []).length,
    assignmentCount: (project.assignments || []).length,
    sendCount: (project.sendLog || []).length
  }
}

export function getState() {
  const d = getData()
  const project = currentProject()
  return {
    activeProjectId: d.activeProjectId,
    currentProject: projectSummary(project),
    projects: d.projects.map(projectSummary),
    components: d.components,
    assemblies: project.assemblies,
    vendors: d.vendors,
    assignments: project.assignments,
    sendLog: project.sendLog,
    inventory: computeInventory(d),
    dataDir: getDataDir()
  }
}

// ---------- projects ----------

export function addProject({ name }) {
  const d = getData()
  const project = createProject(name || `项目 ${todayLabel()}`)
  d.projects.push(project)
  d.activeProjectId = project.id
  persist()
  return projectSummary(project)
}

export function updateProject(id, fields) {
  const d = getData()
  const project = d.projects.find((item) => item.id === id)
  if (!project) throw new Error('项目不存在')
  if (fields.name != null) project.name = sanitize(fields.name)
  persist()
  return projectSummary(project)
}

export function setActiveProject(id) {
  const d = getData()
  const project = d.projects.find((item) => item.id === id)
  if (!project) throw new Error('项目不存在')
  d.activeProjectId = id
  persist()
  return projectSummary(project)
}

export function archiveProject(id) {
  const d = getData()
  const project = d.projects.find((item) => item.id === id)
  if (!project) throw new Error('项目不存在')
  project.status = 'archived'
  project.archivedAt = new Date().toISOString()
  // If we just archived the current project, move focus to another active one if
  // there is one. Otherwise stay on this (now read-only) project — do NOT spawn a
  // blank project just to keep an active one around.
  if (d.activeProjectId === id) {
    const nextActive = d.projects.find((item) => item.status === 'active' && item.id !== id)
    if (nextActive) d.activeProjectId = nextActive.id
  }
  persist()
  return projectSummary(project)
}

export function unarchiveProject(id) {
  const d = getData()
  const project = d.projects.find((item) => item.id === id)
  if (!project) throw new Error('项目不存在')
  project.status = 'active'
  project.archivedAt = null
  persist()
  return projectSummary(project)
}

// Permanently delete a project. Removes its assemblies' drawing files, but NOT
// the shared small-part (component) files — those belong to the global library.
// Always leaves at least one project and a valid activeProjectId.
export function deleteProject(id) {
  const d = getData()
  const index = d.projects.findIndex((item) => item.id === id)
  if (index < 0) throw new Error('项目不存在')
  // 项目名下已领未还的零件自动回公共库存,否则这些数量会从库存里凭空消失
  const touchedComponents = new Set(d.movements.filter((m) => m.projectId === id).map((m) => m.componentId))
  for (const componentId of touchedComponents) {
    const held = allocatedOf(d, componentId, id)
    if (held > 0) pushMovement(d, { type: 'return', componentId, projectId: id, qty: held, note: '项目删除,自动回库' })
  }
  const [removed] = d.projects.splice(index, 1)
  for (const assembly of removed.assemblies || []) {
    removeFileDirs([...(assembly.assemblyFiles || []), ...(assembly.archivedAssemblyFiles || [])])
  }
  if (d.projects.length === 0) {
    const project = createProject()
    d.projects.push(project)
    d.activeProjectId = project.id
  } else if (d.activeProjectId === id) {
    const nextActive = d.projects.find((item) => item.status === 'active') || d.projects[0]
    d.activeProjectId = nextActive.id
  }
  persist()
  return true
}

// Per-project vendor membership: which of the global vendors take part in the
// current project (i.e. which columns show in the matrix).
export function addProjectVendors(vendorIds) {
  const d = getData()
  const project = currentProject()
  ensureWritableProject(project)
  if (!Array.isArray(project.vendorIds)) project.vendorIds = []
  const ids = Array.isArray(vendorIds) ? vendorIds : [vendorIds]
  for (const id of ids) {
    if (d.vendors.some((vendor) => vendor.id === id) && !project.vendorIds.includes(id)) {
      project.vendorIds.push(id)
    }
  }
  persist()
  return projectSummary(project)
}

export function removeProjectVendor(vendorId) {
  const project = currentProject()
  ensureWritableProject(project)
  project.vendorIds = (project.vendorIds || []).filter((id) => id !== vendorId)
  project.assignments = project.assignments.filter((item) => item.vendorId !== vendorId)
  persist()
  return projectSummary(project)
}

// ---------- shared small-part library (components) ----------

export function addComponent({ code, requirements, description }) {
  const d = getData()
  const component = {
    id: uid('c'),
    code: sanitize(code),
    description: description || '', // internal-only note, never put on the 需求单 PDF
    requirements: requirements || {},
    files: [],
    archivedFiles: [],
    rev: 0,
    createdAt: new Date().toISOString()
  }
  d.components.push(component)
  persist()
  return component
}

export function updateComponent(id, fields) {
  const component = findComponent(id)
  if (fields.code != null) component.code = sanitize(fields.code)
  if (fields.description != null) component.description = fields.description
  if (fields.requirements) component.requirements = { ...component.requirements, ...fields.requirements }
  persist()
  return component
}

export function deleteComponent(id) {
  const d = getData()
  const users = []
  for (const project of d.projects) {
    for (const assembly of project.assemblies || []) {
      if ((assembly.members || []).some((m) => m.componentId === id)) users.push(assembly.code)
    }
  }
  if (users.length) throw new Error(`该小零件被 ${users.length} 个组合件使用，请先从组合件中移除`)
  const component = d.components.find((item) => item.id === id)
  if (!component) throw new Error('小零件不存在')
  d.components = d.components.filter((item) => item.id !== id)
  removeFileDirs([...(component.files || []), ...(component.archivedFiles || [])])
  persist()
  return true
}

function componentDir(componentId) {
  return path.join('drawings', 'components', componentId)
}

export function addComponentFile(componentId, { filename, bytes, label, note }) {
  const component = findComponent(componentId)
  const fileId = uid('f')
  const { filename: safeName, storedPath } = writeFileBytes(componentDir(componentId), fileId, filename, bytes)
  component.files.push({ id: fileId, label: label || '', filename: safeName, storedPath, addedAt: new Date().toISOString(), note: note || '' })
  component.rev = (component.rev || 0) + 1
  persist()
  return component
}

export function replaceComponentFile(componentId, fileId, { filename, bytes, note }) {
  const component = findComponent(componentId)
  const index = component.files.findIndex((file) => file.id === fileId)
  if (index < 0) throw new Error('文件不存在')
  const old = component.files[index]
  component.archivedFiles.push({ ...old, removedAt: new Date().toISOString(), reason: '被替换' })
  const newId = uid('f')
  const { filename: safeName, storedPath } = writeFileBytes(componentDir(componentId), newId, filename, bytes)
  component.files[index] = { id: newId, label: old.label || '', filename: safeName, storedPath, addedAt: new Date().toISOString(), note: note || '' }
  component.rev = (component.rev || 0) + 1
  persist()
  return component
}

export function updateComponentFile(componentId, fileId, { label, note }) {
  const component = findComponent(componentId)
  const file = component.files.find((item) => item.id === fileId)
  if (!file) throw new Error('文件不存在')
  if (label != null) file.label = label
  if (note != null) file.note = note
  persist()
  return component
}

export function deleteComponentFile(componentId, fileId) {
  const component = findComponent(componentId)
  const index = component.files.findIndex((file) => file.id === fileId)
  if (index < 0) return component
  const [old] = component.files.splice(index, 1)
  component.archivedFiles.push({ ...old, removedAt: new Date().toISOString(), reason: '已删除' })
  component.rev = (component.rev || 0) + 1
  persist()
  return component
}

// ---------- per-project assemblies (组合件, the matrix rows) ----------

export function addAssembly({ code, notes, buildQty }) {
  const project = currentProject()
  ensureWritableProject(project)
  const assembly = {
    id: uid('a'),
    code: sanitize(code),
    assemblyFiles: [],
    archivedAssemblyFiles: [],
    members: [],
    notes: notes || '',
    buildQty: Math.max(1, Number(buildQty) || 1),
    rev: 0,
    createdAt: new Date().toISOString()
  }
  project.assemblies.push(assembly)
  persist()
  return assembly
}

export function updateAssembly(id, fields) {
  const project = currentProject()
  ensureWritableProject(project)
  const assembly = findAssembly(project, id)
  if (fields.code != null) assembly.code = sanitize(fields.code)
  if (fields.notes != null) assembly.notes = fields.notes
  if (fields.buildQty != null) assembly.buildQty = Math.max(1, Number(fields.buildQty) || 1)
  persist()
  return assembly
}

export function deleteAssembly(id) {
  const project = currentProject()
  ensureWritableProject(project)
  const assembly = (project.assemblies || []).find((item) => item.id === id)
  if (!assembly) throw new Error('组合件不存在')
  project.assemblies = project.assemblies.filter((item) => item.id !== id)
  project.assignments = project.assignments.filter((item) => item.assemblyId !== id)
  // Only the assembly's own drawing files are removed; member components are shared.
  removeFileDirs([...(assembly.assemblyFiles || []), ...(assembly.archivedAssemblyFiles || [])])
  persist()
  return true
}

export function addAssemblyMembers(assemblyId, componentIds) {
  const d = getData()
  const project = currentProject()
  ensureWritableProject(project)
  const assembly = findAssembly(project, assemblyId)
  const ids = Array.isArray(componentIds) ? componentIds : [componentIds]
  for (const cid of ids) {
    if (d.components.some((c) => c.id === cid) && !assembly.members.some((m) => m.componentId === cid)) {
      assembly.members.push({ componentId: cid, qty: 1 })
    }
  }
  assembly.rev = (assembly.rev || 0) + 1
  persist()
  return assembly
}

export function removeAssemblyMember(assemblyId, componentId) {
  const project = currentProject()
  ensureWritableProject(project)
  const assembly = findAssembly(project, assemblyId)
  assembly.members = assembly.members.filter((m) => m.componentId !== componentId)
  assembly.rev = (assembly.rev || 0) + 1
  persist()
  return assembly
}

export function setMemberQty(assemblyId, componentId, qty) {
  const project = currentProject()
  ensureWritableProject(project)
  const assembly = findAssembly(project, assemblyId)
  const member = assembly.members.find((m) => m.componentId === componentId)
  if (member) member.qty = Math.max(1, Number(qty) || 1)
  // qty does not change which drawings get sent, so it does not bump rev / mark stale.
  persist()
  return assembly
}

function assemblyDir(assemblyId) {
  return path.join('drawings', 'assemblies', assemblyId)
}

export function addAssemblyFile(assemblyId, { filename, bytes, label, note }) {
  const project = currentProject()
  ensureWritableProject(project)
  const assembly = findAssembly(project, assemblyId)
  const fileId = uid('f')
  const { filename: safeName, storedPath } = writeFileBytes(assemblyDir(assemblyId), fileId, filename, bytes)
  assembly.assemblyFiles.push({ id: fileId, label: label || '', filename: safeName, storedPath, addedAt: new Date().toISOString(), note: note || '' })
  assembly.rev = (assembly.rev || 0) + 1
  persist()
  return assembly
}

export function replaceAssemblyFile(assemblyId, fileId, { filename, bytes, note }) {
  const project = currentProject()
  ensureWritableProject(project)
  const assembly = findAssembly(project, assemblyId)
  const index = assembly.assemblyFiles.findIndex((file) => file.id === fileId)
  if (index < 0) throw new Error('文件不存在')
  const old = assembly.assemblyFiles[index]
  assembly.archivedAssemblyFiles.push({ ...old, removedAt: new Date().toISOString(), reason: '被替换' })
  const newId = uid('f')
  const { filename: safeName, storedPath } = writeFileBytes(assemblyDir(assemblyId), newId, filename, bytes)
  assembly.assemblyFiles[index] = { id: newId, label: old.label || '', filename: safeName, storedPath, addedAt: new Date().toISOString(), note: note || '' }
  assembly.rev = (assembly.rev || 0) + 1
  persist()
  return assembly
}

export function updateAssemblyFile(assemblyId, fileId, { label, note }) {
  const project = currentProject()
  ensureWritableProject(project)
  const assembly = findAssembly(project, assemblyId)
  const file = assembly.assemblyFiles.find((item) => item.id === fileId)
  if (!file) throw new Error('文件不存在')
  if (label != null) file.label = label
  if (note != null) file.note = note
  persist()
  return assembly
}

export function deleteAssemblyFile(assemblyId, fileId) {
  const project = currentProject()
  ensureWritableProject(project)
  const assembly = findAssembly(project, assemblyId)
  const index = assembly.assemblyFiles.findIndex((file) => file.id === fileId)
  if (index < 0) return assembly
  const [old] = assembly.assemblyFiles.splice(index, 1)
  assembly.archivedAssemblyFiles.push({ ...old, removedAt: new Date().toISOString(), reason: '已删除' })
  assembly.rev = (assembly.rev || 0) + 1
  persist()
  return assembly
}

// ---------- shared file writer ----------
function writeFileBytes(relBase, fileId, filename, bytes) {
  const safeName = sanitize(filename || '图纸')
  const relDir = path.join(relBase, fileId)
  const absDir = path.join(getDataDir(), relDir)
  fs.mkdirSync(absDir, { recursive: true })
  fs.writeFileSync(path.join(absDir, safeName), Buffer.from(bytes))
  return { filename: safeName, storedPath: path.join(relDir, safeName).split(path.sep).join('/') }
}

// Gather every file that should go into a vendor package for one assembly:
// its assembly drawing (under 装配图/) plus each member small-part's current
// drawings (under that component's code folder).
export function resolveAssemblyFiles(assemblyId) {
  const d = getData()
  const project = currentProject()
  const assembly = (project.assemblies || []).find((item) => item.id === assemblyId)
  if (!assembly) return []
  const compMap = compMapOf(d)
  const assemblyCode = sanitize(assembly.code)
  const out = []
  const pushFiles = (files, folder) => {
    const used = new Map()
    for (const file of files) {
      const ext = path.extname(file.filename)
      const baseName = file.label ? sanitize(file.label) : path.basename(file.filename, ext)
      let leaf = baseName + ext
      const n = (used.get(leaf) || 0) + 1
      used.set(leaf, n)
      if (n > 1) leaf = `${baseName}(${n})${ext}`
      out.push({ absPath: path.join(getDataDir(), file.storedPath), nameInZip: `${folder}/${leaf}` })
    }
  }
  pushFiles(assembly.assemblyFiles || [], `${assemblyCode}/装配图`)
  const usedFolders = new Map()
  for (const member of assembly.members || []) {
    const component = compMap.get(member.componentId)
    if (!component || !(component.files || []).length) continue
    let folderName = sanitize(component.code)
    const n = (usedFolders.get(folderName) || 0) + 1
    usedFolders.set(folderName, n)
    if (n > 1) folderName = `${folderName}(${n})`
    pushFiles(component.files, `${assemblyCode}/${folderName}`)
  }
  return out
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
  const vendor = d.vendors.find((item) => item.id === id)
  if (!vendor) throw new Error('厂商不存在')
  if (fields.name != null) vendor.name = sanitize(fields.name)
  if (fields.contact != null) vendor.contact = fields.contact
  persist()
  return vendor
}

export function deleteVendor(id) {
  const d = getData()
  d.vendors = d.vendors.filter((item) => item.id !== id)
  for (const project of d.projects) {
    project.vendorIds = (project.vendorIds || []).filter((vid) => vid !== id)
    project.assignments = project.assignments.filter((item) => item.vendorId !== id)
  }
  persist()
  return true
}

// ---------- bulk import (Excel / CSV) ----------
// Lets several people each fill a standard spreadsheet and have the operator
// merge them in. We MERGE by key (vendor name / 图号): existing rows are updated,
// new rows are created. Empty cells mean "leave unchanged" — we never blank an
// existing spec or delete local entries. Reuses addVendor/updateVendor/
// addComponent/updateComponent so the stored shape stays identical.

const VENDOR_ALIASES = {
  name: ['厂商名称', '厂商', '名称', 'name', 'vendor'],
  contact: ['联系方式', '联系', '联系人', '备注', 'contact']
}
const COMPONENT_ALIASES = {
  code: ['图号', '编号', '零件号', '图号/编号', 'code'],
  material: ['材料', 'material'],
  tolerance: ['公差', 'tolerance'],
  surface: ['表面处理', '表面', 'surface'],
  description: ['描述', '说明', 'description']
}

function cellStr(v) {
  return v == null ? '' : String(v).trim()
}

// First non-empty cell in `row` whose (trimmed) header matches one of `aliases`.
function fieldFrom(row, aliases) {
  for (const key of Object.keys(row)) {
    if (aliases.includes(String(key).trim())) {
      const v = cellStr(row[key])
      if (v) return v
    }
  }
  return ''
}

function rowHasAnyValue(row) {
  return Object.values(row).some((v) => cellStr(v))
}

function pruneEmpty(obj) {
  const out = {}
  for (const [k, v] of Object.entries(obj)) if (cellStr(v)) out[k] = v
  return out
}

function sheetRows(wb, predicate) {
  const name = wb.SheetNames.find((n) => predicate(String(n)))
  if (!name) return null
  return XLSX.utils.sheet_to_json(wb.Sheets[name], { defval: '' })
}

// Parse ONE workbook (bytes = Uint8Array/Buffer) into normalized vendor/component
// rows. Keys are sanitize()d so they match what add* will store. Returns errors
// for value-bearing rows that are missing their key column.
export function parseImportWorkbook(bytes) {
  const wb = XLSX.read(Buffer.from(bytes), { type: 'buffer' })
  const vendors = []
  const components = []
  const errors = []

  const vendorRows = sheetRows(wb, (n) => n.includes('厂商'))
  if (vendorRows) {
    vendorRows.forEach((row, i) => {
      const name = fieldFrom(row, VENDOR_ALIASES.name)
      if (!name) {
        if (rowHasAnyValue(row)) errors.push(`「厂商」表第 ${i + 2} 行缺少厂商名称，已跳过`)
        return
      }
      if (/^示例/.test(name)) return // 模板自带的示例行,不当真数据导入
      vendors.push({ name: sanitize(name), contact: fieldFrom(row, VENDOR_ALIASES.contact) })
    })
  }

  const compRows = sheetRows(wb, (n) => n.includes('零件'))
  if (compRows) {
    compRows.forEach((row, i) => {
      const code = fieldFrom(row, COMPONENT_ALIASES.code)
      if (!code) {
        if (rowHasAnyValue(row)) errors.push(`「小零件」表第 ${i + 2} 行缺少图号，已跳过`)
        return
      }
      if (/^示例/.test(code)) return // 模板自带的示例行,不当真数据导入
      components.push({
        code: sanitize(code),
        requirements: {
          material: fieldFrom(row, COMPONENT_ALIASES.material),
          tolerance: fieldFrom(row, COMPONENT_ALIASES.tolerance),
          surface: fieldFrom(row, COMPONENT_ALIASES.surface)
        },
        description: fieldFrom(row, COMPONENT_ALIASES.description)
      })
    })
  }

  if (!vendorRows && !compRows) {
    errors.push('没找到「厂商」或「小零件」工作表。请用「下载导入模板」里的表头格式。')
  }
  return { vendors, components, errors }
}

// Merge several parsed workbooks by key; later files win on conflicts.
function mergeParsed(parsedList) {
  const vendorMap = new Map()
  const componentMap = new Map()
  const errors = []
  const dupVendors = new Set()
  const dupComponents = new Set()
  for (const p of parsedList) {
    errors.push(...p.errors)
    for (const v of p.vendors) {
      if (vendorMap.has(v.name)) dupVendors.add(v.name)
      vendorMap.set(v.name, v)
    }
    for (const c of p.components) {
      if (componentMap.has(c.code)) dupComponents.add(c.code)
      componentMap.set(c.code, c)
    }
  }
  if (dupVendors.size) errors.push(`厂商重复（取最后一条）：${[...dupVendors].join('、')}`)
  if (dupComponents.size) errors.push(`图号重复（取最后一条）：${[...dupComponents].join('、')}`)
  return { vendors: [...vendorMap.values()], components: [...componentMap.values()], errors }
}

function normalizeBytesList(bytesList) {
  return (Array.isArray(bytesList) ? bytesList : [bytesList]).filter(Boolean)
}

// Dry run: classify each merged row as add/update vs current data. No writes.
export function previewImport(bytesList) {
  const merged = mergeParsed(normalizeBytesList(bytesList).map((b) => parseImportWorkbook(b)))
  const d = getData()
  const existingVendorNames = new Set(d.vendors.map((v) => v.name))
  const existingCodes = new Set(d.components.map((c) => c.code))
  const vendorRows = merged.vendors.map((v) => ({
    name: v.name,
    contact: v.contact,
    action: existingVendorNames.has(v.name) ? 'update' : 'add'
  }))
  const componentRows = merged.components.map((c) => ({
    code: c.code,
    material: c.requirements.material,
    tolerance: c.requirements.tolerance,
    surface: c.requirements.surface,
    description: c.description,
    action: existingCodes.has(c.code) ? 'update' : 'add'
  }))
  return {
    vendors: {
      toAdd: vendorRows.filter((r) => r.action === 'add').length,
      toUpdate: vendorRows.filter((r) => r.action === 'update').length,
      rows: vendorRows
    },
    components: {
      toAdd: componentRows.filter((r) => r.action === 'add').length,
      toUpdate: componentRows.filter((r) => r.action === 'update').length,
      rows: componentRows
    },
    errors: merged.errors
  }
}

// Commit: re-parse (don't trust renderer-side edits) and upsert. Empty cells are
// pruned so they never overwrite an existing value.
export function applyImport(bytesList) {
  const merged = mergeParsed(normalizeBytesList(bytesList).map((b) => parseImportWorkbook(b)))
  const d = getData()
  let vAdded = 0
  let vUpdated = 0
  let cAdded = 0
  let cUpdated = 0
  for (const v of merged.vendors) {
    const existing = d.vendors.find((x) => x.name === v.name)
    if (existing) {
      updateVendor(existing.id, v.contact ? { contact: v.contact } : {})
      vUpdated++
    } else {
      addVendor(v)
      vAdded++
    }
  }
  for (const c of merged.components) {
    const requirements = pruneEmpty(c.requirements)
    const existing = d.components.find((x) => x.code === c.code)
    if (existing) {
      const fields = {}
      if (Object.keys(requirements).length) fields.requirements = requirements
      if (c.description) fields.description = c.description
      updateComponent(existing.id, fields)
      cUpdated++
    } else {
      addComponent({ code: c.code, requirements, description: c.description })
      cAdded++
    }
  }
  return {
    vendors: { added: vAdded, updated: vUpdated },
    components: { added: cAdded, updated: cUpdated },
    errors: merged.errors
  }
}

// Write a blank 2-sheet template (厂商 / 小零件) with headers + one sample row.
export function writeImportTemplate(outPath) {
  const wb = XLSX.utils.book_new()
  const vendorWs = XLSX.utils.aoa_to_sheet([
    ['厂商名称', '联系方式'],
    ['示例：甲精密', '微信 / 联系人 / 电话（选填）']
  ])
  const compWs = XLSX.utils.aoa_to_sheet([
    ['图号', '材料', '公差', '表面处理', '描述'],
    ['示例：ABC-001', '6061 铝', '±0.05', '阳极氧化', '仅自己看，不进需求单（选填）']
  ])
  XLSX.utils.book_append_sheet(wb, vendorWs, '厂商')
  XLSX.utils.book_append_sheet(wb, compWs, '小零件')
  XLSX.writeFile(wb, outPath)
  return { path: outPath }
}

// ---------- inventory / warehouse ----------
// Physical stock is tracked at the small-part (component) level, since only
// components actually arrive. Every quantity is DERIVED from an append-only
// movements log, so numbers stay auditable and a mis-entry can just be deleted.
//   in     : received. projectId null => shared pool; projectId set => received
//            straight to that project (counts as its allocation, not pool).
//   out    : allocated from the pool to a project.
//   return : sent back from a project to the pool.
//   adjust : stock-take correction (qty may be negative).

function pushMovement(d, m) {
  d.movements.push({ id: uid('m'), at: new Date().toISOString(), note: '', ...m })
}

function poolOnHandOf(d, componentId) {
  let n = 0
  for (const m of d.movements) {
    if (m.componentId !== componentId) continue
    if (m.type === 'in' && m.projectId == null) n += m.qty
    else if (m.type === 'out') n -= m.qty
    else if (m.type === 'return') n += m.qty
    else if (m.type === 'adjust' && m.projectId == null) n += m.qty
  }
  return n
}

function allocatedOf(d, componentId, projectId) {
  let n = 0
  for (const m of d.movements) {
    if (m.componentId !== componentId || m.projectId !== projectId) continue
    if (m.type === 'in' || m.type === 'out' || m.type === 'adjust') n += m.qty
    else if (m.type === 'return') n -= m.qty
  }
  return n
}

function qtyOrThrow(qty) {
  const n = Number(qty)
  if (!Number.isFinite(n) || n <= 0) throw new Error('数量必须是正数')
  return n
}

export function stockIn(componentId, { qty, projectId = null, vendorId = null, location, note, photos } = {}) {
  const d = getData()
  const component = findComponent(componentId)
  const n = qtyOrThrow(qty)
  if (projectId != null && !d.projects.some((p) => p.id === projectId)) throw new Error('项目不存在')
  if (location != null && location !== '') component.location = location
  const id = uid('m')
  // 入库凭证照片 (optional, one or more) stored like drawings under receipts/<movementId>/
  const photoRefs = []
  for (const ph of photos || []) {
    if (!ph || !ph.bytes) continue
    const fileId = uid('f')
    const { filename, storedPath } = writeFileBytes(path.join('receipts', id), fileId, ph.filename, ph.bytes)
    photoRefs.push({ id: fileId, filename, storedPath })
  }
  d.movements.push({ id, at: new Date().toISOString(), type: 'in', componentId, projectId: projectId || null, qty: n, vendorId: vendorId || null, note: note || '', photos: photoRefs })
  persist()
  return computeInventory(d)
}

export function stockAllocate(componentId, projectId, { qty, note } = {}) {
  const d = getData()
  findComponent(componentId)
  if (!d.projects.some((p) => p.id === projectId)) throw new Error('项目不存在')
  const n = qtyOrThrow(qty)
  const pool = poolOnHandOf(d, componentId)
  if (n > pool) throw new Error(`公共库存只有 ${pool} 个，不够分发 ${n} 个`)
  pushMovement(d, { type: 'out', componentId, projectId, qty: n, note: note || '' })
  persist()
  return computeInventory(d)
}

export function stockReturn(componentId, projectId, { qty, note } = {}) {
  const d = getData()
  findComponent(componentId)
  if (!d.projects.some((p) => p.id === projectId)) throw new Error('项目不存在')
  const n = qtyOrThrow(qty)
  const held = allocatedOf(d, componentId, projectId)
  if (n > held) throw new Error(`该项目只领了 ${held} 个，不能回库 ${n} 个`)
  pushMovement(d, { type: 'return', componentId, projectId, qty: n, note: note || '' })
  persist()
  return computeInventory(d)
}

export function stockAdjust(componentId, { qty, projectId = null, note } = {}) {
  const d = getData()
  findComponent(componentId)
  const n = Number(qty)
  if (!Number.isFinite(n) || n === 0) throw new Error('盘点数量必须是非零数字（可为负）')
  if (projectId != null && !d.projects.some((p) => p.id === projectId)) throw new Error('项目不存在')
  pushMovement(d, { type: 'adjust', componentId, projectId: projectId || null, qty: n, note: note || '' })
  persist()
  return computeInventory(d)
}

export function setComponentLocation(componentId, location) {
  const component = findComponent(componentId)
  component.location = location || ''
  persist()
  return component
}

export function deleteMovement(id) {
  const d = getData()
  const target = d.movements.find((m) => m.id === id)
  if (!target) throw new Error('记录不存在')
  // 先模拟撤销:任何余额会变负就拒绝,防止"入库已被分发出去,还撤销那条入库"的倒挂
  const after = { movements: d.movements.filter((m) => m.id !== id) }
  const pool = poolOnHandOf(after, target.componentId)
  if (pool < 0) throw new Error(`不能撤销:撤销后公共库存会变成 ${pool}。请先撤销这条记录之后发生的分发`)
  for (const project of d.projects) {
    const held = allocatedOf(after, target.componentId, project.id)
    if (held < 0) throw new Error(`不能撤销:撤销后「${project.name}」的已领数会变成 ${held}。请先撤销该项目更晚的相关记录`)
  }
  removeFileDirs(target.photos)
  d.movements = after.movements
  persist()
  return computeInventory(d)
}

// Per-project demand for a component = Σ over the project's assemblies of
// (buildQty × member.qty). Drives the 缺口 view.
function demandOf(project, componentId) {
  let n = 0
  for (const assembly of project.assemblies || []) {
    const build = Math.max(1, Number(assembly.buildQty) || 1)
    for (const m of assembly.members || []) {
      if (m.componentId === componentId) n += build * (Number(m.qty) || 1)
    }
  }
  return n
}

// Cross-project rollup consumed by the 仓库 page: pool balances + per-project
// allocations, per-project demand gaps, and recent movements (newest first).
function computeInventory(d) {
  const projects = d.projects || []
  const components = (d.components || []).map((c) => {
    const poolOnHand = poolOnHandOf(d, c.id)
    const allocations = projects
      .map((p) => ({ projectId: p.id, projectName: p.name, allocated: allocatedOf(d, c.id, p.id) }))
      .filter((a) => a.allocated !== 0)
    const totalPhysical = poolOnHand + allocations.reduce((s, a) => s + a.allocated, 0)
    return { id: c.id, code: c.code, description: c.description || '', location: c.location || '', poolOnHand, totalPhysical, allocations }
  })
  const projectNeeds = projects.map((p) => {
    const seen = new Set()
    const needs = []
    for (const assembly of p.assemblies || []) {
      for (const m of assembly.members || []) {
        if (seen.has(m.componentId)) continue
        seen.add(m.componentId)
        const demand = demandOf(p, m.componentId)
        if (demand === 0) continue
        const comp = (d.components || []).find((c) => c.id === m.componentId)
        const allocated = allocatedOf(d, m.componentId, p.id)
        const poolOnHand = poolOnHandOf(d, m.componentId)
        const gap = Math.max(0, demand - allocated)
        needs.push({ componentId: m.componentId, code: comp ? comp.code : '(已删除)', demand, allocated, gap, poolOnHand, enough: gap === 0 || poolOnHand >= gap })
      }
    }
    needs.sort((a, b) => b.gap - a.gap)
    return { id: p.id, name: p.name, status: p.status, needs }
  })
  const movements = [...(d.movements || [])].reverse().slice(0, 200).map((m) => {
    const comp = (d.components || []).find((c) => c.id === m.componentId)
    const proj = projects.find((p) => p.id === m.projectId)
    return { ...m, code: comp ? comp.code : '(已删除)', projectName: proj ? proj.name : m.projectId ? '(已删除项目)' : null }
  })
  return { components, projects: projectNeeds, movements }
}

// ---------- usage report (用料报表) ----------
// A per-project, date-ranged rollup of parts usage, for 组会汇报 / 结算.
// movement.at is a UTC ISO string, but the date range the user picks is in LOCAL
// calendar days — so we bucket by the movement's LOCAL date, never by the raw
// ISO prefix (that would be off by the timezone offset near midnight).
// 领用 = 从公共库存分发到项目(out) + 直达入库到项目(in);回库 = return;
// 盘点(adjust)不计入用料。净用料 = 领用 − 回库。

function localDateStr(iso) {
  const d = new Date(iso)
  const p = (n) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`
}

function localDateTimeStr(iso) {
  const d = new Date(iso)
  const p = (n) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`
}

const USAGE_TYPE_LABEL = { out: '领用', in: '直达入库', return: '回库' }

function computeUsageReport(d, projectId, from, to) {
  const project = (d.projects || []).find((p) => p.id === projectId)
  if (!project) throw new Error('项目不存在')
  const compMap = compMapOf(d)
  const inRange = (iso) => {
    const ds = localDateStr(iso)
    if (from && ds < from) return false
    if (to && ds > to) return false
    return true
  }
  const byComp = new Map()
  const detail = []
  for (const m of d.movements || []) {
    if (m.projectId !== projectId) continue
    if (m.type === 'adjust') continue
    const isTake = m.type === 'out' || m.type === 'in'
    const isReturn = m.type === 'return'
    if (!isTake && !isReturn) continue
    if (!inRange(m.at)) continue
    const rec = byComp.get(m.componentId) || { taken: 0, returned: 0 }
    if (isTake) rec.taken += m.qty
    else rec.returned += m.qty
    byComp.set(m.componentId, rec)
    const comp = compMap.get(m.componentId)
    detail.push({
      at: m.at,
      time: localDateTimeStr(m.at),
      type: m.type,
      typeLabel: USAGE_TYPE_LABEL[m.type] || m.type,
      code: comp ? comp.code : '(已删除)',
      qty: m.qty,
      note: m.note || ''
    })
  }
  const rows = [...byComp.entries()].map(([componentId, rec]) => {
    const comp = compMap.get(componentId)
    return {
      componentId,
      code: comp ? comp.code : '(已删除)',
      description: comp ? comp.description || '' : '',
      taken: rec.taken,
      returned: rec.returned,
      net: rec.taken - rec.returned
    }
  })
  rows.sort((a, b) => b.net - a.net || a.code.localeCompare(b.code))
  detail.sort((a, b) => (a.at < b.at ? -1 : a.at > b.at ? 1 : 0))
  return { project: { id: project.id, name: project.name, status: project.status }, from: from || '', to: to || '', rows, detail }
}

export function projectUsageReport(projectId, { from, to } = {}) {
  return computeUsageReport(getData(), projectId, from || '', to || '')
}

export function exportUsageReport(outPath, projectId, { from, to } = {}) {
  const rep = computeUsageReport(getData(), projectId, from || '', to || '')
  const rangeLabel = rep.from || rep.to ? `${rep.from || '最早'} ~ ${rep.to || '至今'}` : '全部时间'
  const wb = XLSX.utils.book_new()

  const summaryAoa = [
    [`项目：${rep.project.name}${rep.project.status === 'archived' ? '（历史）' : ''}`],
    [`时间范围：${rangeLabel}`],
    [`导出日期：${todayLabel()}`],
    [],
    ['图号', '描述', '期间领用', '期间回库', '净用料', '单位'],
    ...rep.rows.map((r) => [r.code, r.description, r.taken, r.returned, r.net, '个'])
  ]
  if (rep.rows.length === 0) summaryAoa.push(['（该时间段内没有领用或回库记录）'])
  const summaryWs = XLSX.utils.aoa_to_sheet(summaryAoa)
  summaryWs['!cols'] = [{ wch: 22 }, { wch: 24 }, { wch: 10 }, { wch: 10 }, { wch: 10 }, { wch: 6 }]
  XLSX.utils.book_append_sheet(wb, summaryWs, '用料汇总')

  const detailAoa = [
    ['时间', '类型', '图号', '数量', '备注'],
    ...rep.detail.map((m) => [m.time, m.typeLabel, m.code, m.qty, m.note])
  ]
  if (rep.detail.length === 0) detailAoa.push(['（该时间段内没有流水记录）'])
  const detailWs = XLSX.utils.aoa_to_sheet(detailAoa)
  detailWs['!cols'] = [{ wch: 18 }, { wch: 10 }, { wch: 22 }, { wch: 8 }, { wch: 30 }]
  XLSX.utils.book_append_sheet(wb, detailWs, '明细')

  XLSX.writeFile(wb, outPath)
  return { path: outPath }
}

// ---------- assignments + packaging ----------

export function setAssignment(assemblyId, vendorId, assigned) {
  const project = currentProject()
  ensureWritableProject(project)
  const exists = project.assignments.find((item) => item.assemblyId === assemblyId && item.vendorId === vendorId)
  if (assigned && !exists) project.assignments.push({ assemblyId, vendorId, deadline: '', note: '' })
  if (!assigned && exists) {
    project.assignments = project.assignments.filter((item) => !(item.assemblyId === assemblyId && item.vendorId === vendorId))
  }
  persist()
  return true
}

// Per-cell (组合件×厂商) 交期 + 打包备注 — printed on that vendor's 需求单 next to
// the assembly, so each vendor can get a different deadline/note.
export function setAssignmentMeta(assemblyId, vendorId, { deadline, note }) {
  const project = currentProject()
  ensureWritableProject(project)
  const assignment = project.assignments.find((item) => item.assemblyId === assemblyId && item.vendorId === vendorId)
  if (!assignment) throw new Error('该格子还没指派，先点格子指派再写打包备注')
  if (deadline != null) assignment.deadline = deadline
  if (note != null) assignment.note = note
  persist()
  return true
}

function lastSentSig(project, vendorId, assemblyId) {
  let sig = null
  for (const entry of project.sendLog) {
    if (entry.vendorId !== vendorId) continue
    const item = (entry.items || []).find((candidate) => candidate.assemblyId === assemblyId)
    if (item && item.sig != null) sig = item.sig
  }
  return sig
}

export function previewPackage(vendorId) {
  const d = getData()
  const project = currentProject()
  const vendor = d.vendors.find((item) => item.id === vendorId)
  if (!vendor) throw new Error('厂商不存在')
  const compMap = compMapOf(d)
  const items = project.assignments
    .filter((item) => item.vendorId === vendorId)
    .map((assignment) => {
      const assembly = (project.assemblies || []).find((item) => item.id === assignment.assemblyId)
      if (!assembly) return null
      const sig = assemblySignature(assembly, compMap)
      const last = lastSentSig(project, vendorId, assembly.id)
      const assemblyFiles = (assembly.assemblyFiles || []).map((file) => ({ label: file.label, filename: file.filename }))
      const members = (assembly.members || []).map((member) => {
        const component = compMap.get(member.componentId)
        return {
          componentId: member.componentId,
          code: component ? component.code : '(已删除小零件)',
          qty: member.qty || 1,
          requirements: component ? component.requirements || {} : {},
          files: component ? (component.files || []).map((file) => ({ label: file.label, filename: file.filename })) : [],
          fileCount: component ? (component.files || []).length : 0,
          rev: component ? component.rev || 0 : 0
        }
      })
      const fileCount = assemblyFiles.length + members.reduce((sum, member) => sum + member.fileCount, 0)
      return {
        assemblyId: assembly.id,
        code: assembly.code,
        notes: assembly.notes || '',
        deadline: assignment.deadline || '',
        note: assignment.note || '',
        assemblyFiles,
        members,
        fileCount,
        hasFile: fileCount > 0,
        sig,
        lastSentSig: last,
        status: last == null ? 'new' : last === sig ? 'sent' : 'stale'
      }
    })
    .filter(Boolean)
  return { vendor, project: projectSummary(project), items, count: items.length }
}

export function appendSendLog(vendorId, items, zipName) {
  const project = currentProject()
  ensureWritableProject(project)
  project.sendLog.push({
    id: uid('s'),
    vendorId,
    at: new Date().toISOString(),
    items,
    zipName
  })
  persist()
}

export { sanitize }
