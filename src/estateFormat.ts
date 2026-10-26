import { formatDate, getDateSystem } from './dateSystem'
import { translateText, type Language } from './i18n'
import type { Kind, RecordRow } from './realEstate'
import { fields } from './realEstate'
import { printDocument } from './print-service'

const names:Record<Language,Record<Kind,string>>={
 'دری':{persons:'مشتریان',properties:'جایدادها',deals:'معاملات',expenses:'مصارف',income:'عواید',requests:'درخواست مشتریان',payments:'دریافت کمیشن',rules:'نرخ کمیشن'},
 'پښتو':{persons:'پېرودونکي',properties:'ملکیتونه',deals:'معاملې',expenses:'لګښتونه',income:'عواید',requests:'د پېرودونکو غوښتنې',payments:'د کمېشن ترلاسه کول',rules:'د کمېشن نرخ'},
 English:{persons:'Customers',properties:'Properties',deals:'Deals',expenses:'Expenses',income:'Income',requests:'Customer requests',payments:'Commission receipts',rules:'Commission rules'}
}
// Translate schema labels and static choice values, never arbitrary customer-entered text.
const fieldLabels: Record<string,[string,string]> = {
 name:['Full name','بشپړ نوم'],phone:['Phone number','د اړیکې شمېره'],role:['Customer type','د پېرودونکي ډول'],address:['Address','پته'],note:['Notes','یادښتونه'],
 title:['Title','سرلیک'],type:['Type','ډول'],dealType:['Offer type','د وړاندیز ډول'],price:['Price','بیه'],currency:['Currency','اسعار'],ownerId:['Owner','مالک'],status:['Status','حالت'],area:['Area','ساحه'],rooms:['Rooms','کوټې'],
 propertyId:['Property','ملکیت'],firstId:['First party','لومړی اړخ'],secondId:['Second party','دوهم اړخ'],amount:['Amount','مبلغ'],date:['Date','نېټه'],endDate:['Contract end date','د تړون د پای نېټه'],documentNo:['Document number','د سند شمېره'],commission:['Total commission','ټول کمېشن'],
 personId:['Customer','پېرودونکی'],dealId:['Deal','معامله'],budget:['Budget','بودجه'],rate:['Commission rate (%)','د کمېشن کچه (%)'],effectiveDate:['Effective date','د اعتبار نېټه'],
};
const labelOverrides:Record<string,[string,string]>={
 'نوع عاید':['Income type','د عاید ډول'],'نوع مصرف':['Expense type','د لګښت ډول'],'نوع معامله':['Deal type','د معاملې ډول'],'نوع جایداد':['Property type','د ملکیت ډول'],'عنوان جایداد':['Property title','د ملکیت سرلیک'],'ولایت، منطقه و آدرس':['Province, area and address','ولایت، سیمه او پته'],'مبلغ معامله':['Deal amount','د معاملې مبلغ'],'مبلغ دریافت':['Amount received','ترلاسه شوی مبلغ'],'نرخ کمیشن فیصدی':['Commission rate (%)','د کمېشن کچه (%)'],'تاریخ اعتبار':['Effective date','د اعتبار نېټه'],
};
export const fieldLabel=(key:string,label:string,language:Language)=>{
 if(language==='دری')return label;
 const custom=labelOverrides[label];
 if(custom)return custom[language==='English'?0:1];
 const translated=translateText(label,language);
 if(translated!==label)return translated;
 const fallback=fieldLabels[key];return fallback?fallback[language==='English'?0:1]:label;
};
const optionLabels:Record<string,[string,string]>={
 'خانه':['House','کور'],'آپارتمان':['Apartment','اپارتمان'],'زمین':['Land','ځمکه'],'دکان':['Shop','دوکان'],'دفتر':['Office','دفتر'],'گدام':['Warehouse','ګودام'],'سایر':['Other','نور'],
 'فروش':['Sale','پلور'],'کرایه':['Rent','کرایه'],'گروی':['Mortgage','ګروۍ'],'فروش و کرایه':['Sale & rent','پلور او کرایه'],
 'موجود':['Available','شته'],'رزرو':['Reserved','ساتل شوی'],'معامله‌شده':['Closed','معامله شوی'],
 'کرایه دفتر':['Office rent','د دفتر کرایه'],'برق':['Electricity','برېښنا'],'معاش':['Salary','معاش'],'ترانسپورت':['Transport','ترانسپورت'],'انترنت':['Internet','انټرنېټ'],
 'مالک':['Owner','مالک'],'خریدار':['Buyer','اخیستونکی'],'فروشنده':['Seller','پلورونکی'],'کرایه‌گیرنده':['Tenant','کرایه نیوونکی'],'کرایه‌دهنده':['Landlord','کرایه ورکوونکی'],'جویای جایداد':['Property seeker','د ملکیت غوښتونکی'],
 'پیش‌نویس':['Draft','مسوده'],'در جریان':['In progress','روان'],'تکمیل‌شده':['Completed','بشپړ شوی'],'لغوشده':['Cancelled','لغوه شوی']
};
export const staticChoiceLabel=(value:string,language:Language)=>language==='دری'?value:optionLabels[value]?.[language==='English'?0:1]||translateText(value,language);
export const fieldDisplayValue=(key:string,value:unknown,language:Language,hasOptions:boolean)=>hasOptions?staticChoiceLabel(String(value??''),language):printableValue(key,value);
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
 const cols=fields[kind].filter(f=>essential.includes(f.key)).map(x=>({key:x.key,label:fieldLabel(x.key,x.label,language),hasOptions:!!x.options}))
 const localRows=rows.map(r=>Object.fromEntries(cols.map(f=>[f.key,fieldDisplayValue(f.key,r.payload[f.key],language,f.hasOptions)])))
 const currencySet=[...new Set(rows.map(r=>String(r.payload.currency||'')).filter(Boolean))]
 printDocument({lang:language==='English'?'en':language==='پښتو'?'ps':'fa',market:officeName(language),currency:currencySet.length===1?currencySet[0]:currencySet.length>1?'AFN / USD':'',title:title||pageName(kind,language),...(rows.length===1?{fields:fields[kind].map(f=>({label:fieldLabel(f.key,f.label,language),value:fieldDisplayValue(f.key,rows[0].payload[f.key],language,!!f.options)}))}:{columns:cols,rows:localRows})})
}
