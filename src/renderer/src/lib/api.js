function clone(value) {
  return JSON.parse(JSON.stringify(value))
}

// Same effective-version signature as the main process (src/main/store.js) and
// the matrix (src/renderer/src/lib/state.js). Must stay byte-identical.
function signatureOf(assembly, compMap) {
  const members = (assembly.members || [])
    .map((m) => `${m.componentId}:${(compMap.get(m.componentId) || {}).rev ?? 'x'}`)
    .sort()
    .join(',')
  return `${assembly.rev || 0}#${members}`
}

function createPreviewApi() {
  // ----- global small-part library (shared across projects) -----
  const components = [
    {
      id: 'c-plate',
      code: 'BRK-A01 支撑板',
      rev: 3,
      requirements: { material: '6061-T6', qty: '12', tolerance: '+/-0.05', surface: '阳极氧化黑色', deadline: '本周五', notes: '边缘倒角，装配面不可划伤' },
      files: [
        { id: 'f-2d', label: '2D 图纸', filename: 'BRK-A01_2D.pdf', storedPath: 'drawings/components/c-plate/f-2d/BRK-A01_2D.pdf' },
        { id: 'f-3d', label: '3D 模型', filename: 'BRK-A01.step', storedPath: 'drawings/components/c-plate/f-3d/BRK-A01.step' }
      ],
      archivedFiles: []
    },
    {
      id: 'c-axis',
      code: 'SHAFT-B12 传动轴',
      rev: 2,
      requirements: { material: '40Cr', qty: '8', tolerance: 'h6', surface: '发黑', deadline: '下周三', notes: '' },
      files: [{ id: 'f-axis', label: '加工图', filename: 'SHAFT-B12.pdf', storedPath: 'drawings/components/c-axis/f-axis/SHAFT-B12.pdf' }],
      archivedFiles: []
    },
    {
      id: 'c-bolt',
      code: 'BOLT-M6 定位螺栓',
      rev: 1,
      requirements: { material: '不锈钢304', qty: '40', tolerance: '', surface: '本色', deadline: '', notes: '通用件，多处复用' },
      files: [{ id: 'f-bolt', label: '图纸', filename: 'BOLT-M6.pdf', storedPath: 'drawings/components/c-bolt/f-bolt/BOLT-M6.pdf' }],
      archivedFiles: []
    },
    {
      id: 'c-cover',
      code: 'COVER-C03 防护罩',
      rev: 0,
      requirements: { material: 'Q235', qty: '4', tolerance: '', surface: '喷粉', deadline: '', notes: '' },
      files: [],
      archivedFiles: []
    },
    {
      id: 'c-base',
      code: 'BASE-018 底板',
      rev: 1,
      requirements: { material: 'Q235', qty: '6', tolerance: '+/-0.1', surface: '喷粉', deadline: '', notes: '' },
      files: [{ id: 'f-base', label: '图纸', filename: 'BASE-018.pdf', storedPath: 'drawings/components/c-base/f-base/BASE-018.pdf' }],
      archivedFiles: []
    }
  ]

  const activeProject = {
    id: 'proj-active',
    name: 'KLD-042 焊接工装样件',
    status: 'active',
    createdAt: new Date(Date.now() - 1000 * 60 * 60 * 24 * 3).toISOString(),
    archivedAt: null,
    vendorIds: ['v-keda', 'v-hongyuan', 'v-yida'],
    assemblies: [
      {
        id: 'a-fixture',
        code: 'KLD-042 焊接工装总成',
        rev: 1,
        notes: '焊后整体退火',
        assemblyFiles: [{ id: 'af-1', label: '装配图', filename: 'KLD-042_ASM.pdf', storedPath: 'drawings/assemblies/a-fixture/af-1/KLD-042_ASM.pdf' }],
        archivedAssemblyFiles: [],
        members: [
          { componentId: 'c-plate', qty: 1 },
          { componentId: 'c-axis', qty: 2 },
          { componentId: 'c-bolt', qty: 8 }
        ]
      },
      {
        id: 'a-guard',
        code: 'COVER 防护总成',
        rev: 0,
        notes: '',
        assemblyFiles: [],
        archivedAssemblyFiles: [],
        members: [
          { componentId: 'c-cover', qty: 1 },
          { componentId: 'c-bolt', qty: 4 }
        ]
      }
    ],
    assignments: [
      { assemblyId: 'a-fixture', vendorId: 'v-keda' },
      { assemblyId: 'a-fixture', vendorId: 'v-hongyuan' },
      { assemblyId: 'a-guard', vendorId: 'v-keda' },
      { assemblyId: 'a-guard', vendorId: 'v-yida' }
    ],
    // keda got an OLD version of the fixture (c-plate was rev 2) -> 需重发.
    sendLog: [
      {
        id: 's-1',
        vendorId: 'v-keda',
        at: new Date().toISOString(),
        items: [
          { assemblyId: 'a-fixture', sig: '1#c-axis:2,c-bolt:1,c-plate:2' },
          { assemblyId: 'a-guard', sig: '0#c-bolt:1,c-cover:0' }
        ]
      },
      { id: 's-2', vendorId: 'v-yida', at: new Date().toISOString(), items: [{ assemblyId: 'a-guard', sig: '0#c-bolt:1,c-cover:0' }] }
    ]
  }

  const archivedProject = {
    id: 'proj-archived',
    name: 'JIG-018 定位夹具试制',
    status: 'archived',
    createdAt: new Date(Date.now() - 1000 * 60 * 60 * 24 * 24).toISOString(),
    archivedAt: new Date(Date.now() - 1000 * 60 * 60 * 24 * 7).toISOString(),
    vendorIds: ['v-keda'],
    assemblies: [
      {
        id: 'a-base',
        code: 'BASE-018 底板总成',
        rev: 0,
        notes: '',
        assemblyFiles: [],
        archivedAssemblyFiles: [],
        members: [{ componentId: 'c-base', qty: 1 }]
      }
    ],
    assignments: [{ assemblyId: 'a-base', vendorId: 'v-keda' }],
    sendLog: [{ id: 's-old', vendorId: 'v-keda', at: new Date().toISOString(), items: [{ assemblyId: 'a-base', sig: '0#c-base:1' }] }]
  }

  let data = {
    dataDir: 'D:\\Users\\txing\\machining-dispatch',
    activeProjectId: activeProject.id,
    components,
    projects: [activeProject, archivedProject],
    vendors: [
      { id: 'v-keda', name: '科达精密', contact: '张工 / 微信已备注' },
      { id: 'v-hongyuan', name: '宏远加工', contact: '李经理 / 华东' },
      { id: 'v-yida', name: '益达五金', contact: '' },
      { id: 'v-spare', name: '精工外协', contact: '备用厂家' }
    ]
  }

  function uid(prefix) {
    return `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`
  }

  function currentProject() {
    return data.projects.find((project) => project.id === data.activeProjectId)
  }

  function compMap() {
    const map = new Map()
    for (const c of data.components) map.set(c.id, c)
    return map
  }

  function summary(project) {
    return {
      id: project.id,
      name: project.name,
      status: project.status,
      createdAt: project.createdAt,
      archivedAt: project.archivedAt,
      vendorIds: project.vendorIds || [],
      assemblyCount: (project.assemblies || []).length,
      assignmentCount: (project.assignments || []).length,
      sendCount: (project.sendLog || []).length
    }
  }

  function state() {
    const project = currentProject()
    return {
      dataDir: data.dataDir,
      activeProjectId: data.activeProjectId,
      currentProject: summary(project),
      projects: data.projects.map(summary),
      components: data.components,
      assemblies: project.assemblies,
      vendors: data.vendors,
      assignments: project.assignments,
      sendLog: project.sendLog
    }
  }

  function getComponent(id) {
    const component = data.components.find((c) => c.id === id)
    if (!component) throw new Error('小零件不存在')
    return component
  }

  function getAssembly(id) {
    const assembly = currentProject().assemblies.find((a) => a.id === id)
    if (!assembly) throw new Error('组合件不存在')
    return assembly
  }

  function getVendor(vendorId) {
    const vendor = data.vendors.find((v) => v.id === vendorId)
    if (!vendor) throw new Error('厂商不存在')
    return vendor
  }

  function lastSentSig(vendorId, assemblyId) {
    let sig = null
    for (const entry of currentProject().sendLog) {
      if (entry.vendorId !== vendorId) continue
      const item = (entry.items || []).find((it) => it.assemblyId === assemblyId)
      if (item && item.sig != null) sig = item.sig
    }
    return sig
  }

  return {
    async getState() {
      return clone(state())
    },
    async addProject(payload) {
      const project = {
        id: uid('proj'),
        name: payload?.name || `项目 ${new Date().toLocaleDateString('zh-CN')}`,
        status: 'active',
        createdAt: new Date().toISOString(),
        archivedAt: null,
        vendorIds: [],
        assemblies: [],
        assignments: [],
        sendLog: []
      }
      data.projects.push(project)
      data.activeProjectId = project.id
      return clone(summary(project))
    },
    async updateProject(id, fields) {
      const project = data.projects.find((item) => item.id === id)
      if (!project) throw new Error('项目不存在')
      if (fields.name != null) project.name = fields.name
      return clone(summary(project))
    },
    async setActiveProject(id) {
      if (!data.projects.some((project) => project.id === id)) throw new Error('项目不存在')
      data.activeProjectId = id
      return clone(summary(currentProject()))
    },
    async archiveProject(id) {
      const project = data.projects.find((item) => item.id === id)
      if (!project) throw new Error('项目不存在')
      project.status = 'archived'
      project.archivedAt = new Date().toISOString()
      if (data.activeProjectId === id) {
        const next = data.projects.find((item) => item.status === 'active' && item.id !== id)
        if (next) data.activeProjectId = next.id
      }
      return clone(summary(project))
    },
    async unarchiveProject(id) {
      const project = data.projects.find((item) => item.id === id)
      if (!project) throw new Error('项目不存在')
      project.status = 'active'
      project.archivedAt = null
      return clone(summary(project))
    },
    async deleteProject(id) {
      const index = data.projects.findIndex((item) => item.id === id)
      if (index < 0) throw new Error('项目不存在')
      data.projects.splice(index, 1)
      if (data.projects.length === 0) {
        await this.addProject({ name: `项目 ${new Date().toLocaleDateString('zh-CN')}` })
      } else if (data.activeProjectId === id) {
        const next = data.projects.find((p) => p.status === 'active') || data.projects[0]
        data.activeProjectId = next.id
      }
      return true
    },
    async addProjectVendors(vendorIds) {
      const project = currentProject()
      if (!Array.isArray(project.vendorIds)) project.vendorIds = []
      const ids = Array.isArray(vendorIds) ? vendorIds : [vendorIds]
      for (const id of ids) {
        if (data.vendors.some((vendor) => vendor.id === id) && !project.vendorIds.includes(id)) project.vendorIds.push(id)
      }
      return clone(summary(project))
    },
    async removeProjectVendor(vendorId) {
      const project = currentProject()
      project.vendorIds = (project.vendorIds || []).filter((id) => id !== vendorId)
      project.assignments = project.assignments.filter((a) => a.vendorId !== vendorId)
      return clone(summary(project))
    },

    // ----- components (global library) -----
    async addComponent(payload) {
      const component = { id: uid('c'), code: payload.code, requirements: payload.requirements || {}, files: [], archivedFiles: [], rev: 0, createdAt: new Date().toISOString() }
      data.components.push(component)
      return clone(component)
    },
    async updateComponent(id, fields) {
      const component = getComponent(id)
      if (fields.code != null) component.code = fields.code
      if (fields.requirements) component.requirements = { ...component.requirements, ...fields.requirements }
      return clone(component)
    },
    async deleteComponent(id) {
      const users = []
      for (const project of data.projects) {
        for (const assembly of project.assemblies || []) {
          if ((assembly.members || []).some((m) => m.componentId === id)) users.push(assembly.code)
        }
      }
      if (users.length) throw new Error(`该小零件被 ${users.length} 个组合件使用，请先从组合件中移除`)
      data.components = data.components.filter((c) => c.id !== id)
      return true
    },
    async addComponentFile(componentId, filename, _bytes, label) {
      const component = getComponent(componentId)
      component.files.push({ id: uid('f'), label: label || '', filename, storedPath: `drawings/components/${componentId}/${filename}` })
      component.rev = (component.rev || 0) + 1
      return clone(component)
    },
    async replaceComponentFile(componentId, fileId, filename) {
      const component = getComponent(componentId)
      const index = component.files.findIndex((f) => f.id === fileId)
      if (index < 0) throw new Error('文件不存在')
      component.archivedFiles.push({ ...component.files[index], removedAt: new Date().toISOString(), reason: '被替换' })
      component.files[index] = { id: uid('f'), label: component.files[index].label, filename, storedPath: `drawings/components/${componentId}/${filename}` }
      component.rev = (component.rev || 0) + 1
      return clone(component)
    },
    async updateComponentFile(componentId, fileId, label) {
      const file = getComponent(componentId).files.find((f) => f.id === fileId)
      if (!file) throw new Error('文件不存在')
      file.label = label
      return clone(getComponent(componentId))
    },
    async deleteComponentFile(componentId, fileId) {
      const component = getComponent(componentId)
      component.files = component.files.filter((f) => f.id !== fileId)
      component.rev = (component.rev || 0) + 1
      return clone(component)
    },

    // ----- assemblies (per-project) -----
    async addAssembly(payload) {
      const assembly = { id: uid('a'), code: payload.code, assemblyFiles: [], archivedAssemblyFiles: [], members: [], notes: payload.notes || '', rev: 0, createdAt: new Date().toISOString() }
      currentProject().assemblies.push(assembly)
      return clone(assembly)
    },
    async updateAssembly(id, fields) {
      const assembly = getAssembly(id)
      if (fields.code != null) assembly.code = fields.code
      if (fields.notes != null) assembly.notes = fields.notes
      return clone(assembly)
    },
    async deleteAssembly(id) {
      const project = currentProject()
      project.assemblies = project.assemblies.filter((a) => a.id !== id)
      project.assignments = project.assignments.filter((a) => a.assemblyId !== id)
      return true
    },
    async addAssemblyMembers(assemblyId, componentIds) {
      const assembly = getAssembly(assemblyId)
      const ids = Array.isArray(componentIds) ? componentIds : [componentIds]
      for (const cid of ids) {
        if (data.components.some((c) => c.id === cid) && !assembly.members.some((m) => m.componentId === cid)) assembly.members.push({ componentId: cid, qty: 1 })
      }
      assembly.rev = (assembly.rev || 0) + 1
      return clone(assembly)
    },
    async removeAssemblyMember(assemblyId, componentId) {
      const assembly = getAssembly(assemblyId)
      assembly.members = assembly.members.filter((m) => m.componentId !== componentId)
      assembly.rev = (assembly.rev || 0) + 1
      return clone(assembly)
    },
    async setMemberQty(assemblyId, componentId, qty) {
      const member = getAssembly(assemblyId).members.find((m) => m.componentId === componentId)
      if (member) member.qty = Math.max(1, Number(qty) || 1)
      return clone(getAssembly(assemblyId))
    },
    async addAssemblyFile(assemblyId, filename, _bytes, label) {
      const assembly = getAssembly(assemblyId)
      assembly.assemblyFiles.push({ id: uid('f'), label: label || '', filename, storedPath: `drawings/assemblies/${assemblyId}/${filename}` })
      assembly.rev = (assembly.rev || 0) + 1
      return clone(assembly)
    },
    async replaceAssemblyFile(assemblyId, fileId, filename) {
      const assembly = getAssembly(assemblyId)
      const index = assembly.assemblyFiles.findIndex((f) => f.id === fileId)
      if (index < 0) throw new Error('文件不存在')
      assembly.archivedAssemblyFiles.push({ ...assembly.assemblyFiles[index], removedAt: new Date().toISOString(), reason: '被替换' })
      assembly.assemblyFiles[index] = { id: uid('f'), label: assembly.assemblyFiles[index].label, filename, storedPath: `drawings/assemblies/${assemblyId}/${filename}` }
      assembly.rev = (assembly.rev || 0) + 1
      return clone(assembly)
    },
    async updateAssemblyFile(assemblyId, fileId, label) {
      const file = getAssembly(assemblyId).assemblyFiles.find((f) => f.id === fileId)
      if (!file) throw new Error('文件不存在')
      file.label = label
      return clone(getAssembly(assemblyId))
    },
    async deleteAssemblyFile(assemblyId, fileId) {
      const assembly = getAssembly(assemblyId)
      assembly.assemblyFiles = assembly.assemblyFiles.filter((f) => f.id !== fileId)
      assembly.rev = (assembly.rev || 0) + 1
      return clone(assembly)
    },

    async addVendor(payload) {
      data.vendors.push({ id: uid('v'), ...payload })
      return clone(data.vendors.at(-1))
    },
    async updateVendor(id, fields) {
      Object.assign(getVendor(id), fields)
      return clone(getVendor(id))
    },
    async deleteVendor(id) {
      data.vendors = data.vendors.filter((v) => v.id !== id)
      for (const project of data.projects) {
        project.vendorIds = (project.vendorIds || []).filter((vid) => vid !== id)
        project.assignments = project.assignments.filter((a) => a.vendorId !== id)
      }
      return true
    },
    async setAssignment(assemblyId, vendorId, assigned) {
      const project = currentProject()
      const exists = project.assignments.some((a) => a.assemblyId === assemblyId && a.vendorId === vendorId)
      if (assigned && !exists) project.assignments.push({ assemblyId, vendorId })
      if (!assigned) project.assignments = project.assignments.filter((a) => !(a.assemblyId === assemblyId && a.vendorId === vendorId))
      return true
    },
    async previewPackage(vendorId) {
      const vendor = getVendor(vendorId)
      const project = currentProject()
      const map = compMap()
      const assemblyIds = project.assignments.filter((a) => a.vendorId === vendorId).map((a) => a.assemblyId)
      const items = assemblyIds
        .map((assemblyId) => {
          const assembly = project.assemblies.find((a) => a.id === assemblyId)
          if (!assembly) return null
          const sig = signatureOf(assembly, map)
          const last = lastSentSig(vendorId, assemblyId)
          const assemblyFiles = (assembly.assemblyFiles || []).map((f) => ({ label: f.label, filename: f.filename }))
          const members = (assembly.members || []).map((m) => {
            const c = map.get(m.componentId)
            return {
              componentId: m.componentId,
              code: c ? c.code : '(已删除小零件)',
              qty: m.qty || 1,
              requirements: c ? c.requirements || {} : {},
              files: c ? (c.files || []).map((f) => ({ label: f.label, filename: f.filename })) : [],
              fileCount: c ? (c.files || []).length : 0,
              rev: c ? c.rev || 0 : 0
            }
          })
          const fileCount = assemblyFiles.length + members.reduce((s, m) => s + m.fileCount, 0)
          return {
            assemblyId: assembly.id,
            code: assembly.code,
            notes: assembly.notes || '',
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
      return { vendor, project: summary(project), items, count: items.length }
    },
    async buildPackage(vendorId) {
      const preview = await this.previewPackage(vendorId)
      currentProject().sendLog.push({
        id: uid('s'),
        vendorId,
        at: new Date().toISOString(),
        items: preview.items.map((item) => ({ assemblyId: item.assemblyId, sig: item.sig }))
      })
      return {
        zipPath: `${data.dataDir}\\packages\\${preview.vendor.name}_preview.zip`,
        fileName: `${preview.vendor.name}_preview.zip`,
        count: preview.items.filter((item) => item.hasFile).length,
        fileCount: preview.items.reduce((sum, item) => sum + item.fileCount, 0),
        missing: preview.items.filter((item) => !item.hasFile).length
      }
    },
    async chooseDataDir() {
      return { dataDir: data.dataDir }
    },
    async exportBackup() {
      return { path: `${data.dataDir}\\backup\\backup_preview.zip` }
    },
    async reveal() {
      return true
    },
    async openPath() {
      return true
    }
  }
}

export const api = window.api ?? createPreviewApi()

// File-from-File helpers: read the picked File into bytes, then call the right
// channel for a component drawing or an assembly drawing.
export async function addComponentFileFromFile(componentId, file, label, note) {
  const bytes = new Uint8Array(await file.arrayBuffer())
  return api.addComponentFile(componentId, file.name, bytes, label, note)
}

export async function replaceComponentFileFromFile(componentId, fileId, file, note) {
  const bytes = new Uint8Array(await file.arrayBuffer())
  return api.replaceComponentFile(componentId, fileId, file.name, bytes, note)
}

export async function addAssemblyFileFromFile(assemblyId, file, label, note) {
  const bytes = new Uint8Array(await file.arrayBuffer())
  return api.addAssemblyFile(assemblyId, file.name, bytes, label, note)
}

export async function replaceAssemblyFileFromFile(assemblyId, fileId, file, note) {
  const bytes = new Uint8Array(await file.arrayBuffer())
  return api.replaceAssemblyFile(assemblyId, fileId, file.name, bytes, note)
}
