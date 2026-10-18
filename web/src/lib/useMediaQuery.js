import { useSyncExternalStore } from 'react'

/** true เมื่อหน้าจอตรงกับ media query เช่น useMediaQuery('(min-width: 768px)') */
export function useMediaQuery(query) {
  return useSyncExternalStore(
    (onChange) => {
      const mq = window.matchMedia(query)
      mq.addEventListener('change', onChange)
      return () => mq.removeEventListener('change', onChange)
    },
    () => window.matchMedia(query).matches,
    () => false,
  )
}
