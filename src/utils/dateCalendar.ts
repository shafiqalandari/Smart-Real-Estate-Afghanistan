export type CalendarSystem = 'GREGORIAN' | 'SHAMSI'

const pad = (n:number) => String(Math.trunc(n)).padStart(2,'0')
const div = (a:number,b:number) => Math.trunc(a/b)
const mod = (a:number,b:number) => a - Math.trunc(a/b)*b

export function getCalendarSystem(): CalendarSystem {
  if (typeof window === 'undefined') return 'GREGORIAN'
  try {
    const raw = JSON.parse(window.localStorage.getItem('settings') || '[]')
    const settings = (Array.isArray(raw) ? raw[0] : raw) || {}
    const value=String(settings.dateSystem || settings.calendarSystem || '').toUpperCase(); return (value.includes('SOLAR')||value.includes('SHAMSI')) ? 'SHAMSI' : 'GREGORIAN'
  } catch { return 'GREGORIAN' }
}

function jalCal(jy:number){
  const breaks=[-61,9,38,199,426,686,756,818,1111,1181,1210,1635,2060,2097,2192,2262,2324,2394,2456,3178]
  const bl=breaks.length; const gy=jy+621; let leapJ=-14; let jp=breaks[0]; let jm=0; let jump=0
  if(jy<jp||jy>=breaks[bl-1]) throw new Error('Invalid Jalaali year')
  for(let i=1;i<bl;i++){jm=breaks[i];jump=jm-jp;if(jy<jm)break;leapJ+=div(jump,33)*8+div(mod(jump,33),4);jp=jm}
  let n=jy-jp; leapJ+=div(n,33)*8+div(mod(n,33)+3,4); if(mod(jump,33)===4&&jump-n===4)leapJ++
  const leapG=div(gy,4)-div((div(gy,100)+1)*3,4)-150; const march=20+leapJ-leapG
  if(jump-n<6)n=n-jump+div(jump+4,33)*33
  let leap=mod(mod(n+1,33)-1,4); if(leap===-1)leap=4
  return {leap,gy,march}
}
function g2d(gy:number,gm:number,gd:number){let d=div((gy+div(gm-8,6)+100100)*1461,4)+div(153*mod(gm+9,12)+2,5)+gd-34840408;d=d-div(div(gy+100100+div(gm-8,6),100)*3,4)+752;return d}
function d2g(jdn:number){let j=4*jdn+139361631;j=j+div(div(4*jdn+183187720,146097)*3,4)*4-3908;const i=div(mod(j,1461),4)*5+308;const gd=div(mod(i,153),5)+1;const gm=mod(div(i,153),12)+1;const gy=div(j,1461)-100100+div(8-gm,6);return{gy,gm,gd}}
function j2d(jy:number,jm:number,jd:number){const r=jalCal(jy);return g2d(r.gy,3,r.march)+(jm-1)*31-div(jm,7)*(jm-7)+jd-1}
function d2j(jdn:number){const g=d2g(jdn);let jy=g.gy-621;const r=jalCal(jy);const jdn1f=g2d(g.gy,3,r.march);let k=jdn-jdn1f;if(k>=0){if(k<=185)return{jy,jm:1+div(k,31),jd:mod(k,31)+1};k-=186}else{jy-=1;k+=179;if(r.leap===1)k+=1}return{jy,jm:7+div(k,30),jd:mod(k,30)+1}}
export function toJalali(gy:number,gm:number,gd:number){return d2j(g2d(gy,gm,gd))}
export function toGregorian(jy:number,jm:number,jd:number){return d2g(j2d(jy,jm,jd))}

function asDate(value:unknown): Date | null {
  if(value instanceof Date) return Number.isNaN(value.getTime())?null:value
  if(value===null||value===undefined||value==='') return null
  const s=String(value).trim()
  const bare=s.match(/^(\d{4})-(\d{2})-(\d{2})$/)
  const d=bare?new Date(Number(bare[1]),Number(bare[2])-1,Number(bare[3]),12,0,0):new Date(s)
  return Number.isNaN(d.getTime())?null:d
}
export function toGregorianInput(value:unknown): string {
  const d=asDate(value); if(!d)return ''
  return `${d.getFullYear()}-${pad(d.getMonth()+1)}-${pad(d.getDate())}`
}
export function gregorianInputToShamsi(value:string):string{
  const m=String(value||'').match(/^(\d{4})-(\d{2})-(\d{2})$/); if(!m)return ''
  try{const j=toJalali(+m[1],+m[2],+m[3]);return `${j.jy}/${pad(j.jm)}/${pad(j.jd)}`}catch{return ''}
}
export function shamsiInputToGregorian(value:string):string{
  const m=String(value||'').trim().replace(/-/g,'/').match(/^(\d{4})\/(\d{1,2})\/(\d{1,2})$/); if(!m)return ''
  const jy=+m[1],jm=+m[2],jd=+m[3]; if(jm<1||jm>12||jd<1||jd>31||(jm>6&&jd>30))return ''
  try{const g=toGregorian(jy,jm,jd);const test=toJalali(g.gy,g.gm,g.gd);if(test.jy!==jy||test.jm!==jm||test.jd!==jd)return '';return `${g.gy}-${pad(g.gm)}-${pad(g.gd)}`}catch{return ''}
}

export function formatAppDate(value:unknown, opts:{monthName?:boolean; fallback?:string}={}):string{
  const d=asDate(value); if(!d)return opts.fallback ?? '—'
  if(getCalendarSystem()==='SHAMSI'){
    const j=toJalali(d.getFullYear(),d.getMonth()+1,d.getDate())
    if(opts.monthName){
      const months=['حمل','ثور','جوزا','سرطان','اسد','سنبله','میزان','عقرب','قوس','جدی','دلو','حوت']
      return `${pad(j.jd)} ${months[j.jm-1]} ${j.jy}`
    }
    return `${j.jy}/${pad(j.jm)}/${pad(j.jd)}`
  }
  if(opts.monthName) return d.toLocaleDateString('en-US',{month:'short',day:'2-digit',year:'numeric'})
  return `${d.getFullYear()}/${pad(d.getMonth()+1)}/${pad(d.getDate())}`
}
export function formatAppMonth(value:unknown):string{
  const d=asDate(value); if(!d)return '—'
  if(getCalendarSystem()==='SHAMSI'){const j=toJalali(d.getFullYear(),d.getMonth()+1,d.getDate());return `${j.jy}/${pad(j.jm)}`}
  return d.toLocaleDateString('en-US',{month:'short',year:'numeric'})
}
export function formatAppDateTime(value:unknown):string{
  const d=asDate(value); if(!d)return '—'
  return `${formatAppDate(d,{monthName:true})} · ${d.toLocaleTimeString('en-US',{hour:'2-digit',minute:'2-digit'})}`
}
export function formatChartDate(value:unknown, withMonth=true):string{
  const d=asDate(value); if(!d)return String(value??'')
  if(getCalendarSystem()==='SHAMSI'){const j=toJalali(d.getFullYear(),d.getMonth()+1,d.getDate());return withMonth?`${pad(j.jm)}/${pad(j.jd)}`:pad(j.jd)}
  return new Intl.DateTimeFormat('en-US',withMonth?{month:'short',day:'numeric'}:{day:'numeric'}).format(d)
}
export const calendarLabel = () => getCalendarSystem()==='SHAMSI'?'شمسی':'میلادی'
