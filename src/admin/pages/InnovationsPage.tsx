import { useState } from 'react'
import { Plus } from 'lucide-react'
import { adminPost, endpoints } from '../adminApi'
import AdminModal from '../components/AdminModal'
import { ResourcePage, badge, dateText, pretty } from './shared'

export default function InnovationsPage(){
 const [open,setOpen]=useState(false);const [busy,setBusy]=useState(false);const [refresh,setRefresh]=useState(0);const [error,setError]=useState('')
 const [form,setForm]=useState({version:'',title:'',description:'',progress:0,isPublished:true})
 const reset=()=>setForm({version:'',title:'',description:'',progress:0,isPublished:true})
 const submit=async()=>{setBusy(true);setError('');try{await adminPost(endpoints.innovations,form);setOpen(false);reset();setRefresh(x=>x+1)}catch(e:any){setError(e.message)}finally{setBusy(false)}}
 return <>{error&&<div className="mb-4 rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-700">{error}</div>}<ResourcePage<any> title="Innovations" sub="Feature ideas and innovation requests." path={endpoints.innovations} params={{refresh}} toolbar={<button onClick={()=>{reset();setOpen(true)}} className="inline-flex h-10 items-center gap-2 rounded-lg bg-slate-900 px-3 text-sm font-bold text-white"><Plus size={16}/>New innovation</button>} columns={[
  {key:'title',title:'Title',render:r=><div><b>{pretty(r.title)}</b><div className="text-xs text-slate-500">v{pretty(r.version)}</div></div>},
  {key:'description',title:'Description',render:r=><span className="line-clamp-2 max-w-xl">{pretty(r.description)}</span>},
  {key:'progress',title:'Progress',render:r=>`${Number(r.progress||0)}%`},
  {key:'status',title:'Status',render:r=>badge(r.isPublished===false?'DRAFT':(r.status||'ACTIVE'))},
  {key:'date',title:'Created',render:r=>dateText(r.createdAt||r.created_at)},
 ]}/><AdminModal open={open} title="New innovation" confirmLabel="Create innovation" busy={busy} onClose={()=>setOpen(false)} onConfirm={submit}><div className="grid gap-3"><label className="text-xs font-semibold text-slate-600">Version<input value={form.version} onChange={e=>setForm({...form,version:e.target.value})} placeholder="1.0.0" className="mt-1 h-10 w-full rounded-lg border border-slate-200 px-3 text-sm outline-none focus:border-slate-500"/></label><label className="text-xs font-semibold text-slate-600">Title<input value={form.title} onChange={e=>setForm({...form,title:e.target.value})} className="mt-1 h-10 w-full rounded-lg border border-slate-200 px-3 text-sm outline-none focus:border-slate-500"/></label><label className="text-xs font-semibold text-slate-600">Description<textarea rows={4} value={form.description} onChange={e=>setForm({...form,description:e.target.value})} className="mt-1 w-full resize-none rounded-lg border border-slate-200 px-3 py-2 text-sm outline-none focus:border-slate-500"/></label><label className="text-xs font-semibold text-slate-600">Progress<input type="number" min="0" max="100" value={form.progress} onChange={e=>setForm({...form,progress:Math.min(100,Math.max(0,Number(e.target.value)||0))})} className="mt-1 h-10 w-full rounded-lg border border-slate-200 px-3 text-sm outline-none focus:border-slate-500"/></label><label className="flex items-center gap-2 text-xs font-semibold text-slate-600"><input type="checkbox" checked={form.isPublished} onChange={e=>setForm({...form,isPublished:e.target.checked})}/>Published</label></div></AdminModal></>
}
