export const ADMIN_PATH='/admin'
export function adminNavigate(path:string){ if(window.location.pathname+window.location.search!==path){ window.history.pushState({},'',path); window.dispatchEvent(new PopStateEvent('popstate')) } }
