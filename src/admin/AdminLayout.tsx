import { useState, type ReactNode } from 'react'
import { Archive, Banknote, Boxes, ClipboardList, Coins, LayoutDashboard, Package, Settings, ShieldCheck, Truck, User, Users, WalletCards, X, Menu, ChevronDown, MessageSquare, Building2, CreditCard } from 'lucide-react'
import { BRAND_NAME, BRAND_DARI } from '../branding'
import { signOut } from './adminApi'
import { adminNavigate } from './adminAuth'

const primary = [
  ['/admin','داشبورد',LayoutDashboard],
  ['/admin/companies','شرکت‌ها',Building2],
  ['/admin/customers','مشتریان',Users],
  ['/admin/company-requests','درخواست‌های ثبت شرکت',ClipboardList],
  ['/admin/devices','مدیریت دستگاه‌ها',Package],
  ['/admin/plans','پلان‌ها',Boxes],
  ['/admin/licenses','لایسنس‌ها',ShieldCheck],
  ['/admin/messages','پیام‌ها',MessageSquare],
] as const
const finance = [
  ['/admin/credits','اعتبارات',Coins],
  ['/admin/subscriptions','اشتراک‌ها',WalletCards],
  ['/admin/payments','پرداخت‌ها',Banknote],
  ['/admin/payment-requests','درخواست‌های پرداخت',ClipboardList],
  ['/admin/payment-methods','روش‌های پرداخت',CreditCard],
] as const
const extras = [
  ['/admin/broadcast','اعلان‌های عمومی',Truck],
  ['/admin/backup','بکاپ',Archive],
  ['/admin/innovations','نوآوری‌ها',Boxes],
  ['/admin/audit','تاریخچه فعالیت',ClipboardList],
  ['/admin/security','امنیت',ShieldCheck],
  ['/admin/settings','تنظیمات',Settings],
] as const
const all = [...primary,...finance,...extras]
export default function AdminLayout({ children }: {children:ReactNode}){
  const [open,setOpen]=useState(false)
  const [financeOpen,setFinanceOpen]=useState(all.slice(primary.length,primary.length+finance.length).some(([p])=>window.location.pathname.startsWith(p)))
  const [extrasOpen,setExtrasOpen]=useState(extras.some(([p])=>window.location.pathname.startsWith(p)))
  const path=window.location.pathname
  const go=(p:string)=>{adminNavigate(p);setOpen(false)}
  const logout=async()=>{try{await signOut()}finally{adminNavigate('/admin/login')}}
  const active=(p:string)=>path===p||(p!=='/admin'&&path.startsWith(p+'/'))
  const links=(items:typeof all)=>(items.map(([p,label,Icon])=><button key={p} onClick={()=>go(p)} aria-current={active(p)?'page':undefined} className={`flex w-full items-center gap-3 rounded-xl px-3 py-2.5 text-right text-[13px] font-medium transition-colors ${active(p)?'bg-blue-600 text-white shadow-sm':'text-slate-300 hover:bg-white/10 hover:text-white'}`}><Icon size={17}/><span className="flex-1">{label}</span></button>))
  return <div dir="rtl" className="min-h-screen bg-[#f4f7fc] text-slate-900">
    <header className="fixed inset-x-0 top-0 z-20 flex h-16 items-center justify-between border-b border-slate-200 bg-white/95 px-4 shadow-sm backdrop-blur lg:pr-[274px] lg:px-8">
      <div className="flex items-center gap-3"><button aria-label="بازکردن فهرست" onClick={()=>setOpen(true)} className="rounded-xl border border-slate-200 p-2 lg:hidden"><Menu size={20}/></button><div><b className="text-sm sm:text-base">مدیریت مرکزی {BRAND_DARI}</b><p className="text-[11px] text-slate-500">مدیریت شرکت‌ها، مشتریان و دسترسی‌ها</p></div></div>
      <button onClick={logout} className="rounded-xl border border-slate-200 px-3 py-2 text-xs font-semibold text-red-600 hover:bg-red-50">خروج</button>
    </header>
    {open&&<button aria-label="بستن فهرست" onClick={()=>setOpen(false)} className="fixed inset-0 z-30 bg-slate-950/60 lg:hidden"/>}
    <aside className={`fixed inset-y-0 right-0 z-40 flex w-[258px] flex-col bg-[#0b172a] shadow-xl transition-transform lg:translate-x-0 ${open?'translate-x-0':'translate-x-full'}`}>
      <div className="flex h-20 items-center gap-3 border-b border-white/10 px-5"><div className="grid h-11 w-11 place-items-center rounded-2xl bg-blue-600 text-white"><Building2 size={22}/></div><div className="min-w-0 flex-1"><strong className="block text-sm text-white">{BRAND_DARI}</strong><span className="text-[10px] text-slate-400">{BRAND_NAME} · ادمین مرکزی</span></div><button aria-label="بستن" onClick={()=>setOpen(false)} className="rounded-lg p-1 text-white lg:hidden"><X size={19}/></button></div>
      <nav aria-label="فهرست مدیریت" className="min-h-0 flex-1 space-y-1 overflow-y-auto px-3 py-4 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
        <p className="mb-2 px-3 text-[10px] font-bold tracking-wide text-slate-500">بخش‌های اصلی</p>{links(primary as unknown as typeof all)}
        <button onClick={()=>setFinanceOpen(!financeOpen)} aria-expanded={financeOpen} className="mt-3 flex w-full items-center gap-2 rounded-xl px-3 py-2.5 text-xs font-bold text-slate-300 hover:bg-white/10"><WalletCards size={17}/><span className="flex-1 text-right">مالی و اشتراک‌ها</span><ChevronDown size={16} className={`transition-transform ${financeOpen?'rotate-180':''}`}/></button>
        {financeOpen&&<div className="space-y-1 pr-2">{links(finance as unknown as typeof all)}</div>}
        <button onClick={()=>setExtrasOpen(!extrasOpen)} aria-expanded={extrasOpen} className="mt-2 flex w-full items-center gap-2 rounded-xl px-3 py-2.5 text-xs font-bold text-slate-300 hover:bg-white/10"><Settings size={17}/><span className="flex-1 text-right">ابزارها و تنظیمات</span><ChevronDown size={16} className={`transition-transform ${extrasOpen?'rotate-180':''}`}/></button>
        {extrasOpen&&<div className="space-y-1 pr-2">{links(extras as unknown as typeof all)}</div>}
      </nav>
      <div className="border-t border-white/10 p-4 text-center text-[11px] text-slate-400">Afghan Power Tech</div>
    </aside>
    <main className="min-h-screen px-4 pb-8 pt-24 sm:px-6 lg:mr-[258px] lg:px-8"><div className="mx-auto w-full max-w-7xl">{children}</div></main>
  </div>
}
