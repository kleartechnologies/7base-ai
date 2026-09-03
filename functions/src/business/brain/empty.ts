import { BRAIN_VERSION, type StoredBusiness } from '../../lib/business.types'

/**
 * A brand new, empty Business Brain.
 *
 * Every optional section starts null rather than as an empty object, so "MARKA
 * has not learned this yet" is distinguishable from "MARKA looked and found
 * nothing" — the Business tab renders those two states differently.
 */
export function emptyBrain(ownerId: string, name: string, now = Date.now()): StoredBusiness {
  return {
    ownerId,
    name: name.trim(),
    industry: 'food_and_beverage',
    identity: {
      legalName: null,
      tagline: null,
      description: null,
      category: null,
      subIndustry: null,
      businessType: null,
      foundedYear: null,
    },
    contact: {
      email: null,
      phone: null,
      whatsapp: null,
      website: null,
      socialProfiles: [],
    },
    location: {
      addressLine1: null,
      addressLine2: null,
      city: null,
      state: null,
      postcode: null,
      countryCode: 'MY',
      openingHours: null,
      serviceArea: null,
    },
    products: [],
    audience: null,
    brand: null,
    marketing: null,
    operations: null,
    provenance: {},
    sources: [],
    discovery: {
      status: 'not_started',
      stage: null,
      lastRunAt: null,
      completedAt: null,
      sourceRef: null,
      pagesAnalysed: 0,
      error: null,
      errorCode: null,
      summary: null,
      unknowns: [],
    },
    brainVersion: BRAIN_VERSION,
    createdAt: now,
    updatedAt: now,
  }
}
