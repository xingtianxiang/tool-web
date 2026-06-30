import React, { useMemo, useRef, useState } from 'react'
import { AlertTriangle, Archive, ArchiveRestore, CheckCircle2, Circle, Minus, Package, Pencil, Plus, Trash2, X } from 'lucide-react'
import { api } from '../lib/api.js'
import { cellState, vendorAlerts, assemblyHasContent } from '../lib/state.js'
import { Button, Field, Modal, TextInput, usePrompt } from '../ui.jsx'

// A project card in the sidebar. Click to switch to it; click the pencil (or it
// shows on hover) to rename in place; drag it between 进行中 / 历史 to change status.
function ProjectCard({ project, selected, onSelect, onRename, onDragStart, onDragEnd, dragging }) {
  const archived = project.status === 'archived'
  const [editing, setEditing] = useState(false)
  const [value, setValue] = useState(project.name)
  const cancelRef = useRef(false)

  function startEdit(e) {
    e.stopPropagation()
    setValue(project.name)
    cancelRef.current = false
    setEditing(true)
  }

  function commit() {
    setEditing(false)
    if (cancelRef.current) {
      cancelRef.current = false
      return
    }
    onRename(project.id, value.trim())
  }

  function cancel() {
    cancelRef.current = true
    setEditing(false)
  }

  return (
    <div
      className={`project-card group ${editing ? 'cursor-text' : 'cursor-grab active:cursor-grabbing'} ${selected ? 'project-card-active' : ''} ${dragging ? 'opacity-40' : ''}`}
      onClick={() => { if (!editing) onSelect() }}
      role="button"
      tabIndex={0}
      onKeyDown={(e) => { if (!editing && (e.key === 'Enter' || e.key === ' ')) { e.preventDefault(); onSelect() } }}
      title={editing ? project.name : '点击切换 · 拖到「进行中」或「历史」可改变状态'}
      draggable={!editing}
      onDragStart={(e) => {
        e.dataTransfer.setData('text/plain', project.id)
        e.dataTransfer.effectAllowed = 'move'
        onDragStart?.(project.id)
      }}
      onDragEnd={() => onDragEnd?.()}
    >
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0 flex-1">
          {editing ? (
            <input
              className="w-full rounded border border-[var(--geist-gray-300)] bg-white px-1.5 py-0.5 text-sm font-semibold text-[var(--geist-primary)] outline-none focus:border-[var(--geist-gray-500)]"
              value={value}
              autoFocus
              onClick={(e) => e.stopPropagation()}
              onChange={(e) => setValue(e.target.value)}
              onFocus={(e) => e.target.select()}
              onBlur={commit}
              onKeyDown={(e) => {
                e.stopPropagation()
                if (e.key === 'Enter') { e.preventDefault(); e.currentTarget.blur() }
                else if (e.key === 'Escape') { e.preventDefault(); cancel() }
              }}
            />
          ) : (
            <div className="truncate text-sm font-semibold text-[var(--geist-primary)]">{project.name}</div>
          )}
          <div className="mt-1 text-xs faint-text">
            {project.assemblyCount} 个组合件 / {project.assignmentCount} 个指派
          </div>
        </div>
        <div className="flex shrink-0 items-center gap-1">
          {!editing && (
            <button type="button" className="icon-button h-6 w-6 opacity-0 transition group-hover:opacity-100" title="重命名" onClick={startEdit}>
              <Pencil size={12} />
            </button>
          )}
          <span className={`status-pill ${archived ? 'status-gray' : 'status-green'}`}>
            {archived ? '历史' : '当前'}
          </span>
        </div>
      </div>
      <div className="mt-3 flex items-center justify-between text-[11px] faint-text">
        <span>{project.sendCount} 次打包</span>
        {archived ? <span>{project.archivedAt ? new Date(project.archivedAt).toLocaleDateString('zh-CN') : '已归档'}</span> : <span>进行中</span>}
      </div>
    </div>
  )
}

