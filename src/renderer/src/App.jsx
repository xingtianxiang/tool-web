import React, { useCallback, useEffect, useState } from 'react'
import { Boxes, Factory, LayoutGrid, Settings as SettingsIcon, Warehouse } from 'lucide-react'
import { api } from './lib/api.js'
import { Toasts } from './ui.jsx'
import Dashboard from './pages/Dashboard.jsx'
import Parts from './pages/Parts.jsx'
import Vendors from './pages/Vendors.jsx'
import WarehousePage from './pages/Warehouse.jsx'
import Settings from './pages/Settings.jsx'
import PackageDialog from './components/PackageDialog.jsx'

const TABS = [
  { key: 'dashboard', label: '状态矩阵', icon: LayoutGrid },
  { key: 'parts', label: '零件', icon: Boxes },
  { key: 'vendors', label: '厂商', icon: Factory },
  { key: 'warehouse', label: '仓库', icon: Warehouse },
  { key: 'settings', label: '设置', icon: SettingsIcon }
]

export default function App() {
  const [tab, setTab] = useState('dashboard')
  const [data, setData] = useState(null)
  const [toasts, setToasts] = useState([])
  const [pkgVendorId, setPkgVendorId] = useState(null)

  const notify = useCallback((msg, type = 'info') => {
    const id = Math.random().toString(36).slice(2)
    setToasts((items) => [...items, { id, msg, type }])
    setTimeout(() => setToasts((items) => items.filter((item) => item.id !== id)), 4200)
  }, [])

  const refresh = useCallback(async () => {
    try {
      setData(await api.getState())
    } catch (error) {
      notify(`读取数据失败。${error.message}`, 'error')
    }
  }, [notify])

  useEffect(() => {
    refresh()
  }, [refresh])

  if (!data) {
    return <div className="flex h-full items-center justify-center text-sm muted-text">加载中...</div>
  }

  const projectReadOnly = data.currentProject?.status === 'archived'
  const pageProps = { data, refresh, notify, openPackage: setPkgVendorId, goTo: setTab, projectReadOnly }

  return (
    <div className="app-shell">
      <header className="app-header">
        <div className="app-title">加工件采购分发</div>
        <nav className="flex gap-1" aria-label="主导航">
          {TABS.map((item) => {
            const Icon = item.icon
            const active = tab === item.key
            return (
              <button
                key={item.key}
                onClick={() => setTab(item.key)}
                className={`nav-tab ${active ? 'nav-tab-active' : ''}`}
                aria-current={active ? 'page' : undefined}
              >
                <Icon size={16} />
                {item.label}
              </button>
            )
          })}
        </nav>
      </header>

      <main className="min-h-0 flex-1 overflow-hidden">
        {tab === 'dashboard' && <Dashboard {...pageProps} />}
        {tab === 'parts' && <Parts {...pageProps} />}
        {tab === 'vendors' && <Vendors {...pageProps} />}
        {tab === 'warehouse' && <WarehousePage {...pageProps} />}
        {tab === 'settings' && <Settings {...pageProps} />}
      </main>

      <PackageDialog
        vendorId={pkgVendorId}
        onClose={() => setPkgVendorId(null)}
        notify={notify}
        refresh={refresh}
      />
      <Toasts items={toasts} onDismiss={(id) => setToasts((items) => items.filter((item) => item.id !== id))} />
    </div>
  )
}
