import React from 'react'
import { CheckCircle2, Info, X, XCircle } from 'lucide-react'

export function Button({ variant = 'secondary', className = '', children, ...props }) {
  const variants = {
    default: 'btn-secondary',
    secondary: 'btn-secondary',
    primary: 'btn-primary',
    danger: 'btn-danger',
    ghost: 'btn-ghost'
  }
  return (
    <button className={`btn ${variants[variant] || variants.secondary} ${className}`} {...props}>
      {children}
    </button>
  )
}

export function Modal({ open, onClose, title, children, footer, wide = false }) {
  if (!open) return null
  return (
    <div className="fixed inset-0 z-40 flex items-center justify-center bg-black/30 p-4" onMouseDown={onClose}>
      <div
        className={`flex max-h-[88vh] w-full ${wide ? 'max-w-3xl' : 'max-w-lg'} flex-col overflow-hidden rounded-xl border border-black/10 bg-white`}
        style={{ boxShadow: 'var(--geist-shadow-popover)' }}
        onMouseDown={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between border-b border-[var(--geist-gray-200)] px-5 py-3">
          <h2 className="text-base font-semibold leading-6 text-[var(--geist-primary)]">{title}</h2>
          <button onClick={onClose} className="icon-button" aria-label="关闭弹窗">
            <X size={18} />
          </button>
        </div>
        <div className="flex-1 overflow-y-auto px-5 py-4">{children}</div>
        {footer && <div className="flex justify-end gap-2 border-t border-[var(--geist-gray-200)] bg-[var(--geist-background-2)] px-5 py-3">{footer}</div>}
      </div>
    </div>
  )
}

export function Field({ label, children, hint }) {
  return (
    <label className="mb-3 block">
      <span className="field-label">{label}</span>
      {children}
      {hint && <span className="mt-1 block text-xs faint-text">{hint}</span>}
    </label>
  )
}

export function TextInput(props) {
  return <input {...props} className={`text-input ${props.className || ''}`} />
}

function PromptModal({ title, label, hint, placeholder, defaultValue, confirmText, onCancel, onSubmit }) {
  const [value, setValue] = React.useState(defaultValue || '')

  function submit() {
    onSubmit(value)
  }

  return (
    <Modal
      open
      onClose={onCancel}
      title={title}
      footer={
        <>
          <Button onClick={onCancel}>取消</Button>
          <Button variant="primary" onClick={submit}>{confirmText || '确定'}</Button>
        </>
      }
    >
      <Field label={label} hint={hint}>
        <TextInput
          value={value}
          onChange={(e) => setValue(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); submit() } }}
          onFocus={(e) => e.target.select()}
          placeholder={placeholder}
          autoFocus
        />
      </Field>
    </Modal>
  )
}

// In-app replacement for window.prompt() — Electron's renderer does not support
// the native prompt(), so the built-in one silently returns null. Returns a
// promise that resolves to the entered string, or null if cancelled.
export function usePrompt() {
  const [config, setConfig] = React.useState(null)
  const resolverRef = React.useRef(null)

  const prompt = React.useCallback((options = {}) => {
    return new Promise((resolve) => {
      resolverRef.current = resolve
      setConfig({
        title: options.title || '请输入',
        label: options.label || '',
        hint: options.hint || '',
        placeholder: options.placeholder || '',
        defaultValue: options.defaultValue || '',
        confirmText: options.confirmText || '确定'
      })
    })
  }, [])

  const settle = React.useCallback((result) => {
    const resolve = resolverRef.current
    resolverRef.current = null
    setConfig(null)
    if (resolve) resolve(result)
  }, [])

  const promptUI = config ? (
    <PromptModal
      title={config.title}
      label={config.label}
      hint={config.hint}
      placeholder={config.placeholder}
      defaultValue={config.defaultValue}
      confirmText={config.confirmText}
      onCancel={() => settle(null)}
      onSubmit={(value) => settle(value)}
    />
  ) : null

  return [promptUI, prompt]
}

export function Toasts({ items, onDismiss }) {
  return (
    <div className="pointer-events-none fixed bottom-4 right-4 z-50 flex flex-col gap-2">
      {items.map((t) => {
        const Icon = t.type === 'error' ? XCircle : t.type === 'success' ? CheckCircle2 : Info
        const color = t.type === 'error' ? 'text-[var(--geist-red-800)]' : t.type === 'success' ? 'text-[var(--geist-green-800)]' : 'text-[var(--geist-blue-700)]'
        return (
          <button
            key={t.id}
            className="pointer-events-auto flex max-w-sm items-start gap-2 rounded-md border border-black/10 bg-white px-4 py-2.5 text-left text-sm text-[var(--geist-primary)]"
            style={{ boxShadow: 'var(--geist-shadow-popover)' }}
            onClick={() => onDismiss(t.id)}
          >
            <Icon size={16} className={`mt-0.5 shrink-0 ${color}`} />
            <span className="whitespace-pre-wrap">{t.msg}</span>
          </button>
        )
      })}
    </div>
  )
}
