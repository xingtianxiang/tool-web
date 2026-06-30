// Effective version signature of an assembly (组合件). Must stay byte-identical
// to assemblySignature in src/main/store.js and signatureOf in lib/api.js — it is
// compared against the signature stored in sendLog to decide 已发 / 需重发.
export function assemblySignature(assembly, compById) {
  const members = (assembly.members || [])
    .map((m) => `${m.componentId}:${(compById[m.componentId] || {}).rev ?? 'x'}`)
    .sort()
    .join(',')
  return `${assembly.rev || 0}#${members}`
}

// An assembly has something to send if it has its own assembly drawing, or any
// member small-part that has at least one file.
export function assemblyHasContent(assembly, compById) {
  if ((assembly.assemblyFiles || []).length > 0) return true
  return (assembly.members || []).some((m) => ((compById[m.componentId] || {}).files || []).length > 0)
}

function lastSentSig(sendLog, vendorId, assemblyId) {
  let sig = null
  for (const entry of sendLog) {
    if (entry.vendorId !== vendorId) continue
    const item = (entry.items || []).find((it) => it.assemblyId === assemblyId)
    if (item && item.sig != null) sig = item.sig
  }
  return sig
}

// Compute the state of an (assembly, vendor) matrix cell.
// kinds: 'none' (not assigned) | 'nocontent' (assigned but no drawings at all)
//        | 'unsent' | 'sent' | 'stale'
export function cellState(assembly, vendorId, sendLog, assignments, compById) {
  const assigned = assignments.some((a) => a.assemblyId === assembly.id && a.vendorId === vendorId)
  if (!assigned) return { kind: 'none' }
  if (!assemblyHasContent(assembly, compById)) return { kind: 'nocontent' }
  const last = lastSentSig(sendLog, vendorId, assembly.id)
  if (last == null) return { kind: 'unsent' }
  if (last === assemblySignature(assembly, compById)) return { kind: 'sent' }
  return { kind: 'stale' }
}

// How many cells need attention for a vendor (stale = highest priority).
export function vendorAlerts(vendorId, assemblies, sendLog, assignments, compById) {
  let stale = 0
  let unsent = 0
  for (const assembly of assemblies) {
    const state = cellState(assembly, vendorId, sendLog, assignments, compById)
    if (state.kind === 'stale') stale++
    else if (state.kind === 'unsent') unsent++
  }
  return { stale, unsent }
}

// Spec fields kept on a small-part (component). These DO go onto the vendor 需求单
// PDF. Quantity comes from the assembly member (member.qty), not the component, and
// 交期/备注 were dropped per product decision. A component also has a free-text
// `description` for internal use that is intentionally NOT in REQ_FIELDS (never on the PDF).
export const REQ_FIELDS = [
  { key: 'material', label: '材料' },
  { key: 'tolerance', label: '公差' },
  { key: 'surface', label: '表面处理' }
]
