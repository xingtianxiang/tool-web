import { contextBridge, ipcRenderer } from 'electron'

const api = {
  getState: () => ipcRenderer.invoke('state:get'),

  addPart: (payload) => ipcRenderer.invoke('part:add', payload),
  updatePart: (id, fields) => ipcRenderer.invoke('part:update', { id, fields }),
  deletePart: (id) => ipcRenderer.invoke('part:delete', id),
  // bytes is a Uint8Array (transferable over the context bridge)
  addFile: (partId, filename, bytes, label, note) =>
    ipcRenderer.invoke('part:addFile', { partId, filename, bytes, label, note }),
  replaceFile: (partId, fileId, filename, bytes, note) =>
    ipcRenderer.invoke('part:replaceFile', { partId, fileId, filename, bytes, note }),
  updateFile: (partId, fileId, label, note) =>
    ipcRenderer.invoke('part:updateFile', { partId, fileId, label, note }),
  deleteFile: (partId, fileId) =>
    ipcRenderer.invoke('part:deleteFile', { partId, fileId }),

  addVendor: (payload) => ipcRenderer.invoke('vendor:add', payload),
  updateVendor: (id, fields) => ipcRenderer.invoke('vendor:update', { id, fields }),
  deleteVendor: (id) => ipcRenderer.invoke('vendor:delete', id),

  setAssignment: (partId, vendorId, assigned) =>
    ipcRenderer.invoke('assign:set', { partId, vendorId, assigned }),

  previewPackage: (vendorId) => ipcRenderer.invoke('package:preview', vendorId),
  buildPackage: (vendorId) => ipcRenderer.invoke('package:build', vendorId),

  getSettings: () => ipcRenderer.invoke('settings:get'),
  chooseDataDir: () => ipcRenderer.invoke('settings:chooseDir'),
  exportBackup: () => ipcRenderer.invoke('backup:export'),

  reveal: (p) => ipcRenderer.invoke('shell:reveal', p),
  openPath: (p) => ipcRenderer.invoke('shell:openPath', p)
}

contextBridge.exposeInMainWorld('api', api)
