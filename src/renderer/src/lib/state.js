// Compute the state of a (part, vendor) cell from raw data.
// kinds: 'none' (not assigned) | 'unsent' | 'sent' | 'stale'
export function cellState(part, vendorId, sendLog, assignments) {
  const assigned = assignments.some((a) => a.partId === part.id && a.vendorId === vendorId)
  if (!assigned) return { kind: 'none' }

  let last = null
  for (const e of sendLog) {
    if (e.vendorId !== vendorId) continue
    const it = (e.items || []).find((i) => i.partId === part.id)
    if (it) last = it.rev != null ? it.rev : it.version
  }
  const cur = part.rev || 0
  if (cur === 0) return { kind: 'nofile' }
  if (last == null) return { kind: 'unsent', cur }
  if (last === cur) return { kind: 'sent', cur, last }
  return { kind: 'stale', cur, last }
}

// How many cells need attention for a vendor (stale = highest priority).
export function vendorAlerts(vendorId, parts, sendLog, assignments) {
  let stale = 0
  let unsent = 0
  for (const p of parts) {
    const s = cellState(p, vendorId, sendLog, assignments)
    if (s.kind === 'stale') stale++
    else if (s.kind === 'unsent') unsent++
  }
  return { stale, unsent }
}

export const REQ_FIELDS = [
  { key: 'material', label: '材料' },
  { key: 'qty', label: '数量' },
  { key: 'tolerance', label: '公差' },
  { key: 'surface', label: '表面处理' },
  { key: 'deadline', label: '交期' },
  { key: 'notes', label: '备注' }
]
