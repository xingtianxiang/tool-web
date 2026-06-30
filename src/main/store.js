import { app } from 'electron'
import fs from 'node:fs'
import path from 'node:path'

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

const EMPTY = { schemaVersion: 5, activeProjectId: null, vendors: [], components: [], projects: [] }

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
  if (d.schemaVersion !== 5) {
    d.schemaVersion = 5
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

export function addAssembly({ code, notes }) {
  const project = currentProject()
  ensureWritableProject(project)
  const assembly = {
    id: uid('a'),
    code: sanitize(code),
    assemblyFiles: [],
    archivedAssemblyFiles: [],
    members: [],
    notes: notes || '',
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
