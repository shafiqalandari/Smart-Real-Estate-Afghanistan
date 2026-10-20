import type { ReactNode } from 'react'
import SimpleLoader from '../../components/SimpleLoader'
export type Column<T> = { key: string; title: string; render: (row:T) => ReactNode; className?: string }
export default function PaginatedTable<T extends { id?: string | number }>({ rows, columns, loading, empty='No records found.', page, pageSize=20, total, onPageChange, onRowClick }: { rows:T[]; columns:Column<T>[]; loading?:boolean; empty?:string; page:number; pageSize?:number; total:number; onPageChange:(page:number)=>void; onRowClick?:(row:T)=>void }) {
  const pages = Math.max(1, Math.ceil(total / pageSize))
  return <div className="overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm">
    <div className="overflow-x-auto"><table className="w-full min-w-[760px] text-sm"><thead className="bg-slate-50 text-slate-500"><tr>{columns.map(c=><th key={c.key} className={`px-4 py-3 text-left font-semibold ${c.className||''}`}>{c.title}</th>)}</tr></thead><tbody>
      {loading ? <tr><td colSpan={columns.length} className="px-4 py-8 text-center text-slate-500"><SimpleLoader minHeight="90px" /></td></tr> : rows.length ? rows.map((row,i)=><tr key={String(row.id ?? i)} onClick={onRowClick?()=>onRowClick(row):undefined} className={`border-t border-slate-100 hover:bg-slate-50/70 ${onRowClick?'cursor-pointer':''}`}>{columns.map(c=><td key={c.key} className={`px-4 py-3 align-middle ${c.className||''}`}>{c.render(row)}</td>)}</tr>) : <tr><td colSpan={columns.length} className="px-4 py-14 text-center text-slate-500">{empty}</td></tr>}
    </tbody></table></div>
    <div className="flex items-center justify-between border-t border-slate-200 px-4 py-3 text-xs text-slate-500"><span>{total.toLocaleString()} records</span><div className="flex items-center gap-2"><button disabled={page<=1||loading} onClick={()=>onPageChange(page-1)} className="rounded-lg border border-slate-200 px-3 py-1.5 disabled:opacity-40">Previous</button><span>Page {page} / {pages}</span><button disabled={page>=pages||loading} onClick={()=>onPageChange(page+1)} className="rounded-lg border border-slate-200 px-3 py-1.5 disabled:opacity-40">Next</button></div></div>
  </div>
}
