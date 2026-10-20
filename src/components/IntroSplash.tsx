import { useEffect, useMemo, useState } from 'react'
import { Building2, MapPin, House } from 'lucide-react'
import type { Language } from '../i18n'

type Props = {
  language: Language
  onDone: () => void
}

const copy = {
  دری: {
    eyebrow: 'REAL ESTATE MANAGEMENT',
    title: 'سیستم رهنمای معاملات و کرایی',
    subtitle: 'جایدادها، مشتریان، معاملات، کمیشن و حسابداری در یک محیط واحد',
    loading: 'آماده‌سازی سیستم',
  },
  پښتو: {
    eyebrow: 'REAL ESTATE MANAGEMENT',
    title: 'د جایدادونو او کرایې مدیریت سیستم',
    subtitle: 'جایدادونه، پېرودونکي، معاملې او حسابونه په یوه ځای کې',
    loading: 'سیستم چمتو کېږي',
  },
  English: {
    eyebrow: 'REAL ESTATE MANAGEMENT',
    title: 'Smart Real Estate Afghanistan',
    subtitle: 'Properties, customers, deals and accounting in one workspace',
    loading: 'Preparing your workspace',
  },
} as const

export default function IntroSplash({ language, onDone }: Props) {
  const [leaving, setLeaving] = useState(false)
  const text = copy[language] || copy['دری']
  const isRtl = language !== 'English'
  const dots = useMemo(() => Array.from({ length: 22 }, (_, i) => i), [])

  useEffect(() => {
    const leaveTimer = window.setTimeout(() => setLeaving(true), 2500)
    const doneTimer = window.setTimeout(() => {
      sessionStorage.setItem('estate-intro-seen', '1')
      onDone()
    }, 3050)
    return () => {
      window.clearTimeout(leaveTimer)
      window.clearTimeout(doneTimer)
    }
  }, [onDone])

  return (
    <div className={`travel-intro ${leaving ? 'travel-intro--leaving' : ''}`} dir={isRtl ? 'rtl' : 'ltr'}>
      <div className="travel-intro__aurora travel-intro__aurora--one" />
      <div className="travel-intro__aurora travel-intro__aurora--two" />
      <div className="travel-intro__grid" />

      <div className="travel-intro__world" aria-hidden="true">
        <div className="travel-intro__globe-ring travel-intro__globe-ring--a" />
        <div className="travel-intro__globe-ring travel-intro__globe-ring--b" />
        <Building2 className="travel-intro__globe" strokeWidth={1.15} />
        {dots.map((dot) => (
          <span key={dot} className={`travel-intro__dot travel-intro__dot--${(dot % 8) + 1}`} />
        ))}
      </div>

      <div className="travel-intro__route" aria-hidden="true">
        <span className="travel-intro__route-start"><MapPin size={17} /></span>
        <span className="travel-intro__route-line" />
        <span className="travel-intro__plane"><House size={28} /></span>
        <span className="travel-intro__route-end"><MapPin size={19} /></span>
      </div>

      <main className="travel-intro__content">
        <div className="travel-intro__mark"><House size={28} /></div>
        <div className="travel-intro__eyebrow">{text.eyebrow}</div>
        <h1>{text.title}</h1>
        <p>{text.subtitle}</p>
        <div className="travel-intro__loader" aria-label={text.loading}>
          <span className="travel-intro__loader-fill" />
        </div>
        <div className="travel-intro__loading-label">
          <span className="travel-intro__pulse" />
          {text.loading}
        </div>
      </main>

      <div className="travel-intro__airport-code travel-intro__airport-code--left">KBL</div>
      <div className="travel-intro__airport-code travel-intro__airport-code--right">AFN · USD · AFG</div>
    </div>
  )
}
