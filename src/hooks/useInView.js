import { useEffect, useRef, useState } from 'react'

// Viewport-gating for gallery thumbnails: returns [ref, inView]. `inView` flips
// true once the element scrolls into view (with a margin so the thumbnail is
// ready slightly before) and STAYS true — one-shot, so the (expensive) thumbnail
// work runs once when the card first appears, not on every scroll. Falls back to
// eager rendering where IntersectionObserver is unavailable.
export function useInView(rootMargin = '300px') {
  const ref = useRef(null)
  const [inView, setInView] = useState(false)

  useEffect(() => {
    if (inView) return
    const el = ref.current
    if (!el) return
    if (typeof IntersectionObserver === 'undefined') { setInView(true); return }
    const io = new IntersectionObserver(([entry]) => {
      if (entry.isIntersecting) { setInView(true); io.disconnect() }
    }, { rootMargin })
    io.observe(el)
    return () => io.disconnect()
  }, [inView, rootMargin])

  return [ref, inView]
}
