import { BrowserWindow } from 'electron'
import fs from 'node:fs'
import path from 'node:path'
import JSZip from 'jszip'

// Render an HTML string to a PDF Buffer using an offscreen window.
// Chromium renders Chinese with the system fonts (Microsoft YaHei on Windows),
// so no font embedding is needed.
export async function htmlToPdf(html) {
  const win = new BrowserWindow({
    show: false,
    width: 900,
    height: 1200,
    webPreferences: { sandbox: true, contextIsolation: true, nodeIntegration: false }
  })
  try {
    await win.loadURL('data:text/html;charset=utf-8,' + encodeURIComponent(html))
    const pdf = await win.webContents.printToPDF({
      printBackground: true,
      pageSize: 'A4',
      margins: { top: 0.4, bottom: 0.4, left: 0.4, right: 0.4 }
    })
    return pdf
  } finally {
    if (!win.isDestroyed()) win.destroy()
  }
}

async function zipToFile(zip, outPath) {
  const content = await zip.generateAsync({
    type: 'nodebuffer',
    compression: 'DEFLATE',
    compressionOptions: { level: 6 }
  })
  fs.mkdirSync(path.dirname(outPath), { recursive: true })
  fs.writeFileSync(outPath, content)
  return { path: outPath, bytes: content.length }
}

// files: [{ absPath, nameInZip }]   blobs: [{ buffer, nameInZip }]
export async function buildZip(outPath, files = [], blobs = []) {
  const zip = new JSZip()
  for (const f of files) {
    if (f && f.absPath && fs.existsSync(f.absPath)) {
      zip.file(f.nameInZip, fs.readFileSync(f.absPath))
    }
  }
  for (const b of blobs) {
    if (b && b.buffer) zip.file(b.nameInZip, b.buffer)
  }
  return zipToFile(zip, outPath)
}

function addDirToZip(zip, absDir, relBase) {
  for (const entry of fs.readdirSync(absDir, { withFileTypes: true })) {
    const abs = path.join(absDir, entry.name)
    const rel = relBase ? relBase + '/' + entry.name : entry.name
    if (entry.isDirectory()) addDirToZip(zip, abs, rel)
    else zip.file(rel, fs.readFileSync(abs))
  }
}

// Back up the whole data folder (data.json + drawings) into one zip.
export async function buildBackup(dataDir, outPath) {
  const zip = new JSZip()
  const dataJson = path.join(dataDir, 'data.json')
  if (fs.existsSync(dataJson)) zip.file('data.json', fs.readFileSync(dataJson))
  const drawings = path.join(dataDir, 'drawings')
  if (fs.existsSync(drawings)) addDirToZip(zip, drawings, 'drawings')
  return zipToFile(zip, outPath)
}
