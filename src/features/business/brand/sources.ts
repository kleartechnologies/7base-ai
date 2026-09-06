import { checkDiscoveryUrl } from '@/features/onboarding/url'
import type { Business } from '@/types'

/**
 * The page sources the Business DNA callable will read on its own, derived
 * from the business document the same way the server derives them (one per
 * kind: the website on file, listed social profiles, pages discovery already
 * read). Kept DOM-free so it can be tested on its own.
 */
export interface KnownSource {
  kind: 'website' | 'facebook' | 'instagram'
  url: string
}

/** The pages the server will read on its own, from the business document. */
export function knownSources(business: Business): KnownSource[] {
  const found = new Map<KnownSource['kind'], string>()
  const consider = (url: string | null | undefined) => {
    if (!url) return
    const check = checkDiscoveryUrl(url)
    if (check.ok && !found.has(check.kind)) found.set(check.kind, check.url)
  }
  consider(business.contact?.website)
  for (const profile of business.contact?.socialProfiles ?? []) consider(profile.url)
  for (const source of business.sources ?? []) {
    if (source.kind === 'website' || source.kind === 'facebook' || source.kind === 'instagram') {
      consider(source.reference)
    }
  }
  consider(business.discovery?.sourceRef)
  return [...found.entries()].map(([kind, url]) => ({ kind, url }))
}
