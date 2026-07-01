import React, { useState } from 'react'
import { ArrowRightLeft, Camera, ClipboardList, GripVertical, Inbox, MapPin, Package, Search, Trash2, Undo2, Warehouse as WarehouseIcon, X } from 'lucide-react'
import { api } from '../lib/api.js'
import { Button, Field, Modal, TextInput, usePrompt } from '../ui.jsx'

// StockModal handles the per-part row actions (分发 / 回库 / 盘点). 入库 has its
// own drag-and-drop board (ReceiveBoard) below.
const ACTIONS = {
  out: { title: '分发到项目', verb: '分发', needsProject: true, allowNegative: false },
  return: { title: '回库', verb: '回库', needsProject: true, allowNegative: false },
  adjust: { title: '盘点调整', verb: '盘点', needsProject: false, allowNegative: true }
}
const TYPE = {
  in: { label: '入库', cls: 'status-green' },
  out: { label: '分发', cls: 'status-blue' },
  return: { label: '回库', cls: 'status-amber' },
  adjust: { label: '盘点', cls: 'status-gray' }
}

function StockModal({ stock, data, onClose, onDone, notify }) {
  const preset = stock?.component || null
  const [qty, setQty] = useState('')
  const [projectId, setProjectId] = useState(data.activeProjectId || '')
  const [note, setNote] = useState('')
  const [busy, setBusy] = useState(false)
  if (!stock) return null

  const cfg = ACTIONS[stock.action]

  async function submit() {
    const n = Number(qty)
    if (cfg.allowNegative) {
      if (!Number.isFinite(n) || n === 0) return notify('盘点数量必须是非零数字（可为负）', 'error')
    } else if (!(n > 0)) {
      return notify('请输入正数数量', 'error')
    }
    if (cfg.needsProject && !projectId) return notify('请选择项目', 'error')
    setBusy(true)
    try {
      if (stock.action === 'out') await api.stockAllocate(preset.id, projectId, { qty: n, note })
      else if (stock.action === 'return') await api.stockReturn(preset.id, projectId, { qty: n, note })
      else if (stock.action === 'adjust') await api.stockAdjust(preset.id, { qty: n, projectId: projectId || null, note })
      notify(`${cfg.verb}成功`, 'success')
      await onDone()
      onClose()
    } catch (error) {
      notify(error.message, 'error')
    } finally {
      setBusy(false)
    }
  }

  const projectLabel = stock.action === 'out' ? '分给哪个项目' : stock.action === 'return' ? '哪个项目退回' : '归到哪'
  const showProject = cfg.needsProject || stock.action === 'adjust'

  return (
    <Modal
      open
      onClose={onClose}
      title={`${cfg.title} — ${preset.code}`}
      footer={
        <>
          <Button onClick={onClose}>取消</Button>
          <Button variant="primary" onClick={submit} disabled={busy}>{busy ? '处理中…' : `确认${cfg.verb}`}</Button>
        </>
      }
    >
      <Field label={cfg.allowNegative ? '数量（增加为正，减少为负）' : '数量（个）'}>
        <TextInput type="number" value={qty} onChange={(e) => setQty(e.target.value)} placeholder={cfg.allowNegative ? '如 -3' : '如 20'} autoFocus className="w-40" />
      </Field>
      {showProject && (
        <Field label={projectLabel} hint={cfg.needsProject ? '' : '不选=公共库存'}>
          <select className="text-input" value={projectId} onChange={(e) => setProjectId(e.target.value)}>
            {!cfg.needsProject && <option value="">公共库存</option>}
            {data.projects.map((p) => <option key={p.id} value={p.id}>{p.name}{p.status === 'archived' ? '（历史）' : ''}</option>)}
          </select>
        </Field>
      )}
      <Field label="备注" hint="选填">
        <TextInput value={note} onChange={(e) => setNote(e.target.value)} />
      </Field>
    </Modal>
  )
}

