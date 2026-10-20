import { useEffect, useState } from 'react'
export default function useDebouncedValue<T>(value: T, delay = 300) {
  const [debounced, setDebounced] = useState(value)
  useEffect(() => { const id = window.setTimeout(() => setDebounced(value), Math.max(250, delay)); return () => window.clearTimeout(id) }, [value, delay])
  return debounced
}
