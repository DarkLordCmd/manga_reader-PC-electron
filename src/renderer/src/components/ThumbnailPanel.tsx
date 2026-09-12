import { useEffect, useRef } from 'react'

interface Props {
  galleryId: string
  pageCount: number
  currentIndex: number
  thumbSize: number
  onSelect: (index: number) => void
}

export default function ThumbnailPanel({ galleryId, pageCount, currentIndex, thumbSize, onSelect }: Props): JSX.Element {
  const refs = useRef<(HTMLButtonElement | null)[]>([])
  useEffect(() => {
    refs.current[currentIndex]?.scrollIntoView({ block: 'center', behavior: 'smooth' })
  }, [currentIndex])

  return (
    <div className="thumb-panel">
      {Array.from({ length: pageCount }, (_, i) => (
        <button
          key={i}
          ref={(el) => { refs.current[i] = el }}
          className={`thumb${i === currentIndex ? ' current' : ''}`}
          onClick={() => onSelect(i)}
          style={{ width: thumbSize }}
        >
          <img src={`manga://page/${galleryId}/${i}`} alt={`${i + 1}`} style={{ width: thumbSize }} />
          <span>{i + 1}</span>
        </button>
      ))}
    </div>
  )
}