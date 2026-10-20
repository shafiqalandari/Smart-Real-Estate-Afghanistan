import { useEffect, useMemo, useState } from 'react'
import { Building2, CheckCircle2, FileText, Wallet, TrendingUp, Clock3, ArrowUpLeft, Plus, Users, RefreshCw } from 'lucide-react'
import { allRecords, type RecordRow } from '../realEstate'
import type { Page } from '../components/Sidebar'
import type { Language } from '../i18n'

type Card = { title: string; value: string; page: Page; icon: typeof Building2; accent: string; hint: string }
const fmt = (value:number)=>new Intl.NumberFormat('en-US',{maximumFractionDigits:2}).format(value)
const phrases: Record<Language,Record<string,string>> = {
 'دری':{},
 'English':{
  'جایدادهای موجود':'Available properties','فهرست جایدادهای قابل معامله':'Properties available for transactions',
  'جایدادهای معامله‌شده':'Closed properties','معاملات ثبت‌شده':'Registered deals',
  'تمام معاملات':'All deals','فروش، کرایه و گروی':'Sale, rent and mortgage',
  'کمیشن دریافت‌شده':'Commission received','دریافت‌های افغانی':'Receipts in AFN',
  'باقی‌مانده کمیشن':'Outstanding commission','کمیشن‌های پرداخت‌نشده':'Unpaid commissions',
  'کمیشن دالری باقی':'Outstanding USD commission','جدا از حساب افغانی':'Separate from AFN account',
  'نمای عمومی دفتر':'Office overview','داشبورد رهنمای معاملات':'Real Estate Dashboard',
  'جایدادها، مشتریان و وضعیت مالی دفتر را در یک نگاه ببینید.':'View properties, customers and office finances at a glance.',
  'تازه‌سازی':'Refresh','اتصال به معلومات برقرار نشد:':'Could not load records:',
  'تلاش دوباره':'Try again','دسترسی سریع':'Quick access',
  'کارهای روزانه دفتر را سریع‌تر انجام دهید.':'Manage your daily office tasks faster.',
  'ثبت جایداد':'Add property','ثبت مشتری':'Add customer','ثبت معامله':'Add deal',
  'وضعیت سیستم':'System status','اتصال به سرور را بررسی کنید.':'Check the server connection.',
  'در حال دریافت معلومات…':'Loading records…','معلومات دفتر بارگذاری شد.':'Office records loaded.',
  'نیازمند بررسی':'Needs attention','در حال بارگذاری':'Loading','آماده استفاده':'Ready'
 },
 'پښتو':{
  'جایدادهای موجود':'شته ملکیتونه','فهرست جایدادهای قابل معامله':'د معاملې لپاره ملکیتونه',
  'جایدادهای معامله‌شده':'معامله شوي ملکیتونه','معاملات ثبت‌شده':'ثبت شوې معاملې',
  'تمام معاملات':'ټولې معاملې','فروش، کرایه و گروی':'پلور، کرایه او ګروي',
  'کمیشن دریافت‌شده':'ترلاسه شوی کمېشن','دریافت‌های افغانی':'په افغانیو کې ترلاسه شوې پیسې',
  'باقی‌مانده کمیشن':'پاتې کمېشن','کمیشن‌های پرداخت‌نشده':'نه ورکړل شوي کمېشنونه',
  'کمیشن دالری باقی':'پاتې ډالري کمېشن','جدا از حساب افغانی':'له افغاني حساب څخه جلا',
  'نمای عمومی دفتر':'د دفتر عمومي لید','داشبورد رهنمای معاملات':'د معاملاتو ډشبورډ',
  'جایدادها، مشتریان و وضعیت مالی دفتر را در یک نگاه ببینید.':'ملکیتونه، پېرودونکي او مالي حالت په یوه نظر وګورئ.',
  'تازه‌سازی':'تازه کول','اتصال به معلومات برقرار نشد:':'معلومات ترلاسه نشول:',
  'تلاش دوباره':'بیا هڅه وکړئ','دسترسی سریع':'چټک لاسرسی',
  'کارهای روزانه دفتر را سریع‌تر انجام دهید.':'د دفتر ورځني کارونه په چټکۍ ترسره کړئ.',
  'ثبت جایداد':'ملکیت ثبتول','ثبت مشتری':'پېرودونکی ثبتول','ثبت معامله':'معامله ثبتول',
  'وضعیت سیستم':'د سیستم حالت','اتصال به سرور را بررسی کنید.':'له سرور سره اړیکه وګورئ.',
  'در حال دریافت معلومات…':'معلومات بارېږي…','معلومات دفتر بارگذاری شد.':'د دفتر معلومات پورته شول.',
  'نیازمند بررسی':'کتنې ته اړتیا لري','در حال بارگذاری':'بارېږي','آماده استفاده':'چمتو'
 }
}
export default function Dashboard({language,onNavigate}:{language:Language;onNavigate:(p:Page)=>void}){
 const t=(value:string)=>phrases[language][value]||value
 const [rows,setRows]=useState<RecordRow[]>([])
 const [error,setError]=useState('')
 const [loading,setLoading]=useState(true)
 const reload=()=>{setLoading(true);allRecords().then(data=>{setRows(data);setError('')}).catch(e=>setError(e instanceof Error?e.message:String(e))).finally(()=>setLoading(false))}
 useEffect(()=>{reload()},[])
 const cards=useMemo<Card[]>(()=>{
  const of=(kind:string)=>rows.filter(r=>r.kind===kind)
  const prop=of('properties'),deal=of('deals'),payments=of('payments')
  const collected=(currency:string)=>payments.filter(r=>r.payload.currency===currency).reduce((n,r)=>n+Number(r.payload.amount||0),0)
  const due=(currency:string)=>deal.filter(r=>r.payload.currency===currency).reduce((n,r)=>n+Number(r.payload.commission||0),0)-collected(currency)
  return [
   {title:'جایدادهای موجود',value:fmt(prop.filter(r=>r.payload.status!=='معامله‌شده').length),page:'properties',icon:Building2,accent:'blue',hint:'فهرست جایدادهای قابل معامله'},
   {title:'جایدادهای معامله‌شده',value:fmt(prop.filter(r=>r.payload.status==='معامله‌شده').length),page:'properties',icon:CheckCircle2,accent:'green',hint:'معاملات ثبت‌شده'},
   {title:'تمام معاملات',value:fmt(deal.length),page:'deals',icon:FileText,accent:'purple',hint:'فروش، کرایه و گروی'},
   {title:'کمیشن دریافت‌شده',value:fmt(collected('AFN'))+' AFN',page:'accounting',icon:Wallet,accent:'green',hint:'دریافت‌های افغانی'},
   {title:'باقی‌مانده کمیشن',value:fmt(Math.max(0,due('AFN')))+' AFN',page:'accounting',icon:Clock3,accent:'orange',hint:'کمیشن‌های پرداخت‌نشده'},
   {title:'کمیشن دالری باقی',value:fmt(Math.max(0,due('USD')))+' USD',page:'accounting',icon:TrendingUp,accent:'blue',hint:'جدا از حساب افغانی'},
  ]
 },[rows])
 return <section className="estate-dashboard space-y-6" dir={language==='English'?'ltr':'rtl'}>
  <header className="estate-page-hero"><div><span className="estate-eyebrow">{t('نمای عمومی دفتر')}</span><h1>{t('داشبورد رهنمای معاملات')}</h1><p>{t('جایدادها، مشتریان و وضعیت مالی دفتر را در یک نگاه ببینید.')}</p></div><button type="button" className="estate-refresh" onClick={reload} disabled={loading}><RefreshCw size={16} className={loading?'animate-spin':''}/> {t('تازه‌سازی')}</button></header>
  <div className="estate-stat-grid">{cards.map(({title,value,page,icon:Icon,accent,hint},i)=><button key={t(title)} type="button" style={{animationDelay:`${i*45}ms`}} className={`estate-stat-card estate-accent-${accent}`} onClick={()=>onNavigate(page)}><div className="estate-stat-top"><span className="estate-stat-icon"><Icon size={22} strokeWidth={1.8}/></span><ArrowUpLeft size={17} className="estate-stat-arrow"/></div><p className="estate-stat-label">{t(title)}</p><strong dir="auto">{loading?'…':value}</strong><small>{t(hint)}</small></button>)}</div>
  {error&&<div role="alert" className="estate-error">{t('اتصال به معلومات برقرار نشد:')} {error} <button onClick={reload}>{t('تلاش دوباره')}</button></div>}
  <div className="estate-dashboard-bottom"><div className="estate-content-card"><h2>{t('دسترسی سریع')}</h2><p>{t('کارهای روزانه دفتر را سریع‌تر انجام دهید.')}</p><div className="estate-quick-grid">{([{name:'ثبت جایداد',page:'properties',icon:Building2},{name:'ثبت مشتری',page:'persons',icon:Users},{name:'ثبت معامله',page:'deals',icon:FileText}] as const).map(a=><button key={a.page} onClick={()=>onNavigate(a.page)}><span><a.icon size={20}/></span><strong>{t(a.name)}</strong><Plus size={16}/></button>)}</div></div><div className="estate-content-card estate-help-card"><h2>{t('وضعیت سیستم')}</h2><p>{t(error?'اتصال به سرور را بررسی کنید.':loading?'در حال دریافت معلومات…':'معلومات دفتر بارگذاری شد.')}</p><span className="estate-help-indicator">{t(error?'نیازمند بررسی':loading?'در حال بارگذاری':'آماده استفاده')}</span></div></div>
 </section>
}
