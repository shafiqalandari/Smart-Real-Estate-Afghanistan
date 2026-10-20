import React,{Suspense,lazy,useState} from 'react'
import ReactDOM from 'react-dom/client'
import './index.css'
import SimpleLoader from './components/SimpleLoader'
import type { Language } from './i18n'
const App=lazy(()=>import('./App'))
const AdminRouter=lazy(()=>import('./admin/AdminRouter'))
const Subscription=lazy(()=>import('./pages/Subscription'))
const EstateAccessGate=lazy(()=>import('./components/EstateAccessGate'))
const IntroSplash=lazy(()=>import('./components/IntroSplash'))
function Entry(){const p=window.location.pathname;const lang=((localStorage.getItem('app-language') as Language)||'دری');const [intro,setIntro]=useState(()=>false);if(!(p==='/admin'||p.startsWith('/admin/'))&&intro)return <IntroSplash language={lang} onDone={()=>setIntro(false)}/>;if(p==='/admin'||p.startsWith('/admin/'))return <AdminRouter/>;if(p==='/subscription'||p.startsWith('/subscription/'))return <EstateAccessGate><div className="min-h-screen bg-page p-4 sm:p-6"><Subscription language={lang}/></div></EstateAccessGate>;return <EstateAccessGate><App/></EstateAccessGate>}
ReactDOM.createRoot(document.getElementById('root')!).render(<React.StrictMode><Suspense fallback={<SimpleLoader fullScreen/>}><Entry/></Suspense></React.StrictMode>)
const local=['localhost','127.0.0.1','0.0.0.0'].includes(location.hostname);if('serviceWorker'in navigator&&!local)window.addEventListener('load',()=>navigator.serviceWorker.register('/sw.js').catch(console.error));if('serviceWorker'in navigator&&local)navigator.serviceWorker.getRegistrations().then(x=>x.forEach(r=>r.unregister())).catch(console.error)
