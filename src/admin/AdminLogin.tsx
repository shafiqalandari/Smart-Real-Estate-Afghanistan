import { useState, type FormEvent } from 'react'
import { ShieldCheck, Building2, Eye, EyeOff, LogIn, ArrowRight } from 'lucide-react'
import { signIn } from './adminApi'
import { adminNavigate } from './adminAuth'
import { BRAND_NAME, BRAND_DARI } from '../branding'

export default function AdminLogin(){
 const [email,setEmail]=useState('')
 const [password,setPassword]=useState('')
 const [show,setShow]=useState(false)
 const [busy,setBusy]=useState(false)
 const [error,setError]=useState('')
 const submit=async(e:FormEvent)=>{
  e.preventDefault();if(busy)return
  setBusy(true);setError('')
  try{const result=await signIn(email.trim(),password);if(!result.ok){setError(result.error);return}adminNavigate('/admin')}
  finally{setBusy(false)}
 }
 return <div dir="rtl" className="relative grid min-h-screen place-items-center overflow-hidden bg-[#071325] p-3 text-slate-900 sm:p-6">
  <div className="pointer-events-none absolute -right-48 -top-48 h-[450px] w-[450px] rounded-full bg-amber-500/10 blur-3xl"/>
  <div className="pointer-events-none absolute -bottom-48 -left-48 h-[450px] w-[450px] rounded-full bg-blue-500/10 blur-3xl"/>
  <div className="relative grid w-full max-w-5xl overflow-hidden rounded-3xl border border-white/10 bg-white shadow-2xl lg:grid-cols-2">
   <aside className="hidden flex-col justify-between bg-gradient-to-br from-[#122f4a] to-[#09162a] p-10 text-white lg:flex">
    <div><div className="flex items-center gap-3"><span className="grid h-12 w-12 place-items-center rounded-2xl bg-amber-500 text-slate-950"><Building2 size={26}/></span><b className="text-sm" dir="ltr">{BRAND_NAME}</b></div><p className="mt-20 text-xs font-bold tracking-widest text-amber-400">CENTRAL MANAGEMENT</p><h1 className="mt-4 text-3xl font-black leading-relaxed">مدیریت مرکزی دفاتر رهنمای معاملات</h1><p className="mt-4 text-sm leading-8 text-slate-300">مدیریت دفاتر، پلان‌ها، اشتراک‌ها، دستگاه‌ها و دسترسی کاربران، از یک پنل مصون.</p></div>
    <p className="text-xs text-slate-400">{BRAND_DARI}</p>
   </aside>
   <main className="p-6 sm:p-10 lg:p-12">
    <div className="mx-auto flex w-full max-w-sm flex-col"><div className="grid h-14 w-14 place-items-center rounded-2xl bg-amber-50 text-amber-600"><ShieldCheck size={28}/></div>
    <p className="mt-5 text-[11px] font-extrabold text-amber-700">{BRAND_NAME}</p><h2 className="mt-2 text-2xl font-black">ورود ادمین مرکزی</h2><p className="mt-2 text-xs leading-7 text-slate-500">برای ادامه ایمیل و رمز ادمین را وارد کنید.</p>
    <form onSubmit={submit} className="mt-7 space-y-4">
     {error&&<div role="alert" className="rounded-xl border border-red-200 bg-red-50 p-3 text-xs leading-7 text-red-700">{error}</div>}
     <label className="block text-xs font-extrabold text-slate-600">ایمیل<input autoComplete="username" type="email" value={email} onChange={e=>setEmail(e.target.value)} className="mt-2 h-12 w-full rounded-xl border border-slate-200 bg-white px-3 text-sm outline-none focus:border-amber-500" required/></label>
     <label className="block text-xs font-extrabold text-slate-600">رمز ورود<span className="relative mt-2 block"><input autoComplete="current-password" type={show?'text':'password'} value={password} onChange={e=>setPassword(e.target.value)} className="h-12 w-full rounded-xl border border-slate-200 bg-white px-3 pl-12 text-sm outline-none focus:border-amber-500" required/><button type="button" onClick={()=>setShow(v=>!v)} aria-label={show?'پنهان کردن رمز':'نمایش رمز'} className="absolute inset-y-0 left-0 grid w-12 place-items-center text-slate-400">{show?<EyeOff size={18}/>:<Eye size={18}/>}</button></span></label>
     <button disabled={busy} type="submit" className="flex h-12 w-full items-center justify-center gap-2 rounded-xl bg-[#112844] text-sm font-black text-white transition hover:bg-[#1a3b60] disabled:opacity-60"><LogIn size={18}/>{busy?'در حال ورود...':'ورود به پنل ادمین'}</button>
    </form>
    <a href="/" className="mt-6 inline-flex items-center justify-center gap-2 text-xs font-bold text-slate-500 hover:text-slate-900"><ArrowRight size={16}/>بازگشت به سیستم رهنمای معاملات</a>
    </div>
   </main>
  </div>
 </div>
}