// Drag a small part from the 零件栏 onto 总仓库 or a 项目 box, set quantities,
// attach optional photo 凭证, then commit everything with one 入库 button.
function ReceiveBoard({ data, refresh, notify }) {
  const [search, setSearch] = useState('')
  const [staged, setStaged] = useState([]) // { componentId, code, target, qty }
  const [vendorId, setVendorId] = useState('')
  const [photoFiles, setPhotoFiles] = useState([])
  const [dragTarget, setDragTarget] = useState(null)
  const [busy, setBusy] = useState(false)

  const zones = [{ key: 'pool', name: '总仓库（公共库存）' }, ...data.projects.filter((p) => p.status !== 'archived').map((p) => ({ key: p.id, name: p.name }))]
  const list = data.components.filter((c) => c.code.toLowerCase().includes(search.trim().toLowerCase()))

  function drop(target, componentId) {
    setDragTarget(null)
    const component = data.components.find((c) => c.id === componentId)
    if (!component) return
    setStaged((rows) => {
      const hit = rows.find((r) => r.componentId === componentId && r.target === target)
      if (hit) return rows.map((r) => (r === hit ? { ...r, qty: r.qty + 1 } : r))
      return [...rows, { componentId, code: component.code, target, qty: 1 }]
    })
  }
  const setRowQty = (i, v) => setStaged((rows) => rows.map((r, idx) => (idx === i ? { ...r, qty: v } : r)))
  const removeRow = (i) => setStaged((rows) => rows.filter((_, idx) => idx !== i))

  async function commit() {
    if (!staged.length) return notify('先把零件拖到「总仓库」或某个项目里', 'error')
    for (const r of staged) if (!(Number(r.qty) > 0)) return notify(`「${r.code}」数量要是正数`, 'error')
    setBusy(true)
    try {
      const photos = []
      for (const f of photoFiles) photos.push({ filename: f.name, bytes: new Uint8Array(await f.arrayBuffer()) })
      for (const r of staged) {
        await api.stockIn(r.componentId, { qty: Number(r.qty), projectId: r.target === 'pool' ? null : r.target, vendorId: vendorId || null, photos })
      }
      notify(`已入库 ${staged.length} 项`, 'success')
      setStaged([])
      setPhotoFiles([])
      setVendorId('')
      await refresh()
    } catch (error) {
      notify(error.message, 'error')
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="flex h-full flex-col gap-3">
      <div className="grid min-h-0 flex-1 grid-cols-1 gap-3 lg:grid-cols-[280px_1fr]">
        {/* 零件栏 */}
        <div className="panel flex min-h-0 flex-col p-3">
          <div className="mb-2 flex items-center gap-1.5 text-sm font-medium text-[var(--geist-primary)]"><Package size={15} /> 零件栏（小零件库）</div>
          <div className="relative mb-2">
            <Search size={14} className="pointer-events-none absolute left-2 top-2.5 faint-text" />
            <TextInput value={search} onChange={(e) => setSearch(e.target.value)} placeholder="搜图号…" className="pl-7" />
          </div>
          <div className="min-h-0 flex-1 space-y-1 overflow-auto">
            {list.length === 0 ? (
              <div className="mt-6 text-center text-xs faint-text">没有匹配的小零件</div>
            ) : list.map((c) => (
              <div
                key={c.id}
                draggable
                onDragStart={(e) => { e.dataTransfer.setData('text/plain', c.id); e.dataTransfer.effectAllowed = 'copy' }}
                className="flex cursor-grab items-center gap-1.5 rounded-md border border-[var(--geist-gray-200)] bg-[var(--geist-background)] px-2 py-1.5 text-sm active:cursor-grabbing hover:border-[var(--geist-gray-400)]"
                title="拖到右边的 总仓库 或 项目"
              >
                <GripVertical size={13} className="faint-text" />
                <span className="truncate">{c.code}</span>
              </div>
            ))}
          </div>
        </div>

        {/* 拖放区 */}
        <div className="min-h-0 space-y-3 overflow-auto pr-0.5">
          {zones.map((z) => {
            const rows = staged.map((r, i) => ({ r, i })).filter(({ r }) => r.target === z.key)
            return (
              <div
                key={z.key}
                onDragOver={(e) => { e.preventDefault(); e.dataTransfer.dropEffect = 'copy'; setDragTarget(z.key) }}
                onDragLeave={() => setDragTarget((t) => (t === z.key ? null : t))}
                onDrop={(e) => { e.preventDefault(); drop(z.key, e.dataTransfer.getData('text/plain')) }}
                className={`rounded-lg border-2 border-dashed p-3 transition ${dragTarget === z.key ? 'border-[var(--geist-primary)] bg-[var(--geist-background-2)]' : 'border-[var(--geist-gray-300)]'}`}
              >
                <div className="mb-2 flex items-center gap-1.5 text-sm font-medium">
                  {z.key === 'pool' ? <WarehouseIcon size={14} /> : <Inbox size={14} />}
                  {z.name}
                  {z.key !== 'pool' && <span className="text-xs faint-text">（直达该项目）</span>}
                </div>
                {rows.length === 0 ? (
                  <div className="py-2 text-center text-xs faint-text">把零件拖到这里</div>
                ) : (
                  <div className="space-y-1.5">
                    {rows.map(({ r, i }) => (
                      <div key={i} className="flex items-center gap-2 rounded-md bg-[var(--geist-background-2)] px-2 py-1.5">
                        <span className="flex-1 truncate text-sm">{r.code}</span>
                        <TextInput type="number" min={1} value={r.qty} onChange={(e) => setRowQty(i, e.target.value)} className="w-20" />
                        <span className="text-xs faint-text">个</span>
                        <button className="icon-button" title="移除" onClick={() => removeRow(i)}><X size={15} /></button>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            )
          })}
        </div>
      </div>

      {/* 提交栏 */}
      <div className="panel flex flex-wrap items-center gap-3 p-3">
        <div className="flex items-center gap-1.5">
          <span className="text-sm muted-text">来源厂商</span>
          <select className="text-input w-auto" value={vendorId} onChange={(e) => setVendorId(e.target.value)}>
            <option value="">（不填）</option>
            {data.vendors.map((v) => <option key={v.id} value={v.id}>{v.name}</option>)}
          </select>
        </div>
        <label className="btn btn-secondary cursor-pointer">
          <Camera size={15} /> 照片凭证
          <input type="file" accept="image/*" multiple className="hidden" onChange={(e) => { setPhotoFiles((p) => [...p, ...Array.from(e.target.files || [])]); e.target.value = '' }} />
        </label>
        {photoFiles.length > 0 && (
          <span className="inline-flex items-center gap-1 text-xs muted-text">
            已选 {photoFiles.length} 张
            <button className="icon-button" title="清除照片" onClick={() => setPhotoFiles([])}><X size={13} /></button>
          </span>
        )}
        <div className="ml-auto flex items-center gap-2">
          {staged.length > 0 && <Button onClick={() => { setStaged([]); setPhotoFiles([]) }}><Trash2 size={15} /> 清空</Button>}
          <Button variant="primary" disabled={busy || !staged.length} onClick={commit}><Inbox size={15} /> {busy ? '入库中…' : `确认入库（${staged.length} 项）`}</Button>
        </div>
      </div>
    </div>
  )
}

function RowActions({ component, onPick }) {
  return (
    <div className="flex gap-1">
      <Button variant="ghost" className="h-7 px-2" title="分发到项目" onClick={() => onPick('out', component)}><ArrowRightLeft size={14} /></Button>
      <Button variant="ghost" className="h-7 px-2" title="回库" onClick={() => onPick('return', component)}><Undo2 size={14} /></Button>
      <Button variant="ghost" className="h-7 px-2" title="盘点" onClick={() => onPick('adjust', component)}><ClipboardList size={14} /></Button>
    </div>
  )
}

export default function Warehouse({ data, refresh, notify }) {
  const [view, setView] = useState('receive')
  const [stock, setStock] = useState(null)
  const [seq, setSeq] = useState(0)
  const [gapProject, setGapProject] = useState(data.activeProjectId || '')
  const [promptUI, prompt] = usePrompt()

  const inv = data.inventory || { components: [], projects: [], movements: [] }
  const vendorName = (id) => (data.vendors.find((v) => v.id === id) || {}).name || ''
  const openStock = (action, component) => { setSeq((s) => s + 1); setStock({ action, component }) }
  const seg = (key) =>
    `rounded px-3 py-1 text-sm transition ${view === key ? 'bg-[var(--geist-primary)] text-white' : 'text-[var(--geist-gray-900)] hover:bg-[var(--geist-background-2)]'}`

  async function editLocation(component) {
    const loc = await prompt({ title: '存放位置', label: `「${component.code}」放在哪`, defaultValue: component.location || '', confirmText: '保存' })
    if (loc == null) return
    try {
      await api.setComponentLocation(component.id, loc)
      await refresh()
    } catch (error) {
      notify(error.message, 'error')
    }
  }

  async function quickFill(need, projectId) {
    const qty = Math.min(need.gap, need.poolOnHand)
    if (qty <= 0) return
    try {
      await api.stockAllocate(need.componentId, projectId, { qty })
      notify(`已从库存补 ${qty} 个`, 'success')
      await refresh()
    } catch (error) {
      notify(error.message, 'error')
    }
  }

  async function undo(m) {
    if (!window.confirm('撤销这条库存记录？余额会相应回退，凭证照片也会删除。')) return
    try {
      await api.deleteMovement(m.id)
      notify('已撤销', 'success')
      await refresh()
    } catch (error) {
      notify(error.message, 'error')
    }
  }

  function openPhoto(m) {
    const ph = (m.photos || [])[0]
    if (!ph) return
    api.openPath(data.dataDir + '\\' + String(ph.storedPath).split('/').join('\\'))
  }

  const gaps = inv.projects.find((p) => p.id === gapProject) || inv.projects[0] || null

  return (
    <div className="flex h-full flex-col">
      <div className="surface-toolbar">
        <div className="inline-flex items-center rounded-md border border-[var(--geist-gray-300)] p-0.5">
          <button className={seg('receive')} onClick={() => setView('receive')}><Inbox size={13} className="mr-1 inline" />入库</button>
          <button className={seg('stock')} onClick={() => setView('stock')}><Package size={13} className="mr-1 inline" />库存总览 ({inv.components.length})</button>
          <button className={seg('gaps')} onClick={() => setView('gaps')}><ClipboardList size={13} className="mr-1 inline" />项目缺口</button>
          <button className={seg('log')} onClick={() => setView('log')}><WarehouseIcon size={13} className="mr-1 inline" />流水</button>
        </div>
      </div>

      <div className="flex-1 overflow-auto bg-[var(--geist-background)] p-4">
        {/* ---- 入库板 ---- */}
        {view === 'receive' && (
          data.components.length === 0
            ? <div className="mt-20 text-center text-sm faint-text">还没有小零件。先去「零件 → 小零件库」建立小零件，再回来入库。</div>
            : <div className="h-[calc(100vh-190px)]"><ReceiveBoard data={data} refresh={refresh} notify={notify} /></div>
        )}

        {/* ---- 库存总览 ---- */}
        {view === 'stock' && (
          inv.components.length === 0 ? (
            <div className="mt-20 text-center text-sm faint-text">还没有小零件。先去「零件 → 小零件库」建立小零件。</div>
          ) : (
            <div className="overflow-auto rounded-md border border-[var(--geist-gray-200)]">
              <table className="w-full text-left text-sm">
                <thead className="bg-[var(--geist-background-2)] text-xs text-[var(--geist-gray-900)]">
                  <tr>
                    <th className="px-3 py-2 font-medium">图号</th>
                    <th className="px-3 py-2 font-medium">在库数</th>
                    <th className="px-3 py-2 font-medium">位置</th>
                    <th className="px-3 py-2 font-medium">各项目已领</th>
                    <th className="px-3 py-2 font-medium">操作</th>
                  </tr>
                </thead>
                <tbody>
                  {inv.components.map((c) => (
                    <tr key={c.id} className="border-t border-[var(--geist-gray-100)]">
                      <td className="px-3 py-2 font-medium text-[var(--geist-primary)]">{c.code}</td>
                      <td className="px-3 py-2"><span className={c.poolOnHand > 0 ? 'font-semibold' : 'faint-text'}>{c.poolOnHand}</span></td>
                      <td className="px-3 py-2">
                        <button className="inline-flex items-center gap-1 text-xs muted-text hover:text-[var(--geist-primary)]" onClick={() => editLocation(c)} title="点击设置位置">
                          <MapPin size={13} />{c.location || <span className="faint-text">未设置</span>}
                        </button>
                      </td>
                      <td className="px-3 py-2">
                        {c.allocations.length === 0 ? <span className="faint-text text-xs">—</span> : (
                          <div className="flex flex-wrap gap-1">
                            {c.allocations.map((a) => <span key={a.projectId} className="status-pill status-gray">{a.projectName} ×{a.allocated}</span>)}
                          </div>
                        )}
                      </td>
                      <td className="px-3 py-2"><RowActions component={c} onPick={openStock} /></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )
        )}

        {/* ---- 项目缺口 ---- */}
        {view === 'gaps' && (
          <div>
            <div className="mb-3 flex items-center gap-2">
              <span className="text-sm muted-text">项目</span>
              <select className="text-input w-auto" value={gaps ? gaps.id : ''} onChange={(e) => setGapProject(e.target.value)}>
                {inv.projects.map((p) => <option key={p.id} value={p.id}>{p.name}{p.status === 'archived' ? '（历史）' : ''}</option>)}
              </select>
            </div>
            {!gaps || gaps.needs.length === 0 ? (
              <div className="mt-16 text-center text-sm faint-text">这个项目还没有「组合件 + 小零件」需求，或需求为 0。</div>
            ) : (
              <div className="overflow-auto rounded-md border border-[var(--geist-gray-200)]">
                <table className="w-full text-left text-sm">
                  <thead className="bg-[var(--geist-background-2)] text-xs text-[var(--geist-gray-900)]">
                    <tr>
                      <th className="px-3 py-2 font-medium">图号</th>
                      <th className="px-3 py-2 font-medium">需要</th>
                      <th className="px-3 py-2 font-medium">已领</th>
                      <th className="px-3 py-2 font-medium">缺</th>
                      <th className="px-3 py-2 font-medium">公共库存</th>
                      <th className="px-3 py-2 font-medium">状态</th>
                      <th className="px-3 py-2 font-medium">操作</th>
                    </tr>
                  </thead>
                  <tbody>
                    {gaps.needs.map((n) => (
                      <tr key={n.componentId} className="border-t border-[var(--geist-gray-100)]">
                        <td className="px-3 py-2 font-medium text-[var(--geist-primary)]">{n.code}</td>
                        <td className="px-3 py-2">{n.demand}</td>
                        <td className="px-3 py-2">{n.allocated}</td>
                        <td className="px-3 py-2"><span className={n.gap > 0 ? 'font-semibold text-[var(--geist-red-800)]' : 'faint-text'}>{n.gap}</span></td>
                        <td className="px-3 py-2 muted-text">{n.poolOnHand}</td>
                        <td className="px-3 py-2">
                          {n.gap === 0
                            ? <span className="status-pill status-green">已齐</span>
                            : n.enough
                              ? <span className="status-pill status-amber">库里够，可补</span>
                              : <span className="status-pill status-red">需再订 {n.gap - n.poolOnHand}</span>}
                        </td>
                        <td className="px-3 py-2">
                          {n.gap > 0 && n.poolOnHand > 0 && (
                            <Button variant="ghost" className="h-7 px-2 text-xs" onClick={() => quickFill(n, gaps.id)}>一键补足 {Math.min(n.gap, n.poolOnHand)}</Button>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        )}

        {/* ---- 流水 ---- */}
        {view === 'log' && (
          inv.movements.length === 0 ? (
            <div className="mt-20 text-center text-sm faint-text">还没有库存流水。到「入库」页把零件拖进来开始。</div>
          ) : (
            <div className="overflow-auto rounded-md border border-[var(--geist-gray-200)]">
              <table className="w-full text-left text-sm">
                <thead className="bg-[var(--geist-background-2)] text-xs text-[var(--geist-gray-900)]">
                  <tr>
                    <th className="px-3 py-2 font-medium">时间</th>
                    <th className="px-3 py-2 font-medium">类型</th>
                    <th className="px-3 py-2 font-medium">图号</th>
                    <th className="px-3 py-2 font-medium">数量</th>
                    <th className="px-3 py-2 font-medium">项目 / 来源</th>
                    <th className="px-3 py-2 font-medium">凭证</th>
                    <th className="px-3 py-2 font-medium">备注</th>
                    <th className="px-3 py-2 font-medium"></th>
                  </tr>
                </thead>
                <tbody>
                  {inv.movements.map((m) => (
                    <tr key={m.id} className="border-t border-[var(--geist-gray-100)]">
                      <td className="px-3 py-2 text-xs muted-text">{new Date(m.at).toLocaleString('zh-CN', { month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' })}</td>
                      <td className="px-3 py-2"><span className={`status-pill ${(TYPE[m.type] || {}).cls || 'status-gray'}`}>{(TYPE[m.type] || {}).label || m.type}</span></td>
                      <td className="px-3 py-2 font-medium text-[var(--geist-primary)]">{m.code}</td>
                      <td className="px-3 py-2">{m.type === 'adjust' && m.qty > 0 ? `+${m.qty}` : m.type === 'out' ? `-${m.qty}` : m.qty}</td>
                      <td className="px-3 py-2 text-xs muted-text">{m.projectName || '公共库存'}{m.vendorId ? ` · 来自 ${vendorName(m.vendorId)}` : ''}</td>
                      <td className="px-3 py-2">
                        {(m.photos || []).length > 0
                          ? <button className="inline-flex items-center gap-1 text-xs text-[var(--geist-primary)] hover:underline" onClick={() => openPhoto(m)} title="打开照片凭证"><Camera size={13} />{m.photos.length}</button>
                          : <span className="faint-text text-xs">—</span>}
                      </td>
                      <td className="px-3 py-2 text-xs muted-text">{m.note || ''}</td>
                      <td className="px-3 py-2"><Button variant="ghost" className="h-7 px-2 text-xs" onClick={() => undo(m)}>撤销</Button></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )
        )}
      </div>

      {stock && <StockModal key={seq} stock={stock} data={data} onClose={() => setStock(null)} onDone={refresh} notify={notify} />}
      {promptUI}
    </div>
  )
}
