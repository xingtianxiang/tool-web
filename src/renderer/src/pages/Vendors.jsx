import { useState } from 'react'
import { Plus, Pencil, Trash2, Package } from 'lucide-react'
import { api } from '../lib/api.js'
import { vendorAlerts } from '../lib/state.js'
import { Button, Modal, Field, TextInput } from '../ui.jsx'

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
          <Button variant="primary" onClick={save}>保存</Button>
        </>
      }
    >
      <Field label="厂商名称">
        <TextInput value={name} onChange={(e) => setName(e.target.value)} placeholder="如:甲厂" autoFocus />
      </Field>
      <Field label="联系方式 / 备注" hint="选填,如微信号、联系人">
        <TextInput value={contact} onChange={(e) => setContact(e.target.value)} />
      </Field>
    </Modal>
  )
}

export default function Vendors({ data, refresh, notify, openPackage }) {
  const [editing, setEditing] = useState(null)

  async function save(payload) {
    try {
      if (editing && editing.id) await api.updateVendor(editing.id, payload)
      else await api.addVendor(payload)
      setEditing(null)
      await refresh()
    } catch (e) {
      notify(e.message, 'error')
    }
  }

  async function remove(v) {
    if (!window.confirm(`删除厂商「${v.name}」?指派关系会一并移除(发送历史保留)。`)) return
    try {
      await api.deleteVendor(v.id)
      await refresh()
    } catch (e) {
      notify(e.message, 'error')
    }
  }

  return (
    <div className="flex h-full flex-col">
      <div className="flex items-center justify-between border-b border-slate-200 bg-white px-4 py-2">
        <span className="text-sm text-slate-500">{data.vendors.length} 家厂商</span>
        <Button variant="primary" onClick={() => setEditing({})}><Plus size={15} /> 新增厂商</Button>
      </div>
      <div className="flex-1 overflow-auto p-4">
        {data.vendors.length === 0 ? (
          <div className="mt-20 text-center text-sm text-slate-400">还没有厂商,点右上角「新增厂商」开始。</div>
        ) : (
          <div className="grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-3">
            {data.vendors.map((v) => {
              const a = vendorAlerts(v.id, data.parts, data.sendLog, data.assignments)
              const assignedCount = data.assignments.filter((x) => x.vendorId === v.id).length
              return (
                <div key={v.id} className="rounded-lg border border-slate-200 bg-white p-3">
                  <div className="flex items-start justify-between">
                    <div>
                      <div className="font-semibold text-slate-800">{v.name}</div>
                      {v.contact && <div className="text-xs text-slate-400">{v.contact}</div>}
                    </div>
                    <div className="flex gap-1">
                      <Button variant="ghost" className="!px-1.5" onClick={() => setEditing(v)}><Pencil size={15} /></Button>
                      <Button variant="ghost" className="!px-1.5 !text-red-500" onClick={() => remove(v)}><Trash2 size={15} /></Button>
                    </div>
                  </div>
                  <div className="mt-2 flex items-center gap-2 text-xs">
                    <span className="text-slate-500">{assignedCount} 个零件</span>
                    {a.stale > 0 && <span className="rounded bg-amber-100 px-1 text-amber-800">{a.stale} 需重发</span>}
                    {a.unsent > 0 && <span className="rounded bg-slate-200 px-1 text-slate-600">{a.unsent} 待发</span>}
                  </div>
                  <Button variant="primary" className="mt-2 w-full !text-sm" onClick={() => openPackage(v.id)}>
                    <Package size={14} /> 打包发送
                  </Button>
                </div>
              )
            })}
          </div>
        )}
      </div>

      <VendorModal open={!!editing} onClose={() => setEditing(null)} onSave={save} initial={editing && editing.id ? editing : null} />
    </div>
  )
}
