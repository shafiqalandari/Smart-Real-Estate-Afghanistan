import { useEffect,useState } from 'react'
import { allRecords,type RecordRow } from '../realEstate'
import type { Page } from '../components/Sidebar'
import type { Language } from '../i18n'
export default function Dashboard({onNavigate}:{language:Language;onNavigate:(p:Page)=>void}){
 const [rows,setRows]=useState<RecordRow[]>([]),[error,setError]=useState('');useEffect(()=>{allRecords().then(setRows).catch(e=>setError(String(e)))},[])
 const count=(k:string)=>rows.filter(r=>r.kind===k).length
 const paid=(c:string)=>rows.filter(r=>r.kind==='payments'&&r.payload.currency===c).reduce((s,r)=>s+Number(r.payload.amount||0),0)
 const due=(c:string)=>rows.filter(r=>r.kind==='deals'&&r.payload.currency===c).reduce((s,r)=>s+Number(r.payload.commission||0),0)-paid(c)
 const cards:[string,string,Page][]=[['جایدادهای موجود',String(rows.filter(r=>r.kind==='properties'&&r.payload.status!=='معامله‌شده').length),'properties'],['جایدادهای معامله‌شده',String(rows.filter(r=>r.kind==='properties'&&r.payload.status==='معامله‌شده').length),'properties'],['تمام معاملات',String(count('deals')),'deals'],['کمیشن دریافت‌شده AFN',paid('AFN').toLocaleString(),'accounting'],['کمیشن باقی‌مانده AFN',due('AFN').toLocaleString(),'accounting'],['کمیشن باقی‌مانده USD',due('USD').toLocaleString(),'accounting']]
 return <div className="space-y-6"><div><h1 className="text-2xl font-bold">داشبورد دفتر رهنمای معاملات</h1><p className="mt-1 text-sm text-slate-500">خلاصه جایدادها، معاملات و کمیشن دفتر</p></div>{error&&<p className="rounded-lg bg-red-100 p-3 text-red-700">{error}</p>}<div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">{cards.map(([name,value,route])=><button key={name} onClick={()=>onNavigate(route)} className="rounded-2xl border bg-white p-5 text-start shadow-sm transition hover:shadow-lg dark:bg-slate-900"><span className="text-sm text-slate-500">{name}</span><div className="mt-3 text-2xl font-black">{value}</div></button>)}</div><div className="flex flex-wrap gap-3">{([['ثبت جایداد','properties'],['ثبت مشتری','persons'],['ثبت معامله','deals']] as const).map(([label,route])=><button key={route} onClick={()=>onNavigate(route)} className="rounded-xl bg-amber-500 px-5 py-3 font-bold text-slate-900">{label}</button>)}</div></div>
}
