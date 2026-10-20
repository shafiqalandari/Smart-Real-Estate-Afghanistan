import { Router } from 'express';
import { pgPool } from '../central/database.js';
import { installationFromRequest, accessPayload } from '../central/access.js';
const router=Router();
const kinds=new Set(['persons','properties','deals','expenses','income','requests','payments','rules']);
router.use(async(req,res,next)=>{try{
 const install=await installationFromRequest(req);
 if(!install || !accessPayload(install).allowed)return res.status(401).json({error:'ورود معتبر و اشتراک فعال لازم است'});
 const office=String(install.customer_id || install.service_customer_id || install.service_customers?.id || '');
 if(!office)return res.status(403).json({error:'دفتر مشخص نیست'});
 req.office=office;next();
}catch(e){next(e)}});
router.get('/records',async(req,res,next)=>{try{
 const kind=String(req.query.kind||''); if(kind&&!kinds.has(kind))return res.status(400).json({error:'نوع نامعتبر'});
 const trash=req.query.trash==='1';
 const rows=await pgPool().query(`SELECT id,kind,payload,created_at,updated_at FROM re_records WHERE office_id=$1 AND ($2::text='' OR kind=$2) AND deleted_at IS ${trash?'NOT NULL':'NULL'} ORDER BY created_at DESC LIMIT 2000`,[req.office,kind]);res.json(rows.rows);
}catch(e){next(e)}});
router.post('/records',async(req,res,next)=>{try{
 const {kind,payload}=req.body||{};if(!kinds.has(kind)||!payload||typeof payload!=='object'||Array.isArray(payload))return res.status(400).json({error:'معلومات نامعتبر'});
 if(JSON.stringify(payload).length>25000)return res.status(413).json({error:'معلومات بسیار زیاد است'});
 if(kind==='payments' && (!payload.dealId || !['AFN','USD'].includes(payload.currency) || !(Number(payload.amount)>0)))return res.status(400).json({error:'معلومات دریافت نادرست است'});
 const c=await pgPool().connect();try{await c.query('BEGIN');
 if(kind==='payments'){
 const deal=await c.query(`SELECT payload FROM re_records WHERE id=$1 AND office_id=$2 AND kind='deals' AND deleted_at IS NULL FOR UPDATE`,[payload.dealId,req.office]);if(!deal.rows.length)throw new Error('معامله پیدا نشد');
 const d=deal.rows[0].payload;const due=Number(d.commission||0);const paid=await c.query(`SELECT COALESCE(SUM((payload->>'amount')::numeric),0) AS sum FROM re_records WHERE office_id=$1 AND kind='payments' AND deleted_at IS NULL AND payload->>'dealId'=$2`,[req.office,payload.dealId]);
 if(d.currency!==payload.currency||Number(paid.rows[0].sum)+Number(payload.amount)>due+0.001)throw new Error('مبلغ یا ارز با کمیشن مطابقت ندارد');
 }
 const r=await c.query('INSERT INTO re_records(office_id,kind,payload) VALUES($1,$2,$3) RETURNING *',[req.office,kind,JSON.stringify(payload)]);
 await c.query('INSERT INTO re_audit(office_id,record_id,action) VALUES($1,$2,$3)',[req.office,r.rows[0].id,'CREATE '+kind]);await c.query('COMMIT');res.status(201).json(r.rows[0]);
 }catch(e){await c.query('ROLLBACK');throw e}finally{c.release()}
}catch(e){next(e)}});
router.put('/records/:id',async(req,res,next)=>{try{
 const {payload}=req.body||{};if(!payload||typeof payload!=='object'||Array.isArray(payload)||JSON.stringify(payload).length>25000)return res.status(400).json({error:'معلومات نامعتبر'});
 const r=await pgPool().query(`UPDATE re_records SET payload=$3,updated_at=now() WHERE id=$1 AND office_id=$2 AND deleted_at IS NULL AND kind NOT IN ('deals','payments') RETURNING *`,[req.params.id,req.office,JSON.stringify(payload)]);
 if(!r.rowCount)return res.status(403).json({error:'ویرایش مجاز نیست یا ریکارد پیدا نشد'});await pgPool().query('INSERT INTO re_audit(office_id,record_id,action) VALUES($1,$2,$3)',[req.office,req.params.id,'UPDATE']);res.json(r.rows[0]);
}catch(e){next(e)}});
router.post('/records/:id/restore',async(req,res,next)=>{try{const r=await pgPool().query(`UPDATE re_records SET deleted_at=NULL WHERE id=$1 AND office_id=$2 AND deleted_at IS NOT NULL RETURNING id`,[req.params.id,req.office]);if(!r.rowCount)return res.sendStatus(404);await pgPool().query('INSERT INTO re_audit(office_id,record_id,action) VALUES($1,$2,$3)',[req.office,req.params.id,'RESTORE']);res.json({success:true})}catch(e){next(e)}});
router.delete('/records/:id',async(req,res,next)=>{try{const r=await pgPool().query(`UPDATE re_records SET deleted_at=now() WHERE id=$1 AND office_id=$2 AND deleted_at IS NULL AND kind NOT IN ('deals','payments') RETURNING id`,[req.params.id,req.office]);if(!r.rowCount)return res.status(403).json({error:'معامله و پرداخت مالی قابل حذف مستقیم نیست'});await pgPool().query('INSERT INTO re_audit(office_id,record_id,action) VALUES($1,$2,$3)',[req.office,req.params.id,'DELETE']);res.json({success:true})}catch(e){next(e)}});
export default router;
