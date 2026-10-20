import { useEffect, useMemo, useRef, useState } from 'react'
import { Image as ImageIcon, MessageCircle, MoreHorizontal, Paperclip, Search, Send, Smile, X } from 'lucide-react'
import EmojiPicker, { type EmojiClickData } from '../../components/EmojiPicker'
import { adminGet, adminPost, endpoints, getAdminRealtimeTicket, normalizePage, sendAdminRealtimeEvent } from '../adminApi'
import useDebouncedValue from '../hooks/useDebouncedValue'
import { PageHeader, dateText, pretty } from './shared'
import SimpleLoader from '../../components/SimpleLoader'
import { fileToDataUrl } from '../../utils/centralSubscription'
import { createRealtimeChat, type RealtimeChatEvent } from '../../utils/realtimeChat'

const MAX_IMAGE = 2 * 1024 * 1024
const allowedImages = ['image/jpeg','image/png','image/webp']

function initials(value:any){const s=String(value||'C').trim();return (s.split(/\s+/).slice(0,2).map(x=>x[0]).join('')||'C').toUpperCase()}

export default function MessagesPage(){
  const [q,setQ]=useState('');const dq=useDebouncedValue(q,300);const [page,setPage]=useState(1)
  const [rows,setRows]=useState<any[]>([]);const [total,setTotal]=useState(0);const [selectedId,setSelectedId]=useState<string>('')
  const [reply,setReply]=useState('');const [loading,setLoading]=useState(true);const [error,setError]=useState('');const [sending,setSending]=useState(false)
  const [attachment,setAttachment]=useState<{name:string;dataUrl:string}|null>(null);const [emojiOpen,setEmojiOpen]=useState(false)
  const [connected,setConnected]=useState(false);const [typing,setTyping]=useState<Record<string,boolean>>({})
  const messageScrollerRef=useRef<HTMLDivElement|null>(null);const typingTimer=useRef<number|undefined>();const realtimeRef=useRef<ReturnType<typeof createRealtimeChat>|null>(null);const selectedIdRef=useRef('')

  const selected=useMemo(()=>rows.find(r=>String(r.id)===String(selectedId))||rows[0]||null,[rows,selectedId])
  const pages=Math.max(1,Math.ceil(total/20))

  const load=async(keepSelection=true)=>{
    setLoading(true)
    try{
      const query=new URLSearchParams({page:String(page),pageSize:'20'});if(dq)query.set('q',dq)
      const data=await adminGet(`${endpoints.messages}?${query}`);const r=normalizePage(data,page,20)
      setRows(r.rows);setTotal(r.total);setError('')
      if(!keepSelection||!selectedId||!r.rows.some((x:any)=>String(x.id)===String(selectedId)))setSelectedId(String(r.rows[0]?.id||''))
    }catch(e:any){setError(e.message)}finally{setLoading(false)}
  }

  useEffect(()=>{void load(false)},[page,dq])
  useEffect(()=>{selectedIdRef.current=selectedId},[selectedId])
  useEffect(()=>{const el=messageScrollerRef.current;if(el)el.scrollTo({top:el.scrollHeight,behavior:'smooth'})},[selected?.messages?.length,selectedId])

  useEffect(()=>{
    const realtime=createRealtimeChat({
      getTicket:getAdminRealtimeTicket,
      onConnectionChange:setConnected,
      sendFallback:sendAdminRealtimeEvent,
      onEvent:(event:RealtimeChatEvent)=>{
        const id=String(event.installationId||'')
        if(event.type==='presence:online'||event.type==='presence:offline'){
          setRows(prev=>prev.map(r=>String(r.installationId||r.id)===id?{...r,online:event.type==='presence:online',lastSeenAt:event.payload?.lastSeenAt||r.lastSeenAt}:r));return
        }
        if(event.type==='typing:start'||event.type==='typing:stop'){
          setTyping(prev=>({...prev,[id]:event.type==='typing:start'}));return
        }
        if(event.type==='message:seen'){
          setRows(prev=>prev.map(r=>String(r.installationId||r.id)===id?{...r,messages:(r.messages||[]).map((m:any)=>m.sender==='provider'?{...m,isRead:true,seenAt:event.payload?.seenAt||new Date().toISOString()}:m)}:r));return
        }
        if(event.type==='message:new'){
          const incoming=event.payload?.message;if(!incoming)return
          setRows(prev=>prev.map(r=>{
            if(String(r.installationId||r.id)!==id)return r
            const exists=(r.messages||[]).some((m:any)=>String(m.id)===String(incoming.id))
            const active=String(selectedIdRef.current)===String(r.id)
            return {...r,lastMessage:incoming.message,lastMessageAt:incoming.createdAt,unreadCount:active?0:Number(r.unreadCount||0)+(incoming.sender==='customer'?1:0),messages:exists?r.messages:[...(r.messages||[]),incoming]}
          }))
          if(String(selectedIdRef.current)===id){realtime.send('message:seen',{installationId:id});void adminPost(`/api/admin/messages/${encodeURIComponent(id)}/read`,{})}
        }
      },
    });realtimeRef.current=realtime
    return()=>{realtime.close();realtimeRef.current=null}
  },[])

  const choose=(row:any)=>{
    const id=String(row.installationId||row.id);setSelectedId(String(row.id));setEmojiOpen(false)
    setRows(prev=>prev.map(r=>String(r.id)===String(row.id)?{...r,unreadCount:0}:r))
    void adminPost(`/api/admin/messages/${encodeURIComponent(id)}/read`,{}).catch(()=>{})
  }

  const pickImage=async(file?:File|null)=>{
    if(!file)return
    if(!allowedImages.includes(file.type)||file.size>MAX_IMAGE){setError('Use a JPG, PNG or WEBP image up to 2 MB.');return}
    setAttachment({name:file.name,dataUrl:await fileToDataUrl(file)});setError('')
  }

  const send=async()=>{
    if(!selected||(!reply.trim()&&!attachment))return
    const installationId=String(selected.installationId||selected.id);setSending(true);setError('')
    try{
      const result:any=await adminPost(`/api/admin/messages/${encodeURIComponent(installationId)}/reply`,{message:reply.trim(),attachmentDataUrl:attachment?.dataUrl,attachmentName:attachment?.name})
      const sent=result?.message
      if(sent)setRows(prev=>prev.map(r=>String(r.id)===String(selected.id)?{...r,lastMessage:sent.message,lastMessageAt:sent.createdAt,messages:(r.messages||[]).some((m:any)=>String(m.id)===String(sent.id))?r.messages:[...(r.messages||[]),sent]}:r))
      setReply('');setAttachment(null);setEmojiOpen(false)
    }catch(e:any){setError(e.message)}finally{setSending(false)}
  }

  const handleTyping=(value:string)=>{
    setReply(value);if(!selected)return
    const id=String(selected.installationId||selected.id)
    realtimeRef.current?.send(value.trim()?'typing:start':'typing:stop',{installationId:id})
    if(typingTimer.current)window.clearTimeout(typingTimer.current)
    if(value.trim())typingTimer.current=window.setTimeout(()=>realtimeRef.current?.send('typing:stop',{installationId:id}),1200)
  }

  const onEmoji=(data:EmojiClickData)=>{setReply(v=>v+data.emoji)}
  const activeId=String(selected?.installationId||selected?.id||'')

  return <>
    <PageHeader title="Messages" sub="Real-time support conversations with real estate office customers."/>
    {error&&<div className="mb-4 rounded-xl border border-red-200 bg-red-50 p-3 text-sm text-red-700">{error}</div>}
    <div className="h-[calc(100vh-190px)] min-h-[620px] max-h-[820px] overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm lg:grid lg:grid-cols-[350px_minmax(0,1fr)]">
      <aside className="flex min-h-0 flex-col border-b border-slate-200 bg-white lg:border-b-0 lg:border-r">
        <div className="border-b border-slate-100 p-4">
          <div className="mb-3 flex items-center justify-between"><div><div className="font-extrabold text-slate-900">Conversations</div><div className="text-[11px] text-slate-400">{connected?'Live connection':'Reconnecting…'}</div></div><span className={`h-2.5 w-2.5 rounded-full ${connected?'bg-emerald-500':'bg-amber-400'}`}/></div>
          <div className="relative"><Search size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400"/><input value={q} onChange={e=>{setQ(e.target.value);setPage(1)}} placeholder="Search company, person or ID…" className="h-10 w-full rounded-xl border border-slate-200 bg-slate-50 pl-9 pr-3 text-sm outline-none focus:border-slate-400 focus:bg-white"/></div>
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto">{loading?<SimpleLoader minHeight="180px"/>:rows.length?rows.map(r=>{
          const name=pretty(r.businessName||r.profileName||r.customerName);const active=String(selected?.id)===String(r.id)
          return <button key={r.id} onClick={()=>choose(r)} className={`flex w-full gap-3 border-b border-slate-100 p-4 text-left transition ${active?'bg-slate-100':'hover:bg-slate-50'}`}>
            <div className="relative shrink-0">{r.profileLogo?<img src={r.profileLogo} className="h-11 w-11 rounded-xl border border-slate-200 object-cover"/>:<span className="grid h-11 w-11 place-items-center rounded-xl bg-slate-900 text-xs font-extrabold text-white">{initials(name)}</span>}<span className={`absolute -bottom-0.5 -right-0.5 h-3.5 w-3.5 rounded-full border-2 border-white ${r.online?'bg-emerald-500':'bg-slate-300'}`}/></div>
            <div className="min-w-0 flex-1"><div className="flex items-start justify-between gap-2"><div className="truncate text-sm font-extrabold text-slate-800">{name}</div><span className="shrink-0 text-[10px] text-slate-400">{r.lastMessageAt?new Date(r.lastMessageAt).toLocaleTimeString([],{hour:'2-digit',minute:'2-digit'}):''}</span></div><div className="mt-1 flex items-center justify-between gap-2"><p className="truncate text-xs text-slate-500">{r.lastMessage||'No messages yet'}</p>{Number(r.unreadCount||0)>0&&<span className="grid min-w-5 place-items-center rounded-full bg-rose-500 px-1.5 py-0.5 text-[10px] font-bold text-white">{r.unreadCount}</span>}</div><div className="mt-1 text-[10px] text-slate-400">{r.smartOfficeId}</div></div>
          </button>}) : <div className="p-8 text-center text-sm text-slate-400">No conversations found.</div>}</div>
        <div className="flex items-center justify-between border-t p-3 text-[11px] text-slate-500"><button disabled={page<=1} onClick={()=>setPage(p=>p-1)} className="rounded-lg border px-3 py-1.5 disabled:opacity-40">Prev</button><span>{page}/{pages}</span><button disabled={page>=pages} onClick={()=>setPage(p=>p+1)} className="rounded-lg border px-3 py-1.5 disabled:opacity-40">Next</button></div>
      </aside>

      <section className="flex h-full min-h-0 min-w-0 flex-col bg-slate-50/60">
        {selected?<>
          <header className="flex items-center justify-between border-b border-slate-200 bg-white px-5 py-4"><div className="flex min-w-0 items-center gap-3">{selected.profileLogo?<img src={selected.profileLogo} className="h-11 w-11 rounded-xl border object-cover"/>:<span className="grid h-11 w-11 place-items-center rounded-xl bg-slate-900 text-xs font-extrabold text-white">{initials(selected.businessName||selected.profileName)}</span>}<div className="min-w-0"><div className="truncate font-extrabold text-slate-900">{pretty(selected.businessName||selected.profileName||selected.customerName)}</div><div className="mt-0.5 flex items-center gap-2 text-[11px] text-slate-500"><span className={`h-2 w-2 rounded-full ${selected.online?'bg-emerald-500':'bg-slate-300'}`}/><span>{selected.online?'Online':`Last seen ${dateText(selected.lastSeenAt)}`}</span>{selected.smartOfficeId&&<><span>·</span><span>{selected.smartOfficeId}</span></>}</div></div></div><button className="grid h-9 w-9 place-items-center rounded-lg border border-slate-200 bg-white text-slate-500"><MoreHorizontal size={17}/></button></header>
          <div ref={messageScrollerRef} className="min-h-0 flex-1 overflow-y-auto p-4 sm:p-6"><div className="mx-auto max-w-4xl space-y-3">{(selected.messages||[]).map((m:any)=>{const mine=m.sender==='provider';return <div key={m.id} className={`flex ${mine?'justify-end':'justify-start'}`}><div className={`max-w-[82%] rounded-2xl px-4 py-3 shadow-sm ${mine?'rounded-br-md bg-slate-900 text-white':'rounded-bl-md border border-slate-200 bg-white text-slate-800'}`}>
            {m.message&&<div className="whitespace-pre-wrap text-sm leading-6">{m.message}</div>}
            {m.attachmentUrl&&<button onClick={()=>window.open(m.attachmentUrl,'_blank')} className="mt-2 block max-w-full overflow-hidden rounded-xl bg-black/5"><img src={m.attachmentUrl} alt={m.attachmentName||'Image'} className="max-h-80 max-w-full object-contain" loading="lazy"/></button>}
            <div className={`mt-2 flex items-center justify-end gap-1.5 text-[10px] ${mine?'text-slate-300':'text-slate-400'}`}><span>{m.createdAt?new Date(m.createdAt).toLocaleTimeString([],{hour:'2-digit',minute:'2-digit'}):''}</span>{mine&&<span>{m.isRead||m.seenAt?'Seen':'Sent'}</span>}</div>
          </div></div>})}{typing[activeId]&&<div className="flex justify-start"><div className="rounded-2xl rounded-bl-md border bg-white px-4 py-2 text-xs text-slate-500">Typing<span className="animate-pulse">…</span></div></div>}</div></div>
          <div className="relative border-t border-slate-200 bg-white p-4">{attachment&&<div className="mb-3 flex items-center gap-3 rounded-xl border border-slate-200 bg-slate-50 p-2"><img src={attachment.dataUrl} className="h-14 w-14 rounded-lg object-cover"/><div className="min-w-0 flex-1"><div className="truncate text-xs font-bold">{attachment.name}</div><div className="text-[10px] text-slate-400">Image ready to send · max 2 MB</div></div><button onClick={()=>setAttachment(null)} className="grid h-8 w-8 place-items-center rounded-lg hover:bg-slate-200"><X size={15}/></button></div>}
            {emojiOpen&&<div className="absolute bottom-[86px] left-4 z-20 w-[340px] max-w-[calc(100vw-2rem)] overflow-hidden rounded-2xl border bg-white shadow-2xl"><EmojiPicker onEmojiClick={onEmoji} lazyLoadEmojis width="100%" height={360}/></div>}
            <div className="mx-auto flex max-w-4xl items-end gap-2 rounded-2xl border border-slate-200 bg-slate-50 p-2"><button onClick={()=>setEmojiOpen(v=>!v)} className="grid h-10 w-10 shrink-0 place-items-center rounded-xl text-slate-500 hover:bg-white"><Smile size={20}/></button><label className="grid h-10 w-10 shrink-0 cursor-pointer place-items-center rounded-xl text-slate-500 hover:bg-white"><Paperclip size={19}/><input type="file" accept="image/jpeg,image/png,image/webp" className="hidden" onChange={e=>void pickImage(e.target.files?.[0])}/></label><textarea value={reply} onChange={e=>handleTyping(e.target.value)} onKeyDown={e=>{if(e.key==='Enter'&&!e.shiftKey){e.preventDefault();void send()}}} rows={1} placeholder="Write a message…" className="max-h-28 min-h-10 flex-1 resize-none bg-transparent px-2 py-2 text-sm outline-none"/><button onClick={()=>void send()} disabled={(!reply.trim()&&!attachment)||sending} className="grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-slate-900 text-white disabled:opacity-40"><Send size={18}/></button></div>
          </div>
        </>:<div className="grid flex-1 place-items-center"><div className="text-center text-slate-400"><span className="mx-auto grid h-16 w-16 place-items-center rounded-2xl bg-white shadow-sm"><MessageCircle size={30}/></span><div className="mt-4 font-bold text-slate-600">Select a conversation</div><div className="mt-1 text-sm">Customer messages will appear here in real time.</div></div></div>}
      </section>
    </div>
  </>
}