const CELL_CONFIG = {
  none: { cls: 'text-[var(--geist-gray-700)] hover:bg-[var(--geist-background-2)] hover:text-[var(--geist-primary)]', title: '点击指派给该厂商', icon: <Minus size={14} />, label: '' },
  nocontent: { cls: 'bg-white text-[var(--geist-red-800)] hover:bg-[var(--geist-red-100)]', title: '该组合件还没有任何图纸（装配图或小零件图纸），无法打包。点击可取消指派', icon: <AlertTriangle size={13} />, label: '无图纸' },
  sent: { cls: 'bg-white text-[var(--geist-green-800)] hover:bg-[var(--geist-green-100)]', title: '已发送当前版本。点击可取消指派', icon: <CheckCircle2 size={13} />, label: '已发最新' },
  stale: { cls: 'bg-white font-medium text-[#aa4d00] hover:bg-[var(--geist-amber-100)]', title: '装配图或某个小零件已更新，该厂商还拿着旧版。点击可取消指派', icon: <AlertTriangle size={13} />, label: '需重发' },
  unsent: { cls: 'bg-white text-[var(--geist-gray-900)] hover:bg-[var(--geist-gray-100)]', title: '已指派，尚未发送。点击可取消指派', icon: <Circle size={12} />, label: '未发送' }
}

function Cell({ state, meta, onClick, disabled }) {
  const base = `flex h-full min-h-16 w-full flex-col items-center justify-center gap-1 px-2 py-1.5 text-center text-xs leading-tight transition ${disabled ? 'cursor-not-allowed opacity-70' : 'cursor-pointer'}`
  const c = CELL_CONFIG[state.kind] || CELL_CONFIG.unsent
  const showMeta = state.kind !== 'none' && meta && (meta.deadline || meta.note)
  return (
    <button onClick={onClick} disabled={disabled} className={`${base} ${c.cls}`} title={c.title}>
      <span className="flex items-center gap-1">{c.icon}{c.label && <span>{c.label}</span>}</span>
      {showMeta && (
        <span
          className="w-full truncate text-xs text-[var(--geist-blue-700)]"
          title={`${meta.deadline ? '交期：' + meta.deadline : ''}${meta.note ? '  备注：' + meta.note : ''}`}
        >
          {[meta.deadline, meta.note].filter(Boolean).join(' · ')}
        </span>
      )}
    </button>
  )
}

// Pick which global vendors take part in the current project. Supports adding
// several existing vendors at once, or creating a brand-new one inline.
function VendorPickerModal({ available, onClose, onConfirm, onCreate }) {
  const [selected, setSelected] = useState([])
  const [newName, setNewName] = useState('')

  function toggle(id) {
    setSelected((prev) => (prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]))
  }

  return (
    <Modal
      open
      onClose={onClose}
      title="添加厂商到本项目"
      footer={
        <>
          <Button onClick={onClose}>取消</Button>
          <Button variant="primary" onClick={() => onConfirm(selected)} disabled={selected.length === 0}>
            添加{selected.length ? ` (${selected.length})` : ''}
          </Button>
        </>
      }
    >
      {available.length === 0 ? (
        <p className="mb-3 text-sm faint-text">所有厂商都已经在本项目里了。可以在下面新建一个厂商。</p>
      ) : (
        <div className="mb-4 flex flex-col gap-1.5">
          <div className="field-label">勾选要加入本项目的厂商</div>
          {available.map((vendor) => (
            <label key={vendor.id} className="flex cursor-pointer items-center gap-2 rounded-md border border-[var(--geist-gray-200)] px-3 py-2 hover:bg-[var(--geist-background-2)]">
              <input type="checkbox" checked={selected.includes(vendor.id)} onChange={() => toggle(vendor.id)} />
              <span className="min-w-0 flex-1">
                <span className="text-sm font-medium text-[var(--geist-primary)]">{vendor.name}</span>
                {vendor.contact && <span className="ml-2 text-xs faint-text">{vendor.contact}</span>}
              </span>
            </label>
          ))}
        </div>
      )}
      <div className="border-t border-[var(--geist-gray-200)] pt-3">
        <Field label="新建厂商" hint="先填名称即可，详细资料可之后到「厂商」页补充">
          <div className="flex gap-2">
            <TextInput
              value={newName}
              onChange={(e) => setNewName(e.target.value)}
              placeholder="如：精工外协"
              onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); onCreate(newName) } }}
            />
            <Button variant="primary" className="shrink-0" onClick={() => onCreate(newName)} disabled={!newName.trim()}>新建并加入</Button>
          </div>
        </Field>
      </div>
    </Modal>
  )
}

