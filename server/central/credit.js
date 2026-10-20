import { randomUUID } from 'node:crypto';
import { pgPool } from './database.js';

const money = (v) => Math.round((Number(v) || 0) * 100) / 100;

async function withTx(fn) {
  const client = await pgPool().connect();
  try {
    await client.query('BEGIN');
    const value = await fn(client);
    await client.query('COMMIT');
    return value;
  } catch (error) {
    try { await client.query('ROLLBACK'); } catch {}
    throw error;
  } finally { client.release(); }
}

export async function ensureCreditAccount(dbOrCustomerId, maybeCustomerId) {
  const customerId = maybeCustomerId || dbOrCustomerId;
  await pgPool().query('INSERT INTO public.credit_accounts(customer_id,balance) VALUES($1,0) ON CONFLICT(customer_id) DO NOTHING', [customerId]);
}

export async function getCreditSummary(_db, customerId) {
  await ensureCreditAccount(customerId);
  const { rows } = await pgPool().query(`
    SELECT c.smart_office_id, a.balance,
      COALESCE(SUM(CASE WHEN l.direction='credit' AND l.entry_type NOT IN ('TRANSFER_RECEIVED') THEN l.amount ELSE 0 END),0) AS total_earned,
      COALESCE(SUM(CASE WHEN l.entry_type='PLAN_CREDIT_REDEMPTION' THEN l.amount ELSE 0 END),0) AS total_redeemed,
      COALESCE(SUM(CASE WHEN l.entry_type='TRANSFER_SENT' THEN l.amount ELSE 0 END),0) AS total_sent,
      COALESCE(SUM(CASE WHEN l.entry_type='TRANSFER_RECEIVED' THEN l.amount ELSE 0 END),0) AS total_received,
      (SELECT count(*) FROM public.referral_relationships r WHERE r.referrer_customer_id=c.id) AS referral_registrations,
      (SELECT count(distinct l2.related_payment_request_id) FROM public.credit_ledger l2 WHERE l2.customer_id=c.id AND l2.entry_type='REFERRAL_PLAN_REWARD') AS referred_plan_purchases
    FROM public.service_customers c
    JOIN public.credit_accounts a ON a.customer_id=c.id
    LEFT JOIN public.credit_ledger l ON l.customer_id=c.id
    WHERE c.id=$1
    GROUP BY c.id,c.smart_office_id,a.balance`, [customerId]);
  const r = rows[0] || {};
  return { smartOfficeId:r.smart_office_id||'', balance:money(r.balance), totalEarned:money(r.total_earned), totalRedeemed:money(r.total_redeemed), totalSent:money(r.total_sent), totalReceived:money(r.total_received), referralRegistrations:Number(r.referral_registrations||0), referredPlanPurchases:Number(r.referred_plan_purchases||0) };
}

async function creditLocked(client, { customerId, amount, entryType, relatedCustomerId=null, relatedPlanId=null, relatedSubscriptionId=null, relatedPaymentRequestId=null, idempotencyKey=null, note='', actorAdminId=null }) {
  const value=money(amount); if (!(value>0)) throw new Error('Credit amount must be greater than zero.');
  if (idempotencyKey) {
    const existing=await client.query('SELECT * FROM public.credit_ledger WHERE idempotency_key=$1 LIMIT 1',[idempotencyKey]);
    if(existing.rows[0]) return existing.rows[0];
  }
  await client.query('INSERT INTO public.credit_accounts(customer_id,balance) VALUES($1,0) ON CONFLICT(customer_id) DO NOTHING',[customerId]);
  const locked=await client.query('SELECT balance FROM public.credit_accounts WHERE customer_id=$1 FOR UPDATE',[customerId]);
  const next=money(Number(locked.rows[0]?.balance||0)+value);
  await client.query('UPDATE public.credit_accounts SET balance=$2,updated_at=now() WHERE customer_id=$1',[customerId,next]);
  const txid=randomUUID();
  const inserted=await client.query(`INSERT INTO public.credit_ledger(transaction_id,customer_id,entry_type,direction,amount,balance_after,related_customer_id,related_plan_id,related_subscription_id,related_payment_request_id,idempotency_key,note,actor_admin_id)
    VALUES($1,$2,$3,'credit',$4,$5,$6,$7,$8,$9,$10,$11,$12) RETURNING *`,[txid,customerId,entryType,value,next,relatedCustomerId,relatedPlanId,relatedSubscriptionId,relatedPaymentRequestId,idempotencyKey,note||null,actorAdminId]);
  return inserted.rows[0];
}

export async function awardReferralSignup(_db,{referrerCustomerId,referredCustomerId}) {
  return withTx((client)=>creditLocked(client,{customerId:referrerCustomerId,amount:10,entryType:'REFERRAL_SIGNUP',relatedCustomerId:referredCustomerId,idempotencyKey:`referral-signup:${referredCustomerId}`,note:'Referral registration reward'}));
}

