import { useState } from 'react'
import { FolderOpen, FolderCog, Archive } from 'lucide-react'
import { api } from '../lib/api.js'
import { Button } from '../ui.jsx'

export default function Settings({ data, refresh, notify }) {
  const [busy, setBusy] = useState(false)

  async function changeDir() {
    try {
      await api.chooseDataDir()
      await refresh()
      notify('数据文件夹已更新', 'success')
    } catch (e) {
      notify(e.message, 'error')
    }
  }

  async function backup() {
    setBusy(true)
    try {
      const r = await api.exportBackup()
      notify('已导出备份', 'success')
      api.reveal(r.path)
    } catch (e) {
      notify('备份失败:' + e.message, 'error')
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="mx-auto max-w-2xl p-6">
      <h2 className="mb-4 text-lg font-semibold text-slate-800">设置</h2>

      <section className="mb-4 rounded-lg border border-slate-200 bg-white p-4">
        <h3 className="mb-1 flex items-center gap-1.5 font-medium text-slate-700"><FolderCog size={16} /> 数据文件夹</h3>
        <p className="mb-2 text-xs text-slate-400">
          所有零件、图纸版本和发送记录都存在这里。可直接用资源管理器打开、整体复制备份。
        </p>
        <div className="mb-2 break-all rounded bg-slate-50 px-3 py-2 text-sm text-slate-600">{data.dataDir}</div>
        <div className="flex gap-2">
          <Button onClick={() => api.reveal(data.dataDir)}><FolderOpen size={15} /> 打开文件夹</Button>
          <Button onClick={changeDir}><FolderCog size={15} /> 更换位置</Button>
        </div>
      </section>

      <section className="rounded-lg border border-slate-200 bg-white p-4">
        <h3 className="mb-1 flex items-center gap-1.5 font-medium text-slate-700"><Archive size={16} /> 备份</h3>
        <p className="mb-2 text-xs text-slate-400">把 data.json 和全部图纸打成一个备份 zip(存到数据文件夹下的 backup 目录)。</p>
        <Button variant="primary" onClick={backup} disabled={busy}><Archive size={15} /> {busy ? '导出中…' : '导出备份'}</Button>
      </section>

      <p className="mt-6 text-center text-xs text-slate-300">加工件采购分发管理 · 本地离线 · 数据不出本机</p>
    </div>
  )
}
