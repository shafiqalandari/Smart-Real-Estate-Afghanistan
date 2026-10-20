import { useEffect, useMemo, useState } from 'react'
import { CalendarDays, X } from 'lucide-react'
import { convertDate, dateParts, daysInSolarMonth, getDateSystem, todayForSystem } from '../dateSystem'

type Props={value:string;onChange:(value:string)=>void;className?:string;allowEmpty?:boolean}
type Parts={y:string;m:string;d:string}

function daysInGregorianMonth(year:number,month:number){
  return new Date(year,month,0).getDate()
}

function languageLabels(){
  const lang=localStorage.getItem('app-language')||'دری'
  if(lang==='English') return {year:'Year',month:'Month',day:'Day',clear:'Clear date',dir:'ltr' as const}
  if(lang==='پښتو') return {year:'کال',month:'میاشت',day:'ورځ',clear:'نېټه پاکه کړئ',dir:'rtl' as const}
  return {year:'سال',month:'ماه',day:'روز',clear:'پاک کردن تاریخ',dir:'rtl' as const}
}

export default function CalendarDateInput({value,onChange,className='',allowEmpty=true}:Props){
  const system=getDateSystem()
  const labels=languageLabels()
  const normalized=useMemo(()=>convertDate(value,system),[value,system])
  const parsed=dateParts(normalized)
  const [draft,setDraft]=useState<Parts>(()=>parsed?{y:String(parsed.y),m:String(parsed.m),d:String(parsed.d)}:{y:'',m:'',d:''})

  useEffect(()=>{
    const p=dateParts(normalized)
    setDraft(p?{y:String(p.y),m:String(p.m),d:String(p.d)}:{y:'',m:'',d:''})
    if(value&&normalized!==value) onChange(normalized)
  },[normalized])

  const today=dateParts(todayForSystem(system))!
  const minYear=system==='Solar Hijri'?1300:1920
  const maxYear=system==='Solar Hijri'?1500:2100
  const years=Array.from({length:maxYear-minYear+1},(_,i)=>maxYear-i)
  const monthNum=Number(draft.m||today.m)
  const yearNum=Number(draft.y||today.y)
  const maxDay=system==='Solar Hijri'?daysInSolarMonth(yearNum,monthNum):daysInGregorianMonth(yearNum,monthNum)
  const days=Array.from({length:maxDay},(_,i)=>i+1)

  const commit=(part:keyof Parts,next:string)=>{
    const base={...draft,[part]:next}
    if(!next){
      setDraft(base)
      if(allowEmpty) onChange('')
      return
    }
    const y=Number(base.y||today.y)
    const m=Number(base.m||today.m)
    const validMax=system==='Solar Hijri'?daysInSolarMonth(y,m):daysInGregorianMonth(y,m)
    const d=Math.min(Number(base.d||today.d),validMax)
    const completed={y:String(y),m:String(m),d:String(d)}
    setDraft(completed)
    onChange(`${y}-${String(m).padStart(2,'0')}-${String(d).padStart(2,'0')}`)
  }

  const clear=()=>{setDraft({y:'',m:'',d:''});onChange('')}

  const partOrder = labels.dir==='rtl'
    ? [
        {key:'d' as const,label:labels.day,values:days.map(String),format:(v:string)=>String(v).padStart(2,'0')},
        {key:'m' as const,label:labels.month,values:Array.from({length:12},(_,i)=>String(i+1)),format:(v:string)=>String(v).padStart(2,'0')},
        {key:'y' as const,label:labels.year,values:years.map(String),format:(v:string)=>v},
      ]
    : [
        {key:'y' as const,label:labels.year,values:years.map(String),format:(v:string)=>v},
        {key:'m' as const,label:labels.month,values:Array.from({length:12},(_,i)=>String(i+1)),format:(v:string)=>String(v).padStart(2,'0')},
        {key:'d' as const,label:labels.day,values:days.map(String),format:(v:string)=>String(v).padStart(2,'0')},
      ]

  return <div className={`calendar-control ${className}`} dir={labels.dir}>
    <span className="calendar-leading" aria-hidden="true"><CalendarDays size={15}/></span>
    <div className="calendar-parts">
      {partOrder.map(({key,label,values,format})=><label className={`calendar-part calendar-${key}`} key={key}>
        <span className="calendar-part-label">{label}</span>
        <select value={draft[key]} onChange={e=>commit(key,e.target.value)} aria-label={label}>
          <option value="">--</option>
          {values.map(v=><option key={v} value={v}>{format(v)}</option>)}
        </select>
      </label>)}
    </div>
    {allowEmpty&&value&&<button type="button" className="calendar-clear" onClick={clear} aria-label={labels.clear}><X size={13}/></button>}
  </div>
}
