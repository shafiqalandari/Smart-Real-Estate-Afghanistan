import React from 'react'
import { BRAND_DARI } from '../branding'

type Props = { children: React.ReactNode }
type State = { error: Error | null }

/** Keep rendering errors from turning the complete app into an empty screen. */
export default class RuntimeErrorBoundary extends React.Component<Props, State> {
  state: State = { error: null }

  static getDerivedStateFromError(error: Error): State { return { error } }
  componentDidCatch(error: Error, info: React.ErrorInfo) {
    console.error('Real estate UI error:', error, info.componentStack)
  }
  render() {
    if (!this.state.error) return this.props.children
    const localHost = ['localhost', '127.0.0.1'].includes(window.location.hostname)
    return <main dir="rtl" className="grid min-h-screen place-items-center bg-slate-50 px-4 py-10 text-slate-900">
      <section className="w-full max-w-lg rounded-3xl border border-slate-200 bg-white p-7 shadow-xl">
        <h1 className="text-xl font-black">{BRAND_DARI}</h1>
        <p className="mt-4 text-sm leading-7">هنگام نمایش این صفحه خطایی رخ داد. دوباره تلاش کنید. در صورت تکرار، متن خطا را برای بررسی بفرستید.</p>
        {localHost && <pre dir="ltr" className="mt-4 max-h-48 overflow-auto whitespace-pre-wrap break-all rounded-xl bg-slate-100 p-3 text-xs text-red-700">{this.state.error.message}</pre>}
        <button type="button" className="mt-5 rounded-xl bg-amber-500 px-5 py-3 font-bold text-slate-950" onClick={() => window.location.reload()}>بارگذاری دوباره</button>
      </section>
    </main>
  }
}
