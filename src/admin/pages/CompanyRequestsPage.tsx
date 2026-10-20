import { useEffect, useState } from 'react'
import { Check, Plus, X } from 'lucide-react'
import { adminGet, adminPost, endpoints, normalizePage } from '../adminApi'
import AdminModal from '../components/AdminModal'
import PaginatedTable from '../components/PaginatedTable'
import { PageHeader, dateText, pretty } from './shared'

type ManualCompanyForm = {
  companyName:string
  email:string
  phone:string
  website:string
  country:string
  city:string
  description:string
  logo:string
}

const emptyManualCompany:ManualCompanyForm={companyName:'',email:'',phone:'',website:'',country:'',city:'',description:'',logo:''}

function sourceBadge(row:any){
  const mode=String(row.entryMode||row.registrationSource||'DYNAMIC').toUpperCase()==='MANUAL'?'MANUAL':'DYNAMIC'
  return <span className={`rounded-full px-2 py-1 text-[10px] font-bold ${mode==='MANUAL'?'bg-violet-50 text-violet-700':'bg-sky-50 text-sky-700'}`}>{mode==='MANUAL'?'Manual':'Dynamic'}</span>
}

export default function CompanyRequestsPage(){
  const [rows,setRows]=useState<any[]>([]);const [page,setPage]=useState(1);const [total,setTotal]=useState(0);const [loading,setLoading]=useState(true);const [error,setError]=useState('');const [success,setSuccess]=useState('')
  const [rejectId,setRejectId]=useState('');const [note,setNote]=useState('');const [busy,setBusy]=useState(false)
  const [addOpen,setAddOpen]=useState(false);const [manual,setManual]=useState<ManualCompanyForm>(emptyManualCompany)
  const load=()=>{setLoading(true);adminGet(`${endpoints.companyRequests}?page=${page}&pageSize=20&status=${encodeURIComponent(new URLSearchParams(window.location.search).get('status')||'PENDING')}`).then(d=>{const r=normalizePage(d,page,20);setRows(r.rows);setTotal(r.total);setError('')}).catch((e:any)=>setError(e.message)).finally(()=>setLoading(false))}
  useEffect(load,[page])
  const approve=async(id:string)=>{setBusy(true);try{await adminPost(`/api/admin/company-registration-requests/${encodeURIComponent(id)}/approve`,{});load()}catch(e:any){setError(e.message)}finally{setBusy(false)}}
  const reject=async()=>{if(!rejectId||!note.trim())return;setBusy(true);try{await adminPost(`/api/admin/company-registration-requests/${encodeURIComponent(rejectId)}/reject`,{note:note.trim()});setRejectId('');setNote('');load()}catch(e:any){setError(e.message)}finally{setBusy(false)}}
  const addManual=async()=>{
    if(!manual.companyName.trim()||!manual.email.trim()||!manual.phone.trim()){setError('Company name, email and phone are required.');return}
    setBusy(true);setError('');setSuccess('')
    try{
      await adminPost(endpoints.companyRequests,{...manual,entryMode:'MANUAL'})
      setAddOpen(false);setManual(emptyManualCompany);setSuccess('شرکت در فهرست شرکت‌ها ثبت شد. برای ساخت حساب ورود، بخش مشتریان را باز کن.');load()
    }catch(e:any){setError(e.message)}finally{setBusy(false)}
  }
  const fieldClass='mt-1 h-10 w-full rounded-lg border border-slate-200 px-3 text-sm outline-none focus:border-slate-500'
  return <>
    <PageHeader title="درخواست‌های ثبت شرکت" sub="تأیید درخواست‌های ثبت و افزودن شرکت به فهرست؛ جدا از حساب ورود مشتری" action={<button onClick={()=>{setManual(emptyManualCompany);setError('');setSuccess('');setAddOpen(true)}} className="inline-flex h-10 items-center gap-2 rounded-lg bg-slate-900 px-4 text-xs font-bold text-white hover:bg-slate-800"><Plus size={15}/>افزودن شرکت به فهرست</button>}/>
    {error&&<div className="mb-4 rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-700">{error}</div>}
    {success&&<div className="mb-4 rounded-lg border border-emerald-200 bg-emerald-50 p-3 text-sm text-emerald-700">{success}</div>}
    <PaginatedTable<any> page={page} total={total} rows={rows} loading={loading} onPageChange={setPage} columns={[
      {key:'company',title:'Company',render:r=><div><b>{pretty(r.companyName||r.company_name)}</b><div className="text-xs text-slate-500">{pretty(r.email)}</div></div>},
      {key:'source',title:'Source',render:r=>sourceBadge(r)},
      {key:'phone',title:'Phone',render:r=>pretty(r.phone)},
      {key:'date',title:'Submitted',render:r=>dateText(r.submittedAt||r.submitted_at)},
      {key:'actions',title:'Actions',render:r=><div className="flex gap-2"><button disabled={busy} onClick={()=>approve(String(r.id))} className="grid h-8 w-8 place-items-center rounded-lg bg-emerald-50 text-emerald-700 disabled:opacity-50"><Check size={15}/></button><button disabled={busy} onClick={()=>{setRejectId(String(r.id));setNote('')}} className="grid h-8 w-8 place-items-center rounded-lg bg-red-50 text-red-700 disabled:opacity-50"><X size={15}/></button></div>}
    ]}/>

    <AdminModal open={addOpen} title="افزودن شرکت به فهرست" confirmLabel="ثبت شرکت" busy={busy} onClose={()=>{if(!busy)setAddOpen(false)}} onConfirm={addManual}>
      <div className="rounded-lg border border-violet-100 bg-violet-50 p-3 text-xs text-violet-700">این فورم فقط شرکت را به فهرست عمومی اضافه می‌کند و <b>حساب ورود، پسورد یا لایسنس مشتری نمی‌سازد</b>. برای ایجاد حساب واقعی از بخش «مشتریان» استفاده کن.</div>
      <div className="grid grid-cols-2 gap-3">
        <label className="col-span-2 text-xs font-semibold text-slate-600">Company name *<input value={manual.companyName} onChange={e=>setManual(v=>({...v,companyName:e.target.value}))} className={fieldClass}/></label>
        <label className="text-xs font-semibold text-slate-600">Email *<input type="email" value={manual.email} onChange={e=>setManual(v=>({...v,email:e.target.value}))} className={fieldClass}/></label>
        <label className="text-xs font-semibold text-slate-600">Phone *<input value={manual.phone} onChange={e=>setManual(v=>({...v,phone:e.target.value}))} className={fieldClass}/></label>
        <label className="text-xs font-semibold text-slate-600">Country<input value={manual.country} onChange={e=>setManual(v=>({...v,country:e.target.value}))} className={fieldClass}/></label>
        <label className="text-xs font-semibold text-slate-600">City<input value={manual.city} onChange={e=>setManual(v=>({...v,city:e.target.value}))} className={fieldClass}/></label>
        <label className="col-span-2 text-xs font-semibold text-slate-600">Website<input value={manual.website} onChange={e=>setManual(v=>({...v,website:e.target.value}))} placeholder="https://example.com" className={fieldClass}/></label>
        <label className="col-span-2 text-xs font-semibold text-slate-600">Logo URL (optional)<input value={manual.logo} onChange={e=>setManual(v=>({...v,logo:e.target.value}))} placeholder="https://..." className={fieldClass}/></label>
        <label className="col-span-2 text-xs font-semibold text-slate-600">Description<textarea rows={3} value={manual.description} onChange={e=>setManual(v=>({...v,description:e.target.value}))} className="mt-1 w-full resize-none rounded-lg border border-slate-200 px-3 py-2 text-sm outline-none focus:border-slate-500"/></label>
      </div>
    </AdminModal>

    <AdminModal open={!!rejectId} title="Reject company request" confirmLabel="Reject" danger busy={busy} onClose={()=>{setRejectId('');setNote('')}} onConfirm={reject}><label className="block text-xs font-semibold text-slate-600">Reason<textarea value={note} onChange={e=>setNote(e.target.value)} rows={4} autoFocus className="mt-1 w-full resize-none rounded-lg border border-slate-200 px-3 py-2 text-sm outline-none focus:border-slate-500" placeholder="Write the rejection reason…"/></label>{!note.trim()&&<p className="text-xs text-slate-400">A reason is required.</p>}</AdminModal>
  </>
}
