import { lazy, Suspense, useEffect, useState } from 'react'
import Header from './components/Header'
import Sidebar, { type Page } from './components/Sidebar'
import SimpleLoader from './components/SimpleLoader'
import { rtlLanguages, type Language } from './i18n'
import type { ThemeName } from './theme'
import type { Kind } from './realEstate'
import { isDarkTheme } from './theme'
import AutoTranslator from './components/AutoTranslator'
import PrintCenter from './PrintCenter'
import './estate-shared.css'
import { clearCustomerInstallationSession } from './utils/centralSubscription'
const Dashboard=lazy(()=>import('./pages/Dashboard'))
const RealEstate=lazy(()=>import('./pages/RealEstate'))
const RecycleEstate=lazy(()=>import('./pages/RealEstate').then(m=>({default:m.RecycleEstate})))
const Reports=lazy(()=>import('./pages/Reports'))
const Settings=lazy(()=>import('./Settings'))
export default function App(){
 const [activePage,setActivePage]=useState<Page>('dashboard')
 const [clientTab,setClientTab]=useState<'persons'|'requests'>('persons')
 const [mobileSidebarOpen,setMobileSidebarOpen]=useState(false)
 const [sidebarCollapsed,setSidebarCollapsed]=useState(()=>localStorage.getItem('app-sidebar-collapsed')==='1')
 const [theme,setTheme]=useState<ThemeName>(()=>(localStorage.getItem('app-theme') as ThemeName)||'royal')
 const [language,setLanguage]=useState<Language>(()=>(localStorage.getItem('app-language') as Language)||'دری')
 const [search,setSearch]=useState('')
 const isRtl=rtlLanguages.includes(language),isDark=isDarkTheme(theme)
 const offset=sidebarCollapsed?(isRtl?'lg:mr-[68px]':'lg:ml-[68px]'):(isRtl?'lg:mr-[228px]':'lg:ml-[228px]')
 useEffect(()=>{localStorage.setItem('app-theme',theme);localStorage.setItem('app-language',language);window.dispatchEvent(new CustomEvent('app-language-change'));document.documentElement.classList.toggle('dark',isDark);document.documentElement.dataset.theme=theme;document.documentElement.dir=isRtl?'rtl':'ltr';document.documentElement.lang=language==='English'?'en':language==='دری'?'fa':'ps'},[theme,language,isDark,isRtl])
 useEffect(()=>localStorage.setItem('app-sidebar-collapsed',sidebarCollapsed?'1':'0'),[sidebarCollapsed])
 const navigate=(p:Page)=>{setActivePage(p);setSearch('')}
 const body=activePage==='recycle'?<RecycleEstate/>:activePage==='settings'?<Settings theme={theme} onThemeChange={setTheme} language={language} onLanguageChange={setLanguage}/>:activePage==='dashboard'?<Dashboard language={language} onNavigate={navigate}/>:activePage==='persons'?<div className='space-y-4'><div className='flex flex-wrap gap-2'><button onClick={()=>setClientTab('persons')} className={'rounded-xl border px-4 py-2 text-sm '+(clientTab==='persons'?'bg-amber-500 text-black':'')}>{language==='English'?'Customers':language==='پښتو'?'پېرودونکي':'مشتریان'}</button><button onClick={()=>setClientTab('requests')} className={'rounded-xl border px-4 py-2 text-sm '+(clientTab==='requests'?'bg-amber-500 text-black':'')}>{language==='English'?'Property requests':language==='پښتو'?'د ملکیت غوښتنې':'درخواست جایداد'}</button></div><RealEstate kind={clientTab} language={language}/></div>:activePage==='reports'?<Reports language={language}/>:<RealEstate kind={activePage as Kind} language={language}/>
 return <><AutoTranslator language={language}/><PrintCenter/><div className="app-root min-h-screen bg-page text-slate-950 dark:bg-[#090f1d] dark:text-white" dir={isRtl?'rtl':'ltr'}><Sidebar activePage={activePage} collapsed={sidebarCollapsed} isOpen={mobileSidebarOpen} isRtl={isRtl} language={language} onClose={()=>setMobileSidebarOpen(false)} onToggleCollapse={()=>setSidebarCollapsed(v=>!v)} onNavigate={navigate}/><Header isRtl={isRtl} language={language} onMenuClick={()=>setMobileSidebarOpen(true)} onLanguageChange={setLanguage} theme={theme} onThemeChange={setTheme} sidebarCollapsed={sidebarCollapsed} searchValue={search} onSearchChange={setSearch} onNavigate={navigate} onLogout={()=>{clearCustomerInstallationSession();window.location.reload()}}/><main className={`px-3 pb-10 pt-[92px] transition-[margin] duration-300 lg:px-6 ${offset}`}><Suspense fallback={<SimpleLoader minHeight="300px"/>}>{body}</Suspense></main></div></>
}
