import React from 'react'
import { Pencil, Plus, Trash2, Upload } from 'lucide-react'
import { useMemo, useState } from 'react'
import { api } from '../lib/api.js'
import { vendorAlerts } from '../lib/state.js'
import { Button, Field, Modal, TextInput } from '../ui.jsx'
import ImportDialog from '../components/ImportDialog.jsx'

function VendorModal({ open, onClose, onSave, initial }) {
  const [name, setName] = useState(initial?.name || '')
  const [contact, setContact] = useState(initial?.contact || '')

  function save() {
    if (!name.trim()) return
    onSave({ name: name.trim(), contact: contact.trim() })
  }

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={initial ? '编辑厂商' : '新增厂商'}
      footer={
        <>
          <Button onClick={onClose}>取消</Button>
          <Button variant="primary" onClick={save}>保存厂商</Button>
        </>
      }
    >
      <Field label="厂商名称">
        <TextInput value={name} onChange={(e) => setName(e.target.value)} placeholder="如：甲厂" autoFocus />
      </Field>
      <Field label="联系方式 / 备注" hint="选填，如微信号、联系人或地区">
        <TextInput value={contact} onChange={(e) => setContact(e.target.value)} />
      </Field>
    </Modal>
  )
}

export default function Vendors({ data, refresh, notify }) {
  const [editing, setEditing] = useState(null)
  const [showImport, setShowImport] = useState(false)
  const compById = useMemo(() => Object.fromEntries((data.components || []).map((component) => [component.id, component])), [data.components])

  async function save(payload) {
    try {
      if (editing && editing.id) await api.updateVendor(editing.id, payload)
      else await api.addVendor(payload)
      setEditing(null)
      await refresh()
    } catch (error) {
      notify(error.message, 'error')
    }
  }

  async function remove(vendor) {
    if (!window.confirm(`删除厂商「${vendor.name}」？指派关系会一并移除，发送历史保留。`)) return
    try {
      await api.deleteVendor(vendor.id)
      await refresh()
    } catch (error) {
      notify(error.message, 'error')
    }
  }

  return (
    <div className="flex h-full flex-col">
      <div className="surface-toolbar">
        <span className="text-sm muted-text">{data.vendors.length} 家厂商</span>
        <div className="flex gap-2">
          <Button onClick={() => setShowImport(true)}><Upload size={15} /> 从 Excel 导入</Button>
          <Button variant="primary" onClick={() => setEditing({})}><Plus size={15} /> 新增厂商</Button>
        </div>
      </div>
      <div className="flex-1 overflow-auto bg-[var(--geist-background)] p-4">
        {data.vendors.length === 0 ? (
          <div className="mt-20 text-center text-sm faint-text">没有厂商。点击右上角「新增厂商」开始。</div>
        ) : (
          <div className="grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-3">
            {data.vendors.map((vendor) => {
              const alerts = vendorAlerts(vendor.id, data.assemblies, data.sendLog, data.assignments, compById)
              const assignedCount = data.assignments.filter((item) => item.vendorId === vendor.id).length
              return (
                <div key={vendor.id} className="panel p-4">
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <div className="truncate font-semibold text-[var(--geist-primary)]">{vendor.name}</div>
                      {vendor.contact && <div className="truncate text-xs faint-text">{vendor.contact}</div>}
                    </div>
                    <div className="flex gap-1">
                      <Button variant="ghost" className="h-8 px-2" onClick={() => setEditing(vendor)} title="编辑厂商"><Pencil size={15} /></Button>
                      <Button variant="ghost" className="h-8 px-2 text-[var(--geist-red-800)]" onClick={() => remove(vendor)} title="删除厂商"><Trash2 size={15} /></Button>
                    </div>
                  </div>
                  <div className="mt-3 flex items-center gap-2 text-xs">
                    <span className="muted-text">{assignedCount} 个组合件</span>
                    {alerts.stale > 0 && <span className="status-pill status-amber">{alerts.stale} 需重发</span>}
                    {alerts.unsent > 0 && <span className="status-pill status-gray">{alerts.unsent} 待发</span>}
                  </div>
                </div>
              )
            })}
          </div>
        )}
      </div>

      <VendorModal open={!!editing} onClose={() => setEditing(null)} onSave={save} initial={editing && editing.id ? editing : null} />
      <ImportDialog open={showImport} onClose={() => setShowImport(false)} onImported={refresh} notify={notify} />
    </div>
  )
}