export async function awardReferralPlanPurchase(_db,{referrerCustomerId,referredCustomerId,planId,paymentRequestId,rewardAfn}) {
  const amount=money(rewardAfn); if(amount<=0) return null;
  return withTx((client)=>creditLocked(client,{customerId:referrerCustomerId,amount,entryType:'REFERRAL_PLAN_REWARD',relatedCustomerId:referredCustomerId,relatedPlanId:planId,relatedPaymentRequestId:paymentRequestId,idempotencyKey:`referral-plan:${paymentRequestId}`,note:'Referral plan purchase reward'}));
}

export async function transferCredit(_db,{senderCustomerId,recipientSmartOfficeId,amount}) {
  const value=money(amount); if(!(value>0)) throw Object.assign(new Error('Enter a valid credit amount.'),{code:'INVALID_AMOUNT'});
  return withTx(async(client)=>{
    const rr=await client.query('SELECT id,smart_office_id,business_name,owner_name FROM public.service_customers WHERE upper(smart_office_id)=upper($1) LIMIT 1',[String(recipientSmartOfficeId||'').trim()]);
    const recipient=rr.rows[0]; if(!recipient) throw Object.assign(new Error('Real Estate Office ID was not found.'),{code:'RECIPIENT_NOT_FOUND'});
    if(String(recipient.id)===String(senderCustomerId)) throw Object.assign(new Error('You cannot transfer credit to your own account.'),{code:'SELF_TRANSFER'});
    const ids=[String(senderCustomerId),String(recipient.id)].sort();
    await client.query('INSERT INTO public.credit_accounts(customer_id,balance) SELECT x,0 FROM unnest($1::uuid[]) x ON CONFLICT(customer_id) DO NOTHING',[ids]);
    const locks=await client.query('SELECT customer_id,balance FROM public.credit_accounts WHERE customer_id=ANY($1::uuid[]) ORDER BY customer_id FOR UPDATE',[ids]);
    const balances=new Map(locks.rows.map(r=>[String(r.customer_id),Number(r.balance||0)]));
    const senderBalance=money(balances.get(String(senderCustomerId))||0); if(senderBalance<value) throw Object.assign(new Error('Your available credit is not enough.'),{code:'INSUFFICIENT_CREDIT'});
    const recipientBalance=money(balances.get(String(recipient.id))||0); const senderAfter=money(senderBalance-value); const recipientAfter=money(recipientBalance+value); const txid=randomUUID();
    await client.query('UPDATE public.credit_accounts SET balance=$2,updated_at=now() WHERE customer_id=$1',[senderCustomerId,senderAfter]);
    await client.query('UPDATE public.credit_accounts SET balance=$2,updated_at=now() WHERE customer_id=$1',[recipient.id,recipientAfter]);
    const sent=await client.query(`INSERT INTO public.credit_ledger(transaction_id,customer_id,entry_type,direction,amount,balance_after,related_customer_id,note) VALUES($1,$2,'TRANSFER_SENT','debit',$3,$4,$5,'Zero-fee real estate office credit transfer') RETURNING id`,[txid,senderCustomerId,value,senderAfter,recipient.id]);
    const recv=await client.query(`INSERT INTO public.credit_ledger(transaction_id,customer_id,entry_type,direction,amount,balance_after,related_customer_id,note) VALUES($1,$2,'TRANSFER_RECEIVED','credit',$3,$4,$5,'Zero-fee real estate office credit transfer') RETURNING id`,[txid,recipient.id,value,recipientAfter,senderCustomerId]);
    await client.query('INSERT INTO public.credit_transfers(transaction_id,sender_customer_id,recipient_customer_id,amount,sender_ledger_id,recipient_ledger_id) VALUES($1,$2,$3,$4,$5,$6)',[txid,senderCustomerId,recipient.id,value,sent.rows[0].id,recv.rows[0].id]);
    return {transactionId:txid,amount:value,balanceAfter:senderAfter,recipient:{smartOfficeId:recipient.smart_office_id,displayName:recipient.owner_name||recipient.business_name||'',companyName:recipient.business_name||''}};
  });
}

