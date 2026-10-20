import { RefreshCcw } from 'lucide-react'

export default function SimpleLoader({ fullScreen=false, minHeight='280px', label='' }: { fullScreen?: boolean; minHeight?: string; label?: string }) {
  return <div className={`grid place-items-center bg-transparent text-slate-500 dark:text-slate-300 ${fullScreen?'min-h-screen':''}`} style={fullScreen?undefined:{minHeight}}>
    <div className="flex items-center gap-2 text-sm font-medium"><RefreshCcw size={18} className="animate-spin opacity-70"/>{label ? <span>{label}</span> : null}</div>
  </div>
}
