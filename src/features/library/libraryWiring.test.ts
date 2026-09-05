import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { ROUTES } from '@/app/routes/paths'
import { WORKSPACE_NAV } from '@/features/shell/navigation'

/**
 * The Library's wiring outside its own module: the route constant, the
 * sidebar entry, and the one Firestore index its queries depend on.
 */

describe('library route wiring', () => {
  it('exposes /library as a route', () => {
    expect(ROUTES.library).toBe('/library')
  })

  it('has a Library entry in the workspace nav, after Assets', () => {
    const labelKeys = WORKSPACE_NAV.map((item) => item.labelKey)
    const library = WORKSPACE_NAV.find((item) => item.labelKey === 'nav.library')
    expect(library?.to).toBe(ROUTES.library)
    // Assets V1 slotted in between Creative and Library by design.
    expect(labelKeys.indexOf('nav.library')).toBe(labelKeys.indexOf('nav.assets') + 1)
  })
})

describe('firestore.indexes.json', () => {
  const config = JSON.parse(
    readFileSync(new URL('../../../firestore.indexes.json', import.meta.url), 'utf8'),
  ) as { indexes: { collectionGroup: string; fields: { fieldPath: string; order: string }[] }[] }

  it('declares the composite index observeRecommendations requires', () => {
    // The Library (and the Recommendations tab) runs
    // where('ownerId','==',uid) + orderBy('createdAt','desc') on
    // `recommendations` — the only equality+order query in the app whose
    // composite index was missing. Without it the query fails at runtime.
    const index = config.indexes.find(
      (candidate) =>
        candidate.collectionGroup === 'recommendations' &&
        candidate.fields.length === 2 &&
        candidate.fields[0]?.fieldPath === 'ownerId' &&
        candidate.fields[0]?.order === 'ASCENDING' &&
        candidate.fields[1]?.fieldPath === 'createdAt' &&
        candidate.fields[1]?.order === 'DESCENDING',
    )
    expect(index).toBeDefined()
  })
})
