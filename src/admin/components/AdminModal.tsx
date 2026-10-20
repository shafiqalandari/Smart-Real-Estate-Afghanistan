import type { ReactNode } from 'react'
import { X } from 'lucide-react'

type Props = {
  open: boolean
  title: string
  children: ReactNode
  confirmLabel?: string
  cancelLabel?: string
  busy?: boolean
  danger?: boolean
  onClose: () => void
  onConfirm?: () => void | Promise<void>
}

export default function AdminModal({open,title,children,confirmLabel='Confirm',cancelLabel='Cancel',busy=false,danger=false,onClose,onConfirm}:Props){
  if(!open) return null
  return <div className="fixed inset-0 z-[120] grid place-items-center bg-slate-950/35 p-4" onMouseDown={e=>{if(e.target===e.currentTarget&&!busy)onClose()}}>
    <div className="w-full max-w-md rounded-2xl border border-slate-200 bg-white shadow-2xl">
      <div className="flex items-center justify-between border-b border-slate-100 px-5 py-4">
        <h3 className="text-sm font-bold text-slate-900">{title}</h3>
        <button type="button" disabled={busy} onClick={onClose} className="grid h-8 w-8 place-items-center rounded-lg text-slate-500 hover:bg-slate-100 disabled:opacity-50"><X size={16}/></button>
      </div>
      <div className="space-y-4 px-5 py-4 text-sm text-slate-700">{children}</div>
      <div className="flex justify-end gap-2 border-t border-slate-100 px-5 py-4">
        <button type="button" disabled={busy} onClick={onClose} className="h-9 rounded-lg border border-slate-200 px-4 text-xs font-bold text-slate-700 hover:bg-slate-50 disabled:opacity-50">{cancelLabel}</button>
        {onConfirm&&<button type="button" disabled={busy} onClick={onConfirm} className={`h-9 rounded-lg px-4 text-xs font-bold text-white disabled:opacity-50 ${danger?'bg-red-600 hover:bg-red-700':'bg-slate-900 hover:bg-slate-800'}`}>{busy?'Working…':confirmLabel}</button>}
      </div>
    </div>
  </div>
}
