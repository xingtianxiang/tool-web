import React from 'react'
import { Archive, FolderCog, FolderOpen } from 'lucide-react'
import { useState } from 'react'
import { api } from '../lib/api.js'
import { Button } from '../ui.jsx'

export default function Settings({ data, refresh, notify }) {
  const [busy, setBusy] = useState(false)

  async function changeDir() {
    try {
      await api.chooseDataDir()
      await refresh()
      notify('数据文件夹已更新', 'success')
    } catch (error) {
      notify(error.message, 'error')
    }
  }

  async function backup() {
    setBusy(true)
    try {
      const result = await api.exportBackup()
      notify('备份已导出', 'success')
      api.reveal(result.path)
    } catch (error) {
      notify(`备份失败。${error.message}`, 'error')
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="mx-auto max-w-2xl p-6">
      <h2 className="mb-4 text-xl font-semibold leading-7 text-[var(--geist-primary)]">设置</h2>

      <section className="panel mb-4 p-4">
        <h3 className="mb-1 flex items-center gap-1.5 text-base font-semibold text-[var(--geist-primary)]"><FolderCog size={16} /> 数据文件夹</h3>
        <p className="mb-3 text-sm muted-text">
          所有零件、图纸版本和发送记录都存在这里。可以直接用资源管理器打开，也可以整体复制备份。
        </p>
        <div className="mb-3 break-all rounded-md border border-[var(--geist-gray-200)] bg-[var(--geist-background-2)] px-3 py-2 font-mono text-xs muted-text">{data.dataDir}</div>
        <div className="flex gap-2">
          <Button onClick={() => api.reveal(data.dataDir)}><FolderOpen size={15} /> 打开文件夹</Button>
          <Button onClick={changeDir}><FolderCog size={15} /> 更换位置</Button>
        </div>
      </section>

      <section className="panel p-4">
        <h3 className="mb-1 flex items-center gap-1.5 text-base font-semibold text-[var(--geist-primary)]"><Archive size={16} /> 备份</h3>
        <p className="mb-3 text-sm muted-text">把 data.json 和全部图纸打成一个备份 zip，存到数据文件夹下的 backup 目录。</p>
        <Button variant="primary" onClick={backup} disabled={busy}><Archive size={15} /> {busy ? '导出中...' : '导出备份'}</Button>
      </section>

      <p className="mt-6 text-center text-xs faint-text">加工件采购分发管理 / 本地离线 / 数据不出本机</p>
    </div>
  )
}
