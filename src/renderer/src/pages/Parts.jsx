import { useRef, useState } from 'react'
import { Plus, Upload, History, Pencil, Trash2, FileText, FolderOpen, Tag, RefreshCw } from 'lucide-react'
import { api, addFileFromFile, replaceFileFromFile } from '../lib/api.js'
import { REQ_FIELDS } from '../lib/state.js'
import { Button, Modal, Field, TextInput } from '../ui.jsx'

function absOf(dataDir, storedPath) {
  return dataDir + '\\' + String(storedPath).split('/').join('\\')
}

function PartModal({ open, onClose, onSave, initial }) {
  const [code, setCode] = useState(initial?.code || '')
  const [req, setReq] = useState(initial?.requirements || {})

  function save() {
    if (!code.trim()) return
    onSave({ code: code.trim(), requirements: req })
  }

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={initial ? '编辑零件' : '新增零件'}
      footer={
        <>
          <Button onClick={onClose}>取消</Button>
          <Button variant="primary" onClick={save}>保存</Button>
        </>
      }
    >
      <Field label="图号 / 名称" hint="零件的唯一标识,所有图纸文件都挂在它下面">
        <TextInput value={code} onChange={(e) => setCode(e.target.value)} placeholder="如:支架-A01" autoFocus />
      </Field>
      <div className="grid grid-cols-2 gap-x-4">
        {REQ_FIELDS.map((f) => (
          <Field key={f.key} label={f.label}>
            {f.key === 'notes' ? (
              <textarea
                className="w-full rounded-md border border-slate-300 px-3 py-1.5 text-sm outline-none focus:border-blue-500"
                rows={2}
                value={req[f.key] || ''}
                onChange={(e) => setReq({ ...req, [f.key]: e.target.value })}
              />
            ) : (
              <TextInput value={req[f.key] || ''} onChange={(e) => setReq({ ...req, [f.key]: e.target.value })} />
            )}
          </Field>
        ))}
      </div>
    </Modal>
  )
}

