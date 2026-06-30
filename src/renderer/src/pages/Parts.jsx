import React, { useMemo, useRef, useState } from 'react'
import { Boxes, FileText, FolderOpen, History, Layers, Pencil, Plus, RefreshCw, Tag, Trash2, Upload, X } from 'lucide-react'
import {
  api,
  addComponentFileFromFile,
  replaceComponentFileFromFile,
  addAssemblyFileFromFile,
  replaceAssemblyFileFromFile
} from '../lib/api.js'
import { REQ_FIELDS } from '../lib/state.js'
import { Button, Field, Modal, TextInput, usePrompt } from '../ui.jsx'
import ImportDialog from '../components/ImportDialog.jsx'

function absOf(dataDir, storedPath) {
  return dataDir + '\\' + String(storedPath).split('/').join('\\')
}

// One drawing file. The actual replace/rename/delete are passed in by the parent
// so the same row works for a small-part's files and an assembly's drawing.
function FileRow({ file, dataDir, readOnly, prompt, notify, onReplace, onSetLabel, onDelete }) {
  const replaceRef = useRef(null)

  async function doReplace(nextFile) {
    if (!nextFile) return
    try {
      await onReplace(nextFile)
    } catch (error) {
      notify(`替换失败。${error.message}`, 'error')
    }
  }

  async function rename() {
    const label = await prompt({
      title: '标签命名',
      label: '文件标签',
      hint: '如 2D 图 / 3D 图 / 子件。留空则只显示文件名。',
      defaultValue: file.label || '',
      confirmText: '保存'
    })
    if (label === null) return
    try {
      await onSetLabel(label)
    } catch (error) {
      notify(error.message, 'error')
    }
  }

  async function remove() {
    if (!window.confirm(`删除文件「${file.label || file.filename}」？旧文件会留底到历史。`)) return
    try {
      await onDelete()
    } catch (error) {
      notify(error.message, 'error')
    }
  }

  return (
    <div className="flex items-center gap-2 rounded-md border border-[var(--geist-gray-200)] bg-[var(--geist-background-2)] px-2 py-1.5">
      <FileText size={14} className="shrink-0 muted-text" />
      <div className="min-w-0 flex-1">
        <div className="truncate text-sm text-[var(--geist-primary)]" title={file.filename}>{file.label || file.filename}</div>
        {file.label && <div className="truncate text-[11px] faint-text">{file.filename}</div>}
      </div>
      <input ref={replaceRef} type="file" className="hidden" onChange={(e) => { doReplace(e.target.files?.[0]); e.target.value = '' }} />
      <button className="icon-button h-7 w-7" title="打开" onClick={() => api.openPath(absOf(dataDir, file.storedPath))}><FolderOpen size={14} /></button>
      <button className="icon-button h-7 w-7" title="标签命名" onClick={rename} disabled={readOnly}><Tag size={14} /></button>
      <button className="icon-button h-7 w-7" title="替换 / 改版" onClick={() => replaceRef.current?.click()} disabled={readOnly}><RefreshCw size={14} /></button>
      <button className="icon-button h-7 w-7 text-[var(--geist-red-800)]" title="删除" onClick={remove} disabled={readOnly}><Trash2 size={14} /></button>
    </div>
  )
}

