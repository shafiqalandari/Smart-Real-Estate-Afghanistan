import React,{Suspense,lazy,useState} from 'react'
import ReactDOM from 'react-dom/client'
import './index.css'
import './estate-premium.css'
import './estate-next.css'
import SimpleLoader from './components/SimpleLoader'
import RuntimeErrorBoundary from './components/RuntimeErrorBoundary'
import type { Language } from './i18n'
const App=lazy(()=>import('./App'))
const AdminRouter=lazy(()=>import('./admin/AdminRouter'))
const Subscription=lazy(()=>import('./pages/Subscription'))
const EstateAccessGate=lazy(()=>import('./components/EstateAccessGate'))
const IntroSplash=lazy(()=>import('./components/IntroSplash'))
function Entry(){const p=window.location.pathname;const lang=((localStorage.getItem('app-language') as Language)||'دری');const [intro,setIntro]=useState(()=>!(sessionStorage.getItem('estate-intro-seen-v2')==='1') && !(p==='/admin'||p.startsWith('/admin/')));if(!(p==='/admin'||p.startsWith('/admin/'))&&intro)return <IntroSplash language={lang} onDone={()=>setIntro(false)}/>;if(p==='/admin'||p.startsWith('/admin/'))return <AdminRouter/>;if(p==='/subscription'||p.startsWith('/subscription/'))return <EstateAccessGate><div className="min-h-screen bg-page p-4 sm:p-6"><Subscription language={lang}/></div></EstateAccessGate>;return <EstateAccessGate><App/></EstateAccessGate>}
ReactDOM.createRoot(document.getElementById('root')!).render(<React.StrictMode><RuntimeErrorBoundary><Suspense fallback={<SimpleLoader fullScreen label="در حال بارگذاری..."/>}><Entry/></Suspense></RuntimeErrorBoundary></React.StrictMode>)
const local=['localhost','127.0.0.1','0.0.0.0'].includes(location.hostname);if('serviceWorker'in navigator&&!local)window.addEventListener('load',()=>navigator.serviceWorker.register('/sw.js').catch(console.error));if('serviceWorker'in navigator&&local)navigator.serviceWorker.getRegistrations().then(x=>x.forEach(r=>r.unregister())).catch(console.error)
