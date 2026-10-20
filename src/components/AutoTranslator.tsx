import { useEffect } from 'react'
import { translateText, type Language } from '../i18n'

const ATTRS = ['placeholder', 'title', 'aria-label'] as const
type AttrName = typeof ATTRS[number]
type TextState = { source: string; translated: string }
type AttrState = { source: string; translated: string }

function shouldSkip(node: Node) {
  const parent = node.parentElement
  return Boolean(parent && ['SCRIPT', 'STYLE', 'NOSCRIPT', 'TEXTAREA'].includes(parent.tagName))
}

function textNodes(root: Node) {
  const nodes: Text[] = []
  if (root.nodeType === Node.TEXT_NODE) {
    nodes.push(root as Text)
    return nodes
  }
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT)
  let current: Node | null
  while ((current = walker.nextNode())) nodes.push(current as Text)
  return nodes
}

function elements(root: Node) {
  if (!(root instanceof Element)) return []
  return [root, ...Array.from(root.querySelectorAll('*'))]
}

export default function AutoTranslator({ language }: { language: Language }) {
  useEffect(() => {
    const textState = new WeakMap<Text, TextState>()
    const attrState = new WeakMap<Element, Map<AttrName, AttrState>>()
    const pending = new Set<Node>()
    let frame = 0

    const translateNode = (node: Text) => {
      if (shouldSkip(node)) return
      const current = node.nodeValue || ''
      const previous = textState.get(node)
      const source = previous && current === previous.translated ? previous.source : current
      const translated = translateText(source, language)
      textState.set(node, { source, translated })
      if (translated !== current) node.nodeValue = translated
    }

    const translateElement = (element: Element) => {
      let states = attrState.get(element)
      if (!states) {
        states = new Map<AttrName, AttrState>()
        attrState.set(element, states)
      }
      for (const attr of ATTRS) {
        const current = element.getAttribute(attr)
        if (!current) continue
        const previous = states.get(attr)
        const source = previous && current === previous.translated ? previous.source : current
        const translated = translateText(source, language)
        states.set(attr, { source, translated })
        if (translated !== current) element.setAttribute(attr, translated)
      }
      if (element instanceof HTMLOptionElement && !element.hasAttribute('value')) {
        element.setAttribute('value', element.textContent || '')
      }
    }

    const translateRoot = (root: Node) => {
      textNodes(root).forEach(translateNode)
      elements(root).forEach(translateElement)
    }

    const schedule = (root: Node) => {
      pending.add(root)
      if (frame) return
      frame = window.requestAnimationFrame(() => {
        frame = 0
        const roots = [...pending]
        pending.clear()
        roots.forEach(translateRoot)
      })
    }

    schedule(document.body)
    const observer = new MutationObserver((mutations) => {
      for (const mutation of mutations) {
        mutation.addedNodes.forEach(schedule)
        if (mutation.type === 'characterData' && mutation.target) schedule(mutation.target)
      }
    })
    observer.observe(document.body, { childList: true, subtree: true, characterData: true })

    return () => {
      observer.disconnect()
      if (frame) window.cancelAnimationFrame(frame)
    }
  }, [language])

  return null
}