function HistoryModal({ open, onClose, title, archived, dataDir }) {
  const items = archived || []
  return (
    <Modal open={open} onClose={onClose} title={title} wide>
      {items.length === 0 ? (
        <p className="text-sm faint-text">还没有被替换或删除的文件。每次替换或删除的旧文件都会留底到这里。</p>
      ) : (
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-[var(--geist-gray-200)] text-left text-xs muted-text">
              <th className="py-2">文件</th>
              <th>原因</th>
              <th>时间</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {[...items].reverse().map((file, index) => (
              <tr key={file.id || index} className="border-b border-[var(--geist-gray-100)]">
                <td className="max-w-[260px] truncate py-2" title={file.filename}>{file.label ? `${file.label} / ${file.filename}` : file.filename}</td>
                <td className="text-xs muted-text">{file.reason || '-'}</td>
                <td className="text-xs muted-text">{file.removedAt ? new Date(file.removedAt).toLocaleString('zh-CN') : '-'}</td>
                <td className="text-right">
                  <button className="text-[var(--geist-blue-700)] hover:underline" onClick={() => api.openPath(absOf(dataDir, file.storedPath))}>打开</button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </Modal>
  )
}

// ---------- 小零件库 (global component library) ----------

function ComponentModal({ onClose, onSave, initial }) {
  const [code, setCode] = useState(initial?.code || '')
  const [req, setReq] = useState(initial?.requirements || {})
  const [description, setDescription] = useState(initial?.description || '')

  function save() {
    if (!code.trim()) return
    onSave({ code: code.trim(), requirements: req, description })
  }

  return (
    <Modal
      open
      onClose={onClose}
      title={initial ? '编辑小零件' : '新增小零件'}
      footer={
        <>
          <Button onClick={onClose}>取消</Button>
          <Button variant="primary" onClick={save}>保存小零件</Button>
        </>
      }
    >
      <Field label="图号 / 名称" hint="小零件的唯一标识，所有图纸和规格都挂在它下面，可被多个组合件复用">
        <TextInput value={code} onChange={(e) => setCode(e.target.value)} placeholder="如：BRK-A01 支撑板" autoFocus />
      </Field>
      <div className="grid grid-cols-3 gap-x-4">
        {REQ_FIELDS.map((field) => (
          <Field key={field.key} label={field.label}>
            <TextInput value={req[field.key] || ''} onChange={(e) => setReq({ ...req, [field.key]: e.target.value })} />
          </Field>
        ))}
      </div>
      <Field label="描述（仅内部查看，不进需求单 PDF）" hint="给自己人备注用，打包发给厂商的 PDF 不会包含这段">
        <textarea className="text-input h-auto py-2" rows={2} value={description} onChange={(e) => setDescription(e.target.value)} />
      </Field>
    </Modal>
  )
}

function ComponentCard({ component, dataDir, usedCount, notify, refresh, onEdit, prompt }) {
  const [drag, setDrag] = useState(false)
  const [busy, setBusy] = useState(false)
  const [history, setHistory] = useState(false)
  const addRef = useRef(null)

  async function addFiles(fileList) {
    const files = Array.from(fileList || [])
    if (!files.length) return
    setBusy(true)
    try {
      for (const file of files) await addComponentFileFromFile(component.id, file)
      notify(`已为「${component.code}」添加 ${files.length} 个文件`, 'success')
      await refresh()
    } catch (error) {
      notify(`上传失败。${error.message}`, 'error')
    } finally {
      setBusy(false)
    }
  }

  async function remove() {
    if (!window.confirm(`删除小零件「${component.code}」？它的所有图纸文件也会被移除。`)) return
    try {
      await api.deleteComponent(component.id)
      notify('小零件已删除', 'success')
      await refresh()
    } catch (error) {
      notify(error.message, 'error')
    }
  }

  const reqSummary = REQ_FIELDS.filter((field) => component.requirements[field.key])
    .map((field) => `${field.label}: ${component.requirements[field.key]}`)
    .join(' / ')
  const files = component.files || []

  return (
    <div
      className={`panel flex flex-col p-4 transition ${drag ? 'border-[var(--geist-blue-700)] ring-2 ring-[var(--geist-blue-200)]' : ''}`}
      onDragOver={(e) => { e.preventDefault(); setDrag(true) }}
      onDragLeave={() => setDrag(false)}
      onDrop={(e) => { e.preventDefault(); setDrag(false); addFiles(e.dataTransfer.files) }}
    >
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="truncate font-semibold text-[var(--geist-primary)]">{component.code}</div>
          <div className="text-xs faint-text">
            {(component.rev || 0) > 0 ? (
              <span>修订 v{component.rev} / {files.length} 个文件</span>
            ) : (
              <span className="text-[var(--geist-red-800)]">无图纸。拖入文件或点击添加。</span>
            )}
            {usedCount > 0 && <span> · 本项目 {usedCount} 个组合件在用</span>}
          </div>
        </div>
        <div className="flex gap-1">
          <Button variant="ghost" className="h-8 px-2" onClick={() => setHistory(true)} title="历史文件"><History size={15} /></Button>
          <Button variant="ghost" className="h-8 px-2" onClick={() => onEdit(component)} title="编辑小零件"><Pencil size={15} /></Button>
          <Button variant="ghost" className="h-8 px-2 text-[var(--geist-red-800)]" onClick={remove} title="删除小零件"><Trash2 size={15} /></Button>
        </div>
      </div>

      {reqSummary && <div className="mt-2 line-clamp-1 text-xs muted-text" title={reqSummary}>{reqSummary}</div>}
      {component.description && <div className="mt-1 line-clamp-2 text-xs faint-text" title={component.description}>描述：{component.description}</div>}

      {files.length > 0 && (
        <div className="mt-3 flex flex-col gap-1.5">
          {files.map((file) => (
            <FileRow
              key={file.id}
              file={file}
              dataDir={dataDir}
              readOnly={false}
              prompt={prompt}
              notify={notify}
              onReplace={async (nativeFile) => { await replaceComponentFileFromFile(component.id, file.id, nativeFile); notify('已替换，修订 +1', 'success'); await refresh() }}
              onSetLabel={async (label) => { await api.updateComponentFile(component.id, file.id, label, null); await refresh() }}
              onDelete={async () => { await api.deleteComponentFile(component.id, file.id); notify('文件已删除，修订 +1', 'success'); await refresh() }}
            />
          ))}
        </div>
      )}

      <div className="mt-3 flex items-center gap-2">
        <input ref={addRef} type="file" multiple className="hidden" onChange={(e) => { addFiles(e.target.files); e.target.value = '' }} />
        <Button onClick={() => addRef.current?.click()} disabled={busy} className="h-8 text-xs">
          <Upload size={13} /> {busy ? '上传中...' : '添加文件'}
        </Button>
        <span className="ml-auto flex items-center gap-1 text-[11px] faint-text"><FileText size={12} /> 可一次拖入多个 2D / 3D 文件</span>
      </div>

      <HistoryModal open={history} onClose={() => setHistory(false)} title={`历史文件留底 / ${component.code}`} archived={component.archivedFiles} dataDir={dataDir} />
    </div>
  )
}

// ---------- 组合件 (per-project assemblies) ----------

function ComponentPickerModal({ available, onClose, onConfirm, onCreate }) {
  const [selected, setSelected] = useState([])
  const [newName, setNewName] = useState('')

  function toggle(id) {
    setSelected((prev) => (prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]))
  }

  return (
    <Modal
      open
      onClose={onClose}
      title="把小零件加入组合件"
      footer={
        <>
          <Button onClick={onClose}>取消</Button>
          <Button variant="primary" onClick={() => onConfirm(selected)} disabled={selected.length === 0}>添加{selected.length ? ` (${selected.length})` : ''}</Button>
        </>
      }
    >
      {available.length === 0 ? (
        <p className="mb-3 text-sm faint-text">小零件库里的零件都已经在这个组合件里了。可以在下面新建一个小零件。</p>
      ) : (
        <div className="mb-4 flex max-h-72 flex-col gap-1.5 overflow-y-auto">
          <div className="field-label">勾选要加入的小零件</div>
          {available.map((component) => (
            <label key={component.id} className="flex cursor-pointer items-center gap-2 rounded-md border border-[var(--geist-gray-200)] px-3 py-2 hover:bg-[var(--geist-background-2)]">
              <input type="checkbox" checked={selected.includes(component.id)} onChange={() => toggle(component.id)} />
              <span className="min-w-0 flex-1">
                <span className="text-sm font-medium text-[var(--geist-primary)]">{component.code}</span>
                <span className="ml-2 text-xs faint-text">{(component.files || []).length > 0 ? `${component.files.length} 个图纸` : '无图纸'}</span>
              </span>
            </label>
          ))}
        </div>
      )}
      <div className="border-t border-[var(--geist-gray-200)] pt-3">
        <Field label="新建小零件" hint="先填名称即可，图纸和规格可之后在「小零件库」补充">
          <div className="flex gap-2">
            <TextInput value={newName} onChange={(e) => setNewName(e.target.value)} placeholder="如：BOLT-M6 螺栓" onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); onCreate(newName) } }} />
            <Button variant="primary" className="shrink-0" onClick={() => onCreate(newName)} disabled={!newName.trim()}>新建并加入</Button>
          </div>
        </Field>
      </div>
    </Modal>
  )
}

