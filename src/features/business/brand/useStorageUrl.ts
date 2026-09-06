import { useEffect, useState } from 'react'
import { getAssetUrl } from '@/services/storage/storage.service'

/**
 * Resolves a Storage path to a short-lived URL, keyed so a stale path never
 * shows the previous file's bytes — the same pattern as the Assets page.
 */
export function useStorageUrl(storagePath: string | null): string | null {
  const [resolved, setResolved] = useState<{ path: string; url: string } | null>(null)

  useEffect(() => {
    if (!storagePath) return
    let cancelled = false
    getAssetUrl(storagePath)
      .then((url) => {
        if (!cancelled) setResolved({ path: storagePath, url })
      })
      .catch(() => {
        // Renders without a preview; everything else still works.
      })
    return () => {
      cancelled = true
    }
  }, [storagePath])

  return storagePath && resolved?.path === storagePath ? resolved.url : null
}
