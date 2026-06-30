import { contextBridge, ipcRenderer } from 'electron'

const api = {
  getState: () => ipcRenderer.invoke('state:get'),

  addProject: (payload) => ipcRenderer.invoke('project:add', payload),
  updateProject: (id, fields) => ipcRenderer.invoke('project:update', { id, fields }),
  setActiveProject: (id) => ipcRenderer.invoke('project:setActive', id),
  archiveProject: (id) => ipcRenderer.invoke('project:archive', id),
  unarchiveProject: (id) => ipcRenderer.invoke('project:unarchive', id),
  deleteProject: (id) => ipcRenderer.invoke('project:delete', id),
  addProjectVendors: (vendorIds) => ipcRenderer.invoke('project:addVendors', vendorIds),
  removeProjectVendor: (vendorId) => ipcRenderer.invoke('project:removeVendor', vendorId),

  // ----- shared small-part library (components) -----
  addComponent: (payload) => ipcRenderer.invoke('component:add', payload),
  updateComponent: (id, fields) => ipcRenderer.invoke('component:update', { id, fields }),
  deleteComponent: (id) => ipcRenderer.invoke('component:delete', id),
  // bytes is a Uint8Array (transferable over the context bridge)
  addComponentFile: (componentId, filename, bytes, label, note) =>
    ipcRenderer.invoke('component:addFile', { componentId, filename, bytes, label, note }),
  replaceComponentFile: (componentId, fileId, filename, bytes, note) =>
    ipcRenderer.invoke('component:replaceFile', { componentId, fileId, filename, bytes, note }),
  updateComponentFile: (componentId, fileId, label, note) =>
    ipcRenderer.invoke('component:updateFile', { componentId, fileId, label, note }),
  deleteComponentFile: (componentId, fileId) =>
    ipcRenderer.invoke('component:deleteFile', { componentId, fileId }),

  // ----- per-project assemblies (组合件) -----
  addAssembly: (payload) => ipcRenderer.invoke('assembly:add', payload),
  updateAssembly: (id, fields) => ipcRenderer.invoke('assembly:update', { id, fields }),
  deleteAssembly: (id) => ipcRenderer.invoke('assembly:delete', id),
  addAssemblyMembers: (assemblyId, componentIds) =>
    ipcRenderer.invoke('assembly:addMembers', { assemblyId, componentIds }),
  removeAssemblyMember: (assemblyId, componentId) =>
    ipcRenderer.invoke('assembly:removeMember', { assemblyId, componentId }),
  setMemberQty: (assemblyId, componentId, qty) =>
    ipcRenderer.invoke('assembly:setMemberQty', { assemblyId, componentId, qty }),
  addAssemblyFile: (assemblyId, filename, bytes, label, note) =>
    ipcRenderer.invoke('assembly:addFile', { assemblyId, filename, bytes, label, note }),
  replaceAssemblyFile: (assemblyId, fileId, filename, bytes, note) =>
    ipcRenderer.invoke('assembly:replaceFile', { assemblyId, fileId, filename, bytes, note }),
  updateAssemblyFile: (assemblyId, fileId, label, note) =>
    ipcRenderer.invoke('assembly:updateFile', { assemblyId, fileId, label, note }),
  deleteAssemblyFile: (assemblyId, fileId) =>
    ipcRenderer.invoke('assembly:deleteFile', { assemblyId, fileId }),

  addVendor: (payload) => ipcRenderer.invoke('vendor:add', payload),
  updateVendor: (id, fields) => ipcRenderer.invoke('vendor:update', { id, fields }),
  deleteVendor: (id) => ipcRenderer.invoke('vendor:delete', id),

  setAssignment: (assemblyId, vendorId, assigned) =>
    ipcRenderer.invoke('assign:set', { assemblyId, vendorId, assigned }),
  setAssignmentMeta: (assemblyId, vendorId, meta) =>
    ipcRenderer.invoke('assign:setMeta', { assemblyId, vendorId, meta }),

  previewPackage: (vendorId) => ipcRenderer.invoke('package:preview', vendorId),
  buildPackage: (vendorId) => ipcRenderer.invoke('package:build', vendorId),

  getSettings: () => ipcRenderer.invoke('settings:get'),
  chooseDataDir: () => ipcRenderer.invoke('settings:chooseDir'),
  exportBackup: () => ipcRenderer.invoke('backup:export'),

  reveal: (p) => ipcRenderer.invoke('shell:reveal', p),
  openPath: (p) => ipcRenderer.invoke('shell:openPath', p)
}

contextBridge.exposeInMainWorld('api', api)
