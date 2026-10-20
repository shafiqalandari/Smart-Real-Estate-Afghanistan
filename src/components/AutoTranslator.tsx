import { useEffect } from 'react'
import { translateText, type Language } from '../i18n'

const ATTRS=['placeholder','title','aria-label'] as const
export default function AutoTranslator({language}:{language:Language}){
 useEffect(()=>{
   const apply=(root:ParentNode=document)=>{
     const walker=document.createTreeWalker(root,NodeFilter.SHOW_TEXT)
     const nodes:Text[]=[]; let n:Node|null
     while((n=walker.nextNode()))nodes.push(n as Text)
     nodes.forEach(node=>{
       const p=node.parentElement
       if(!p||['SCRIPT','STYLE'].includes(p.tagName))return
       const raw=node.nodeValue||''
       const next=translateText(raw,language)
       if(next!==raw)node.nodeValue=next
     })
     if(root instanceof Element){
       const all=[root,...Array.from(root.querySelectorAll('*'))]
       all.forEach(el=>{
         if(el instanceof HTMLOptionElement && !el.hasAttribute('value')) el.setAttribute('value',el.textContent||'')
         ATTRS.forEach(a=>{const v=el.getAttribute(a);if(v){const next=translateText(v,language);if(next!==v)el.setAttribute(a,next)}})
       })
     } else document.querySelectorAll('*').forEach(el=>{
       if(el instanceof HTMLOptionElement && !el.hasAttribute('value')) el.setAttribute('value',el.textContent||'')
       ATTRS.forEach(a=>{const v=el.getAttribute(a);if(v){const next=translateText(v,language);if(next!==v)el.setAttribute(a,next)}})
     })
   }
   apply()
   const observer=new MutationObserver(ms=>ms.forEach(m=>{if(m.type==='characterData'){const t=m.target as Text;const next=translateText(t.nodeValue||'',language);if(next!==t.nodeValue)t.nodeValue=next;return}m.addedNodes.forEach(node=>{if(node.nodeType===Node.ELEMENT_NODE)apply(node as Element);else if(node.nodeType===Node.TEXT_NODE){const t=node as Text;const next=translateText(t.nodeValue||'',language);if(next!==t.nodeValue)t.nodeValue=next}})}))
   observer.observe(document.body,{childList:true,subtree:true,characterData:true})
   return()=>observer.disconnect()
 },[language])
 return null
}
