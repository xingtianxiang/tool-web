import { useCallback, useEffect, useState } from 'react'
import { LayoutGrid, Boxes, Factory, Settings as SettingsIcon } from 'lucide-react'
import { api } from './lib/api.js'
import { Toasts } from './ui.jsx'
import Dashboard from './pages/Dashboard.jsx'
import Parts from './pages/Parts.jsx'
import Vendors from './pages/Vendors.jsx'
import Settings from './pages/Settings.jsx'
import PackageDialog from './components/PackageDialog.jsx'

const TABS = [
  { key: 'dashboard', label: '状态矩阵', icon: LayoutGrid },
  { key: 'parts', label: '零件', icon: Boxes },
  { key: 'vendors', label: '厂商', icon: Factory },
  { key: 'settings', label: '设置', icon: SettingsIcon }
]

export default function App() {
  const [tab, setTab] = useState('dashboard')
  const [data, setData] = useState(null)
  const [toasts, setToasts] = useState([])
  const [pkgVendorId, setPkgVendorId] = useState(null)

  const notify = useCallback((msg, type = 'info') => {
    const id = Math.random().toString(36).slice(2)
    setToasts((t) => [...t, { id, msg, type }])
    setTimeout(() => setToasts((t) => t.filter((x) => x.id !== id)), 4200)
  }, [])

  const refresh = useCallback(async () => {
    try {
      setData(await api.getState())
    } catch (e) {
      notify('读取数据失败:' + e.message, 'error')
    }
  }, [notify])

  useEffect(() => {
    refresh()
  }, [refresh])

  if (!data) {
    return <div className="flex h-full items-center justify-center text-slate-400">加载中…</div>
  }

  const pageProps = { data, refresh, notify, openPackage: setPkgVendorId, goTo: setTab }

  return (
    <div className="flex h-full flex-col">
      <header className="flex items-center gap-1 border-b border-slate-200 bg-white px-4">
        <div className="mr-4 py-3 text-base font-bold text-slate-800">加工件采购分发</div>
        <nav className="flex gap-1">
          {TABS.map((t) => {
            const Icon = t.icon
            const active = tab === t.key
            return (
              <button
                key={t.key}
                onClick={() => setTab(t.key)}
                className={`flex items-center gap-1.5 border-b-2 px-3 py-3 text-sm font-medium transition ${
                  active
                    ? 'border-blue-600 text-blue-700'
                    : 'border-transparent text-slate-500 hover:text-slate-800'
                }`}
              >
                <Icon size={16} />
                {t.label}
              </button>
            )
          })}
        </nav>
      </header>

      <main className="flex-1 overflow-hidden">
        {tab === 'dashboard' && <Dashboard {...pageProps} />}
        {tab === 'parts' && <Parts {...pageProps} />}
        {tab === 'vendors' && <Vendors {...pageProps} />}
        {tab === 'settings' && <Settings {...pageProps} />}
      </main>

      <PackageDialog
        vendorId={pkgVendorId}
        onClose={() => setPkgVendorId(null)}
        notify={notify}
        refresh={refresh}
      />
      <Toasts items={toasts} onDismiss={(id) => setToasts((t) => t.filter((x) => x.id !== id))} />
    </div>
  )
}
