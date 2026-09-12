import { useCallback, useState } from 'react'
import type { OpenFolderResult } from '@shared/ipc'

export function useGallery(): {
  gallery: OpenFolderResult | null
  openFolder: () => Promise<void>
  openPath: (p: string) => Promise<void>
} {
  const [gallery, setGallery] = useState<OpenFolderResult | null>(null)
  const openFolder = useCallback(async () => {
    const g = await window.api.pickFolder()
    if (g) setGallery(g)
  }, [])
  const openPath = useCallback(async (p: string) => {
    const g = await window.api.openFolder(p)
    if (g) setGallery(g)
  }, [])
  return { gallery, openFolder, openPath }
}