import { X } from 'lucide-react'

export function Button({ variant = 'default', className = '', children, ...props }) {
  const variants = {
    default: 'bg-white border border-slate-300 text-slate-700 hover:bg-slate-50',
    primary: 'bg-blue-600 text-white hover:bg-blue-700 border border-blue-600',
    danger: 'bg-white border border-red-300 text-red-600 hover:bg-red-50',
    ghost: 'bg-transparent text-slate-500 hover:bg-slate-100 border border-transparent'
  }
  return (
    <button
      className={`inline-flex items-center gap-1.5 rounded-md px-3 py-1.5 text-sm font-medium transition disabled:opacity-50 disabled:cursor-not-allowed ${variants[variant]} ${className}`}
      {...props}
    >
      {children}
    </button>
  )
}

export function Modal({ open, onClose, title, children, footer, wide = false }) {
  if (!open) return null
  return (
    <div className="fixed inset-0 z-40 flex items-center justify-center bg-black/40 p-4" onMouseDown={onClose}>
      <div
        className={`flex max-h-[88vh] w-full ${wide ? 'max-w-3xl' : 'max-w-lg'} flex-col rounded-xl bg-white shadow-2xl`}
        onMouseDown={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between border-b border-slate-200 px-5 py-3">
          <h2 className="text-base font-semibold text-slate-800">{title}</h2>
          <button onClick={onClose} className="rounded p-1 text-slate-400 hover:bg-slate-100 hover:text-slate-700">
            <X size={18} />
          </button>
        </div>
        <div className="flex-1 overflow-y-auto px-5 py-4">{children}</div>
        {footer && <div className="flex justify-end gap-2 border-t border-slate-200 px-5 py-3">{footer}</div>}
      </div>
    </div>
  )
}

export function Field({ label, children, hint }) {
  return (
    <label className="mb-3 block">
      <span className="mb-1 block text-sm font-medium text-slate-600">{label}</span>
      {children}
      {hint && <span className="mt-1 block text-xs text-slate-400">{hint}</span>}
    </label>
  )
}

export function TextInput(props) {
  return (
    <input
      {...props}
      className={`w-full rounded-md border border-slate-300 px-3 py-1.5 text-sm outline-none focus:border-blue-500 focus:ring-1 focus:ring-blue-500 ${props.className || ''}`}
    />
  )
}

export function Toasts({ items, onDismiss }) {
  return (
    <div className="pointer-events-none fixed bottom-4 right-4 z-50 flex flex-col gap-2">
      {items.map((t) => (
        <div
          key={t.id}
          className={`pointer-events-auto flex max-w-sm items-start gap-2 rounded-lg px-4 py-2.5 text-sm shadow-lg ${
            t.type === 'error'
              ? 'bg-red-600 text-white'
              : t.type === 'success'
                ? 'bg-emerald-600 text-white'
                : 'bg-slate-800 text-white'
          }`}
          onClick={() => onDismiss(t.id)}
        >
          <span className="whitespace-pre-wrap">{t.msg}</span>
        </div>
      ))}
    </div>
  )
}
