import { formatDate, getDateSystem } from './dateSystem'
import type { Language } from './i18n'
import type { Kind, RecordRow } from './realEstate'
import { fields } from './realEstate'
import { printDocument } from './print-service'

const names:Record<Language,Record<Kind,string>>={
 'دری':{persons:'مشتریان',properties:'جایدادها',deals:'معاملات',expenses:'مصارف',income:'عواید',requests:'درخواست مشتریان',payments:'دریافت کمیشن',rules:'نرخ کمیشن'},
 'پښتو':{persons:'پېرودونکي',properties:'ملکیتونه',deals:'معاملې',expenses:'لګښتونه',income:'عواید',requests:'د پېرودونکو غوښتنې',payments:'د کمېشن ترلاسه کول',rules:'د کمېشن نرخ'},
 English:{persons:'Customers',properties:'Properties',deals:'Deals',expenses:'Expenses',income:'Income',requests:'Customer requests',payments:'Commission receipts',rules:'Commission rules'}
}
export const pageName=(kind:Kind,lang:Language)=>names[lang][kind]
export const formatMoney=(amount:number,currency:string)=>`${new Intl.NumberFormat('en-US',{maximumFractionDigits:2}).format(amount)} ${currency}`
export const printableValue=(key:string,value:unknown):string=>{
 const v=String(value??'');if(!v)return ''
 if(['date','endDate','effectiveDate','licenseExpiry'].includes(key))return formatDate(v.slice(0,10),getDateSystem())
 if(['price','amount','budget','commission'].includes(key)&&Number.isFinite(+v))return new Intl.NumberFormat('en-US',{maximumFractionDigits:2}).format(+v)
 return v
}
export const officeName=(lang:Language):string=>{
 try{const data=JSON.parse(localStorage.getItem('settings')||'{}');return (lang==='دری'?data.companyNameDari:lang==='پښتو'?data.companyNamePashto:data.companyName)||'Smart Real Estate Afghanistan'}catch{return 'Smart Real Estate Afghanistan'}
}
export function printEstate(kind:Kind,language:Language,rows:RecordRow[],title?:string){
 const essential=({persons:['name','phone','role','address'],properties:['title','type','dealType','address','price','currency','status'],deals:['propertyId','type','amount','currency','date','status'],payments:['dealId','personId','amount','currency','date'],income:['title','amount','currency','date'],expenses:['title','amount','currency','date'],requests:['personId','type','budget','currency'],rules:['type','rate','effectiveDate']} as Record<Kind,string[]>)[kind]
 const cols=fields[kind].filter(f=>essential.includes(f.key)).map(x=>({key:x.key,label:x.label}))
 const localRows=rows.map(r=>Object.fromEntries(cols.map(f=>[f.key,printableValue(f.key,r.payload[f.key])])))
 const currencySet=[...new Set(rows.map(r=>String(r.payload.currency||'')).filter(Boolean))]
 printDocument({lang:language==='English'?'en':language==='پښتو'?'ps':'fa',market:officeName(language),currency:currencySet.length===1?currencySet[0]:currencySet.length>1?'AFN / USD':'',title:title||pageName(kind,language),...(rows.length===1?{fields:fields[kind].map(f=>({label:f.label,value:printableValue(f.key,rows[0].payload[f.key])}))}:{columns:cols,rows:localRows})})
}