export async function redeemPlanCredit(_db,{customerId,amount,planId=null,subscriptionId=null,paymentRequestId=null,idempotencyKey=null}) {
  const value=money(amount); if(value<0) throw new Error('Credit cannot be negative.'); if(value===0) return {creditApplied:0,balanceAfter:null};
  return withTx(async(client)=>{
    if(idempotencyKey){const old=await client.query('SELECT amount,balance_after FROM public.credit_ledger WHERE idempotency_key=$1 LIMIT 1',[idempotencyKey]); if(old.rows[0]) return {creditApplied:money(old.rows[0].amount),balanceAfter:money(old.rows[0].balance_after),reused:true};}
    await client.query('INSERT INTO public.credit_accounts(customer_id,balance) VALUES($1,0) ON CONFLICT(customer_id) DO NOTHING',[customerId]);
    const locked=await client.query('SELECT balance FROM public.credit_accounts WHERE customer_id=$1 FOR UPDATE',[customerId]); const balance=money(locked.rows[0]?.balance||0); if(balance<value) throw Object.assign(new Error('Your available credit is not enough.'),{code:'INSUFFICIENT_CREDIT'}); const next=money(balance-value); const txid=randomUUID();
    await client.query('UPDATE public.credit_accounts SET balance=$2,updated_at=now() WHERE customer_id=$1',[customerId,next]);
    await client.query(`INSERT INTO public.credit_ledger(transaction_id,customer_id,entry_type,direction,amount,balance_after,related_plan_id,related_subscription_id,related_payment_request_id,idempotency_key,note) VALUES($1,$2,'PLAN_CREDIT_REDEMPTION','debit',$3,$4,$5,$6,$7,$8,'Credit applied to real estate office plan')`,[txid,customerId,value,next,planId,subscriptionId,paymentRequestId,idempotencyKey]);
    return {creditApplied:value,balanceAfter:next};
  });
}

export async function finalizePlanPaymentWithCredit({ requestId, installationId, customerId, planId, paymentMethodId, cashAmount, currency='AFN', requestedCreditAfn=0, startsAt, expiresAt, isLifetime=false, note='' }) {
  return withTx(async (client) => {
    const request = await client.query('SELECT status,credit_applied_afn FROM public.payment_requests WHERE id=$1 FOR UPDATE', [requestId]);
    if (!request.rows[0]) throw new Error('Payment request not found.');
    if (request.rows[0].status === 'APPROVED') {
      const existing = await client.query('SELECT id,starts_at,expires_at FROM public.subscriptions WHERE payment_request_id=$1 LIMIT 1', [requestId]);
      return { alreadyApproved:true, subscription:existing.rows[0]||null, creditApplied:money(request.rows[0].credit_applied_afn||0) };
    }
    if (request.rows[0].status !== 'PROCESSING') throw new Error('Payment request is not ready for approval.');

    const credit = money(requestedCreditAfn);
    let balanceAfter = null;
    if (credit > 0) {
      const prior = await client.query("SELECT amount,balance_after FROM public.credit_ledger WHERE idempotency_key=$1 LIMIT 1", [`plan-credit:${requestId}`]);
      if (prior.rows[0]) {
        balanceAfter = money(prior.rows[0].balance_after);
      } else {
        await client.query('INSERT INTO public.credit_accounts(customer_id,balance) VALUES($1,0) ON CONFLICT(customer_id) DO NOTHING', [customerId]);
        const locked = await client.query('SELECT balance FROM public.credit_accounts WHERE customer_id=$1 FOR UPDATE', [customerId]);
        const balance = money(locked.rows[0]?.balance || 0);
        if (balance < credit) throw Object.assign(new Error('Customer credit balance is no longer sufficient.'), { code:'INSUFFICIENT_CREDIT' });
        balanceAfter = money(balance - credit);
        await client.query('UPDATE public.credit_accounts SET balance=$2,updated_at=now() WHERE customer_id=$1', [customerId, balanceAfter]);
        await client.query(`INSERT INTO public.credit_ledger(transaction_id,customer_id,entry_type,direction,amount,balance_after,related_plan_id,related_payment_request_id,idempotency_key,note)
          VALUES($1,$2,'PLAN_CREDIT_REDEMPTION','debit',$3,$4,$5,$6,$7,'Credit applied to real estate office plan')`, [randomUUID(), customerId, credit, balanceAfter, planId, requestId, `plan-credit:${requestId}`]);
      }
    }

    let subscription = (await client.query('SELECT * FROM public.subscriptions WHERE payment_request_id=$1 LIMIT 1', [requestId])).rows[0] || null;
    if (!subscription) {
      const inserted = await client.query(`INSERT INTO public.subscriptions(installation_id,starts_at,expires_at,status,note,plan_id,payment_request_id,payment_method_id,amount,currency,is_lifetime)
        VALUES($1,$2,$3,'ACTIVE',$4,$5,$6,$7,$8,$9,$10) RETURNING *`, [installationId, startsAt, expiresAt, note, planId, requestId, paymentMethodId, money(cashAmount), currency, Boolean(isLifetime)]);
      subscription = inserted.rows[0];
    }
    await client.query(`UPDATE public.installations SET status='ACTIVE',approval_status='APPROVED',subscription_expires_at=$2,lifetime_access=$3,access_version=$4 WHERE id=$1`, [installationId, expiresAt, Boolean(isLifetime), Date.now()]);
    const approved = await client.query(`UPDATE public.payment_requests SET status='APPROVED',credit_applied_afn=$2,reviewed_at=now(),approved_expires_at=$3,updated_at=now() WHERE id=$1 RETURNING *`, [requestId, credit, expiresAt]);
    return { alreadyApproved:false, subscription, paymentRequest:approved.rows[0], creditApplied:credit, balanceAfter };
  });
}
