import { Home, Settings, Trash2, ShieldCheck, Building2, Users, FileText, Wallet, BarChart3, ChevronLeft, ChevronRight } from 'lucide-react'
import { useEffect, useState } from 'react'
import type { Language } from '../i18n'
import { BRAND_NAME, BRAND_DARI, BRAND_PASHTO } from '../branding'
export const items = [[Home,'Dashboard','dashboard'],[Building2,'Properties','properties'],[Users,'Customers','persons'],[FileText,'Deals','deals'],[Wallet,'Accounting','accounting'],[BarChart3,'Reports','reports'],[Trash2,'Recycle Bin','recycle'],[Settings,'Settings','settings'],[ShieldCheck,'Admin','admin']] as const
export type Page = (typeof items)[number][2]
type Props={activePage:Page;collapsed:boolean;isOpen:boolean;isRtl:boolean;language:Language;onClose:()=>void;onToggleCollapse:()=>void;onNavigate:(page:Page)=>void}
const names:Record<Language,Record<Page,string>>={
 'دری':{dashboard:'داشبورد',properties:'جایدادها',persons:'مشتریان',deals:'معاملات',accounting:'حسابداری',reports:'گزارش‌ها',recycle:'سطل زباله',settings:'تنظیمات',admin:'ادمین'},
 'پښتو':{dashboard:'ډشبورډ',properties:'ملکیتونه',persons:'پېرودونکي',deals:'معاملې',accounting:'حسابداري',reports:'راپورونه',recycle:'کثافات',settings:'تنظیمات',admin:'اډمین'},
 'English':{dashboard:'Dashboard',properties:'Properties',persons:'Customers',deals:'Deals',accounting:'Accounting',reports:'Reports',recycle:'Recycle Bin',settings:'Settings',admin:'Admin'}
}
export default function Sidebar({activePage,collapsed,isOpen,isRtl,language,onClose,onToggleCollapse,onNavigate}:Props){
 const [logo,setLogo]=useState(()=>{try{return JSON.parse(localStorage.getItem('settings')||'{}')?.logo||''}catch{return ''}})
 useEffect(()=>{const load=()=>{try{setLogo(JSON.parse(localStorage.getItem('settings')||'{}')?.logo||'')}catch{setLogo('')}};window.addEventListener('app-settings-updated',load);return()=>window.removeEventListener('app-settings-updated',load)},[])
 return <>
 {isOpen&&<button onClick={onClose} aria-label="بستن منو" className="fixed inset-0 z-40 bg-black/50 lg:hidden"/>}
 <aside className={`fixed inset-y-0 z-50 flex w-[228px] flex-col estate-sidebar transition-[width,transform] duration-300 lg:z-40 lg:translate-x-0 ${collapsed?'lg:w-[68px]':''} ${isRtl?'right-0':'left-0'} ${isOpen?'translate-x-0':isRtl?'translate-x-full':'-translate-x-full'}`}>
 <div className="flex h-[72px] items-center gap-3 border-b estate-side-border px-3"><div className="grid h-10 w-10 shrink-0 place-items-center rounded-xl estate-side-logo">{logo?<img src={logo} alt="" className="h-full w-full rounded-xl object-cover"/>:<Building2 size={22}/>}</div><div className={collapsed?'lg:hidden':''}><strong className="block text-[11px] leading-snug break-words">{language==='English'?BRAND_NAME:language==='پښتو'?BRAND_PASHTO:BRAND_DARI}</strong><div className="text-[10px] estate-side-muted">{language==='English'?'Office Management':language==='پښتو'?'د دفتر مدیریت':'مدیریت دفتر'}</div></div></div>
 <button onClick={onToggleCollapse} aria-label="جمع کردن منو" className="mx-3 mt-3 hidden justify-center rounded-lg border estate-side-border p-2 estate-side-muted lg:flex">{collapsed?<ChevronRight size={17}/>:<ChevronLeft size={17}/>}</button>
 <nav className="flex-1 space-y-1 overflow-y-auto px-3 py-5">{items.map(([Icon,,key])=><button key={key} onClick={()=>{onClose();if(key==='admin'){window.location.href='/admin'}else onNavigate(key)}} title={names[language][key]} className={`flex h-11 w-full items-center gap-3 rounded-xl px-3 text-sm font-semibold transition-colors ${activePage===key?'estate-side-active':'estate-side-inactive'}`}><Icon size={19}/><span className={collapsed?'lg:hidden':''}>{names[language][key]}</span></button>)}</nav>
 <div className="border-t estate-side-border p-3 text-xs estate-side-muted">{collapsed?'':BRAND_NAME}</div>
 </aside></>
}
