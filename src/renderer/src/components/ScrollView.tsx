import { useEffect, useRef } from 'react'

interface Props {
  galleryId: string
  pages: string[]
  widthScale: number
  currentIndex: number
  jumpTo: number | null
  onVisible: (index: number) => void
  onJumpDone: () => void
}

export default function ScrollView({ galleryId, pages, widthScale, currentIndex, jumpTo, onVisible, onJumpDone }: Props): JSX.Element {
  const containerRef = useRef<HTMLDivElement>(null)
  const itemRefs = useRef<(HTMLDivElement | null)[]>([])

  useEffect(() => {
    const container = containerRef.current
    if (!container) return
    const observer = new IntersectionObserver(
      (entries) => {
        for (const en of entries) {
          if (en.isIntersecting && en.intersectionRatio > 0.5) {
            onVisible(Number((en.target as HTMLElement).dataset.index))
          }
        }
      },
      { root: container, threshold: [0.5] }
    )
    itemRefs.current.forEach((el) => el && observer.observe(el))
    return () => observer.disconnect()
  }, [pages.length, onVisible])

  useEffect(() => {
    if (jumpTo == null) return
    itemRefs.current[jumpTo]?.scrollIntoView({ block: 'start' })
    onJumpDone()
  }, [jumpTo, onJumpDone])

  return (
    <div className="scroll-view" ref={containerRef}>
      {pages.map((_, i) => (
        <div
          key={i}
          data-index={i}
          ref={(el) => { itemRefs.current[i] = el }}
          className={`scroll-item${i === currentIndex ? ' current' : ''}`}
        >
          <img src={`manga://page/${galleryId}/${i}`} style={{ width: `${widthScale * 100}%` }} alt={`page ${i + 1}`} />
        </div>
      ))}
    </div>
  )
}