function AssemblyModal({ onClose, onSave, initial }) {
  const [code, setCode] = useState(initial?.code || '')
  const [notes, setNotes] = useState(initial?.notes || '')

  function save() {
    if (!code.trim()) return
    onSave({ code: code.trim(), notes })
  }

  return (
    <Modal
      open
      onClose={onClose}
      title={initial ? '编辑组合件' : '新增组合件'}
      footer={
        <>
          <Button onClick={onClose}>取消</Button>
          <Button variant="primary" onClick={save}>保存组合件</Button>
        </>
      }
    >
      <Field label="组合件名称 / 图号" hint="一个大零件（装配体），里面装若干小零件，可有一张装配图">
        <TextInput value={code} onChange={(e) => setCode(e.target.value)} placeholder="如：KLD-042 焊接工装总成" autoFocus />
      </Field>
      <Field label="整体备注" hint="选填，如整体工艺要求">
        <textarea className="text-input h-auto py-2" rows={2} value={notes} onChange={(e) => setNotes(e.target.value)} />
      </Field>
    </Modal>
  )
}

function AssemblyCard({ assembly, compById, components, dataDir, readOnly, notify, refresh, onEdit, prompt }) {
  const [busy, setBusy] = useState(false)
  const [picking, setPicking] = useState(false)
  const [history, setHistory] = useState(false)
  const drawingRef = useRef(null)

  async function addDrawing(fileList) {
    const files = Array.from(fileList || [])
    if (!files.length) return
    setBusy(true)
    try {
      for (const file of files) await addAssemblyFileFromFile(assembly.id, file)
      notify('已添加装配图', 'success')
      await refresh()
    } catch (error) {
      notify(`上传失败。${error.message}`, 'error')
    } finally {
      setBusy(false)
    }
  }

  async function remove() {
    if (!window.confirm(`删除组合件「${assembly.code}」？它的装配图会被移除，里面的小零件仍保留在库里。`)) return
    try {
      await api.deleteAssembly(assembly.id)
      notify('组合件已删除', 'success')
      await refresh()
    } catch (error) {
      notify(error.message, 'error')
    }
  }

  async function addMembers(componentIds) {
    if (!componentIds.length) { setPicking(false); return }
    try {
      await api.addAssemblyMembers(assembly.id, componentIds)
      setPicking(false)
      await refresh()
    } catch (error) {
      notify(error.message, 'error')
    }
  }

  async function createAndAdd(name) {
    const clean = name.trim()
    if (!clean) return
    try {
      const component = await api.addComponent({ code: clean, requirements: {} })
      await api.addAssemblyMembers(assembly.id, [component.id])
      setPicking(false)
      await refresh()
      notify(`已新建小零件「${component.code}」并加入`, 'success')
    } catch (error) {
      notify(error.message, 'error')
    }
  }

  async function removeMember(componentId) {
    try {
      await api.removeAssemblyMember(assembly.id, componentId)
      await refresh()
    } catch (error) {
      notify(error.message, 'error')
    }
  }

  async function setQty(componentId, qty) {
    try {
      await api.setMemberQty(assembly.id, componentId, qty)
      await refresh()
    } catch (error) {
      notify(error.message, 'error')
    }
  }

  const members = assembly.members || []
  const drawings = assembly.assemblyFiles || []
  const memberComponentIds = members.map((m) => m.componentId)
  const available = components.filter((c) => !memberComponentIds.includes(c.id))

  return (
    <div className="panel flex flex-col p-4">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="truncate font-semibold text-[var(--geist-primary)]">{assembly.code}</div>
          <div className="text-xs faint-text">{members.length} 个小零件{drawings.length > 0 ? ' · 含装配图' : ''}</div>
        </div>
        <div className="flex gap-1">
          <Button variant="ghost" className="h-8 px-2" onClick={() => setHistory(true)} title="装配图历史"><History size={15} /></Button>
          <Button variant="ghost" className="h-8 px-2" onClick={() => onEdit(assembly)} title="编辑组合件" disabled={readOnly}><Pencil size={15} /></Button>
          <Button variant="ghost" className="h-8 px-2 text-[var(--geist-red-800)]" onClick={remove} title="删除组合件" disabled={readOnly}><Trash2 size={15} /></Button>
        </div>
      </div>

      {assembly.notes && <div className="mt-2 line-clamp-1 text-xs muted-text" title={assembly.notes}>备注：{assembly.notes}</div>}

      {/* assembly drawing */}
      <div className="mt-3">
        <div className="mb-1 text-[11px] font-medium uppercase tracking-wide faint-text">装配图</div>
        {drawings.length > 0 ? (
          <div className="flex flex-col gap-1.5">
            {drawings.map((file) => (
              <FileRow
                key={file.id}
                file={file}
                dataDir={dataDir}
                readOnly={readOnly}
                prompt={prompt}
                notify={notify}
                onReplace={async (nativeFile) => { await replaceAssemblyFileFromFile(assembly.id, file.id, nativeFile); notify('装配图已替换', 'success'); await refresh() }}
                onSetLabel={async (label) => { await api.updateAssemblyFile(assembly.id, file.id, label, null); await refresh() }}
                onDelete={async () => { await api.deleteAssemblyFile(assembly.id, file.id); notify('装配图已删除', 'success'); await refresh() }}
              />
            ))}
          </div>
        ) : (
          <div className="text-xs faint-text">没有装配图（可选）。</div>
        )}
        <input ref={drawingRef} type="file" multiple className="hidden" onChange={(e) => { addDrawing(e.target.files); e.target.value = '' }} />
        <Button onClick={() => drawingRef.current?.click()} disabled={busy || readOnly} className="mt-2 h-7 text-xs">
          <Upload size={12} /> {busy ? '上传中...' : '添加装配图'}
        </Button>
      </div>

      {/* members */}
      <div className="mt-3">
        <div className="mb-1 text-[11px] font-medium uppercase tracking-wide faint-text">小零件清单</div>
        {members.length === 0 ? (
          <div className="text-xs faint-text">还没有小零件。点下面「添加小零件」从库里挑或新建。</div>
        ) : (
          <div className="flex flex-col gap-1.5">
            {members.map((member) => {
              const component = compById[member.componentId]
              const fileCount = component ? (component.files || []).length : 0
              return (
                <div key={member.componentId} className="flex items-center gap-2 rounded-md border border-[var(--geist-gray-200)] bg-[var(--geist-background-2)] px-2 py-1.5">
                  <Boxes size={14} className="shrink-0 muted-text" />
                  <div className="min-w-0 flex-1">
                    <div className="truncate text-sm text-[var(--geist-primary)]">{component ? component.code : '(已删除的小零件)'}</div>
                    <div className="truncate text-[11px] faint-text">{fileCount > 0 ? `${fileCount} 个图纸 / 修订 v${component.rev || 0}` : <span className="text-[var(--geist-red-800)]">无图纸</span>}</div>
                  </div>
                  <label className="flex items-center gap-1 text-[11px] faint-text">
                    数量
                    <input
                      type="number"
                      min="1"
                      key={member.qty}
                      defaultValue={member.qty || 1}
                      disabled={readOnly}
                      className="w-14 rounded border border-[var(--geist-gray-300)] bg-white px-1.5 py-0.5 text-sm text-[var(--geist-primary)] outline-none focus:border-[var(--geist-gray-500)]"
                      onBlur={(e) => { const v = Number(e.target.value) || 1; if (v !== (member.qty || 1)) setQty(member.componentId, v) }}
                    />
                  </label>
                  <button className="icon-button h-7 w-7 text-[var(--geist-red-800)]" title="移出组合件" onClick={() => removeMember(member.componentId)} disabled={readOnly}><X size={14} /></button>
                </div>
              )
            })}
          </div>
        )}
        <Button onClick={() => setPicking(true)} disabled={readOnly} className="mt-2 h-7 text-xs">
          <Plus size={12} /> 添加小零件
        </Button>
      </div>

      {picking && <ComponentPickerModal available={available} onClose={() => setPicking(false)} onConfirm={addMembers} onCreate={createAndAdd} />}
      <HistoryModal open={history} onClose={() => setHistory(false)} title={`装配图历史 / ${assembly.code}`} archived={assembly.archivedAssemblyFiles} dataDir={dataDir} />
    </div>
  )
}

