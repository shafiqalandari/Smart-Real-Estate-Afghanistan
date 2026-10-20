export type Kind='persons'|'properties'|'deals'|'expenses'|'income'|'requests'|'payments'|'rules'
export type RecordRow={id:string;kind:Kind;payload:Record<string,string|number>;created_at:string}
const base=String(import.meta.env.VITE_CENTRAL_API_URL||'').replace(/\/$/,'')
export async function realRequest(path:string,options:RequestInit={}){
 const token=localStorage.getItem('safarpro-installation-token')||''
 const r=await fetch(`${base}/api/real-estate${path}`,{...options,headers:{'Content-Type':'application/json',Authorization:`Bearer ${token}`,...options.headers}})
 const body=await r.json().catch(()=>({}));if(!r.ok)throw new Error(body.error||'خطا در ارتباط با سرور');return body
}
export const allRecords=async(trash=false):Promise<RecordRow[]>=>realRequest(`/records${trash?'?trash=1':''}`)
export const saveRecord=async(kind:Kind,payload:Record<string,string|number>,id?:string)=>realRequest(id?`/records/${id}`:'/records',{method:id?'PUT':'POST',body:JSON.stringify(id?{payload}:{kind,payload})})
export const deleteRecord=async(id:string)=>realRequest(`/records/${id}`,{method:'DELETE'})
export const restoreRecord=async(id:string)=>realRequest(`/records/${id}/restore`,{method:'POST'})
export const kinds:Kind[]=['properties','persons','deals','expenses','income','requests','payments','rules']
export const fields:Record<Kind,{key:string;label:string;type?:string;options?:string[]}[]>={
 persons:[{key:'name',label:'نام مکمل'},{key:'phone',label:'شماره تماس'},{key:'role',label:'نوع مشتری',options:['مالک','خریدار','فروشنده','کرایه‌گیرنده','کرایه‌دهنده','جویای جایداد']},{key:'address',label:'آدرس'},{key:'note',label:'توضیحات'}],
 properties:[{key:'title',label:'عنوان جایداد'},{key:'type',label:'نوع جایداد',options:['خانه','آپارتمان','زمین','دکان','دفتر','گدام','سایر']},{key:'dealType',label:'نوع عرضه',options:['فروش','کرایه','گروی','فروش و کرایه']},{key:'address',label:'ولایت، منطقه و آدرس'},{key:'price',label:'قیمت',type:'number'},{key:'currency',label:'ارز',options:['AFN','USD']},{key:'ownerId',label:'مالک',type:'person'},{key:'status',label:'وضعیت',options:['موجود','رزرو','معامله‌شده']},{key:'area',label:'مساحت'},{key:'rooms',label:'اتاق‌ها',type:'number'},{key:'note',label:'توضیحات'}],
 deals:[{key:'propertyId',label:'جایداد',type:'property'},{key:'type',label:'نوع معامله',options:['فروش','کرایه','گروی']},{key:'firstId',label:'طرف اول',type:'person'},{key:'secondId',label:'طرف دوم',type:'person'},{key:'amount',label:'مبلغ معامله',type:'number'},{key:'currency',label:'ارز',options:['AFN','USD']},{key:'date',label:'تاریخ',type:'date'},{key:'endDate',label:'تاریخ ختم قرارداد',type:'date'},{key:'documentNo',label:'شماره سته'},{key:'commission',label:'کمیشن مجموعی',type:'number'},{key:'status',label:'وضعیت',options:['پیش‌نویس','در جریان','تکمیل‌شده','لغوشده']}],
 expenses:[{key:'title',label:'نوع مصرف',options:['کرایه دفتر','برق','معاش','ترانسپورت','انترنت','سایر']},{key:'amount',label:'مبلغ',type:'number'},{key:'currency',label:'ارز',options:['AFN','USD']},{key:'date',label:'تاریخ',type:'date'},{key:'note',label:'توضیحات'}],
 income:[{key:'title',label:'نوع عاید'},{key:'amount',label:'مبلغ',type:'number'},{key:'currency',label:'ارز',options:['AFN','USD']},{key:'date',label:'تاریخ',type:'date'},{key:'note',label:'توضیحات'}],
 requests:[{key:'personId',label:'مشتری',type:'person'},{key:'type',label:'نوع جایداد',options:['خانه','آپارتمان','زمین','دکان','دفتر','سایر']},{key:'area',label:'منطقه دلخواه'},{key:'budget',label:'بودجه',type:'number'},{key:'currency',label:'ارز',options:['AFN','USD']},{key:'note',label:'توضیحات'}],
 payments:[{key:'dealId',label:'معامله',type:'deal'},{key:'personId',label:'پرداخت‌کننده',type:'person'},{key:'amount',label:'مبلغ دریافت',type:'number'},{key:'currency',label:'ارز',options:['AFN','USD']},{key:'date',label:'تاریخ',type:'date'},{key:'note',label:'توضیحات'}],
 rules:[{key:'type',label:'نوع معامله',options:['فروش','کرایه','گروی']},{key:'rate',label:'نرخ کمیشن فیصدی',type:'number'},{key:'effectiveDate',label:'تاریخ اعتبار',type:'date'}]
}
