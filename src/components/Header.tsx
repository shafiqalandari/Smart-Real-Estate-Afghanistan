import { Trash2, ChevronDown, Languages, LogOut, Menu, Moon, Search, Settings, Sun, User } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import type { Language } from '../i18n'
import type { ThemeName } from '../theme'
import { isDarkTheme } from '../theme'
import type { Page } from './Sidebar'
import { getDateSystem, todayForSystem, updateDateSystem, type DateSystem } from '../dateSystem'
import CalendarModeMenu from '../CalendarModeMenu'

const languages: Language[] = ['English', 'دری', 'پښتو']

type Props = {
  isRtl: boolean
  language: Language
  onMenuClick: () => void
  onLanguageChange: (language: Language) => void
  theme: ThemeName
  onThemeChange: (theme: ThemeName) => void
  sidebarCollapsed: boolean
  searchValue: string
  onSearchChange: (value: string) => void
  onNavigate?: (page: Page) => void
  onLogout?: () => void
}

function todayText(language: Language) {
  const system=getDateSystem()
  if(system==='Solar Hijri') return todayForSystem('Solar Hijri')
  const locale = language === 'English' ? 'en-US' : language === 'پښتو' ? 'ps-AF' : 'fa-AF'
  try {
    return new Intl.DateTimeFormat(locale, { weekday: 'short', day: '2-digit', month: 'short', year:'numeric' }).format(new Date())
  } catch {
    return todayForSystem('Gregorian')
  }
}

