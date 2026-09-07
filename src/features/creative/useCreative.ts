import { useEffect, useState } from 'react'
import { observeCreative } from '@/services/creatives/creative.service'
import type { Creative } from '@/types'

/**
 * One persisted creative, live. Chat cards reference a creative by id and
 * render it from the document itself — the same document the Creative page
 * lists — so an edit, a retried image or a brand change shows the same way
 * everywhere, and the poster in the thread can never be a different picture
 * from the poster in the library.
 */
export type CreativeLookup =
  | { status: 'loading'; creative: null }
  | { status: 'ready'; creative: Creative }
  | { status: 'missing'; creative: null }

export function useCreative(creativeId: string): CreativeLookup {
  const [state, setState] = useState<{ id: string; lookup: CreativeLookup } | null>(null)

  useEffect(() => {
    return observeCreative(
      creativeId,
      (creative) => {
        setState({
          id: creativeId,
          lookup: creative ? { status: 'ready', creative } : { status: 'missing', creative: null },
        })
      },
      () => setState({ id: creativeId, lookup: { status: 'missing', creative: null } }),
    )
  }, [creativeId])

  return state && state.id === creativeId ? state.lookup : { status: 'loading', creative: null }
}
