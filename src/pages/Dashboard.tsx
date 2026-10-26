import { useEffect, useMemo, useState } from 'react'
import { Building2, CheckCircle2, FileText, Wallet, TrendingUp, Clock3, ArrowUpLeft, Plus, Users, RefreshCw, HandCoins, Receipt, ClipboardList, Home, Coins, DollarSign } from 'lucide-react'
import { allRecords, type RecordRow } from '../realEstate'
import type { Page } from '../components/Sidebar'
import type { Language } from '../i18n'

type Card = { title: string; value: string; page: Page; icon: typeof Building2; accent: string; hint: string }
const fmt = (value:number)=>new Intl.NumberFormat('en-US',{maximumFractionDigits:2}).format(value)
const phrases: Record<Language,Record<string,string>> = {
 'دری':{},
 'English':{
  'مشتریان ثبت‌شده':'Registered customers','درخواست‌های جایداد':'Property requests','عایدات دفتر (AFN)':'Office income (AFN)','مصارف دفتر (AFN)':'Office expenses (AFN)','عایدات دفتر (USD)':'Office income (USD)','مصارف دفتر (USD)':'Office expenses (USD)','کمیشن دریافت‌شده (USD)':'Commission received (USD)','مجموع جایدادها':'All properties','مجموع مشتریان دفتر':'Office customer count','بودجه درخواست‌های ثبت‌شده':'Registered property enquiries','ثبت دریافت کمیشن':'Record commission receipt','ثبت مصارف':'Record expenses','درخواست جایداد':'Property request',
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
  'مشتریان ثبت‌شده':'ثبت شوي پېرودونکي','درخواست‌های جایداد':'د ملکیت غوښتنې','عایدات دفتر (AFN)':'د دفتر عواید (AFN)','مصارف دفتر (AFN)':'د دفتر لګښتونه (AFN)','عایدات دفتر (USD)':'د دفتر عواید (USD)','مصارف دفتر (USD)':'د دفتر لګښتونه (USD)','کمیشن دریافت‌شده (USD)':'ترلاسه شوی کمېشن (USD)','مجموع جایدادها':'ټول ملکیتونه','مجموع مشتریان دفتر':'ټول پېرودونکي','بودجه درخواست‌های ثبت‌شده':'ثبت شوې غوښتنې','ثبت دریافت کمیشن':'د کمېشن ثبت','ثبت مصارف':'د لګښتونو ثبت','درخواست جایداد':'د ملکیت غوښتنه',
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
  const prop=of('properties'),deal=of('deals'),payments=of('payments'),persons=of('persons'),requests=of('requests')
  const collected=(currency:string)=>payments.filter(r=>r.payload.currency===currency).reduce((n,r)=>n+Number(r.payload.amount||0),0)
  const due=(currency:string)=>deal.filter(r=>r.payload.currency===currency).reduce((n,r)=>n+Number(r.payload.commission||0),0)-collected(currency)
  const sum=(kind:string,currency:string)=>of(kind).filter(r=>String(r.payload.currency||'AFN').toUpperCase()===currency).reduce((n,r)=>n+Number(r.payload.amount||0),0)
  return [
   {title:'جایدادهای موجود',value:fmt(prop.filter(r=>r.payload.status!=='معامله‌شده').length),page:'properties',icon:Building2,accent:'blue',hint:'فهرست جایدادهای قابل معامله'},
   {title:'جایدادهای معامله‌شده',value:fmt(prop.filter(r=>r.payload.status==='معامله‌شده').length),page:'properties',icon:CheckCircle2,accent:'green',hint:'معاملات ثبت‌شده'},
   {title:'تمام معاملات',value:fmt(deal.length),page:'deals',icon:FileText,accent:'purple',hint:'فروش، کرایه و گروی'},
   {title:'کمیشن دریافت‌شده',value:fmt(collected('AFN'))+' AFN',page:'accounting',icon:Wallet,accent:'green',hint:'دریافت‌های افغانی'},
   {title:'باقی‌مانده کمیشن',value:fmt(Math.max(0,due('AFN')))+' AFN',page:'accounting',icon:Clock3,accent:'orange',hint:'کمیشن‌های پرداخت‌نشده'},
   {title:'کمیشن دالری باقی',value:fmt(Math.max(0,due('USD')))+' USD',page:'accounting',icon:TrendingUp,accent:'blue',hint:'جدا از حساب افغانی'},
   {title:'مشتریان ثبت‌شده',value:fmt(persons.length),page:'persons',icon:Users,accent:'purple',hint:'مجموع مشتریان دفتر'},
   {title:'درخواست‌های جایداد',value:fmt(requests.length),page:'requests',icon:ClipboardList,accent:'orange',hint:'بودجه درخواست‌های ثبت‌شده'},
   {title:'مجموع جایدادها',value:fmt(prop.length),page:'properties',icon:Home,accent:'blue',hint:'فهرست جایدادهای قابل معامله'},
   {title:'کمیشن دریافت‌شده (USD)',value:fmt(collected('USD'))+' USD',page:'payments',icon:DollarSign,accent:'green',hint:'جدا از حساب افغانی'},
   {title:'عایدات دفتر (AFN)',value:fmt(sum('income','AFN'))+' AFN',page:'income',icon:HandCoins,accent:'green',hint:'دریافت‌های افغانی'},
   {title:'مصارف دفتر (AFN)',value:fmt(sum('expenses','AFN'))+' AFN',page:'expenses',icon:Receipt,accent:'orange',hint:'جدا از حساب افغانی'},
   {title:'عایدات دفتر (USD)',value:fmt(sum('income','USD'))+' USD',page:'income',icon:Coins,accent:'green',hint:'جدا از حساب افغانی'},
   {title:'مصارف دفتر (USD)',value:fmt(sum('expenses','USD'))+' USD',page:'expenses',icon:Receipt,accent:'orange',hint:'جدا از حساب افغانی'},
  ]
 },[rows])
 return <section className="estate-dashboard space-y-6" dir={language==='English'?'ltr':'rtl'}>
  <header className="estate-page-hero"><div><span className="estate-eyebrow">{t('نمای عمومی دفتر')}</span><h1>{t('داشبورد رهنمای معاملات')}</h1><p>{t('جایدادها، مشتریان و وضعیت مالی دفتر را در یک نگاه ببینید.')}</p></div><button type="button" className="estate-refresh" onClick={reload} disabled={loading}><RefreshCw size={16} className={loading?'animate-spin':''}/> {t('تازه‌سازی')}</button></header>
  <div className="estate-stat-grid">{cards.map(({title,value,page,icon:Icon,accent,hint},i)=><button key={t(title)} type="button" style={{animationDelay:`${i*45}ms`}} className={`estate-stat-card estate-accent-${accent}`} onClick={()=>onNavigate(page)}><div className="estate-stat-top"><span className="estate-stat-icon"><Icon size={22} strokeWidth={1.8}/></span><ArrowUpLeft size={17} className="estate-stat-arrow"/></div><p className="estate-stat-label">{t(title)}</p><strong dir="auto">{loading?'…':value}</strong><small>{t(hint)}</small></button>)}</div>
  {error&&<div role="alert" className="estate-error">{t('اتصال به معلومات برقرار نشد:')} {error} <button onClick={reload}>{t('تلاش دوباره')}</button></div>}
  <div className="estate-dashboard-bottom"><div className="estate-content-card"><h2>{t('دسترسی سریع')}</h2><p>{t('کارهای روزانه دفتر را سریع‌تر انجام دهید.')}</p><div className="estate-quick-grid">{([{name:'ثبت جایداد',page:'properties',icon:Building2},{name:'ثبت مشتری',page:'persons',icon:Users},{name:'ثبت معامله',page:'deals',icon:FileText},{name:'ثبت دریافت کمیشن',page:'payments',icon:Wallet},{name:'ثبت مصارف',page:'expenses',icon:Receipt},{name:'درخواست جایداد',page:'requests',icon:ClipboardList}] as const).map(a=><button key={a.page} onClick={()=>onNavigate(a.page)}><span><a.icon size={20}/></span><strong>{t(a.name)}</strong><Plus size={16}/></button>)}</div></div><div className="estate-content-card estate-help-card"><h2>{t('وضعیت سیستم')}</h2><p>{t(error?'اتصال به سرور را بررسی کنید.':loading?'در حال دریافت معلومات…':'معلومات دفتر بارگذاری شد.')}</p><span className="estate-help-indicator">{t(error?'نیازمند بررسی':loading?'در حال بارگذاری':'آماده استفاده')}</span></div></div>
 </section>
}
