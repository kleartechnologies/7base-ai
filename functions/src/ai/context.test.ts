import { describe, expect, it } from 'vitest'

import { buildBusinessContext } from './context'
import type { Discovered, StoredBusiness } from '../lib/business.types'

/**
 * The Business Brain mixes facts read off a page with inferences drawn from
 * them, and the prompt is the only place that distinction survives. These
 * tests pin the *structure* of that rendering, not its prose:
 *
 *  - a provenance header exists for every discovered section, and
 *  - the fields it governs are indented beneath it.
 *
 * The second half is the part that regressed once already. A header followed
 * by fields at the same depth reads as two unrelated statements, and an
 * inference that reads like a fact is exactly how MARKA ends up telling an
 * owner something untrue about their own business.
 */

function discovered<T>(value: T, overrides: Partial<Discovered<T>> = {}): Discovered<T> {
  return {
    value,
    source: 'website',
    sourceRef: 'https://warungpakdin.com/',
    confidence: 0.8,
    confirmed: false,
    discoveredAt: 1000,
    ...overrides,
  }
}

function brain(overrides: Partial<StoredBusiness> = {}): StoredBusiness {
  return {
    name: 'Warung Pak Din',
    identity: { businessType: 'Warung' },
    contact: { website: 'https://warungpakdin.com/' },
    products: [],
    ...overrides,
  } as unknown as StoredBusiness
}

/** The lines belonging to `header`, up to the next blank line. */
function blockUnder(context: string, header: string): string[] {
  const lines = context.split('\n')
  const start = lines.findIndex((line) => line.startsWith(header))
  expect(start, `no block headed "${header}"`).toBeGreaterThanOrEqual(0)

  const block: string[] = []
  for (const line of lines.slice(start + 1)) {
    if (line.trim() === '') break
    block.push(line)
  }
  return block
}

describe('buildBusinessContext — provenance structure', () => {
  it('returns null when there is nothing known', () => {
    expect(buildBusinessContext(null)).toBeNull()
  })

  it('indents every field of an inferred section under its header', () => {
    const context = buildBusinessContext(
      brain({
        audience: discovered(
          { summary: 'Appears to serve office workers.', customerTypes: ['Office workers'], needs: [], useCases: [] },
          { source: 'inferred', confidence: 0.5 },
        ),
      } as unknown as Partial<StoredBusiness>),
    )!

    const block = blockUnder(context, 'AUDIENCE —')
    expect(block.length).toBeGreaterThan(0)
    for (const line of block) {
      expect(line).toMatch(/^ {2}- /)
    }
    expect(block).toContain('  - Audience summary: Appears to serve office workers.')
    expect(block).toContain('  - Customer types: Office workers')
  })

  it('marks an inferred section as an assumption, not a finding', () => {
    const context = buildBusinessContext(
      brain({
        brand: discovered({ voice: 'Playful', personalityTraits: [], keyMessages: [] }, { source: 'inferred' }),
      } as unknown as Partial<StoredBusiness>),
    )!

    const header = context.split('\n').find((line) => line.startsWith('BRAND —'))!
    expect(header).toMatch(/INFERENCE/)
    expect(header).toMatch(/working assumption/)
  })

  it('marks an owner-confirmed section as fact', () => {
    const context = buildBusinessContext(
      brain({
        brand: discovered(
          { voice: 'Premium and sophisticated', personalityTraits: [], keyMessages: [] },
          { source: 'user', confirmed: true },
        ),
      } as unknown as Partial<StoredBusiness>),
    )!

    const header = context.split('\n').find((line) => line.startsWith('BRAND —'))!
    expect(header).toMatch(/CONFIRMED BY THE OWNER/)
    expect(blockUnder(context, 'BRAND —')).toContain('  - Brand voice: Premium and sophisticated')
  })

  it('distinguishes website-read from inferred from confirmed', () => {
    const context = buildBusinessContext(
      brain({
        marketing: discovered({
          positioning: 'Halal comfort food',
          differentiators: [],
          promotions: [],
          activeChannels: [],
        }),
        audience: discovered({ summary: 'Families.', customerTypes: [], needs: [], useCases: [] }, { source: 'inferred' }),
        brand: discovered(
          { voice: 'Warm', personalityTraits: [], keyMessages: [] },
          { source: 'user', confirmed: true },
        ),
      } as unknown as Partial<StoredBusiness>),
    )!

    expect(context).toMatch(/^MARKETING — READ FROM THEIR WEBSITE/m)
    expect(context).toMatch(/^AUDIENCE — MARKA'S INFERENCE/m)
    expect(context).toMatch(/^BRAND — CONFIRMED BY THE OWNER/m)
  })

  it('separates each section with a blank line so headers cannot run together', () => {
    const context = buildBusinessContext(
      brain({
        audience: discovered({ summary: 'Families.', customerTypes: [], needs: [], useCases: [] }, { source: 'inferred' }),
        brand: discovered({ voice: 'Warm', personalityTraits: [], keyMessages: [] }),
      } as unknown as Partial<StoredBusiness>),
    )!

    const lines = context.split('\n')
    for (const [index, line] of lines.entries()) {
      if (/^[A-Z ]+ — /.test(line) && index > 0) {
        expect(lines[index - 1]).toBe('')
      }
    }
  })

  it('heads the fact block so top-level values are not mistaken for inference', () => {
    const context = buildBusinessContext(brain())!
    expect(context.split('\n')[0]).toMatch(/^ESTABLISHED FACTS —/)
    expect(context).toContain('- Name: Warung Pak Din')
  })

  it('lists unknowns under their own header, indented, with the never-guess rule', () => {
    const context = buildBusinessContext(
      brain({
        discovery: { unknowns: ['Opening hours', 'Best-selling item'] },
      } as unknown as Partial<StoredBusiness>),
    )!

    const header = context.split('\n').find((line) => line.startsWith('NOT KNOWN —'))!
    expect(header).toMatch(/Ask; never guess/)
    expect(blockUnder(context, 'NOT KNOWN —')).toEqual([
      '  - Opening hours',
      '  - Best-selling item',
    ])
  })

  it('omits a section entirely rather than reporting it as unknown', () => {
    const context = buildBusinessContext(brain())!
    expect(context).not.toContain('AUDIENCE')
    expect(context).not.toContain('BRAND')
    expect(context).not.toContain('undefined')
    expect(context).not.toContain('null')
  })

  it('keeps products indented under their own line', () => {
    const context = buildBusinessContext(
      brain({
        products: [
          { id: 'p1', name: 'Nasi Lemak', priceMinor: 1290, currency: 'MYR', isSignature: true },
        ],
      } as unknown as Partial<StoredBusiness>),
    )!

    expect(context).toContain('- Menu / products (1 known):')
    expect(context).toContain('  • Nasi Lemak MYR 12.90 — highlighted on their site')
  })
})
