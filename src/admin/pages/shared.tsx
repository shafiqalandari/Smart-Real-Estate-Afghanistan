import { formatAppDateTime } from '../../utils/dateCalendar'
import { useEffect, useMemo, useState, type ReactNode } from 'react'
import { Search } from 'lucide-react'
import PaginatedTable, { type Column } from '../components/PaginatedTable'
import useDebouncedValue from '../hooks/useDebouncedValue'
import { fetchPaged } from '../adminApi'
export const pretty=(v:any)=> v===null||v===undefined||v===''?'—': typeof v==='boolean'?(v?'Yes':'No'): typeof v==='number'?v.toLocaleString():String(v)
export const dateText=(v:any)=>v?formatAppDateTime(v):'—'
export const badge=(value:any)=>{const s=String(value||'UNKNOWN'); const good=/ACTIVE|APPROVED|PAID|ALLOWED|AVAILABLE/i.test(s); const bad=/BLOCK|REJECT|EXPIRE|FAILED/i.test(s); return <span className={`rounded-full px-2 py-1 text-[10px] font-bold ${good?'bg-emerald-50 text-emerald-700':bad?'bg-red-50 text-red-700':'bg-amber-50 text-amber-700'}`}>{s}</span>}
export const shortDeviceName=(value:any)=>{const s=String(value||'').trim();if(!s)return'Browser';if(/firefox|fxios/i.test(s))return'Firefox';if(/edg\//i.test(s))return'Edge';if(/chrome|crios|chromium/i.test(s))return'Chrome';if(/safari/i.test(s))return'Safari';if(/iphone/i.test(s))return'iPhone';if(/ipad/i.test(s))return'iPad';if(/android/i.test(s))return'Android';return s.split(/[(/;]/)[0].trim().slice(0,32)||'Browser'}
export function PageHeader({title,sub,action}:{title:string;sub?:string;action?:ReactNode}){return <div className="mb-5 flex flex-wrap items-start justify-between gap-3"><div><h1 className="text-2xl font-extrabold tracking-tight">{title}</h1>{sub&&<p className="mt-1 text-sm text-slate-500">{sub}</p>}</div>{action}</div>}
export function ResourcePage<T extends {id?:string|number}>({title,sub,path,columns,params={},transform,toolbar}:{title:string;sub?:string;path:string;columns:Column<T>[];params?:Record<string,string|number|undefined>;transform?:(rows:any[])=>T[];toolbar?:ReactNode}){
 const [q,setQ]=useState(''); const dq=useDebouncedValue(q,300); const [page,setPage]=useState(1); const [state,setState]=useState({rows:[] as T[],total:0,loading:true,error:''});
 const stable=useMemo(()=>JSON.stringify(params),[params]);
 const urlParams=useMemo(()=>{const query=new URLSearchParams(window.location.search);return Object.fromEntries(['status','filter','date'].flatMap(key=>query.has(key)?[[key,query.get(key)!]]:[]))},[path]);
 useEffect(()=>{let alive=true;setState(s=>({...s,loading:true,error:''}));fetchPaged<any>(path,{...urlParams,...params,q:dq},page,20).then(r=>{if(alive)setState({rows:transform?transform(r.rows):r.rows,total:r.total,loading:false,error:''})}).catch((e:any)=>{if(alive)setState({rows:[],total:0,loading:false,error:e?.message||'Unable to load data.'})});return()=>{alive=false}},[path,dq,page,stable]);
 return <><PageHeader title={title} sub={sub} action={toolbar}/><div className="mb-4 flex gap-3"><div className="relative min-w-0 flex-1"><Search size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400"/><input value={q} onChange={e=>{setQ(e.target.value);setPage(1)}} placeholder="Search…" className="h-10 w-full rounded-lg border border-slate-200 bg-white pl-9 pr-3 text-sm outline-none focus:border-slate-500"/></div></div>{state.error&&<div className="mb-4 rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-700">{state.error}</div>}<PaginatedTable rows={state.rows} columns={columns} loading={state.loading} page={page} total={state.total} onPageChange={setPage}/></>
}
