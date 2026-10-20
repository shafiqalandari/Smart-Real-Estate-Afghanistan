export type DateSystem = 'Gregorian' | 'Solar Hijri'

const div=(a:number,b:number)=>Math.trunc(a/b)
const mod=(a:number,b:number)=>a-Math.trunc(a/b)*b

function jalCal(jy:number, withoutLeap=false){
  const breaks=[-61,9,38,199,426,686,756,818,1111,1181,1210,1635,2060,2097,2192,2262,2324,2394,2456,3178]
  const bl=breaks.length
  const gy=jy+621
  let leapJ=-14
  let jp=breaks[0]
  let jm=0,jump=0
  if(jy<jp||jy>=breaks[bl-1]) throw new Error('Invalid Jalaali year '+jy)
  for(let j=1;j<bl;j++){
    jm=breaks[j]
    jump=jm-jp
    if(jy<jm) break
    leapJ+=div(jump,33)*8+div(mod(jump,33),4)
    jp=jm
  }
  let n=jy-jp
  leapJ+=div(n,33)*8+div(mod(n,33)+3,4)
  if(mod(jump,33)===4&&jump-n===4) leapJ++
  const leapG=div(gy,4)-div((div(gy,100)+1)*3,4)-150
  const march=20+leapJ-leapG
  if(withoutLeap) return {leap:0,gy,march}
  if(jump-n<6) n=n-jump+div(jump+4,33)*33
  let leap=mod(mod(n+1,33)-1,4)
  if(leap===-1) leap=4
  return {leap,gy,march}
}
function g2d(gy:number,gm:number,gd:number){
  let d=div((gy+div(gm-8,6)+100100)*1461,4)+div(153*mod(gm+9,12)+2,5)+gd-34840408
  d=d-div(div(gy+100100+div(gm-8,6),100)*3,4)+752
  return d
}
function d2g(jdn:number){
  let j=4*jdn+139361631
  j=j+div(div(4*jdn+183187720,146097)*3,4)*4-3908
  const i=div(mod(j,1461),4)*5+308
  const gd=div(mod(i,153),5)+1
  const gm=mod(div(i,153),12)+1
  const gy=div(j,1461)-100100+div(8-gm,6)
  return {gy,gm,gd}
}
export function toGregorian(jy:number,jm:number,jd:number){
  const r=jalCal(jy,true)
  const jdn=g2d(r.gy,3,r.march)+(jm-1)*31-div(jm,7)*(jm-7)+jd-1
  return d2g(jdn)
}
export function toJalaali(gy:number,gm:number,gd:number){
  const jdn=g2d(gy,gm,gd)
  const g=d2g(jdn)
  let jy=g.gy-621
  const r=jalCal(jy,false)
  const jdn1f=g2d(g.gy,3,r.march)
  let k=jdn-jdn1f
  if(k>=0){
    if(k<=185) return {jy,jm:1+div(k,31),jd:mod(k,31)+1}
    k-=186
  }else{
    jy-=1
    k+=179
    if(r.leap===1) k+=1
  }
  return {jy,jm:7+div(k,30),jd:mod(k,30)+1}
}

const pad=(n:number)=>String(n).padStart(2,'0')
export const dateParts=(value:string)=>{const m=/^(\d{4})-(\d{2})-(\d{2})$/.exec(value||'');return m?{y:+m[1],m:+m[2],d:+m[3]}:null}
export const isSolarValue=(value:string)=>{const p=dateParts(value);return !!p&&p.y<1700}
export const isGregorianValue=(value:string)=>{const p=dateParts(value);return !!p&&p.y>=1700}
export function convertDate(value:string,system:DateSystem){
  const p=dateParts(value);if(!p)return value||''
  try{
    if(system==='Solar Hijri'&&isGregorianValue(value)){const j=toJalaali(p.y,p.m,p.d);return `${j.jy}-${pad(j.jm)}-${pad(j.jd)}`}
    if(system==='Gregorian'&&isSolarValue(value)){const g=toGregorian(p.y,p.m,p.d);return `${g.gy}-${pad(g.gm)}-${pad(g.gd)}`}
  }catch{}
  return value
}
export function getDateSystem():DateSystem{
  try{const s=JSON.parse(localStorage.getItem('settings')||'{}');return s.dateSystem==='Solar Hijri'?'Solar Hijri':'Gregorian'}catch{return 'Gregorian'}
}
export function todayForSystem(system:DateSystem=getDateSystem()){
  const d=new Date();const gy=d.getFullYear(),gm=d.getMonth()+1,gd=d.getDate()
  if(system==='Gregorian') return `${gy}-${pad(gm)}-${pad(gd)}`
  const j=toJalaali(gy,gm,gd);return `${j.jy}-${pad(j.jm)}-${pad(j.jd)}`
}
export function isJalaaliLeapYear(jy:number){try{return jalCal(jy,false).leap===0}catch{return false}}
export function daysInSolarMonth(jy:number,jm:number){if(jm<=6)return 31;if(jm<=11)return 30;return isJalaaliLeapYear(jy)?30:29}
export function displayDate(value:string){return formatDate(value)}
export function formatDate(value:string,system:DateSystem=getDateSystem()){return convertDate(value,system)||'_'}

// API and database dates remain Gregorian ISO; only visible dates use the selected calendar.
export const toStorageDate=(value:string,system:DateSystem=getDateSystem())=>convertDate(value,'Gregorian')
export const todayISO=()=>{const d=new Date();const p=(v:number)=>String(v).padStart(2,'0');return `${d.getFullYear()}-${p(d.getMonth()+1)}-${p(d.getDate())}`}
export function updateDateSystem(mode:DateSystem){
 const previous=(()=>{try{return JSON.parse(localStorage.getItem('settings')||'{}')}catch{return {}}})();
 localStorage.setItem('settings',JSON.stringify({...previous,dateSystem:mode}));
 window.dispatchEvent(new CustomEvent('app-settings-updated'));window.dispatchEvent(new Event('estate-date-system-changed'))
}
