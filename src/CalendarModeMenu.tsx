import React,{useEffect,useRef,useState} from 'react';
import type {CalendarMode} from './MarketDatePicker';
type Language='fa'|'ps'|'en';
const captions={fa:{title:'نوع تقویم',hint:'تقویم سیستم را انتخاب کنید',jalali:'شمسی (جلالی)',gregorian:'میلادی'},ps:{title:'د کلیزې ډول',hint:'د سیسټم کلیزه وټاکئ',jalali:'لمریز (جلالي)',gregorian:'میلادي'},en:{title:'Calendar type',hint:'Choose the system calendar',jalali:'Solar (Jalali)',gregorian:'Gregorian'}};
export default function CalendarModeMenu({value,onChange,lang}:{value:CalendarMode;onChange:(value:CalendarMode)=>void;lang:Language}){
 const [open,setOpen]=useState(false);const root=useRef<HTMLDivElement>(null);const first=useRef<HTMLButtonElement>(null);const c=captions[lang]||captions.fa;
 useEffect(()=>{if(!open)return;const closeOutside=(event:PointerEvent)=>{if(root.current&&!root.current.contains(event.target as Node))setOpen(false)};const closeEscape=(event:KeyboardEvent)=>{if(event.key==='Escape')setOpen(false)};document.addEventListener('pointerdown',closeOutside);document.addEventListener('keydown',closeEscape);first.current?.focus();return()=>{document.removeEventListener('pointerdown',closeOutside);document.removeEventListener('keydown',closeEscape)}},[open]);
 const choose=(mode:CalendarMode)=>{onChange(mode);setOpen(false)};
 return <div className="calendar-menu-root" ref={root}>
  <button type="button" className={'calendar-icon-trigger'+(open?' is-open':'')} title={c.title} aria-label={c.title} aria-haspopup="menu" aria-expanded={open} onClick={()=>setOpen(v=>!v)}>
   <svg aria-hidden="true" width="19" height="19" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><rect x="3" y="5" width="18" height="16" rx="2"/><path d="M16 3v4M8 3v4M3 10h18"/><path d="m9.2 15 1.8 1.8 3.8-4"/></svg>
  </button>
  {open&&<div className="calendar-menu-popover" role="menu" aria-label={c.title} dir={lang==='en'?'ltr':'rtl'}>
   <div className="calendar-menu-heading"><strong>{c.title}</strong><small>{c.hint}</small></div>
   {(['jalali','gregorian'] as CalendarMode[]).map((mode,index)=><button ref={index===0?first:undefined} type="button" key={mode} role="menuitemradio" aria-checked={value===mode} className={'calendar-menu-option'+(value===mode?' selected':'')} onClick={()=>choose(mode)}><span className="calendar-menu-radio" aria-hidden="true">{value===mode?'✓':''}</span><span>{c[mode]}</span></button>)}
  </div>}
 </div>;
}
