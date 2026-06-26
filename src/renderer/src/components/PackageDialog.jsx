import { useEffect, useState } from 'react'
import { Package, FolderOpen, FileArchive, CheckCircle2, AlertTriangle } from 'lucide-react'
import { api } from '../lib/api.js'
import { Button, Modal } from '../ui.jsx'

const STATUS = {
  new: { label: '首次发送', cls: 'bg-blue-100 text-blue-700' },
  sent: { label: '已是最新', cls: 'bg-emerald-100 text-emerald-700' },
  stale: { label: '需重发', cls: 'bg-amber-100 text-amber-800' }
}

export default function PackageDialog({ vendorId, onClose, notify, refresh }) {
  const [preview, setPreview] = useState(null)
  const [loading, setLoading] = useState(false)
  const [building, setBuilding] = useState(false)
  const [result, setResult] = useState(null)

  useEffect(() => {
    if (!vendorId) {
      setPreview(null)
      setResult(null)
      return
    }
    setLoading(true)
    setResult(null)
    api
      .previewPackage(vendorId)
      .then(setPreview)
      .catch((e) => notify(e.message, 'error'))
      .finally(() => setLoading(false))
  }, [vendorId, notify])

  async function build() {
    setBuilding(true)
    try {
      const r = await api.buildPackage(vendorId)
      setResult(r)
      notify(`已生成 ${r.fileName}`, 'success')
      await refresh()
    } catch (e) {
      notify('打包失败:' + e.message, 'error')
    } finally {
      setBuilding(false)
    }
  }

  const withFile = preview?.items.filter((i) => i.hasFile).length || 0
  const totalFiles = preview?.items.filter((i) => i.hasFile).reduce((n, i) => n + i.fileCount, 0) || 0
  const changed = preview?.items.filter((i) => i.status !== 'sent').length || 0

  return (
    <Modal
      open={!!vendorId}
      onClose={onClose}
      wide
      title={preview ? `打包发送 — ${preview.vendor.name}` : '打包发送'}
      footer={
        result ? (
          <Button variant="primary" onClick={onClose}>完成</Button>
        ) : (
          <>
            <Button onClick={onClose}>取消</Button>
            <Button variant="primary" onClick={build} disabled={building || withFile === 0}>
              <Package size={15} /> {building ? '生成中…' : `生成压缩包(${withFile} 个零件 · ${totalFiles} 个文件)`}
            </Button>
          </>
        )
      }
    >
      {loading && <p className="text-sm text-slate-400">读取中…</p>}

      {!loading && preview && !result && (
        <>
          <div className="mb-3 text-sm text-slate-500">
            共指派 {preview.count} 个零件
            {changed > 0 ? <>,其中 <span className="font-medium text-amber-700">{changed} 个自上次发送后有变化</span></> : ',全部已是最新'}。
            生成的压缩包里每个零件一个文件夹,装入它当前的全部图纸文件,外加一份「需求单.pdf」。
          </div>
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-slate-200 text-left text-xs text-slate-500">
                <th className="py-1.5">图号/名称</th>
                <th>图纸文件</th>
                <th>当前修订</th>
                <th>上次发送</th>
                <th>状态</th>
              </tr>
            </thead>
            <tbody>
              {preview.items.map((it) => {
                const s = STATUS[it.status]
                return (
                  <tr key={it.partId} className="border-b border-slate-100">
                    <td className="py-1.5 font-medium text-slate-700">
                      {it.code}
                      {!it.hasFile && <span className="ml-1 rounded bg-red-100 px-1 text-xs text-red-600">无图纸,不打入</span>}
                    </td>
                    <td className="text-slate-500" title={it.files.map((f) => f.label ? `${f.label}(${f.filename})` : f.filename).join('\n')}>
                      {it.fileCount > 0 ? `${it.fileCount} 个` : '—'}
                    </td>
                    <td>{it.rev > 0 ? `v${it.rev}` : '—'}</td>
                    <td className="text-slate-500">{it.lastSentRev == null ? '—' : `v${it.lastSentRev}`}</td>
                    <td><span className={`rounded px-1.5 py-0.5 text-xs ${s.cls}`}>{s.label}</span></td>
                  </tr>
                )
              })}
            </tbody>
          </table>
          {withFile === 0 && (
            <div className="mt-3 flex items-center gap-1.5 text-sm text-red-500">
              <AlertTriangle size={15} /> 这些零件都还没上传图纸,无法打包。先到「零件」页上传。
            </div>
          )}
        </>
      )}

      {result && (
        <div className="flex flex-col items-center gap-3 py-4 text-center">
          <CheckCircle2 size={40} className="text-emerald-500" />
          <div className="text-sm text-slate-700">
            已打包 {result.count} 个零件 · {result.fileCount} 个图纸文件 + 需求单
            {result.missing > 0 && <span className="text-amber-600">(另有 {result.missing} 个无图纸的零件被跳过)</span>}
          </div>
          <div className="break-all rounded bg-slate-50 px-3 py-2 text-xs text-slate-500">{result.zipPath}</div>
          <div className="mt-1 text-xs text-slate-400">接下来:打开文件夹,把这个 zip 拖进微信发给厂商即可。</div>
          <div className="flex gap-2">
            <Button onClick={() => api.reveal(result.zipPath)}><FolderOpen size={15} /> 打开所在文件夹</Button>
            <Button onClick={() => api.openPath(result.zipPath)}><FileArchive size={15} /> 打开压缩包</Button>
          </div>
        </div>
      )}
    </Modal>
  )
}
