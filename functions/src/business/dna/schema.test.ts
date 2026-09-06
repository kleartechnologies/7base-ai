import { describe, expect, it } from 'vitest'

import { WEBSITE_ANALYSIS_SCHEMA } from '../brain/schema'
import { BRAND_DNA_SCHEMA, BUSINESS_DNA_SCHEMA, BUSINESS_DNA_SCHEMA_NAME } from './schema'

/**
 * OpenAI strict mode requires every object to list all of its properties in
 * `required` and to forbid extras. The DNA schema is the website schema plus
 * one block; both halves must obey the same rule, or the provider rejects
 * the call at runtime and no test would have caught it.
 */

function assertStrict(node: unknown, path = 'root'): void {
  if (typeof node !== 'object' || node === null) return
  const record = node as Record<string, unknown>
  if (record.type === 'object') {
    expect(record.additionalProperties, `${path}.additionalProperties`).toBe(false)
    const properties = record.properties as Record<string, unknown>
    expect(new Set(record.required as string[]), `${path}.required`).toEqual(new Set(Object.keys(properties)))
    for (const [key, child] of Object.entries(properties)) assertStrict(child, `${path}.${key}`)
  }
  if (record.type === 'array') assertStrict(record.items, `${path}[]`)
}

describe('BUSINESS_DNA_SCHEMA', () => {
  it('is the website schema plus exactly one brandDna block', () => {
    expect(BUSINESS_DNA_SCHEMA_NAME).toBe('business_dna')
    expect(Object.keys(BUSINESS_DNA_SCHEMA.properties)).toEqual([
      ...Object.keys(WEBSITE_ANALYSIS_SCHEMA.properties),
      'brandDna',
    ])
    expect(BUSINESS_DNA_SCHEMA.required).toEqual([...WEBSITE_ANALYSIS_SCHEMA.required, 'brandDna'])
  })

  it('is strict-mode valid all the way down', () => {
    assertStrict(BUSINESS_DNA_SCHEMA)
  })

  it('refers to images by id and names no URL field', () => {
    const keys = Object.keys(BRAND_DNA_SCHEMA.properties)
    expect(keys).toContain('logoImageId')
    expect(keys.some((key) => /url/i.test(key))).toBe(false)
    expect(JSON.stringify(BRAND_DNA_SCHEMA)).not.toMatch(/https?:/)
  })
})
