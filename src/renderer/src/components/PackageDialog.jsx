import React, { useEffect, useState } from 'react'
import { AlertTriangle, CheckCircle2, FileArchive, FolderOpen, Package } from 'lucide-react'
import { api } from '../lib/api.js'
import { Button, Modal } from '../ui.jsx'

const STATUS = {
  new: { label: '首次发送', cls: 'status-blue' },
  sent: { label: '已是最新', cls: 'status-green' },
  stale: { label: '需重发', cls: 'status-amber' }
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
      .catch((error) => notify(error.message, 'error'))
      .finally(() => setLoading(false))
  }, [vendorId, notify])

  async function build() {
    setBuilding(true)
    try {
      const nextResult = await api.buildPackage(vendorId)
      setResult(nextResult)
      notify(`已生成 ${nextResult.fileName}`, 'success')
      await refresh()
    } catch (error) {
      notify(`打包失败。${error.message}`, 'error')
    } finally {
      setBuilding(false)
    }
  }

  const withFile = preview?.items.filter((item) => item.hasFile).length || 0
  const totalFiles = preview?.items.filter((item) => item.hasFile).reduce((sum, item) => sum + item.fileCount, 0) || 0
  const changed = preview?.items.filter((item) => item.status !== 'sent').length || 0

  return (
    <Modal
      open={!!vendorId}
      onClose={onClose}
      wide
      title={preview ? `打包发送 / ${preview.vendor.name}` : '打包发送'}
      footer={
        result ? (
          <Button variant="primary" onClick={onClose}>完成</Button>
        ) : (
          <>
            <Button onClick={onClose}>取消</Button>
            <Button variant="primary" onClick={build} disabled={building || withFile === 0}>
              <Package size={15} /> {building ? '生成中...' : `生成压缩包（${withFile} 个组合件 / ${totalFiles} 个文件）`}
            </Button>
          </>
        )
      }
    >
      {loading && <p className="text-sm faint-text">读取中...</p>}

      {!loading && preview && !result && (
        <>
          <div className="mb-3 text-sm muted-text">
            共指派 {preview.count} 个组合件
            {changed > 0 ? <>，其中 <span className="font-medium text-[#aa4d00]">{changed} 个自上次发送后有变化</span></> : '，全部已是最新'}。
            压缩包按组合件分文件夹，每个组合件下含装配图和各小零件的当前图纸，外加一份「需求单.pdf」。
          </div>
          <div className="flex flex-col gap-2">
            {preview.items.map((item) => {
              const status = STATUS[item.status]
              return (
                <div key={item.assemblyId} className="rounded-md border border-[var(--geist-gray-200)] px-3 py-2">
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0">
                      <span className="font-medium text-[var(--geist-primary)]">{item.code}</span>
                      {item.assemblyFiles.length > 0 && <span className="status-pill status-gray ml-2">含装配图</span>}
                      {!item.hasFile && <span className="status-pill status-red ml-2">无图纸，不打入</span>}
                      <div className="mt-0.5 text-xs faint-text">{item.members.length} 个小零件 / {item.fileCount} 个图纸文件</div>
                    </div>
                    <span className={`status-pill shrink-0 ${status.cls}`}>{status.label}</span>
                  </div>
                  {item.members.length > 0 && (
                    <div className="mt-2 flex flex-col gap-0.5 border-t border-[var(--geist-gray-100)] pt-1.5 text-xs">
                      {item.members.map((m) => {
                        const spec = [m.requirements.material, m.requirements.qty && `${m.requirements.qty} 件`].filter(Boolean).join(' · ')
                        return (
                          <div key={m.componentId} className="flex items-center justify-between gap-2">
                            <span className="min-w-0 truncate text-[var(--geist-gray-900)]">
                              {m.code}
                              {m.fileCount === 0 && <span className="text-[var(--geist-red-800)]"> · 无图纸</span>}
                            </span>
                            <span className="shrink-0 faint-text">{spec}</span>
                          </div>
                        )
                      })}
                    </div>
                  )}
                </div>
              )
            })}
          </div>
          {withFile === 0 && (
            <div className="mt-3 flex items-center gap-1.5 text-sm text-[var(--geist-red-800)]">
              <AlertTriangle size={15} /> 这些组合件都还没有任何图纸，无法打包。先到「零件」页上传小零件图纸或添加装配图。
            </div>
          )}
        </>
      )}

      {result && (
        <div className="flex flex-col items-center gap-3 py-4 text-center">
          <CheckCircle2 size={40} className="text-[var(--geist-green-800)]" />
          <div className="text-sm text-[var(--geist-primary)]">
            已打包 {result.count} 个组合件 / {result.fileCount} 个图纸文件 + 需求单
            {result.missing > 0 && <span className="text-[#aa4d00]">（另有 {result.missing} 个无图纸组合件被跳过）</span>}
          </div>
          <div className="break-all rounded-md border border-[var(--geist-gray-200)] bg-[var(--geist-background-2)] px-3 py-2 font-mono text-xs muted-text">{result.zipPath}</div>
          <div className="mt-1 text-xs faint-text">接下来打开文件夹，把这个 zip 发给厂商即可。</div>
          <div className="flex gap-2">
            <Button onClick={() => api.reveal(result.zipPath)}><FolderOpen size={15} /> 打开所在文件夹</Button>
            <Button onClick={() => api.openPath(result.zipPath)}><FileArchive size={15} /> 打开压缩包</Button>
          </div>
        </div>
      )}
    </Modal>
  )
}