export default function Header({
  isRtl,
  language,
  onMenuClick,
  onLanguageChange,
  theme,
  onThemeChange,
  sidebarCollapsed,
  searchValue,
  onSearchChange,
  onNavigate,
  onLogout,
}: Props) {
  const dark = isDarkTheme(theme)
  const [dateMode,setDateMode]=useState<DateSystem>(getDateSystem)
  const selectDate=(mode:'jalali'|'gregorian')=>{const next=mode==='jalali'?'Solar Hijri':'Gregorian';updateDateSystem(next);setDateMode(next)}
  useEffect(()=>{const handler=()=>setDateMode(getDateSystem());window.addEventListener('app-settings-updated',handler);return()=>window.removeEventListener('app-settings-updated',handler)},[])
  const offset = sidebarCollapsed
    ? isRtl ? 'lg:right-[68px]' : 'lg:left-[68px]'
    : isRtl ? 'lg:right-[228px]' : 'lg:left-[228px]'
  const [languageOpen, setLanguageOpen] = useState(false)
  const [accountOpen, setAccountOpen] = useState(false)
  const languageRef = useRef<HTMLDivElement>(null)
  const accountRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const close = (event: MouseEvent) => {
      const target = event.target as Node
      if (!languageRef.current?.contains(target)) setLanguageOpen(false)
      if (!accountRef.current?.contains(target)) setAccountOpen(false)
    }
    document.addEventListener('mousedown', close)
    return () => document.removeEventListener('mousedown', close)
  }, [])

  const languageLabel = language === 'English' ? 'EN' : language === 'پښتو' ? 'PS' : 'دری'
  const searchPlaceholder = language === 'English' ? 'Search office records...' : language === 'پښتو' ? 'د دفتر معلومات ولټوئ...'  : 'جستجوی معلومات دفتر...'

  return (
    <header
      className={`app-header fixed left-0 right-0 top-0 z-30 h-[72px] transition-[left,right] duration-300 ${offset}`}
      dir={isRtl ? 'rtl' : 'ltr'}
    >
      <div className="flex h-full items-center gap-3 px-3 lg:px-5">
        <button onClick={onMenuClick} className="header-icon-btn lg:hidden" aria-label="Open menu">
          <Menu size={19}/>
        </button>

        <div className="hidden min-w-0 flex-1 items-center gap-3 md:flex">
          <div className="relative w-full max-w-[540px]">
            <Search size={17} className="pointer-events-none absolute start-3.5 top-1/2 -translate-y-1/2 text-slate-400"/>
            <input
              value={searchValue}
              onChange={(e) => onSearchChange(e.target.value)}
              placeholder={searchPlaceholder}
              className="header-search"
            />
            <div className="pointer-events-none absolute end-3 top-1/2 hidden -translate-y-1/2 rounded-md border border-slate-200 bg-white px-1.5 py-0.5 text-[9px] font-bold text-slate-400 xl:block dark:border-white/10 dark:bg-white/5">
              Ctrl K
            </div>
          </div>
          <div className="hidden items-center gap-2 rounded-xl border border-slate-200/80 bg-white/70 px-3 py-2 text-[11px] font-semibold text-slate-500 shadow-sm xl:flex dark:border-white/10 dark:bg-white/[0.04] dark:text-slate-400">
            <span className="h-2 w-2 rounded-full bg-emerald-500 shadow-[0_0_0_4px_rgba(16,185,129,.10)]"/>
            {todayText(language)}
          </div>
        </div>

        <div className="ms-auto flex items-center gap-1.5 sm:gap-2">
          <CalendarModeMenu value={dateMode==='Solar Hijri'?'jalali':'gregorian'} onChange={selectDate} lang={language==='English'?'en':language==='پښتو'?'ps':'fa'}/>
          <button onClick={() => onNavigate?.('recycle')} className="header-icon-btn relative" aria-label="Recycle Bin">
            <Trash2 size={18}/>
            <span className="absolute end-2 top-2 h-2 w-2 rounded-full border-2 border-white bg-amber-500 dark:border-[#0b1424]"/>
          </button>

          <div ref={languageRef} className="relative">
            <button onClick={() => setLanguageOpen(v => !v)} className="header-control-btn">
              <Languages size={17}/>
              <span className="hidden text-xs font-extrabold sm:inline">{languageLabel}</span>
              <ChevronDown size={14} className={`transition-transform ${languageOpen ? 'rotate-180' : ''}`}/>
            </button>
            {languageOpen && (
              <div className={`header-menu w-44 ${isRtl ? 'left-0' : 'right-0'}`}>
                <div className="px-3 pb-2 pt-3 text-[10px] font-black uppercase tracking-[.15em] text-slate-400">Language</div>
                {languages.map(item => (
                  <button
                    key={item}
                    onClick={() => { onLanguageChange(item); setLanguageOpen(false) }}
                    className={`flex w-full items-center justify-between px-3 py-2.5 text-sm font-semibold transition hover:bg-slate-50 dark:hover:bg-white/5 ${item === language ? 'text-amber-600 dark:text-amber-400' : ''}`}
                  >
                    <span>{item}</span>
                    {item === language && <span className="h-2 w-2 rounded-full bg-amber-500"/>}
                  </button>
                ))}
              </div>
            )}
          </div>

          <button onClick={() => onThemeChange(dark ? 'minimalism' : 'midnight')} className="header-icon-btn" aria-label="Toggle theme">
            {dark ? <Sun size={18}/> : <Moon size={18}/>} 
          </button>

          <div ref={accountRef} className="relative">
            <button onClick={() => setAccountOpen(v => !v)} className="account-trigger">
              <span className="grid h-8 w-8 place-items-center rounded-lg bg-gradient-to-br from-amber-400 to-orange-500 text-slate-950 shadow-sm"><User size={16}/></span>
              <span className="hidden min-w-0 text-start md:block">
                <span className="block max-w-[120px] truncate text-[11px] font-black leading-4">Admin</span>
                <span className="block text-[9px] font-semibold text-slate-400">Super Admin</span>
              </span>
              <ChevronDown size={14} className={`hidden transition-transform md:block ${accountOpen ? 'rotate-180' : ''}`}/>
            </button>
            {accountOpen && (
              <div className={`header-menu w-52 ${isRtl ? 'left-0' : 'right-0'}`}>
                <div className="border-b border-slate-100 px-4 py-3 dark:border-white/10">
                  <div className="text-sm font-black">Administrator</div>
                  <div className="mt-0.5 text-[11px] text-slate-400">حساب شرکت</div>
                </div>
                <button onClick={() => { onNavigate?.('settings'); setAccountOpen(false) }} className="header-menu-item"><Settings size={16}/><span>{language === 'English' ? 'Settings' : language === 'پښتو' ? 'تنظیمات' : 'تنظیمات'}</span></button>
                <button onClick={onLogout} className="header-menu-item text-red-500"><LogOut size={16}/><span>{language === 'English' ? 'Logout' : language === 'پښتو' ? 'وتل' : 'خروج'}</span></button>
              </div>
            )}
          </div>
        </div>
      </div>
    </header>
  )
}
