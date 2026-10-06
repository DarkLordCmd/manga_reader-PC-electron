import { useMemo, useState } from 'react'
import PageImg from './PageImg'

interface Props {
  galleryId: string
  pageCount: number
  currentIndex: number
  pagesPerScreen: number
  direction: 'Ltr' | 'Rtl'
  onPrev: () => void
  onNext: () => void
}

/** Paged reader: tap zones, swipe, first-page-alone pairing (JHenTai-style
 * double-column spread where page 1 is shown alone so pairs stay coherent). */
export default function BookView({ galleryId, pageCount, currentIndex, pagesPerScreen, direction, onPrev, onNext }: Props): JSX.Element {
  const [press, setPress] = useState<{ x: number; y: number } | null>(null)

  const start = useMemo(() => {
    const first = Math.min(Math.max(0, currentIndex), Math.max(0, pageCount - 1))
    // Pair alignment: keep the spread 1-alive (page 1 alone) so two-page
    // spreads never merge unrelated pages.
    if (pagesPerScreen > 1 && first > 0) {
      return Math.min(first - (first % pagesPerScreen), Math.max(0, pageCount - 1))
    }
    return first
  }, [currentIndex, pageCount, pagesPerScreen])

  const indices = Array.from({ length: Math.min(pagesPerScreen, pageCount - start) }, (_, k) => start + k)
  const ordered = direction === 'Rtl' ? [...indices].reverse() : indices

  const onPointerDown = (e: React.PointerEvent): void => { setPress({ x: e.clientX, y: e.clientY }) }
  const onPointerUp = (e: React.PointerEvent): void => {
    if (!press) return
    const dx = e.clientX - press.x
    const dy = e.clientY - press.y
    setPress(null)
    if (Math.abs(dx) < 60 || Math.abs(dx) < Math.abs(dy)) return
    // LTR: swipe left = next; RTL: swipe left = prev (reverse reading).
    if ((direction === 'Rtl') === dx > 0) onNext()
    else onPrev()
  }

  return (
    <div className="book-view" onPointerDown={onPointerDown} onPointerUp={onPointerUp}>
      <div className="book-zone left" onClick={direction === 'Rtl' ? onNext : onPrev} />
      <div className="book-pages">
        {ordered.map((i) => (
          <PageImg key={i} galleryId={galleryId} index={i} />
        ))}
      </div>
      <div className="book-zone right" onClick={direction === 'Rtl' ? onPrev : onNext} />
    </div>
  )
}
