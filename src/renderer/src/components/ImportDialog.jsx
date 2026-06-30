import React, { useState } from 'react'
import { Download, FileSpreadsheet, Upload } from 'lucide-react'
import { api, previewImportFromFiles, applyImportFromFiles } from '../lib/api.js'
import { Button, Modal } from '../ui.jsx'

function ActionPill({ action }) {
  return action === 'add'
    ? <span className="status-pill status-green">新增</span>
    : <span className="status-pill status-amber">更新</span>
}

function PreviewTable({ title, summary, columns, rows }) {
  if (!rows.length) return null
  return (
    <div>
      <div className="mb-1 flex items-baseline gap-2 text-sm font-medium text-[var(--geist-primary)]">
        {title}
        <span className="text-xs muted-text">新增 {summary.toAdd} · 更新 {summary.toUpdate}</span>
      </div>
      <div className="max-h-44 overflow-auto rounded-md border border-[var(--geist-gray-200)]">
        <table className="w-full text-left text-xs">
          <thead className="sticky top-0 bg-[var(--geist-background-2)] text-[var(--geist-gray-900)]">
            <tr>
              <th className="px-2 py-1 font-medium">操作</th>
              {columns.map((c) => <th key={c.key} className="px-2 py-1 font-medium">{c.label}</th>)}
            </tr>
          </thead>
          <tbody>
            {rows.map((row, i) => (
              <tr key={i} className="border-t border-[var(--geist-gray-100)]">
                <td className="px-2 py-1"><ActionPill action={row.action} /></td>
                {columns.map((c) => <td key={c.key} className="px-2 py-1 muted-text">{row[c.key] || ''}</td>)}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}

// Shared dialog for importing/merging 厂商 + 小零件 from one or more Excel/CSV
// files. Pick files -> dry-run preview (add/update classification) -> confirm to
// commit the merge. Reused from Settings, Parts (小零件库) and Vendors.
export default function ImportDialog({ open, onClose, onImported, notify }) {
  const [files, setFiles] = useState([])
  const [preview, setPreview] = useState(null)
  const [busy, setBusy] = useState(false)

  function close() {
    setFiles([])
    setPreview(null)
    setBusy(false)
    onClose()
  }

  async function pick(event) {
    const picked = Array.from(event.target.files || [])
    event.target.value = '' // let the user re-pick the same file after edits
    if (!picked.length) return
    setFiles(picked)
    setBusy(true)
    try {
      setPreview(await previewImportFromFiles(picked))
    } catch (error) {
      notify(error.message, 'error')
      setPreview(null)
    } finally {
      setBusy(false)
    }
  }

  async function confirm() {
    if (!files.length || !preview) return
    setBusy(true)
    try {
      const r = await applyImportFromFiles(files)
      notify(`导入完成 — 厂商：新增 ${r.vendors.added} / 更新 ${r.vendors.updated}；小零件：新增 ${r.components.added} / 更新 ${r.components.updated}`, 'success')
      await onImported?.()
      close()
    } catch (error) {
      notify(error.message, 'error')
    } finally {
      setBusy(false)
    }
  }

  async function downloadTemplate() {
    try {
      const r = await api.downloadImportTemplate()
      if (r?.canceled) return
      notify('模板已保存', 'success')
      if (r?.path) api.reveal(r.path)
    } catch (error) {
      notify(error.message, 'error')
    }
  }

  const nothing = preview && !preview.vendors.rows.length && !preview.components.rows.length

  return (
    <Modal
      open={open}
      onClose={close}
      title="从 Excel 导入厂商 / 小零件"
      wide
      footer={
        <>
          <Button onClick={close}>取消</Button>
          <Button variant="primary" onClick={confirm} disabled={!preview || nothing || busy}>
            {busy ? '处理中…' : '确认导入'}
          </Button>
        </>
      }
    >
      <p className="mb-3 text-sm muted-text">
        用模板各自填好 Excel，发到一起后在这里导入。可一次选多份，按 <b>图号 / 厂商名</b> 自动合并：已有的更新、没有的新增，<b>不会删除</b>已有数据；表格里留空的格子不会覆盖原有内容。
      </p>

      <div className="mb-4 flex flex-wrap items-center gap-2">
        <Button onClick={downloadTemplate}><Download size={15} /> 下载导入模板</Button>
        <label className="btn btn-secondary cursor-pointer">
          <Upload size={15} /> 选择 Excel 文件
          <input type="file" accept=".xlsx,.xls,.csv" multiple className="hidden" onChange={pick} />
        </label>
        {files.length > 0 && (
          <span className="inline-flex items-center gap-1 text-xs muted-text">
            <FileSpreadsheet size={13} /> 已选 {files.length} 个：{files.map((f) => f.name).join('、')}
          </span>
        )}
      </div>

      {busy && !preview && <div className="text-sm muted-text">正在解析…</div>}

      {preview && (
        <div className="space-y-4">
          {nothing && <div className="text-sm faint-text">没有可导入的行。请检查表头是否为模板格式。</div>}

          {preview.errors?.length > 0 && (
            <div className="rounded-md border border-[var(--geist-amber-300,#f5d90a)] bg-[var(--geist-background-2)] p-2 text-xs">
              <div className="mb-1 font-medium text-[var(--geist-primary)]">提示 / 跳过：</div>
              <ul className="list-disc space-y-0.5 pl-4 muted-text">
                {preview.errors.map((e, i) => <li key={i}>{e}</li>)}
              </ul>
            </div>
          )}

          <PreviewTable
            title="厂商"
            summary={preview.vendors}
            columns={[{ key: 'name', label: '厂商名称' }, { key: 'contact', label: '联系方式' }]}
            rows={preview.vendors.rows}
          />
          <PreviewTable
            title="小零件"
            summary={preview.components}
            columns={[
              { key: 'code', label: '图号' },
              { key: 'material', label: '材料' },
              { key: 'tolerance', label: '公差' },
              { key: 'surface', label: '表面处理' },
              { key: 'description', label: '描述' }
            ]}
            rows={preview.components.rows}
          />
        </div>
      )}
    </Modal>
  )
}
