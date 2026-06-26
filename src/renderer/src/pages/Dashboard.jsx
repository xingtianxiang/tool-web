import { Package, AlertTriangle } from 'lucide-react'
import { api } from '../lib/api.js'
import { cellState, vendorAlerts } from '../lib/state.js'
import { Button } from '../ui.jsx'

function Cell({ state, onClick }) {
  const base = 'h-full w-full cursor-pointer text-center text-xs leading-tight transition flex items-center justify-center'
  if (state.kind === 'none') {
    return (
      <button onClick={onClick} className={`${base} text-slate-300 hover:bg-blue-50 hover:text-blue-400`} title="点击指派给该厂商">
        —
      </button>
    )
  }
  if (state.kind === 'nofile') {
    return (
      <button onClick={onClick} className={`${base} bg-red-50 text-red-400`} title="该零件还没有图纸,无法打包 — 点击可取消指派">
        无图纸
      </button>
    )
  }
  if (state.kind === 'sent') {
    return (
      <button onClick={onClick} className={`${base} bg-emerald-50 text-emerald-700`} title="已发送最新修订 — 点击可取消指派">
        ✓ 已发 v{state.cur}
      </button>
    )
  }
  if (state.kind === 'stale') {
    return (
      <button onClick={onClick} className={`${base} bg-amber-100 font-semibold text-amber-800`} title="图纸已更新,该厂商还拿着旧版,需重发 — 点击可取消指派">
        ⚠ v{state.last}→v{state.cur}
      </button>
    )
  }
  // unsent
  return (
    <button onClick={onClick} className={`${base} bg-slate-100 text-slate-500`} title="已指派,尚未发送 — 点击可取消指派">
      ○ 未发送
    </button>
  )
}

export default function Dashboard({ data, refresh, notify, openPackage, goTo }) {
  const { parts, vendors, assignments, sendLog } = data

  async function toggle(part, vendorId) {
    const assigned = assignments.some((a) => a.partId === part.id && a.vendorId === vendorId)
    try {
      await api.setAssignment(part.id, vendorId, !assigned)
      await refresh()
    } catch (e) {
      notify(e.message, 'error')
    }
  }

  if (parts.length === 0 || vendors.length === 0) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-3 text-slate-500">
        <p className="text-sm">先添加{parts.length === 0 ? '零件' : ''}{parts.length === 0 && vendors.length === 0 ? ' 和 ' : ''}{vendors.length === 0 ? '厂商' : ''},再回到这里指派与打包。</p>
        <div className="flex gap-2">
          {parts.length === 0 && <Button variant="primary" onClick={() => goTo('parts')}>去添加零件</Button>}
          {vendors.length === 0 && <Button variant="primary" onClick={() => goTo('vendors')}>去添加厂商</Button>}
        </div>
      </div>
    )
  }

  return (
    <div className="flex h-full flex-col">
      <div className="flex items-center justify-between border-b border-slate-200 bg-white px-4 py-2">
        <div className="flex items-center gap-4 text-xs text-slate-500">
          <span className="flex items-center gap-1"><span className="inline-block h-3 w-3 rounded-sm bg-emerald-50 ring-1 ring-emerald-200" /> 已发最新</span>
          <span className="flex items-center gap-1"><span className="inline-block h-3 w-3 rounded-sm bg-amber-100 ring-1 ring-amber-300" /> 需重发</span>
          <span className="flex items-center gap-1"><span className="inline-block h-3 w-3 rounded-sm bg-slate-100 ring-1 ring-slate-300" /> 未发送</span>
          <span className="flex items-center gap-1"><span className="text-slate-300">—</span> 未指派(点格子指派)</span>
        </div>
        <span className="text-xs text-slate-400">{parts.length} 个零件 · {vendors.length} 家厂商</span>
      </div>

      <div className="flex-1 overflow-auto">
        <table className="border-separate border-spacing-0 text-sm">
          <thead>
            <tr>
              <th className="sticky left-0 top-0 z-20 min-w-[200px] border-b border-r border-slate-200 bg-slate-50 px-3 py-2 text-left font-semibold text-slate-600">
                零件 \ 厂商
              </th>
              {vendors.map((v) => {
                const a = vendorAlerts(v.id, parts, sendLog, assignments)
                return (
                  <th key={v.id} className="sticky top-0 z-10 min-w-[140px] border-b border-r border-slate-200 bg-slate-50 px-2 py-2 align-top">
                    <div className="flex flex-col items-center gap-1">
                      <span className="font-semibold text-slate-700">{v.name}</span>
                      <div className="flex items-center gap-1 text-[11px]">
                        {a.stale > 0 && (
                          <span className="flex items-center gap-0.5 rounded bg-amber-100 px-1 text-amber-800">
                            <AlertTriangle size={11} /> {a.stale} 需重发
                          </span>
                        )}
                        {a.unsent > 0 && <span className="rounded bg-slate-200 px-1 text-slate-600">{a.unsent} 待发</span>}
                      </div>
                      <Button variant="primary" className="!px-2 !py-1 !text-xs" onClick={() => openPackage(v.id)}>
                        <Package size={12} /> 打包
                      </Button>
                    </div>
                  </th>
                )
              })}
            </tr>
          </thead>
          <tbody>
            {parts.map((p) => (
              <tr key={p.id} className="group">
                <th className="sticky left-0 z-10 border-b border-r border-slate-200 bg-white px-3 py-2 text-left font-normal group-hover:bg-slate-50">
                  <div className="font-medium text-slate-800">{p.code}</div>
                  <div className="text-xs text-slate-400">
                    {(p.rev || 0) > 0 ? `修订 v${p.rev} · ${p.files.length} 个文件` : <span className="text-red-400">无图纸</span>}
                  </div>
                </th>
                {vendors.map((v) => (
                  <td key={v.id} className="h-12 border-b border-r border-slate-200 p-0">
                    <Cell state={cellState(p, v.id, sendLog, assignments)} onClick={() => toggle(p, v.id)} />
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}
