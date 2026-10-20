import React,{useEffect,useRef,useState} from 'react';
export type CalendarMode='jalali'|'gregorian';
type Props={value?:string;onChange:(value:string)=>void;mode:CalendarMode;lang:'fa'|'ps'|'en';required?:boolean;monthOnly?:boolean};
const pad=(v:number)=>String(v).padStart(2,'0');
const normalize=(s:string)=>s.replace(/[۰-۹]/g,c=>String('۰۱۲۳۴۵۶۷۸۹'.indexOf(c))).replace(/[٠-٩]/g,c=>String('٠١٢٣٤٥٦٧٨٩'.indexOf(c)));
const dayMS=86400000;
const utc=(y:number,m:number,d:number)=>new Date(Date.UTC(y,m-1,d,12));
const iso=(d:Date)=>`${d.getUTCFullYear()}-${pad(d.getUTCMonth()+1)}-${pad(d.getUTCDate())}`;
const formatter=new Intl.DateTimeFormat('en-US-u-ca-persian-nu-latn',{year:'numeric',month:'numeric',day:'numeric',timeZone:'UTC'});
function persianParts(d:Date){const o:any={};for(const p of formatter.formatToParts(d))if(['year','month','day'].includes(p.type))o[p.type]=Number(normalize(p.value));return {y:o.year as number,m:o.month as number,d:o.day as number};}
function compare(y:number,m:number,d:number,other:{y:number,m:number,d:number}){return y!==other.y?y-other.y:m!==other.m?m-other.m:d-other.d;}
function persianToGregorian(y:number,m:number,d:number){let low=Date.UTC(y+620,0,1,12),high=Date.UTC(y+623,0,1,12);while(low<high){const mid=low+Math.floor((high-low)/dayMS/2)*dayMS; const p=persianParts(new Date(mid));if(compare(y,m,d,p)>0)low=mid+dayMS;else high=mid;}const result=new Date(low);return compare(y,m,d,persianParts(result))===0?result:null;}
function getParts(date:Date,mode:CalendarMode){return mode==='jalali'?persianParts(date):{y:date.getUTCFullYear(),m:date.getUTCMonth()+1,d:date.getUTCDate()};}
export function formatMarketDate(value:any,mode:CalendarMode,lang:'fa'|'ps'|'en'='fa',monthOnly=false){if(!value)return '';const raw=String(value).slice(0,10);const d=new Date(`${raw.length===7?raw+'-01':raw}T12:00:00Z`);if(Number.isNaN(+d))return String(value);const p=getParts(d,mode);return `${p.y}/${pad(p.m)}${monthOnly?'':'/'+pad(p.d)}`;}
const monthNames={fa:['حمل','ثور','جوزا','سرطان','اسد','سنبله','میزان','عقرب','قوس','جدی','دلو','حوت'],ps:['وری','غویی','غبرګولی','چنګاښ','زمری','وږی','تله','لړم','لیندۍ','مرغومی','سلواغه','کب'],en:['Hamal','Sawr','Jawza','Saratan','Asad','Sonbola','Mizan','Aqrab','Qaws','Jadi','Dalwa','Hoot']};
const gregMonths=['January','February','March','April','May','June','July','August','September','October','November','December'];
const labels={fa:{today:'امروز',clear:'پاک‌کردن',choose:'انتخاب تاریخ',days:['ش','ی','د','س','چ','پ','ج']},ps:{today:'نن',clear:'پاکول',choose:'نېټه وټاکئ',days:['ش','ی','د','س','چ','پ','ج']},en:{today:'Today',clear:'Clear',choose:'Select date',days:['Sa','Su','Mo','Tu','We','Th','Fr']}};
function toUTC(y:number,m:number,d:number,mode:CalendarMode){return mode==='jalali'?persianToGregorian(y,m,d):utc(y,m,d)}
function parseTypedDate(text:string,mode:CalendarMode,monthOnly:boolean){
 const normalized=normalize(text.trim()).replace(/[\-.\s]+/g,'/');
 const match=normalized.match(monthOnly?/^(\d{4})\/(\d{1,2})$/:/^(\d{4})\/(\d{1,2})\/(\d{1,2})$/);
 if(!match)return null;
 const y=Number(match[1]),m=Number(match[2]),d=monthOnly?1:Number(match[3]);
 if(y<1||y>9999||m<1||m>12||d<1||d>31)return null;
 const converted=toUTC(y,m,d,mode);
 if(!converted||Number.isNaN(converted.getTime()))return null;
 const check=getParts(converted,mode);
 if(check.y!==y||check.m!==m||check.d!==d)return null;
 const result=iso(converted);
 return monthOnly?result.slice(0,7):result;
}
export default function MarketDatePicker({value='',onChange,mode,lang,monthOnly=false}:Props){
 const ref=useRef<HTMLDivElement>(null);const [open,setOpen]=useState(false);const [editing,setEditing]=useState(false);const [draft,setDraft]=useState('');const [invalid,setInvalid]=useState(false);const initial=()=>getParts(new Date(),mode);const [view,setView]=useState(()=>({y:initial().y,m:initial().m}));
 useEffect(()=>{if(open){const d=value?new Date(`${String(value).slice(0,7)}-${monthOnly?'01':String(value).slice(8,10)||'01'}T12:00:00Z`):new Date();const p=getParts(d,mode);setView({y:p.y,m:p.m});}},[open,mode]);
 useEffect(()=>{if(!open)return;const close=(e:PointerEvent)=>{if(ref.current&&!ref.current.contains(e.target as Node))setOpen(false)};document.addEventListener('pointerdown',close);return()=>document.removeEventListener('pointerdown',close)},[open]);
 useEffect(()=>{if(!editing){setDraft(value?formatMarketDate(value,mode,lang,monthOnly):'');setInvalid(false)}},[value,mode,lang,monthOnly,editing]);
 const commit=()=>{const typed=draft.trim();if(!typed){onChange('');setInvalid(false);setEditing(false);return}const parsed=parseTypedDate(typed,mode,monthOnly);if(!parsed){setInvalid(true);return}onChange(parsed);setDraft(formatMarketDate(parsed,mode,lang,monthOnly));setInvalid(false);setEditing(false)};
 const first=toUTC(view.y,view.m,1,mode);const start=first?((first.getUTCDay()+1)%7):0;
 const cells=Array.from({length:42},(_,idx)=>{const date=first?new Date(first.getTime()+(idx-start)*dayMS):null;const parts=date?getParts(date,mode):null;return {date,parts,active:parts?.m===view.m&&parts?.y===view.y}});
 const move=(offset:number)=>{let m=view.m+offset,y=view.y;if(m<1){m=12;y--}if(m>12){m=1;y++}setView({y,m})};
 const choose=(date:Date)=>{const newValue=iso(date);const result=monthOnly?newValue.slice(0,7):newValue;onChange(result);setDraft(formatMarketDate(result,mode,lang,monthOnly));setEditing(false);setInvalid(false);setOpen(false)};
 const today=()=>choose(new Date());const isSelected=(date:Date)=>value&&(monthOnly?iso(date).slice(0,7)===String(value).slice(0,7):iso(date)===String(value).slice(0,10));
 return <div className="market-date-picker" ref={ref}><div className={'market-date-entry'+(invalid?' market-date-invalid':'')}><input type="text" inputMode="numeric" className="market-date-manual" aria-label={labels[lang].choose} aria-invalid={invalid} placeholder={monthOnly?'۱۴۰۵/۰۷':'۱۴۰۵/۰۷/۲۳'} value={editing?draft:(value?formatMarketDate(value,mode,lang,monthOnly):'')} onFocus={()=>{setEditing(true);setDraft(value?formatMarketDate(value,mode,lang,monthOnly):'')}} onChange={e=>{setDraft(normalize(e.target.value));setInvalid(false)}} onBlur={()=>{if(editing)commit()}} onKeyDown={e=>{if(e.key==='Enter'){e.preventDefault();commit();(e.target as HTMLInputElement).blur()}else if(e.key==='Escape'){setDraft(value?formatMarketDate(value,mode,lang,monthOnly):'');setInvalid(false);setEditing(false);(e.target as HTMLInputElement).blur()}}}/><button className="market-date-calendar-button" type="button" aria-label={labels[lang].choose} aria-haspopup="dialog" aria-expanded={open} onMouseDown={e=>e.preventDefault()} onClick={()=>setOpen(o=>!o)}>▦</button></div>{invalid&&<small className="market-date-error" role="alert">{lang==='en'?'Invalid date. Use YYYY/MM/DD.':lang==='ps'?'نېټه سمه نه ده. بېلګه: ۱۴۰۵/۰۷/۲۳':'تاریخ معتبر نیست. نمونه: ۱۴۰۵/۰۷/۲۳'}</small>}{open&&<div className="market-calendar" role="dialog" aria-label={labels[lang].choose} dir={lang==='en'?'ltr':'rtl'}><div className="market-calendar-top"><button type="button" onClick={()=>move(-1)} aria-label="Previous month">‹</button><strong>{mode==='jalali'?monthNames[lang][view.m-1]:gregMonths[view.m-1]} {view.y}</strong><button type="button" onClick={()=>move(1)} aria-label="Next month">›</button></div>{monthOnly?<div className="market-calendar-months">{Array.from({length:12},(_,i)=><button key={i} type="button" className={view.m===i+1?'selected':''} onClick={()=>{const date=toUTC(view.y,i+1,1,mode);if(date)choose(date)}}>{mode==='jalali'?monthNames[lang][i]:gregMonths[i].slice(0,3)}</button>)}</div>:<div className="market-calendar-grid">{labels[lang].days.map((d,i)=><span className="market-calendar-weekday" key={i}>{d}</span>)}{cells.map((c,i)=><button key={i} type="button" disabled={!c.date} className={`${!c.active?'other-month ':''}${c.date&&isSelected(c.date)?'selected':''}`} onClick={()=>c.date&&choose(c.date)}>{c.parts?.d||''}</button>)}</div>}<div className="market-calendar-actions"><button type="button" onClick={today}>{labels[lang].today}</button><button type="button" onClick={()=>{onChange('');setOpen(false)}}>{labels[lang].clear}</button></div></div>}</div>
}
