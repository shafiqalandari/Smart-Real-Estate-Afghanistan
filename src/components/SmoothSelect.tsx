import { useEffect, useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { Check, ChevronDown, Search } from 'lucide-react'

export type SmoothSelectOption = {
  value: string
  label: string
  disabled?: boolean
}

type Props = {
  value: string
  onChange: (value: string) => void
  options: SmoothSelectOption[]
  ariaLabel?: string
  placeholder?: string
  disabled?: boolean
  searchable?: boolean
  searchPlaceholder?: string
  className?: string
  menuClassName?: string
  maxMenuHeight?: number
  appearance?: 'auto' | 'light' | 'dark'
}

export default function SmoothSelect({
  value,
  onChange,
  options,
  ariaLabel,
  placeholder = 'Select',
  disabled = false,
  searchable,
  searchPlaceholder = 'Search…',
  className = '',
  menuClassName = '',
  maxMenuHeight = 260,
  appearance = 'auto',
}: Props) {
  const readAutoDark = () => typeof document !== 'undefined' && document.documentElement.classList.contains('dark')
  const [open, setOpen] = useState(false)
  const [query, setQuery] = useState('')
  const [rect, setRect] = useState<DOMRect | null>(null)
  const [autoDark, setAutoDark] = useState(readAutoDark)
  const buttonRef = useRef<HTMLButtonElement>(null)
  const menuRef = useRef<HTMLDivElement>(null)
  const selected = options.find((option) => option.value === value)
  const hasSearch = searchable ?? options.length > 8
  const isDark = appearance === 'dark' || (appearance === 'auto' && autoDark)

  const filtered = useMemo(() => {
    const q = query.trim().toLocaleLowerCase()
    if (!q) return options
    return options.filter((option) => `${option.label} ${option.value}`.toLocaleLowerCase().includes(q))
  }, [options, query])

  const updateRect = () => {
    if (!buttonRef.current) return
    setRect(buttonRef.current.getBoundingClientRect())
    if (appearance === 'auto') {
      setAutoDark(readAutoDark())
    }
  }

  useEffect(() => {
    if (appearance !== 'auto' || typeof document === 'undefined') return
    const syncTheme = () => setAutoDark(readAutoDark())
    syncTheme()
    const observer = new MutationObserver(syncTheme)
    observer.observe(document.documentElement, { attributes: true, attributeFilter: ['class'] })
    return () => observer.disconnect()
  }, [appearance])

  useEffect(() => {
    if (!open) return
    updateRect()

    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setOpen(false)
    }
    const closeOnOutsidePointer = (event: PointerEvent) => {
      const target = event.target as Node | null
      if (!target) return
      if (buttonRef.current?.contains(target)) return
      if (menuRef.current?.contains(target)) return
      setOpen(false)
    }
    const sync = () => updateRect()

    document.addEventListener('pointerdown', closeOnOutsidePointer, true)
    window.addEventListener('keydown', closeOnEscape)
    window.addEventListener('resize', sync)
    window.addEventListener('scroll', sync, true)
    return () => {
      document.removeEventListener('pointerdown', closeOnOutsidePointer, true)
      window.removeEventListener('keydown', closeOnEscape)
      window.removeEventListener('resize', sync)
      window.removeEventListener('scroll', sync, true)
    }
  }, [open, appearance])

  useEffect(() => {
    if (!open) setQuery('')
  }, [open])

  const choose = (next: string, optionDisabled?: boolean) => {
    if (optionDisabled) return
    onChange(next)
    setOpen(false)
  }

  const viewportHeight = typeof window === 'undefined' ? 900 : window.innerHeight
  const viewportWidth = typeof window === 'undefined' ? 1200 : window.innerWidth
  const estimatedMenuHeight = Math.min(maxMenuHeight + (hasSearch ? 54 : 12), 340)
  const placeAbove = !!rect && rect.bottom + estimatedMenuHeight + 10 > viewportHeight && rect.top > estimatedMenuHeight
  const menuWidth = rect ? rect.width : 170
  const menuStyle = rect ? {
    position: 'fixed' as const,
    left: Math.max(8, Math.min(rect.left, viewportWidth - menuWidth - 8)),
    top: placeAbove ? undefined : rect.bottom + 6,
    bottom: placeAbove ? viewportHeight - rect.top + 6 : undefined,
    width: menuWidth,
    zIndex: 10000,
  } : undefined

  const buttonTheme = appearance === 'light'
    ? 'border-slate-200 bg-white text-slate-800 hover:border-slate-300 focus:ring-[#172a57]/15'
    : appearance === 'dark'
      ? 'border-[#30456f] bg-[#0d1628] text-slate-100 hover:border-[#49608c] focus:ring-amber-400/20'
      : 'border-slate-200 bg-white text-slate-800 hover:border-slate-300 focus:ring-[#172a57]/15 dark:border-[#30456f] dark:bg-[#0d1628] dark:text-slate-100 dark:hover:border-[#49608c] dark:focus:ring-amber-400/20'
  const chevronTheme = appearance === 'light'
    ? 'bg-slate-50 text-slate-500'
    : appearance === 'dark'
      ? 'bg-white/10 text-slate-200'
      : 'bg-slate-50 text-slate-500 dark:bg-white/10 dark:text-slate-200'
  const menuTheme = appearance === 'light'
    ? 'border-slate-200 text-slate-800'
    : appearance === 'dark'
      ? 'border-[#30456f] text-slate-100'
      : 'border-slate-200 text-slate-800 dark:border-[#30456f] dark:text-slate-100'
  const searchWrapTheme = ''
  const searchInputTheme = isDark
    ? 'border-[#30456f] text-slate-100 placeholder:text-slate-400 focus:border-amber-400'
    : 'border-slate-200 text-slate-800 placeholder:text-slate-400 focus:border-amber-500'

  return <>
    <button
      ref={buttonRef}
      type="button"
      aria-label={ariaLabel}
      aria-expanded={open}
      disabled={disabled}
      onClick={() => {
        if (disabled) return
        if (!open) updateRect()
        setOpen((v) => !v)
      }}
      className={`flex h-10 w-full min-w-0 items-center justify-between gap-2 rounded-lg border px-3 text-sm font-medium shadow-sm transition focus:outline-none focus:ring-2 disabled:cursor-not-allowed disabled:opacity-50 ${buttonTheme} ${className}`}
    >
      <span className={`min-w-0 truncate text-start ${selected ? '' : 'text-slate-400'}`}>{selected?.label ?? placeholder}</span>
      <span className={`grid h-6 w-6 shrink-0 place-items-center rounded-md ${chevronTheme}`}>
        <ChevronDown size={15} className={`transition-transform ${open ? 'rotate-180' : ''}`}/>
      </span>
    </button>

    {open && rect && createPortal(
      <div
        ref={menuRef}
        role="listbox"
        aria-label={ariaLabel}
        className={`overflow-hidden rounded-xl border p-1.5 shadow-2xl ${menuTheme} ${menuClassName}`}
        style={{
          ...menuStyle,
          backgroundColor: isDark ? '#0b1324' : '#ffffff',
          color: isDark ? '#f8fafc' : '#1e293b',
          opacity: 1,
          backdropFilter: 'none',
          WebkitBackdropFilter: 'none',
          isolation: 'isolate',
          boxShadow: isDark
            ? '0 18px 45px rgba(0,0,0,.58), 0 0 0 1px rgba(71,85,105,.38)'
            : '0 18px 45px rgba(15,23,42,.20), 0 0 0 1px rgba(148,163,184,.24)',
        }}
      >
        {hasSearch && <div className={`sticky top-0 z-10 mb-1 p-1 ${searchWrapTheme}`} style={{backgroundColor:isDark?'#0b1324':'#ffffff'}}>
          <div className="relative">
            <Search size={14} className="pointer-events-none absolute start-3 top-1/2 -translate-y-1/2 text-slate-400"/>
            <input
              autoFocus
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder={searchPlaceholder}
              className={`h-9 w-full rounded-lg border ps-9 pe-3 text-sm outline-none ${searchInputTheme}`}
              style={{backgroundColor:isDark?'#111c30':'#ffffff',color:isDark?'#f8fafc':'#1e293b'}}
            />
          </div>
        </div>}
        <div className="overflow-y-auto overscroll-contain" style={{maxHeight: maxMenuHeight}}>
          {filtered.map((option) => {
            const active = option.value === value
            const idleClass = isDark ? 'text-slate-100 hover:bg-[#17233b]' : 'text-slate-700 hover:bg-slate-100'
            const activeClass = 'bg-amber-500 font-semibold text-slate-950'
            return <button
              type="button"
              role="option"
              aria-selected={active}
              key={option.value}
              disabled={option.disabled}
              onClick={() => choose(option.value, option.disabled)}
              className={`flex w-full items-center gap-2 rounded-lg px-3 py-2 text-start text-sm transition disabled:cursor-not-allowed disabled:opacity-40 ${active ? activeClass : idleClass}`}
            >
              <span className="grid h-4 w-4 shrink-0 place-items-center">{active && <Check size={14}/>}</span>
              <span className="min-w-0 flex-1 truncate">{option.label}</span>
            </button>
          })}
          {!filtered.length && <div className="px-3 py-5 text-center text-xs text-slate-400">No results</div>}
        </div>
      </div>,
      document.body,
    )}
  </>
}
