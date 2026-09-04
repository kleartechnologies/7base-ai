import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { ROUTES } from '@/app/routes/paths'
import { WORKSPACE_NAV } from '@/features/shell/navigation'

/**
 * The Assets tab's wiring outside its own module: the route constant, the
 * sidebar entry, and the one Firestore index observeAssets depends on.
 */

describe('assets route wiring', () => {
  it('exposes /assets as a route', () => {
    expect(ROUTES.assets).toBe('/assets')
  })

  it('has an Assets entry in the workspace nav, between Creative and Library', () => {
    const labels = WORKSPACE_NAV.map((item) => item.label)
    const assets = WORKSPACE_NAV.find((item) => item.label === 'Assets')
    expect(assets?.to).toBe(ROUTES.assets)
    expect(labels.indexOf('Assets')).toBe(labels.indexOf('Creative') + 1)
    expect(labels.indexOf('Library')).toBe(labels.indexOf('Assets') + 1)
  })
})

describe('firestore.indexes.json', () => {
  const config = JSON.parse(
    readFileSync(new URL('../../../firestore.indexes.json', import.meta.url), 'utf8'),
  ) as { indexes: { collectionGroup: string; fields: { fieldPath: string; order: string }[] }[] }

  it('declares the composite index observeAssets requires', () => {
    // observeAssets runs where('ownerId','==',uid) + orderBy('updatedAt','desc')
    // on `assets`; without this index the query fails at runtime.
    const index = config.indexes.find(
      (candidate) =>
        candidate.collectionGroup === 'assets' &&
        candidate.fields.length === 2 &&
        candidate.fields[0]?.fieldPath === 'ownerId' &&
        candidate.fields[0]?.order === 'ASCENDING' &&
        candidate.fields[1]?.fieldPath === 'updatedAt' &&
        candidate.fields[1]?.order === 'DESCENDING',
    )
    expect(index).toBeDefined()
  })
})