function HistoryModal({ open, onClose, part, dataDir }) {
  if (!part) return null
  const archived = part.archivedFiles || []
  return (
    <Modal open={open} onClose={onClose} title={`历史文件(留底) — ${part.code}`} wide>
      {archived.length === 0 ? (
        <p className="text-sm text-slate-400">还没有被替换或删除的文件。每次「替换」或「删除」的旧文件都会留底到这里。</p>
      ) : (
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-slate-200 text-left text-xs text-slate-500">
              <th className="py-1.5">文件</th>
              <th>原因</th>
              <th>时间</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {[...archived].reverse().map((f, i) => (
              <tr key={f.id || i} className="border-b border-slate-100">
                <td className="max-w-[260px] truncate py-1.5" title={f.filename}>
                  {f.label ? `${f.label} · ${f.filename}` : f.filename}
                </td>
                <td className="text-xs text-slate-500">{f.reason || '—'}</td>
                <td className="text-xs text-slate-500">{f.removedAt ? new Date(f.removedAt).toLocaleString('zh-CN') : '—'}</td>
                <td className="text-right">
                  <button className="text-blue-600 hover:underline" onClick={() => api.openPath(absOf(dataDir, f.storedPath))}>打开</button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </Modal>
  )
}

function FileRow({ partId, file, dataDir, notify, refresh }) {
  const replaceRef = useRef(null)

  async function doReplace(f) {
    if (!f) return
    try {
      await replaceFileFromFile(partId, file.id, f)
      notify(`已替换「${file.label || file.filename}」(修订 +1)`, 'success')
      await refresh()
    } catch (e) {
      notify('替换失败:' + e.message, 'error')
    }
  }

  async function rename() {
    const label = window.prompt('给这个文件起个标签(如:2D图 / 3D图 / 子零件A),留空则只显示文件名', file.label || '')
    if (label === null) return
    try {
      await api.updateFile(partId, file.id, label, null)
      await refresh()
    } catch (e) {
      notify(e.message, 'error')
    }
  }

  async function remove() {
    if (!window.confirm(`删除文件「${file.label || file.filename}」?(会留底到历史)`)) return
    try {
      await api.deleteFile(partId, file.id)
      notify('已删除(修订 +1)', 'success')
      await refresh()
    } catch (e) {
      notify(e.message, 'error')
    }
  }

  return (
    <div className="flex items-center gap-2 rounded border border-slate-100 bg-slate-50 px-2 py-1">
      <FileText size={14} className="shrink-0 text-slate-400" />
      <div className="min-w-0 flex-1">
        <div className="truncate text-sm text-slate-700" title={file.filename}>{file.label || file.filename}</div>
        {file.label && <div className="truncate text-[11px] text-slate-400">{file.filename}</div>}
      </div>
      <input ref={replaceRef} type="file" className="hidden" onChange={(e) => { doReplace(e.target.files?.[0]); e.target.value = '' }} />
      <button className="rounded p-1 text-slate-400 hover:bg-slate-200 hover:text-slate-600" title="打开" onClick={() => api.openPath(absOf(dataDir, file.storedPath))}><FolderOpen size={14} /></button>
      <button className="rounded p-1 text-slate-400 hover:bg-slate-200 hover:text-slate-600" title="标签命名" onClick={rename}><Tag size={14} /></button>
      <button className="rounded p-1 text-slate-400 hover:bg-slate-200 hover:text-blue-600" title="替换/改版(留底旧文件)" onClick={() => replaceRef.current?.click()}><RefreshCw size={14} /></button>
      <button className="rounded p-1 text-red-400 hover:bg-red-50 hover:text-red-600" title="删除" onClick={remove}><Trash2 size={14} /></button>
    </div>
  )
}

function PartCard({ part, dataDir, notify, refresh, onEdit, onHistory }) {
  const [drag, setDrag] = useState(false)
  const [busy, setBusy] = useState(false)
  const addRef = useRef(null)

  async function addFiles(fileList) {
    const files = Array.from(fileList || [])
    if (!files.length) return
    setBusy(true)
    try {
      for (const f of files) await addFileFromFile(part.id, f)
      notify(`已为「${part.code}」添加 ${files.length} 个文件`, 'success')
      await refresh()
    } catch (e) {
      notify('上传失败:' + e.message, 'error')
    } finally {
      setBusy(false)
    }
  }

  async function remove() {
    if (!window.confirm(`删除零件「${part.code}」?它的所有图纸文件也会被移除。`)) return
    try {
      await api.deletePart(part.id)
      await refresh()
    } catch (e) {
      notify(e.message, 'error')
    }
  }

  const reqSummary = REQ_FIELDS.filter((f) => f.key !== 'notes' && part.requirements[f.key])
    .map((f) => `${f.label}:${part.requirements[f.key]}`)
    .join(' · ')

  const files = part.files || []

  return (
    <div
      className={`flex flex-col rounded-lg border bg-white p-3 transition ${drag ? 'border-blue-500 ring-2 ring-blue-200' : 'border-slate-200'}`}
      onDragOver={(e) => { e.preventDefault(); setDrag(true) }}
      onDragLeave={() => setDrag(false)}
      onDrop={(e) => { e.preventDefault(); setDrag(false); addFiles(e.dataTransfer.files) }}
    >
      <div className="flex items-start justify-between">
        <div>
          <div className="font-semibold text-slate-800">{part.code}</div>
          <div className="text-xs text-slate-400">
            {(part.rev || 0) > 0 ? (
              <span className="text-slate-500">修订 v{part.rev} · {files.length} 个文件</span>
            ) : (
              <span className="text-red-400">无图纸 — 拖入文件或点添加</span>
            )}
          </div>
        </div>
        <div className="flex gap-1">
          <Button variant="ghost" className="!px-1.5" onClick={() => onHistory(part)} title="历史文件"><History size={15} /></Button>
          <Button variant="ghost" className="!px-1.5" onClick={() => onEdit(part)} title="编辑零件"><Pencil size={15} /></Button>
          <Button variant="ghost" className="!px-1.5 !text-red-500" onClick={remove} title="删除零件"><Trash2 size={15} /></Button>
        </div>
      </div>

      {reqSummary && <div className="mt-1.5 line-clamp-1 text-xs text-slate-500" title={reqSummary}>{reqSummary}</div>}

      {files.length > 0 && (
        <div className="mt-2 flex flex-col gap-1">
          {files.map((f) => (
            <FileRow key={f.id} partId={part.id} file={f} dataDir={dataDir} notify={notify} refresh={refresh} />
          ))}
        </div>
      )}

      <div className="mt-2 flex items-center gap-2">
        <input ref={addRef} type="file" multiple className="hidden" onChange={(e) => { addFiles(e.target.files); e.target.value = '' }} />
        <Button onClick={() => addRef.current?.click()} disabled={busy} className="!text-xs">
          <Upload size={13} /> {busy ? '上传中…' : '添加文件'}
        </Button>
        <span className="ml-auto flex items-center gap-1 text-[11px] text-slate-300"><FileText size={12} /> 可一次拖入多个(2D/3D/子零件)</span>
      </div>
    </div>
  )
}

export default function Parts({ data, refresh, notify }) {
  const [editing, setEditing] = useState(null) // part or {} for new
  const [history, setHistory] = useState(null)

  async function save(payload) {
    try {
      if (editing && editing.id) await api.updatePart(editing.id, payload)
      else await api.addPart(payload)
      setEditing(null)
      await refresh()
    } catch (e) {
      notify(e.message, 'error')
    }
  }

  return (
    <div className="flex h-full flex-col">
      <div className="flex items-center justify-between border-b border-slate-200 bg-white px-4 py-2">
        <span className="text-sm text-slate-500">{data.parts.length} 个零件</span>
        <Button variant="primary" onClick={() => setEditing({})}><Plus size={15} /> 新增零件</Button>
      </div>
      <div className="flex-1 overflow-auto p-4">
        {data.parts.length === 0 ? (
          <div className="mt-20 text-center text-sm text-slate-400">还没有零件,点右上角「新增零件」开始。</div>
        ) : (
          <div className="grid grid-cols-1 gap-3 lg:grid-cols-2 xl:grid-cols-3">
            {data.parts.map((p) => (
              <PartCard
                key={p.id}
                part={p}
                dataDir={data.dataDir}
                notify={notify}
                refresh={refresh}
                onEdit={setEditing}
                onHistory={setHistory}
              />
            ))}
          </div>
        )}
      </div>

      <PartModal
        open={!!editing}
        onClose={() => setEditing(null)}
        onSave={save}
        initial={editing && editing.id ? editing : null}
      />
      <HistoryModal open={!!history} onClose={() => setHistory(null)} part={history} dataDir={data.dataDir} />
    </div>
  )
}
