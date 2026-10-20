import { ResourcePage, badge, dateText, pretty } from './shared'
import { endpoints } from '../adminApi'
export default function LicensesPage(){return <ResourcePage<any> title="Licenses" sub="License keys and device access." path={endpoints.licenses} columns={[
 {key:'key',title:'ID',render:r=><span className="font-mono text-xs">{pretty(r.licenseKey||r.key)}</span>},{key:'plan',title:'Plan',render:r=>pretty(r.plan||r.planName)},{key:'status',title:'Status',render:r=>badge(r.status)},{key:'expires',title:'Expires',render:r=>dateText(r.expiresAt||r.expires_at)}
]}/>}
