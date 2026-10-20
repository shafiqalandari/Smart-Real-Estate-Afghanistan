import { useEffect, useState } from 'react'
import { ArrowLeft, RefreshCcw, Users, Smartphone, ShieldCheck, AlertTriangle, Clock3, Building2, CreditCard, MessageSquare } from 'lucide-react'
import { adminGet } from '../adminApi'
import { adminNavigate } from '../adminAuth'

export default function AdminOverview(){
 const [welcome,setWelcome]=useState(()=>sessionStorage.getItem('real-estate-admin-welcome')!=='1')
 useEffect(()=>{if(!welcome)return;const id=window.setTimeout(()=>{sessionStorage.setItem('real-estate-admin-welcome','1');setWelcome(false)},2200);return()=>window.clearTimeout(id)},[welcome])
 const [data,setData]=useState<any>(null)
 const [error,setError]=useState('')
 const [loading,setLoading]=useState(true)
 const load=()=>{setLoading(true);adminGet('/api/admin/dashboard/analytics').then(r=>{setData(r);setError('')}).catch((e:any)=>setError(e.message)).finally(()=>setLoading(false))}
 useEffect(load,[])
 const d=data?.devices||{}, s=data?.sections||{}
 const cards=[
  {label:'شرکت‌های ثبت‌شده',value:s.companies,path:'/admin/companies',icon:Building2,accent:'text-blue-600',bg:'bg-blue-50'},
  {label:'تمام دستگاه‌ها',value:d.total,path:'/admin/devices',icon:Smartphone,accent:'text-indigo-600',bg:'bg-indigo-50'},
  {label:'دسترسی‌های فعال',value:d.allowed,path:'/admin/devices?filter=allowed',icon:ShieldCheck,accent:'text-emerald-600',bg:'bg-emerald-50'},
  {label:'منتظر تأیید',value:d.pending,path:'/admin/devices?filter=pending',icon:Clock3,accent:'text-amber-600',bg:'bg-amber-50'},
  {label:'دستگاه‌های بلاک‌شده',value:d.blocked,path:'/admin/devices?filter=blocked',icon:AlertTriangle,accent:'text-rose-600',bg:'bg-rose-50'},
  {label:'درخواست‌های شرکت‌ها',value:s.requests,path:'/admin/company-requests',icon:Users,accent:'text-violet-600',bg:'bg-violet-50'},
 ]
 const shortcuts=[{label:'مدیریت مشتریان',desc:'حساب، دسترسی و پروفایل مشتریان',path:'/admin/customers',icon:Users},{label:'مدیریت دستگاه‌ها',desc:'تأیید، بلاک و تمدید دستگاه',path:'/admin/devices',icon:Smartphone},{label:'پلان‌ها و اشتراک‌ها',desc:'مدیریت پلان‌ها و اعتبار',path:'/admin/plans',icon:CreditCard},{label:'پیام‌های مشتریان',desc:'بررسی گفتگوها و درخواست‌ها',path:'/admin/messages',icon:MessageSquare}]
 if(welcome)return <div className="fixed inset-0 z-50 flex items-center justify-center bg-[#08162d] px-6 text-white"><div className="animate-pulse text-center"><div className="mx-auto mb-6 grid h-20 w-20 place-items-center rounded-3xl bg-blue-600 text-5xl shadow-2xl"><Building2 size={34}/></div><h1 className="text-3xl font-black">Smart Real Estate Afghanistan</h1><p className="mt-3 text-sm text-slate-300">به مدیریت مرکزی خوش آمدید</p><div className="mx-auto mt-8 h-1 w-44 overflow-hidden rounded-full bg-white/20"><div className="h-full w-full origin-right animate-pulse bg-blue-400"/></div></div></div>
 return <div className="space-y-7"><div className="flex flex-wrap items-center justify-between gap-3"><div><h1 className="text-2xl font-extrabold text-slate-900">داشبورد مدیریت</h1><p className="mt-1 text-sm text-slate-500">معلومات مهم شرکت‌ها و دستگاه‌ها در یک نگاه</p></div><button onClick={load} disabled={loading} className="flex items-center gap-2 rounded-xl border border-slate-200 bg-white px-4 py-2 text-sm font-semibold hover:bg-slate-50"><RefreshCcw size={16} className={loading?'animate-spin':''}/>تازه‌سازی</button></div>
 {error&&<div role="alert" className="rounded-xl border border-red-200 bg-red-50 p-4 text-sm text-red-700">{error}</div>}
 <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">{cards.map(c=><button key={c.path+c.label} onClick={()=>adminNavigate(c.path)} className="group flex items-center gap-4 rounded-2xl border border-slate-200 bg-white p-5 text-right shadow-sm transition-all hover:-translate-y-0.5 hover:border-blue-200 hover:shadow-md"><span className={`grid h-13 w-13 shrink-0 place-items-center rounded-2xl p-3 ${c.bg} ${c.accent}`}><c.icon size={23}/></span><span className="flex-1"><span className="block text-xs font-semibold text-slate-500">{c.label}</span><b className="mt-1 block text-3xl font-bold text-slate-900">{data?Number(c.value||0).toLocaleString('en-US'):'...'}</b></span><ArrowLeft size={16} className="text-slate-300 group-hover:text-blue-600"/></button>)}</div>
 <section className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm"><div className="mb-4"><h2 className="text-lg font-bold">دسترسی سریع</h2><p className="text-xs text-slate-500">بخش موردنظر را انتخاب کن</p></div><div className="grid gap-3 sm:grid-cols-2">{shortcuts.map(x=><button key={x.path} onClick={()=>adminNavigate(x.path)} className="flex items-center gap-3 rounded-xl border border-slate-200 p-4 text-right transition hover:border-blue-300 hover:bg-blue-50/50"><span className="rounded-xl bg-slate-100 p-3 text-slate-700"><x.icon size={20}/></span><span className="flex-1"><b className="block text-sm">{x.label}</b><span className="mt-1 block text-xs text-slate-500">{x.desc}</span></span><ArrowLeft size={16} className="text-slate-400"/></button>)}</div></section>
 </div>
}
