export const api = window.api

// Read a dropped/selected File into bytes and add it as a NEW file of the part.
export async function addFileFromFile(partId, file, label, note) {
  const bytes = new Uint8Array(await file.arrayBuffer())
  return api.addFile(partId, file.name, bytes, label, note)
}

// Replace one existing file (revise it) with a new local File.
export async function replaceFileFromFile(partId, fileId, file, note) {
  const bytes = new Uint8Array(await file.arrayBuffer())
  return api.replaceFile(partId, fileId, file.name, bytes, note)
}
