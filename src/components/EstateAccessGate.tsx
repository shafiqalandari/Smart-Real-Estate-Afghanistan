import { useEffect, useState, type ReactNode, type FormEvent } from 'react'
import { Building2, Eye, EyeOff, LogIn, RefreshCcw, ShieldAlert, UserPlus, Landmark, Handshake, BarChart3, Globe2, ShieldCheck } from 'lucide-react'
import SimpleLoader from './SimpleLoader'
import type { Language } from '../i18n'
import { BRAND_NAME, BRAND_DARI, BRAND_PASHTO } from '../branding'
import {
  clearCustomerInstallationSession,
  getOfflineAccessDecision,
  hasInstallationToken,
  retryCustomerAccess,
  signInCustomerAccount,
  signUpCustomerAccount,
  syncCustomerAccess,
  type CustomerAccessSnapshot,
  type CustomerRegistrationProfile,
} from '../utils/centralSubscription'
import './estate-login.css'

type GateState = 'loading' | 'auth' | 'allowed' | 'blocked' | 'suspended' | 'pending' | 'rejected' | 'expired' | 'offline'
const languageNow = ():Language => {
  const v=localStorage.getItem('app-language') as Language|null
  return v==='English'||v==='پښتو'||v==='دری'?v:'دری'
}
const stateFrom=(a:CustomerAccessSnapshot|null):GateState => {
  if(!a) return 'auth'
  const s=String(a.accessStatus||'').toUpperCase()
  if(s.includes('BLOCKED')) return 'blocked'
  if(s.includes('SUSPENDED')) return 'suspended'
  if(s.includes('DEVICE_PENDING')||String(a.deviceApprovalStatus||'').toUpperCase()==='PENDING') return 'pending'
  if(s.includes('DEVICE_REJECTED')||String(a.deviceApprovalStatus||'').toUpperCase()==='REJECTED') return 'rejected'
  return a.allowed?'allowed':'expired'
}
const copy={
  English:{brand:BRAND_NAME,eyebrow:'PROPERTY & RENTAL MANAGEMENT',intro:'A simple, reliable workspace for real estate offices.',desc:'Manage properties, owners, customers, sales, rentals, deals and commissions in one place.',feature1:'Property records',feature2:'Deals & commissions',feature3:'Clear reports',welcome:'Welcome back',hint:'Sign in to manage your office.',signin:'Sign in',signup:'Create office account',email:'Email address',password:'Password',confirm:'Confirm password',company:'Real estate office name',owner:'Responsible person',phone:'Phone number',create:'Create account and register device',login:'Sign in to office',required:'Please complete all required fields.',mismatch:'Passwords do not match.',short:'Password must be at least 8 characters.',blocked:'Access blocked',blockedSub:'Access to your office has been blocked by the administrator.',suspended:'Account suspended',suspendedSub:'Your office account is temporarily suspended.',pending:'Device approval required',pendingSub:'This device is waiting for approval.',rejected:'Device rejected',rejectedSub:'This device was not approved.',expired:'Subscription expired',expiredSub:'Your office subscription has expired. Open Subscriptions to renew.',offline:'Central server unavailable',offlineSub:'No valid offline access is available for this device.',retry:'Retry',subscription:'Subscriptions',logout:'Use another account',language:'Language',show:'Show password',hide:'Hide password',secure:'Protected office access'},
  پښتو:{brand:BRAND_PASHTO,eyebrow:'د جایدادونو او کرایې مدیریت',intro:'د رهنمای معاملاتو دفتر لپاره ساده او منظم سیستم',desc:'جایدادونه، مشتریان، پلور، کرایه، معاملې او کمیشنونه په یوه ځای کې مدیریت کړئ.',feature1:'د جایدادونو ثبت',feature2:'معاملې او کمیشن',feature3:'مالي راپورونه',welcome:'ښه راغلاست',hint:'د دفتر حساب ته ننوځئ.',signin:'ننوتل',signup:'د دفتر حساب جوړول',email:'ایمیل',password:'پټ نوم',confirm:'پټ نوم تایید',company:'د رهنمای معاملاتو دفتر نوم',owner:'مسؤول شخص',phone:'د اړیکې شمېره',create:'حساب او وسیله ثبتول',login:'دفتر ته ننوتل',required:'ضروري معلومات بشپړ کړئ.',mismatch:'پټ نومونه یو شان نه دي.',short:'پټ نوم باید لږ تر لږه ۸ توري ولري.',blocked:'لاسرسی بند شوی',blockedSub:'ستاسو د دفتر لاسرسی د ادمین لخوا بند شوی.',suspended:'حساب ځنډول شوی',suspendedSub:'ستاسو د دفتر حساب موقتاً ځنډول شوی.',pending:'د وسیلې تایید ته اړتیا ده',pendingSub:'دا وسیله د تایید په تمه ده.',rejected:'وسیله رد شوه',rejectedSub:'دا وسیله تایید نه شوه.',expired:'اشتراک ختم شوی',expiredSub:'ستاسو د دفتر اشتراک ختم شوی. د نوي کولو لپاره اشتراک خلاص کړئ.',offline:'مرکزي سرور ته لاسرسی نشته',offlineSub:'د دې وسیلې لپاره معتبر آفلاین لاسرسی نشته.',retry:'بیا هڅه',subscription:'اشتراکونه',logout:'بل حساب وکاروئ',language:'ژبه',show:'پټ نوم ښکاره کول',hide:'پټ نوم پټول',secure:'ستاسو د دفتر خوندي حساب'},
  دری:{brand:BRAND_DARI,eyebrow:'مدیریت جایدادها و کرایی',intro:'یک سیستم ساده برای دفتر رهنمای معاملات شما',desc:'جایدادها، مالکین، مشتریان، خریدوفروش، کرایه، معاملات و کمیشن را از یک جای مدیریت کنید.',feature1:'ثبت جایدادها',feature2:'معاملات و کمیشن',feature3:'گزارش‌های مالی',welcome:'خوش آمدید',hint:'برای مدیریت دفتر وارد حساب شوید.',signin:'ورود به حساب',signup:'ایجاد حساب دفتر',email:'ایمیل',password:'رمز ورود',confirm:'تکرار رمز',company:'نام دفتر رهنمای معاملات',owner:'نام مسئول دفتر',phone:'شماره تماس',create:'ساخت حساب و ثبت دستگاه',login:'ورود به سیستم',required:'معلومات ضروری را تکمیل کنید.',mismatch:'رمزها یکسان نیستند.',short:'رمز باید حداقل ۸ کاراکتر باشد.',blocked:'دسترسی مسدود شده',blockedSub:'ادمین دسترسی دفتر شما را مسدود کرده است.',suspended:'حساب تعلیق شده',suspendedSub:'حساب دفتر شما موقتاً تعلیق شده است.',pending:'تأیید دستگاه ضروری است',pendingSub:'این دستگاه منتظر تأیید ادمین است.',rejected:'دستگاه رد شده',rejectedSub:'این دستگاه تأیید نشده است.',expired:'اشتراک ختم شده',expiredSub:'اعتبار اشتراک دفتر شما ختم شده است. برای تمدید، بخش اشتراک را باز کنید.',offline:'سرور مرکزی در دسترس نیست',offlineSub:'این دستگاه دسترسی آفلاین معتبر ندارد.',retry:'تلاش دوباره',subscription:'اشتراک‌ها',logout:'استفاده از حساب دیگر',language:'زبان',show:'نمایش رمز',hide:'پنهان کردن رمز',secure:'ورود مصون به حساب دفتر'}
} as const
function Auth({lang,onDone,onLanguageChange}:{lang:Language;onDone:(a:CustomerAccessSnapshot)=>void;onLanguageChange:(l:Language)=>void}){
 const t=copy[lang],rtl=lang!=='English'
 const [mode,setMode]=useState<'signin'|'signup'>('signin')
 const [email,setEmail]=useState(''),[password,setPassword]=useState(''),[confirm,setConfirm]=useState('')
 const [show,setShow]=useState(false),[busy,setBusy]=useState(false),[error,setError]=useState('')
 const [profile,setProfile]=useState<CustomerRegistrationProfile>({businessName:'',ownerName:'',phone:'',email:'',whatsapp:'',country:'Afghanistan',city:'',address:'',businessType:'Real Estate Agency',licenseNumber:''})
 const submit=async(e?:FormEvent)=>{
  e?.preventDefault();if(busy)return;setError('')
  const em=(mode==='signin'?email:profile.email).trim().toLowerCase()
  if(!/^\S+@\S+\.\S+$/.test(em)||!password||(mode==='signup'&&(!profile.businessName.trim()||!profile.ownerName.trim()||!profile.phone.trim()))){setError(t.required);return}
  if(password.length<8){setError(t.short);return}
  if(mode==='signup'&&password!==confirm){setError(t.mismatch);return}
  setBusy(true)
  try{const a=mode==='signup'?await signUpCustomerAccount({...profile,email:em},password):await signInCustomerAccount(em,password);onDone(a)}
  catch(e:any){setError(e?.message||t.retry)}finally{setBusy(false)}
 }
 return <main className="estate-login" dir={rtl?'rtl':'ltr'}>
  <div className="estate-login-glow estate-login-glow-one"/><div className="estate-login-glow estate-login-glow-two"/>
  <div className="estate-login-layout">
   <section className="estate-login-story">
    <div className="estate-login-brand"><span className="estate-login-brand-mark"><Building2 size={25}/></span><span>{BRAND_NAME}</span></div>
    <p className="estate-login-eyebrow">{t.eyebrow}</p>
    <h1>{t.intro}</h1><p className="estate-login-desc">{t.desc}</p>
    <div className="estate-login-feature-grid"><span><Landmark size={18}/>{t.feature1}</span><span><Handshake size={18}/>{t.feature2}</span><span><BarChart3 size={18}/>{t.feature3}</span></div>
    <div className="estate-login-illustration" aria-hidden="true"><div className="estate-login-illustration-ring"/><Building2 size={96} strokeWidth={1.2}/></div>
    <p className="estate-login-signature">{BRAND_NAME}</p>
   </section>
   <section className="estate-login-form-pane">
    <form onSubmit={submit} className="estate-login-card">
     <div className="estate-login-card-header"><span className="estate-login-badge"><Building2 size={21}/></span><label className="estate-login-language"><Globe2 size={16}/><span className="sr-only">{t.language}</span><select aria-label={t.language} value={lang} onChange={e=>onLanguageChange(e.target.value as Language)}><option value="دری">دری</option><option value="پښتو">پښتو</option><option value="English">English</option></select></label></div>
     <p className="estate-login-mobile-name">{t.brand}</p>
     <h2>{t.welcome}</h2><p className="estate-login-hint">{t.hint}</p>
     <div className="estate-login-tabs"><button type="button" className={mode==='signin'?'active':''} onClick={()=>{setMode('signin');setError('')}}>{t.signin}</button><button type="button" className={mode==='signup'?'active':''} onClick={()=>{setMode('signup');setError('')}}>{t.signup}</button></div>
     {error&&<div role="alert" className="estate-login-error">{error}</div>}
     <div className="estate-login-fields">
      {mode==='signup'&&<><label>{t.company}<input autoComplete="organization" value={profile.businessName} onChange={e=>setProfile(p=>({...p,businessName:e.target.value}))} required/></label><label>{t.owner}<input autoComplete="name" value={profile.ownerName} onChange={e=>setProfile(p=>({...p,ownerName:e.target.value}))} required/></label><label>{t.phone}<input autoComplete="tel" type="tel" value={profile.phone} onChange={e=>setProfile(p=>({...p,phone:e.target.value}))} required/></label></>}
      <label>{t.email}<input type="email" autoComplete="email" value={mode==='signup'?profile.email:email} onChange={e=>mode==='signup'?setProfile(p=>({...p,email:e.target.value})):setEmail(e.target.value)} required/></label>
      <label className="estate-login-wide">{t.password}<span className="estate-login-password"><input type={show?'text':'password'} autoComplete={mode==='signin'?'current-password':'new-password'} value={password} onChange={e=>setPassword(e.target.value)} required minLength={8}/><button type="button" onClick={()=>setShow(v=>!v)} aria-label={show?t.hide:t.show}>{show?<EyeOff size={19}/>:<Eye size={19}/>}</button></span></label>
      {mode==='signup'&&<label className="estate-login-wide">{t.confirm}<input type="password" autoComplete="new-password" value={confirm} onChange={e=>setConfirm(e.target.value)} required minLength={8}/></label>}
     </div>
     <button type="submit" className="estate-login-submit" disabled={busy}>{busy?<RefreshCcw className="animate-spin" size={17}/>:mode==='signup'?<UserPlus size={18}/>:<LogIn size={18}/>} {mode==='signup'?t.create:t.login}</button>
     <p className="estate-login-trust"><ShieldCheck size={15}/>{t.secure}</p>
    </form>
   </section>
  </div>
 </main>
}
function AccessMessage({state,access,onRetry}:{state:GateState;access:CustomerAccessSnapshot|null;onRetry:()=>void}){
 const lang=languageNow(),t=copy[lang],rtl=lang!=='English'
 const map:any={blocked:[t.blocked,access?.blockReason||t.blockedSub],suspended:[t.suspended,access?.blockReason||t.suspendedSub],pending:[t.pending,t.pendingSub],rejected:[t.rejected,t.rejectedSub],expired:[t.expired,t.expiredSub],offline:[t.offline,t.offlineSub]}
 const [title,desc]=map[state]||[t.offline,t.offlineSub]
 return <div className="fixed inset-0 z-[400] grid place-items-center bg-[#07111f] p-4" dir={rtl?'rtl':'ltr'}><div className="w-full max-w-md rounded-3xl bg-white p-7 text-center shadow-2xl"><div className="mx-auto grid h-14 w-14 place-items-center rounded-2xl bg-amber-50 text-amber-600"><ShieldAlert size={28}/></div><p className="mt-4 text-xs font-bold text-amber-700">{t.brand}</p><h2 className="mt-3 text-xl font-black">{title}</h2><p className="mt-2 text-sm leading-6 text-slate-500">{desc}</p><div className="mt-5 flex gap-2"><button onClick={onRetry} className="inline-flex h-10 flex-1 items-center justify-center gap-2 rounded-xl bg-slate-900 text-sm font-bold text-white"><RefreshCcw size={15}/>{t.retry}</button>{state==='expired'&&<button onClick={()=>location.href='/subscription'} className="h-10 flex-1 rounded-xl border border-slate-200 text-sm font-bold">{t.subscription}</button>}</div><button onClick={()=>{clearCustomerInstallationSession();location.reload()}} className="mt-3 text-xs font-bold text-slate-400 hover:text-slate-700">{t.logout}</button></div></div>
}
export default function EstateAccessGate({children}:{children:ReactNode}){
 const enabled=String(import.meta.env.VITE_CENTRAL_ACCESS_ENABLED??'true')!=='false'
 const [state,setState]=useState<GateState>(enabled?'loading':'allowed')
 const [access,setAccess]=useState<CustomerAccessSnapshot|null>(null)
 const [lang,setLang]=useState<Language>(languageNow())
 const check=async(silent=false)=>{
  setLang(languageNow());if(!hasInstallationToken()){setState('auth');setAccess(null);return}
  if(!silent)setState('loading')
  try{const a=await syncCustomerAccess();setAccess(a);setState(stateFrom(a))}
  catch(e:any){if(e?.status===401){clearCustomerInstallationSession();setState('auth');return}const d=getOfflineAccessDecision();if(d.allowed&&d.snapshot){setAccess(d.snapshot);setState(stateFrom(d.snapshot));return}setAccess(d.snapshot);setState(d.reason==='expired'?'expired':'offline')}
 }
 useEffect(()=>{if(!enabled)return;void check();const f=()=>document.visibilityState==='visible'&&void check(true);const i=window.setInterval(f,30000);window.addEventListener('focus',f);window.addEventListener('online',f);return()=>{clearInterval(i);window.removeEventListener('focus',f);window.removeEventListener('online',f)}},[enabled])
 const updateLanguage=(v:Language)=>{setLang(v);localStorage.setItem('app-language',v);document.documentElement.lang=v==='English'?'en':v==='پښتو'?'ps':'fa';document.documentElement.dir=v==='English'?'ltr':'rtl';window.dispatchEvent(new CustomEvent('app-language-change'))}
 if(!enabled||state==='allowed')return <>{children}</>
 if(state==='loading')return <SimpleLoader fullScreen label={lang==='English'?BRAND_NAME:lang==='پښتو'?BRAND_PASHTO:BRAND_DARI}/>
 if(state==='auth')return <Auth lang={lang} onLanguageChange={updateLanguage} onDone={a=>{setAccess(a);setState(stateFrom(a))}}/>
 return <AccessMessage state={state} access={access} onRetry={()=>void retryCustomerAccess().then(a=>{setAccess(a);setState(stateFrom(a))}).catch(()=>void check())}/>
}
