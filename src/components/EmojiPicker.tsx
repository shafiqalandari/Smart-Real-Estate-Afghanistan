import { useMemo, useState } from 'react'
import { Search } from 'lucide-react'

export type EmojiClickData = { emoji:string }

const groups = [
  { id:'smileys', label:'😀', ranges:[[0x1F600,0x1F64F]], extras:['🙂','🥲','🥹','🫠','🫡','🫢','🫣','🤭','🤫','🤔','🫥','😶‍🌫️','😮‍💨','😵‍💫','❤️‍🔥','❤️‍🩹'] },
  { id:'people', label:'👋', ranges:[[0x1F466,0x1F487],[0x1F590,0x1F596],[0x1F918,0x1F93A]], extras:['👋','🤚','🖐️','✋','🖖','🫱','🫲','🫳','🫴','👌','🤌','🤏','✌️','🤞','🫰','🤟','🤘','🤙','👈','👉','👆','👇','☝️','🫵','👍','👎','✊','👊','🤛','🤜','👏','🙌','🫶','👐','🤲','🤝','🙏','💪','🦾','🦿'] },
  { id:'animals', label:'🐶', ranges:[[0x1F400,0x1F43E],[0x1F980,0x1F9AE]], extras:['🐶','🐱','🐭','🐹','🐰','🦊','🐻','🐼','🐻‍❄️','🐨','🐯','🦁','🐮','🐷','🐸','🐵','🙈','🙉','🙊','🐔','🐧','🐦','🐤','🦄'] },
  { id:'food', label:'🍕', ranges:[[0x1F32D,0x1F37F]], extras:['🍎','🍐','🍊','🍋','🍌','🍉','🍇','🍓','🫐','🍈','🍒','🍑','🥭','🍍','🥥','🥝','🍅','🥑','🍕','🍔','🍟','🌭','🍿','🧁','☕','🫖'] },
  { id:'travel', label:'🚗', ranges:[[0x1F680,0x1F6C5]], extras:['🚗','🚕','🚙','🚌','🚎','🏎️','🚓','🚑','🚒','🚚','🚛','🚜','🛵','🏍️','🚲','✈️','🚀','🛸','🚁','⛵','🚢'] },
  { id:'activities', label:'⚽', ranges:[[0x1F3A0,0x1F3FA]], extras:['⚽','🏀','🏈','⚾','🥎','🎾','🏐','🏉','🥏','🎱','🪀','🏓','🏸','🏒','🏑','🥍','🏏','⛳','🏹','🎣','🤿','🥊','🥋','🎽','🛹','🛼'] },
  { id:'objects', label:'💡', ranges:[[0x1F4A0,0x1F5FF]], extras:['⌚','📱','💻','⌨️','🖥️','🖨️','🖱️','💾','💿','📷','📹','☎️','📺','📻','⏰','🔋','💡','🔦','🕯️','🧯','🛒','💎','⚖️','🔧','🔨','🪛','⚙️','🧰'] },
  { id:'symbols', label:'❤️', ranges:[[0x2600,0x26FF],[0x2700,0x27BF]], extras:['❤️','🧡','💛','💚','💙','💜','🖤','🤍','🤎','💔','❣️','💕','💞','💓','💗','💖','💘','💝','💟','✅','❌','⚠️','❗','❓','💯','✨','🔥','⭐','🌟'] },
  { id:'flags', label:'🏳️', ranges:[[0x1F1E6,0x1F1FF]], extras:['🏳️','🏴','🏁','🚩','🏳️‍🌈','🏳️‍⚧️','🇦🇫','🇺🇸','🇬🇧','🇨🇦','🇩🇪','🇫🇷','🇹🇷','🇨🇳','🇯🇵','🇮🇳','🇵🇰','🇦🇪'] },
] as const

function codepoints(ranges:readonly (readonly [number,number])[]) {
  const values:string[]=[]
  for(const [start,end] of ranges){for(let cp=start;cp<=end;cp++){try{values.push(String.fromCodePoint(cp))}catch{}}}
  return values
}

export default function EmojiPicker({onEmojiClick,height=360,width='100%'}:{onEmojiClick:(data:EmojiClickData)=>void;height?:number;width?:number|string;lazyLoadEmojis?:boolean}){
  const [group,setGroup]=useState(0);const [query,setQuery]=useState('')
  const emojis=useMemo(()=>{const g=groups[group];const set=new Set<string>([...g.extras,...codepoints(g.ranges)]);return [...set].filter(Boolean)},[group])
  const visible=query.trim()?emojis.filter(e=>e.includes(query.trim())):emojis
  return <div className="flex flex-col bg-white text-slate-900" style={{height,width}}>
    <div className="flex gap-1 overflow-x-auto border-b border-slate-100 p-2">{groups.map((g,i)=><button key={g.id} onClick={()=>{setGroup(i);setQuery('')}} className={`grid h-8 w-8 shrink-0 place-items-center rounded-lg text-lg ${i===group?'bg-slate-100':'hover:bg-slate-50'}`}>{g.label}</button>)}</div>
    <div className="border-b border-slate-100 p-2"><div className="relative"><Search size={14} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-slate-400"/><input value={query} onChange={e=>setQuery(e.target.value)} placeholder="Emoji" className="h-8 w-full rounded-lg border border-slate-200 pl-8 pr-2 text-xs outline-none"/></div></div>
    <div className="grid flex-1 grid-cols-8 content-start gap-1 overflow-y-auto p-2">{visible.map((emoji,i)=><button key={`${emoji}-${i}`} onClick={()=>onEmojiClick({emoji})} className="grid h-9 w-9 place-items-center rounded-lg text-xl hover:bg-slate-100">{emoji}</button>)}</div>
  </div>
}
