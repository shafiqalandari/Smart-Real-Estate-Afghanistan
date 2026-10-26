/** Always show a useful state even when a lazily loaded module cannot start. */
const root = document.getElementById('root')
const localHost = ['localhost', '127.0.0.1', '0.0.0.0'].includes(location.hostname)

function showFailure(reason: unknown): void {
  console.error('Real Estate startup error:', reason)
  if (!root) return
  root.replaceChildren()
  const screen = document.createElement('main')
  screen.setAttribute('dir', 'rtl')
  Object.assign(screen.style, {
    minHeight: '100vh', display: 'grid', placeItems: 'center', padding: '24px',
    background: '#08111f', color: '#e2e8f0', fontFamily: 'Vazirmatn, Tahoma, sans-serif'
  })
  const card = document.createElement('section')
  Object.assign(card.style, {
    maxWidth: '560px', width: '100%', border: '1px solid #e2e8f0',
    borderRadius: '24px', background: '#0f1b2f', padding: '28px',
    boxShadow: '0 15px 40px rgba(15,23,42,.06)'
  })
  const title = document.createElement('h1')
  title.textContent = 'سیستم رهنمای معاملات و کرایی'
  title.style.fontSize = '22px'
  const help = document.createElement('p')
  help.textContent = 'برنامه هنگام شروع با یک خطا روبه‌رو شد. صفحه را دوباره باز کنید. اگر مشکل ادامه داشت، متن خطا را به پشتیبان بفرستید.'
  help.style.lineHeight = '1.9'
  const detail = document.createElement('pre')
  detail.textContent = localHost ? String(reason instanceof Error ? `${reason.name}: ${reason.message}` : reason) : 'خطای بارگذاری برنامه'
  Object.assign(detail.style, {fontSize: '12px', overflowWrap: 'anywhere', whiteSpace: 'pre-wrap', background: '#132540', padding: '12px', borderRadius: '10px', direction: 'ltr', textAlign: 'left'})
  const reload = document.createElement('button')
  reload.type = 'button'
  reload.textContent = 'تلاش دوباره'
  Object.assign(reload.style, {marginTop: '10px', border: '0', borderRadius: '10px', background: '#e7a008', color: '#171717', padding: '12px 22px', cursor: 'pointer', fontWeight: 'bold'})
  reload.addEventListener('click', () => location.reload())
  card.append(title, help, detail, reload)
  screen.append(card)
  root.append(screen)
}

if (root) {
  root.setAttribute('aria-busy', 'true')
  root.innerHTML = '<div data-estate-bootstrap="1" dir="rtl" style="min-height:100vh;display:grid;place-items:center;background:#08111f;color:#e2e8f0;font-family:Vazirmatn,Tahoma,sans-serif"><div style="text-align:center"><div style="font-size:14px;font-weight:800;color:#fbbf24;letter-spacing:.08em;margin-bottom:12px">SMART REAL ESTATE AFGHANISTAN</div><div style="font-size:16px">در حال بارگذاری سیستم رهنمای معاملات...</div></div></div>'
}

window.addEventListener('unhandledrejection', e => {
  if (root?.querySelector('[data-estate-bootstrap]')) showFailure(e.reason)
})

import('./main').catch(showFailure)
