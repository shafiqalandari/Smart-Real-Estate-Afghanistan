import { ResourcePage, badge, dateText, pretty } from './shared'
import { endpoints } from '../adminApi'
export default function SubscriptionsPage(){return <ResourcePage<any> title="Subscriptions" sub="Current and historical customer subscriptions." path={endpoints.subscriptions} columns={[
 {key:'customer',title:'Customer',render:r=>pretty(r.customerName||r.businessName||r.service_customers?.business_name)},{key:'plan',title:'Plan',render:r=>pretty(r.plan?.title||r.subscription_plans?.title||r.planTitle)},{key:'status',title:'Status',render:r=>badge(r.status)},{key:'start',title:'Started',render:r=>dateText(r.startedAt||r.started_at||r.createdAt)},{key:'end',title:'Expires',render:r=>dateText(r.expiresAt||r.expires_at)}
]}/>} 