// ---------- page ----------

export default function Parts({ data, refresh, notify, projectReadOnly = false }) {
  const [tab, setTab] = useState('assemblies')
  const [editingComponent, setEditingComponent] = useState(null)
  const [editingAssembly, setEditingAssembly] = useState(null)
  const [showImport, setShowImport] = useState(false)
  const [promptUI, prompt] = usePrompt()

  const components = data.components || []
  const assemblies = data.assemblies || []
  const compById = useMemo(() => Object.fromEntries(components.map((c) => [c.id, c])), [components])
  const usageInProject = useMemo(() => {
    const counts = {}
    for (const assembly of assemblies) {
      for (const member of assembly.members || []) counts[member.componentId] = (counts[member.componentId] || 0) + 1
    }
    return counts
  }, [assemblies])

  async function saveComponent(payload) {
    try {
      if (editingComponent && editingComponent.id) await api.updateComponent(editingComponent.id, payload)
      else await api.addComponent(payload)
      setEditingComponent(null)
      await refresh()
    } catch (error) {
      notify(error.message, 'error')
    }
  }

  async function saveAssembly(payload) {
    if (projectReadOnly) {
      notify('历史项目只读，不能修改组合件。', 'info')
      return
    }
    try {
      if (editingAssembly && editingAssembly.id) await api.updateAssembly(editingAssembly.id, payload)
      else await api.addAssembly(payload)
      setEditingAssembly(null)
      await refresh()
    } catch (error) {
      notify(error.message, 'error')
    }
  }

  const segBtn = (key, label) =>
    `rounded px-3 py-1 text-sm transition ${tab === key ? 'bg-[var(--geist-primary)] text-white' : 'text-[var(--geist-gray-900)] hover:bg-[var(--geist-background-2)]'}`

  return (
    <div className="flex h-full flex-col">
      <div className="surface-toolbar">
        <div className="flex items-center gap-3">
          <div className="inline-flex items-center rounded-md border border-[var(--geist-gray-300)] p-0.5">
            <button className={segBtn('assemblies', '组合件')} onClick={() => setTab('assemblies')}><Layers size={13} className="mr-1 inline" />组合件 ({assemblies.length})</button>
            <button className={segBtn('library', '小零件库')} onClick={() => setTab('library')}><Boxes size={13} className="mr-1 inline" />小零件库 ({components.length})</button>
          </div>
          {tab === 'assemblies' && projectReadOnly && <span className="status-pill status-gray">历史只读</span>}
        </div>
        {tab === 'assemblies' ? (
          <Button variant="primary" onClick={() => setEditingAssembly({})} disabled={projectReadOnly}><Plus size={15} /> 新增组合件</Button>
        ) : (
          <div className="flex gap-2">
            <Button onClick={() => setShowImport(true)}><Upload size={15} /> 从 Excel 导入</Button>
            <Button variant="primary" onClick={() => setEditingComponent({})}><Plus size={15} /> 新增小零件</Button>
          </div>
        )}
      </div>

      <div className="flex-1 overflow-auto bg-[var(--geist-background)] p-4">
        {tab === 'assemblies' ? (
          assemblies.length === 0 ? (
            <div className="mt-20 text-center text-sm faint-text">
              {projectReadOnly ? '这个历史项目没有组合件。' : '没有组合件。点右上角「新增组合件」，再往里面加小零件。'}
            </div>
          ) : (
            <div className="grid grid-cols-1 gap-3 lg:grid-cols-2 xl:grid-cols-3">
              {assemblies.map((assembly) => (
                <AssemblyCard
                  key={assembly.id}
                  assembly={assembly}
                  compById={compById}
                  components={components}
                  dataDir={data.dataDir}
                  readOnly={projectReadOnly}
                  notify={notify}
                  refresh={refresh}
                  onEdit={setEditingAssembly}
                  prompt={prompt}
                />
              ))}
            </div>
          )
        ) : components.length === 0 ? (
          <div className="mt-20 text-center text-sm faint-text">小零件库是空的。点右上角「新增小零件」，或在组合件里「添加小零件 → 新建并加入」。</div>
        ) : (
          <div className="grid grid-cols-1 gap-3 lg:grid-cols-2 xl:grid-cols-3">
            {components.map((component) => (
              <ComponentCard
                key={component.id}
                component={component}
                dataDir={data.dataDir}
                usedCount={usageInProject[component.id] || 0}
                notify={notify}
                refresh={refresh}
                onEdit={setEditingComponent}
                prompt={prompt}
              />
            ))}
          </div>
        )}
      </div>

      {editingComponent && (
        <ComponentModal onClose={() => setEditingComponent(null)} onSave={saveComponent} initial={editingComponent.id ? editingComponent : null} />
      )}
      {editingAssembly && (
        <AssemblyModal onClose={() => setEditingAssembly(null)} onSave={saveAssembly} initial={editingAssembly.id ? editingAssembly : null} />
      )}
      <ImportDialog open={showImport} onClose={() => setShowImport(false)} onImported={refresh} notify={notify} />
      {promptUI}
    </div>
  )
}
