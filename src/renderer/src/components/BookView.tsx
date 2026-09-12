interface Props {
  galleryId: string
  pageCount: number
  currentIndex: number
  pagesPerScreen: number
  direction: 'Ltr' | 'Rtl'
  onPrev: () => void
  onNext: () => void
}

export default function BookView({ galleryId, pageCount, currentIndex, pagesPerScreen, direction, onPrev, onNext }: Props): JSX.Element {
  const start = Math.min(currentIndex, Math.max(0, pageCount - 1))
  const indices = Array.from({ length: Math.min(pagesPerScreen, pageCount - start) }, (_, k) => start + k)
  const ordered = direction === 'Rtl' ? [...indices].reverse() : indices

  return (
    <div className="book-view">
      <div className="book-zone left" onClick={onPrev} />
      <div className="book-pages">
        {ordered.map((i) => (
          <img key={i} src={`manga://page/${galleryId}/${i}`} alt={`page ${i + 1}`} />
        ))}
      </div>
      <div className="book-zone right" onClick={onNext} />
    </div>
  )
}