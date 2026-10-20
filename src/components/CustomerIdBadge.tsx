import { Copy, Check } from 'lucide-react'
import { useState } from 'react'
const ACCESS_CACHE_KEY='safarpro-access-cache-v2'
function cachedId(){try{const p=JSON.parse(localStorage.getItem(ACCESS_CACHE_KEY)||'null');return String(p?.snapshot?.smartOfficeId||'')}catch{return''}}
export default function CustomerIdBadge({smartOfficeId}:{smartOfficeId?:string}){const[id]=useState(()=>smartOfficeId||cachedId());const[copied,setCopied]=useState(false);if(!id)return null;return <button type="button" title="کود دفتر" onClick={async()=>{try{await navigator.clipboard.writeText(id);setCopied(true);setTimeout(()=>setCopied(false),1200)}catch{}}} className="inline-flex items-center gap-2 rounded-lg border border-slate-200 bg-white px-3 py-2 text-start text-xs shadow-sm dark:border-white/10 dark:bg-white/5"><span><span className="block text-[10px] font-bold uppercase tracking-wide text-slate-400">کود دفتر</span><b>{id}</b></span>{copied?<Check size={14}/>:<Copy size={14}/>}</button>}
