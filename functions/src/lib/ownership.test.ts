import { describe, expect, it } from 'vitest'

import { assertOwnership } from './ownership'

/**
 * The Admin SDK ignores Firestore rules, so this comparison is the only thing
 * standing between one restaurant owner and another's data. It is tested for
 * the cases an attacker would actually try: a missing document, a document
 * with no owner, and an owner field that is something other than a string.
 */

const OWNER = 'uid_owner'
const INTRUDER = 'uid_intruder'

function denied(run: () => void): unknown {
  try {
    run()
  } catch (error) {
    return error
  }
  throw new Error('expected assertOwnership to throw')
}

describe('assertOwnership', () => {
  it('allows the owner through', () => {
    expect(() => assertOwnership({ ownerId: OWNER }, OWNER)).not.toThrow()
  })

  it('refuses a different signed-in user', () => {
    expect(() => assertOwnership({ ownerId: OWNER }, INTRUDER)).toThrow()
  })

  it('refuses a document that does not exist', () => {
    expect(() => assertOwnership(null, OWNER)).toThrow()
    expect(() => assertOwnership(undefined, OWNER)).toThrow()
  })

  it('refuses a document with no owner recorded', () => {
    expect(() => assertOwnership({}, OWNER)).toThrow()
    expect(() => assertOwnership({ ownerId: null }, OWNER)).toThrow()
  })

  it('refuses non-string owner fields rather than coercing them', () => {
    // An injected `{ownerId: {}}` must not slip past a loose comparison.
    expect(() => assertOwnership({ ownerId: {} }, OWNER)).toThrow()
    expect(() => assertOwnership({ ownerId: ['uid_owner'] }, OWNER)).toThrow()
    expect(() => assertOwnership({ ownerId: 0 }, '0')).toThrow()
  })

  it('does not accept an empty uid against an empty owner field', () => {
    // Belt and braces: an unauthenticated call should never reach here, but if
    // it did, empty-equals-empty must not read as a match.
    expect(() => assertOwnership({ ownerId: '' }, '')).toThrow()
  })

  it('tells the client nothing about what it asked for', () => {
    const error = denied(() => assertOwnership({ ownerId: OWNER }, INTRUDER)) as {
      code?: string
      message?: string
    }
    expect(error.code).toBe('permission-denied')
    expect(error.message).toBe('You do not have access to that.')
    expect(error.message).not.toContain(OWNER)
  })
})
