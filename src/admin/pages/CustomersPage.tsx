import { Search, Plus } from 'lucide-react'
import { useEffect, useState } from 'react'
import { adminPost, fetchPaged } from '../adminApi'
import { adminNavigate } from '../adminAuth'
import AdminModal from '../components/AdminModal'
import PaginatedTable from '../components/PaginatedTable'
import useDebouncedValue from '../hooks/useDebouncedValue'
import { PageHeader, badge, dateText, pretty } from './shared'
import SmoothSelect from '../../components/SmoothSelect'

type Action = { row:any; kind:'grant'|'block'|'unblock' }

export default function CustomersPage(){
  const [q,setQ]=useState(''); const dq=useDebouncedValue(q,300); const [page,setPage]=useState(1); const [rows,setRows]=useState<any[]>([]); const [total,setTotal]=useState(0); const [loading,setLoading]=useState(true); const [error,setError]=useState('')
  const [createOpen,setCreateOpen]=useState(false); const [newCustomer,setNewCustomer]=useState({businessName:'',ownerName:'',phone:'',email:'',password:'',country:'Afghanistan',city:''}); const [created,setCreated]=useState('');
  const [action,setAction]=useState<Action|null>(null); const [reason,setReason]=useState(''); const [value,setValue]=useState(1); const [unit,setUnit]=useState('MONTH'); const [busy,setBusy]=useState(false)
  const load=()=>{setLoading(true);fetchPaged<any>('/api/admin/customers',{q:dq},page,20).then(r=>{setRows(r.rows);setTotal(r.total);setError('')}).catch((e:any)=>setError(e.message)).finally(()=>setLoading(false))}
  useEffect(load,[page,dq])
  const open=(row:any,kind:Action['kind'])=>{setAction({row,kind});setReason('');setValue(1);setUnit('MONTH')}
  const submit=async()=>{if(!action)return;if(action.kind==='block'&&!reason.trim())return;setBusy(true);try{const id=encodeURIComponent(action.row.id);if(action.kind==='grant')await adminPost(`/api/admin/customers/${id}/grant-access`,{value:Math.max(1,Number(value)||1),unit,note:reason.trim()});else await adminPost(`/api/admin/customers/${id}/${action.kind}`,{reason:reason.trim()});setAction(null);load()}catch(e:any){setError(e.message)}finally{setBusy(false)}}
  const createCustomer=async()=>{
    if(!newCustomer.businessName.trim()||!newCustomer.ownerName.trim()||!newCustomer.phone.trim()||!newCustomer.email.trim()||newCustomer.password.length<8){setError('نام شرکت، مسئول، شماره تماس، ایمیل و پسورد حداقل ۸ کاراکتر ضروری است.');return}
    setBusy(true);setError('');setCreated('');
    try {await adminPost('/api/admin/customers/create',newCustomer);setCreateOpen(false);setCreated(`حساب مشتری ${newCustomer.businessName} ساخته شد. اکنون مشتری با ایمیل و پسورد خود در دستگاه خودش وارد شود؛ دیموی پیش‌فرض خودکار شروع شده است. برای مدت بیشتر از بخش تمدید اعتبار استفاده کن.`);setNewCustomer({businessName:'',ownerName:'',phone:'',email:'',password:'',country:'Afghanistan',city:''});setPage(1);load()}
    catch(e:any){setError(e.message)}finally{setBusy(false)}
  }
  return <><PageHeader title="مشتریان" sub="حساب‌های واقعی ورود به سیستم رهنمای معاملات، دستگاه‌ها و اعتبار" action={<button onClick={()=>{setError('');setCreateOpen(true)}} className="inline-flex items-center gap-2 rounded-xl bg-blue-600 px-4 py-2.5 text-xs font-bold text-white hover:bg-blue-700"><Plus size={16}/>ثبت مشتری جدید</button>}/>
    <div className="mb-4 rounded-xl border border-blue-100 bg-blue-50 p-3 text-xs leading-6 text-blue-800">«شرکت‌ها» فهرست معرفی شرکت‌هاست؛ ثبت دستی در آن بخش **حساب ورود مشتری نمی‌سازد**. مشتری را از همین‌جا ثبت کن، سپس پس از ورود او، دستگاه و مدت اعتبار را تنظیم کن.</div>
    {created&&<div className="mb-4 rounded-lg border border-emerald-200 bg-emerald-50 p-3 text-sm text-emerald-800">{created}</div>}
    <div className="relative mb-4"><Search size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400"/><input value={q} onChange={e=>{setQ(e.target.value);setPage(1)}} placeholder="جستجوی شرکت، مسئول، ایمیل یا شماره تماس..." className="h-10 w-full rounded-lg border border-slate-200 bg-white pl-9 pr-3 text-sm outline-none focus:border-slate-500"/></div>
    {error&&<div className="mb-4 rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-700">{error}</div>}
    <PaginatedTable<any> page={page} total={total} rows={rows} loading={loading} onPageChange={setPage} columns={[
      {key:'name',title:'نام شرکت',render:r=><div><b>{pretty(r.businessName||r.business_name||r.profileName||r.ownerName)}</b><div className="text-xs text-slate-500">{pretty(r.email)}</div></div>},
      {key:'owner',title:'مسئول',render:r=>pretty(r.ownerName||r.owner_name)},
      {key:'phone',title:'تماس',render:r=>pretty(r.phone)},
      {key:'devices',title:'دستگاه‌ها',render:r=><div><b>{pretty(r.deviceCount||0)}</b><div className="text-[10px] text-slate-500">{r.activeDeviceCount||0} active · {r.blockedDeviceCount||0} blocked</div></div>},
      {key:'status',title:'وضعیت',render:r=>badge(r.accountStatus||'ACTIVE')},
      {key:'seen',title:'آخرین فعالیت',render:r=>dateText(r.lastSeenAt)},
      {key:'actions',title:'عملیات',render:r=>{const blocked=String(r.accountStatus||'').toUpperCase()==='BLOCKED';return <div className="flex flex-wrap gap-2"><button onClick={()=>adminNavigate(`/admin/customers/${encodeURIComponent(r.id)}`)} className="rounded-lg border border-blue-200 px-2 py-1 text-[11px] font-semibold text-blue-700">پروفایل</button><button onClick={()=>open(r,'grant')} className="rounded-lg border border-slate-200 px-2 py-1 text-[11px] font-semibold">تمدید اعتبار</button><button onClick={()=>open(r,blocked?'unblock':'block')} className={`rounded-lg border px-2 py-1 text-[11px] font-semibold ${blocked?'border-emerald-200 text-emerald-700':'border-red-200 text-red-700'}`}>{blocked?'رفع بلاک':'بلاک'}</button></div>}},
      {key:'created',title:'تاریخ ثبت',render:r=>dateText(r.createdAt||r.created_at)},
    ]}/>
    <AdminModal open={createOpen} title="ثبت حساب جدید مشتری" confirmLabel="ساخت حساب مشتری" busy={busy} onClose={()=>{if(!busy)setCreateOpen(false)}} onConfirm={createCustomer}>
      <p className="mb-3 rounded-lg bg-slate-50 p-3 text-xs leading-6 text-slate-700">این فورم یک حساب واقعی با ایمیل و پسورد می‌سازد. دستگاه فقط هنگام ورود مشتری از موبایل یا کمپیوتر خودش ثبت می‌شود. در زمان ثبت، دیموی پیش‌فرض که در «تنظیمات ادمین» مشخص کرده‌ای، خودکار فعال می‌شود. پس از ختم مدت، دسترسی قطع می‌گردد مگر لایسنس معتبر داشته باشد.</p>
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">{([
        ['businessName','نام شرکت *'],['ownerName','نام مسئول *'],['phone','شماره تماس *'],['email','ایمیل ورود *'],['password','پسورد مشتری (حداقل ۸ کاراکتر) *'],['country','کشور'],['city','شهر']
      ] as const).map(([key,label])=><label key={key} className="text-xs font-semibold text-slate-600">{label}<input type={key==='password'?'password':key==='email'?'email':'text'} autoComplete="off" value={newCustomer[key]} onChange={e=>setNewCustomer(v=>({...v,[key]:e.target.value}))} className="mt-1 h-10 w-full rounded-lg border border-slate-200 px-3 text-sm outline-none focus:border-blue-500"/></label>)}</div>
    </AdminModal>
    <AdminModal open={!!action} title={action?.kind==='grant'?'تمدید اعتبار مشتری':action?.kind==='block'?'بلاک حساب مشتری':'رفع بلاک مشتری'} confirmLabel={action?.kind==='grant'?'تمدید اعتبار':action?.kind==='block'?'بلاک حساب':'رفع بلاک'} danger={action?.kind==='block'} busy={busy} onClose={()=>setAction(null)} onConfirm={submit}>
      {action?.kind==='grant'&&<div className="grid grid-cols-2 gap-3"><label className="text-xs font-semibold text-slate-600">مدت<input type="number" min="1" value={value} onChange={e=>setValue(Math.max(1,Number(e.target.value)||1))} className="mt-1 h-10 w-full rounded-lg border border-slate-200 px-3 outline-none focus:border-slate-500"/></label><label className="text-xs font-semibold text-slate-600">واحد<div className="mt-1"><SmoothSelect value={unit} onChange={setUnit} options={[{value:'DAY',label:'روز'},{value:'MONTH',label:'ماه'},{value:'YEAR',label:'سال'}]} ariaLabel="Unit"/></div></label></div>}
      <label className="block text-xs font-semibold text-slate-600">{action?.kind==='grant'?'یادداشت (اختیاری)':action?.kind==='block'?'دلیل':'دلیل (اختیاری)'}<textarea rows={3} value={reason} onChange={e=>setReason(e.target.value)} className="mt-1 w-full resize-none rounded-lg border border-slate-200 px-3 py-2 text-sm outline-none focus:border-slate-500"/></label>
    </AdminModal>
  </>
}