// Per-cell (组合件 × 厂商) 交期 + 打包备注. Each vendor can get a different
// deadline/note; these print on that vendor's 需求单 next to the assembly.
function CellMetaModal({ assemblyCode, vendorName, initial, onClose, onSave }) {
  const [deadline, setDeadline] = useState(initial.deadline || '')
  const [note, setNote] = useState(initial.note || '')

  return (
    <Modal
      open
      onClose={onClose}
      title={`打包备注 / ${assemblyCode} → ${vendorName}`}
      footer={
        <>
          <Button onClick={onClose}>取消</Button>
          <Button variant="primary" onClick={() => onSave({ deadline, note })}>保存</Button>
        </>
      }
    >
      <Field label="交期" hint="点开日历选日期；留空表示不指定。会印在该厂商的需求单上">
        <TextInput type="date" value={deadline} onChange={(e) => setDeadline(e.target.value)} autoFocus />
      </Field>
      <Field label="打包备注" hint="只给这家厂商看的说明，会印在需求单上">
        <textarea className="text-input h-auto py-2" rows={3} value={note} onChange={(e) => setNote(e.target.value)} />
      </Field>
    </Modal>
  )
}

export default function Dashboard({ data, refresh, notify, openPackage, goTo, projectReadOnly = false }) {
  const { assemblies, components, vendors, assignments, sendLog, currentProject } = data
  const activeProjects = useMemo(() => data.projects.filter((project) => project.status !== 'archived'), [data.projects])
  const archivedProjects = useMemo(() => data.projects.filter((project) => project.status === 'archived'), [data.projects])
  const compById = useMemo(() => Object.fromEntries((components || []).map((component) => [component.id, component])), [components])
  const [promptUI, prompt] = usePrompt()
  const [pickerOpen, setPickerOpen] = useState(false)
  const [cellMeta, setCellMeta] = useState(null)
  const [draggingId, setDraggingId] = useState(null)
  const [dragOverZone, setDragOverZone] = useState(null)

  // Columns are the vendors that belong to THIS project (membership), kept in the
  // order they were added. The rest of the global vendor list is offered in the picker.
  const projectVendorIds = currentProject.vendorIds || []
  const projectVendors = useMemo(
    () => projectVendorIds.map((id) => vendors.find((vendor) => vendor.id === id)).filter(Boolean),
    [projectVendorIds, vendors]
  )
  const availableVendors = useMemo(
    () => vendors.filter((vendor) => !projectVendorIds.includes(vendor.id)),
    [vendors, projectVendorIds]
  )
  const draggingProject = draggingId ? data.projects.find((project) => project.id === draggingId) : null

  async function selectProject(projectId) {
    if (projectId === currentProject.id) return
    try {
      await api.setActiveProject(projectId)
      await refresh()
    } catch (error) {
      notify(error.message, 'error')
    }
  }

  async function addProject() {
    const name = await prompt({
      title: '新建项目',
      label: '项目名称',
      defaultValue: `项目 ${new Date().toLocaleDateString('zh-CN')}`,
      confirmText: '创建'
    })
    if (!name) return
    try {
      await api.addProject({ name })
      await refresh()
      notify(`已创建项目「${name}」`, 'success')
    } catch (error) {
      notify(error.message, 'error')
    }
  }

  async function renameProject(projectId, name) {
    const project = data.projects.find((item) => item.id === projectId)
    if (!name || (project && name === project.name)) return
    try {
      await api.updateProject(projectId, { name })
      await refresh()
      notify('项目已重命名', 'success')
    } catch (error) {
      notify(error.message, 'error')
    }
  }

  async function archiveProject() {
    if (projectReadOnly) return
    if (!window.confirm(`归档项目「${currentProject.name}」？归档后会留在历史区，只读查看。`)) return
    try {
      await api.archiveProject(currentProject.id)
      await refresh()
      notify('项目已归档，已放入历史区', 'success')
    } catch (error) {
      notify(error.message, 'error')
    }
  }

  function openCellMeta(assembly, vendor, assignment) {
    setCellMeta({
      assemblyId: assembly.id,
      vendorId: vendor.id,
      assemblyCode: assembly.code,
      vendorName: vendor.name,
      deadline: assignment.deadline || '',
      note: assignment.note || ''
    })
  }

  async function saveCellMeta({ deadline, note }) {
    try {
      await api.setAssignmentMeta(cellMeta.assemblyId, cellMeta.vendorId, { deadline, note })
      setCellMeta(null)
      await refresh()
      notify('已保存打包备注', 'success')
    } catch (error) {
      notify(error.message, 'error')
    }
  }

  async function deleteProject() {
    if (!window.confirm(
      `确定永久删除项目「${currentProject.name}」？\n\n该项目的所有零件、图纸文件和发送记录都会被一并删除，无法恢复。\n（如果只是想收起来留底，用「完成归档」就好。）`
    )) return
    try {
      await api.deleteProject(currentProject.id)
      await refresh()
      notify('项目已删除', 'success')
    } catch (error) {
      notify(error.message, 'error')
    }
  }

  // Move a project between 进行中 (active) and 历史 (archived) — used by both the
  // drag-and-drop between the two sidebar groups and the toolbar restore button.
  // No confirm: the drag is intentional and the move is reversible (drag it back).
  async function moveProjectTo(status, projectId) {
    const project = data.projects.find((item) => item.id === projectId)
    if (!project || project.status === status) return
    try {
      if (status === 'archived') {
        await api.archiveProject(projectId)
        notify(`「${project.name}」已放入历史区`, 'success')
      } else {
        await api.unarchiveProject(projectId)
        notify(`「${project.name}」已恢复为进行中`, 'success')
      }
      await refresh()
    } catch (error) {
      notify(error.message, 'error')
    }
  }

  function onDragStartCard(projectId) {
    setDraggingId(projectId)
  }

  function onDragEndCard() {
    setDraggingId(null)
    setDragOverZone(null)
  }

  function onDropToZone(status, event) {
    event.preventDefault()
    const projectId = event.dataTransfer.getData('text/plain') || draggingId
    setDraggingId(null)
    setDragOverZone(null)
    if (projectId) moveProjectTo(status, projectId)
  }

  async function addVendorsToProject(vendorIds) {
    if (!vendorIds.length) {
      setPickerOpen(false)
      return
    }
    try {
      await api.addProjectVendors(vendorIds)
      setPickerOpen(false)
      await refresh()
      notify(`已把 ${vendorIds.length} 家厂商加入本项目`, 'success')
    } catch (error) {
      notify(error.message, 'error')
    }
  }

  async function createAndAddVendor(name) {
    const clean = name.trim()
    if (!clean) return
    try {
      const vendor = await api.addVendor({ name: clean, contact: '' })
      await api.addProjectVendors([vendor.id])
      setPickerOpen(false)
      await refresh()
      notify(`已新建并加入「${vendor.name}」`, 'success')
    } catch (error) {
      notify(error.message, 'error')
    }
  }

  async function removeVendorFromProject(vendor) {
    if (!window.confirm(`把「${vendor.name}」移出本项目？该厂商在本项目的指派会被清除，发送历史保留。`)) return
    try {
      await api.removeProjectVendor(vendor.id)
      await refresh()
      notify(`已把「${vendor.name}」移出本项目`, 'success')
    } catch (error) {
      notify(error.message, 'error')
    }
  }

  async function toggle(assembly, vendorId) {
    if (projectReadOnly) {
      notify('历史项目只读，不能修改指派。', 'info')
      return
    }
    const assigned = assignments.some((item) => item.assemblyId === assembly.id && item.vendorId === vendorId)
    try {
      await api.setAssignment(assembly.id, vendorId, !assigned)
      await refresh()
    } catch (error) {
      notify(error.message, 'error')
    }
  }

  return (
    <div className="project-canvas">
      <aside className="project-rail">
        <div className="flex items-center justify-between gap-2">
          <div>
            <div className="text-sm font-semibold text-[var(--geist-primary)]">项目画布</div>
            <div className="mt-1 text-xs faint-text">{draggingId ? '拖到「进行中」或「历史」松手即可切换' : '当前和历史都在这里'}</div>
          </div>
          <Button className="h-8 px-2 text-xs" onClick={addProject}>
            <Plus size={13} /> 新项目
          </Button>
        </div>

        <div
          className={`mt-4 space-y-2 rounded-lg p-1 transition ${dragOverZone === 'active' ? 'bg-[var(--geist-blue-100)] ring-2 ring-inset ring-[var(--geist-blue-700)]' : ''}`}
          onDragOver={(e) => { if (draggingProject && draggingProject.status !== 'active') { e.preventDefault(); e.dataTransfer.dropEffect = 'move'; setDragOverZone('active') } }}
          onDrop={(e) => onDropToZone('active', e)}
        >
          <div className="flex items-center justify-between px-1 text-[11px] font-medium uppercase tracking-wide faint-text">
            <span>进行中</span>
            {dragOverZone === 'active' && <span className="normal-case text-[var(--geist-blue-700)]">松手恢复为进行中</span>}
          </div>
          {activeProjects.map((project) => (
            <ProjectCard
              key={project.id}
              project={project}
              selected={project.id === currentProject.id}
              onSelect={() => selectProject(project.id)}
              onRename={renameProject}
              onDragStart={onDragStartCard}
              onDragEnd={onDragEndCard}
              dragging={draggingId === project.id}
            />
          ))}
          {activeProjects.length === 0 && (
            <div className="rounded-md border border-dashed border-[var(--geist-gray-300)] p-3 text-xs faint-text">
              没有进行中的项目。点右上角「新项目」，或把历史项目拖上来恢复。
            </div>
          )}
        </div>

        <div
          className={`mt-5 space-y-2 rounded-lg p-1 transition ${dragOverZone === 'archived' ? 'bg-[var(--geist-gray-100)] ring-2 ring-inset ring-[var(--geist-gray-500)]' : ''}`}
          onDragOver={(e) => { if (draggingProject && draggingProject.status !== 'archived') { e.preventDefault(); e.dataTransfer.dropEffect = 'move'; setDragOverZone('archived') } }}
          onDrop={(e) => onDropToZone('archived', e)}
        >
          <div className="flex items-center justify-between px-1 text-[11px] font-medium uppercase tracking-wide faint-text">
            <span>历史</span>
            {dragOverZone === 'archived' && <span className="normal-case text-[var(--geist-primary)]">松手放入历史</span>}
          </div>
          {archivedProjects.length === 0 ? (
            <div className="rounded-md border border-dashed border-[var(--geist-gray-300)] p-3 text-xs faint-text">
              完成并归档的项目会出现在这里，也可以把卡片拖进来归档。
            </div>
          ) : (
            archivedProjects.map((project) => (
              <ProjectCard
                key={project.id}
                project={project}
                selected={project.id === currentProject.id}
                onSelect={() => selectProject(project.id)}
                onRename={renameProject}
                onDragStart={onDragStartCard}
                onDragEnd={onDragEndCard}
                dragging={draggingId === project.id}
              />
            ))
          )}
        </div>
      </aside>

      <section className="min-w-0 flex flex-1 flex-col">
        <div className="surface-toolbar min-h-16">
          <div className="min-w-0">
            <div className="flex items-center gap-2">
              <h1 className="truncate text-base font-semibold text-[var(--geist-primary)]">{currentProject.name}</h1>
              {projectReadOnly && <span className="status-pill status-gray">历史只读</span>}
            </div>
            <div className="mt-1 text-xs faint-text">
              {currentProject.assemblyCount} 个组合件 / {projectVendors.length} 家厂商 / {currentProject.sendCount} 次打包记录
            </div>
          </div>
          <div className="flex items-center gap-2">
            {projectReadOnly ? (
              <Button onClick={() => moveProjectTo('active', currentProject.id)}><ArchiveRestore size={15} /> 恢复为进行中</Button>
            ) : (
              <Button onClick={archiveProject}><Archive size={15} /> 完成归档</Button>
            )}
            <Button variant="danger" onClick={deleteProject}><Trash2 size={15} /> 删除</Button>
          </div>
        </div>

        {assemblies.length === 0 ? (
          <div className="flex h-full flex-col items-center justify-center gap-3 text-sm muted-text">
            <p>先在「零件」页新建组合件（大零件），再回到这里指派与打包。</p>
            {!projectReadOnly && <Button variant="primary" onClick={() => goTo('parts')}>去新建组合件</Button>}
          </div>
        ) : projectVendors.length === 0 ? (
          <div className="flex h-full flex-col items-center justify-center gap-3 text-sm muted-text">
            <p>本项目还没有指定厂商。把要用的厂商加进来，就能开始指派与打包。</p>
            {!projectReadOnly && (
              <Button variant="primary" onClick={() => setPickerOpen(true)}><Plus size={15} /> 添加厂商</Button>
            )}
          </div>
        ) : (
          <>
            <div className="surface-toolbar border-t-0">
              <div className="flex flex-wrap items-center gap-x-4 gap-y-2 text-xs muted-text">
                <span className="flex items-center gap-1"><span className="h-3 w-3 rounded-sm border border-[var(--geist-green-800)] bg-[var(--geist-green-100)]" /> 已发最新</span>
                <span className="flex items-center gap-1"><span className="h-3 w-3 rounded-sm border border-[#ffdc73] bg-[var(--geist-amber-100)]" /> 需重发</span>
                <span className="flex items-center gap-1"><span className="h-3 w-3 rounded-sm border border-[var(--geist-gray-300)] bg-[var(--geist-gray-100)]" /> 未发送</span>
                <span className="flex items-center gap-1"><Minus size={13} /> 未指派，点击格子指派</span>
                <span className="flex items-center gap-1"><Pencil size={11} /> 已指派的格子悬停可写交期/打包备注</span>
              </div>
              <div className="flex items-center gap-3">
                <span className="text-xs faint-text">{assemblies.length} 个组合件 / {projectVendors.length} 家厂商</span>
                {!projectReadOnly && (
                  <Button className="h-8 px-2 text-xs" onClick={() => setPickerOpen(true)}><Plus size={13} /> 添加厂商</Button>
                )}
              </div>
            </div>

            <div className="min-h-0 flex-1 bg-[var(--geist-background)] p-4">
              <div className="panel resizable-matrix-panel">
                <table className="data-table h-full w-full table-fixed">
                  <thead>
                    <tr>
                      <th className="sticky left-0 top-0 z-20 w-[26%] min-w-[220px] border-b border-r bg-[var(--geist-background-2)] px-4 py-4 text-left">
                        组合件 / 厂商
                      </th>
                      {projectVendors.map((vendor) => {
                        const alerts = vendorAlerts(vendor.id, assemblies, sendLog, assignments, compById)
                        return (
                          <th key={vendor.id} className="group relative sticky top-0 z-10 min-w-[168px] border-b border-r bg-[var(--geist-background-2)] px-3 py-4 align-top">
                            {!projectReadOnly && (
                              <button
                                type="button"
                                className="icon-button absolute right-1 top-1 h-6 w-6 opacity-0 transition group-hover:opacity-100"
                                title="移出本项目"
                                onClick={() => removeVendorFromProject(vendor)}
                              >
                                <X size={12} />
                              </button>
                            )}
                            <div className="flex flex-col items-center gap-2">
                              <span className="text-sm font-semibold text-[var(--geist-primary)]">{vendor.name}</span>
                              <div className="flex min-h-5 items-center gap-1 text-[11px]">
                                {alerts.stale > 0 && (
                                  <span className="status-pill status-amber">
                                    <AlertTriangle size={11} /> {alerts.stale} 需重发
                                  </span>
                                )}
                                {alerts.unsent > 0 && <span className="status-pill status-gray">{alerts.unsent} 待发</span>}
                              </div>
                              <Button variant="primary" className="h-8 px-2 text-xs" onClick={() => openPackage(vendor.id)} disabled={projectReadOnly}>
                                <Package size={12} /> 打包
                              </Button>
                            </div>
                          </th>
                        )
                      })}
                    </tr>
                  </thead>
                  <tbody>
                    {assemblies.map((assembly) => {
                      const memberCount = (assembly.members || []).length
                      const hasDrawing = (assembly.assemblyFiles || []).length > 0
                      const empty = !assemblyHasContent(assembly, compById)
                      return (
                        <tr key={assembly.id} className="group">
                          <th className="sticky left-0 z-10 border-b border-r bg-white px-4 py-3 text-left font-normal group-hover:bg-[var(--geist-background-2)]">
                            <div className="text-sm font-medium text-[var(--geist-primary)]">{assembly.code}</div>
                            <div className="text-xs faint-text">
                              {memberCount} 个小零件{hasDrawing ? ' · 含装配图' : ''}
                              {empty && <span className="text-[var(--geist-red-800)]"> · 无图纸</span>}
                            </div>
                          </th>
                          {projectVendors.map((vendor) => {
                            const assignment = assignments.find((a) => a.assemblyId === assembly.id && a.vendorId === vendor.id)
                            return (
                              <td key={vendor.id} className="group/cell relative h-12 border-b border-r p-0">
                                <Cell state={cellState(assembly, vendor.id, sendLog, assignments, compById)} meta={assignment} onClick={() => toggle(assembly, vendor.id)} disabled={projectReadOnly} />
                                {assignment && !projectReadOnly && (
                                  <button
                                    type="button"
                                    className="absolute right-0.5 top-0.5 z-10 flex h-5 w-5 items-center justify-center rounded bg-white/70 text-[var(--geist-gray-700)] opacity-0 transition hover:bg-white hover:text-[var(--geist-primary)] group-hover/cell:opacity-100"
                                    title="打包备注 / 交期"
                                    onClick={(e) => { e.stopPropagation(); openCellMeta(assembly, vendor, assignment) }}
                                  >
                                    <Pencil size={11} />
                                  </button>
                                )}
                              </td>
                            )
                          })}
                        </tr>
                      )
                    })}
                  </tbody>
                </table>
              </div>
            </div>
          </>
        )}
      </section>
      {pickerOpen && (
        <VendorPickerModal
          available={availableVendors}
          onClose={() => setPickerOpen(false)}
          onConfirm={addVendorsToProject}
          onCreate={createAndAddVendor}
        />
      )}
      {cellMeta && (
        <CellMetaModal
          assemblyCode={cellMeta.assemblyCode}
          vendorName={cellMeta.vendorName}
          initial={cellMeta}
          onClose={() => setCellMeta(null)}
          onSave={saveCellMeta}
        />
      )}
      {promptUI}
    </div>
  )
}
