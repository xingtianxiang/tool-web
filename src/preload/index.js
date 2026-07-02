import { contextBridge, ipcRenderer } from 'electron'

// ipcMain.handle 抛出的错误传到渲染端会带上
// "Error invoking remote method 'xxx': Error: " 前缀 —— 在这里统一剥掉,
// 页面上给用户看的就是干净的中文提示
function invoke(channel, ...args) {
  return ipcRenderer.invoke(channel, ...args).catch((error) => {
    const message = String((error && error.message) || error).replace(
      /^Error invoking remote method '[^']+': (?:Error: )?/,
      ''
    )
    throw new Error(message)
  })
}

const api = {
  getState: () => invoke('state:get'),

  addProject: (payload) => invoke('project:add', payload),
  updateProject: (id, fields) => invoke('project:update', { id, fields }),
  setActiveProject: (id) => invoke('project:setActive', id),
  archiveProject: (id) => invoke('project:archive', id),
  unarchiveProject: (id) => invoke('project:unarchive', id),
  deleteProject: (id) => invoke('project:delete', id),
  addProjectVendors: (vendorIds) => invoke('project:addVendors', vendorIds),
  removeProjectVendor: (vendorId) => invoke('project:removeVendor', vendorId),

  // ----- shared small-part library (components) -----
  addComponent: (payload) => invoke('component:add', payload),
  updateComponent: (id, fields) => invoke('component:update', { id, fields }),
  deleteComponent: (id) => invoke('component:delete', id),
  // bytes is a Uint8Array (transferable over the context bridge)
  addComponentFile: (componentId, filename, bytes, label, note) =>
    invoke('component:addFile', { componentId, filename, bytes, label, note }),
  replaceComponentFile: (componentId, fileId, filename, bytes, note) =>
    invoke('component:replaceFile', { componentId, fileId, filename, bytes, note }),
  updateComponentFile: (componentId, fileId, label, note) =>
    invoke('component:updateFile', { componentId, fileId, label, note }),
  deleteComponentFile: (componentId, fileId) =>
    invoke('component:deleteFile', { componentId, fileId }),

  // ----- per-project assemblies (组合件) -----
  addAssembly: (payload) => invoke('assembly:add', payload),
  updateAssembly: (id, fields) => invoke('assembly:update', { id, fields }),
  deleteAssembly: (id) => invoke('assembly:delete', id),
  addAssemblyMembers: (assemblyId, componentIds) =>
    invoke('assembly:addMembers', { assemblyId, componentIds }),
  removeAssemblyMember: (assemblyId, componentId) =>
    invoke('assembly:removeMember', { assemblyId, componentId }),
  setMemberQty: (assemblyId, componentId, qty) =>
    invoke('assembly:setMemberQty', { assemblyId, componentId, qty }),
  addAssemblyFile: (assemblyId, filename, bytes, label, note) =>
    invoke('assembly:addFile', { assemblyId, filename, bytes, label, note }),
  replaceAssemblyFile: (assemblyId, fileId, filename, bytes, note) =>
    invoke('assembly:replaceFile', { assemblyId, fileId, filename, bytes, note }),
  updateAssemblyFile: (assemblyId, fileId, label, note) =>
    invoke('assembly:updateFile', { assemblyId, fileId, label, note }),
  deleteAssemblyFile: (assemblyId, fileId) =>
    invoke('assembly:deleteFile', { assemblyId, fileId }),

  addVendor: (payload) => invoke('vendor:add', payload),
  updateVendor: (id, fields) => invoke('vendor:update', { id, fields }),
  deleteVendor: (id) => invoke('vendor:delete', id),

  setAssignment: (assemblyId, vendorId, assigned) =>
    invoke('assign:set', { assemblyId, vendorId, assigned }),
  setAssignmentMeta: (assemblyId, vendorId, meta) =>
    invoke('assign:setMeta', { assemblyId, vendorId, meta }),

  previewPackage: (vendorId) => invoke('package:preview', vendorId),
  buildPackage: (vendorId) => invoke('package:build', vendorId),

  getSettings: () => invoke('settings:get'),
  chooseDataDir: () => invoke('settings:chooseDir'),
  exportBackup: () => invoke('backup:export'),

  // ----- bulk import from Excel/CSV (bytesList = array of Uint8Array) -----
  previewImport: (bytesList) => invoke('import:preview', bytesList),
  applyImport: (bytesList) => invoke('import:apply', bytesList),
  downloadImportTemplate: () => invoke('import:downloadTemplate'),

  // ----- inventory / warehouse -----
  stockIn: (componentId, opts) => invoke('stock:in', { componentId, ...opts }),
  stockAllocate: (componentId, projectId, opts) => invoke('stock:allocate', { componentId, projectId, ...opts }),
  stockReturn: (componentId, projectId, opts) => invoke('stock:return', { componentId, projectId, ...opts }),
  stockAdjust: (componentId, opts) => invoke('stock:adjust', { componentId, ...opts }),
  setComponentLocation: (componentId, location) => invoke('stock:setLocation', { componentId, location }),
  deleteMovement: (id) => invoke('stock:deleteMovement', id),

  // ----- usage report (用料报表) -----
  projectUsageReport: (projectId, range = {}) => invoke('report:projectUsage', { projectId, ...range }),
  exportUsageReport: (projectId, range = {}) => invoke('report:exportUsage', { projectId, ...range }),

  reveal: (p) => invoke('shell:reveal', p),
  openPath: (p) => invoke('shell:openPath', p)
}

contextBridge.exposeInMainWorld('api', api)
