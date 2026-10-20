import { lazy, Suspense, useEffect, useMemo, useState, type ComponentType, type LazyExoticComponent } from 'react'
import AdminLoading from './AdminLoading'
import AdminLayout from './AdminLayout'
import AdminLogin from './AdminLogin'
import { getSession } from './adminApi'
import { adminNavigate } from './adminAuth'

const DeviceDetailsPage = lazy(() => import('./pages/DeviceDetailsPage'))
const CustomerDetailsPage = lazy(() => import('./pages/CustomerDetailsPage'))

const pages: Record<string, LazyExoticComponent<ComponentType>> = {
  '/admin': lazy(() => import('./pages/AdminOverview')),
  '/admin/companies': lazy(() => import('./pages/CompaniesPage')),
  '/admin/customers': lazy(() => import('./pages/CustomersPage')),
  '/admin/company-requests': lazy(() => import('./pages/CompanyRequestsPage')),
  '/admin/devices': lazy(() => import('./pages/DevicesPage')),
  '/admin/licenses': lazy(() => import('./pages/LicensesPage')),
  '/admin/plans': lazy(() => import('./pages/PlansPage')),
  '/admin/credits': lazy(() => import('./pages/CreditsPage')),
  '/admin/subscriptions': lazy(() => import('./pages/SubscriptionsPage')),
  '/admin/payments': lazy(() => import('./pages/PaymentHistoryPage')),
  '/admin/payment-requests': lazy(() => import('./pages/PaymentRequestsPage')),
  '/admin/payment-methods': lazy(() => import('./pages/PaymentMethodsPage')),
  '/admin/messages': lazy(() => import('./pages/MessagesPage')),
  '/admin/broadcast': lazy(() => import('./pages/BroadcastPage')),
  '/admin/backup': lazy(() => import('./pages/BackupPage')),
  '/admin/innovations': lazy(() => import('./pages/InnovationsPage')),
  '/admin/audit': lazy(() => import('./pages/AuditPage')),
  '/admin/security': lazy(() => import('./pages/SecurityPage')),
  '/admin/settings': lazy(() => import('./pages/AdminSettingsPage')),
}

export default function AdminRouter(){
  const [path,setPath]=useState(window.location.pathname.replace(/\/$/,'')||'/admin')
  const [search,setSearch]=useState(window.location.search)
  const [checking,setChecking]=useState(path!=='/admin/login')
  const [allowed,setAllowed]=useState(path==='/admin/login')
  useEffect(()=>{const onPop=()=>{setPath(window.location.pathname.replace(/\/$/,'')||'/admin');setSearch(window.location.search)};window.addEventListener('popstate',onPop);return()=>window.removeEventListener('popstate',onPop)},[])
  useEffect(()=>{if(path==='/admin/login'){setAllowed(true);setChecking(false);return}let alive=true;setChecking(true);getSession().then(()=>{if(alive){setAllowed(true);setChecking(false)}}).catch(()=>{if(alive){setAllowed(false);setChecking(false);adminNavigate('/admin/login')}});return()=>{alive=false}},[path])
  const Page=useMemo(()=>path.startsWith('/admin/devices/')?DeviceDetailsPage:path.startsWith('/admin/customers/')?CustomerDetailsPage:(pages[path]||pages['/admin']),[path])
  if(path==='/admin/login') return <AdminLogin/>
  if(checking||!allowed) return <AdminLoading/>
  return <AdminLayout><Suspense fallback={<AdminLoading/>}><Page key={path+search}/></Suspense></AdminLayout>
}
