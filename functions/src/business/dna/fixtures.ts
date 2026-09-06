import type { StoredBusiness } from '../../lib/business.types'
import type { StoredAsset } from '../../creative/assets'
import type { SocialProfileContent } from '../discovery/fetchSocial'
import type { WebsiteAnalysis } from '../brain/validate'
import type { NormalizedSite } from '../website/normalize'
import type { BusinessDnaAnalysis, ValidatedBrandDna } from './validate'

/**
 * Shared fixtures for the Phase 7E test files. Realistic shapes, not
 * minimal stubs: a warung with a website, a Facebook Page and a handful of
 * uploaded Assets.
 */

export const NOW = 1_800_000_000_000
export const BUSINESS_ID = 'biz_warung'
export const OWNER_ID = 'owner_1'

export function site(over: Partial<NormalizedSite> = {}): NormalizedSite {
  return {
    startUrl: 'https://warungmakcik.com/',
    pageUrls: ['https://warungmakcik.com/', 'https://warungmakcik.com/menu'],
    corpus: 'Warung Mak Cik. Home-style Malay food in Bangsar. Nasi campur, rendang, sambal.',
    charCount: 80,
    signals: {
      emails: [],
      phones: [],
      socialLinks: ['https://www.facebook.com/warungmakcik'],
      images: [
        'https://warungmakcik.com/img/storefront-photo.jpg',
        'https://warungmakcik.com/img/rendang.jpg',
        'https://warungmakcik.com/img/nasi-campur.jpg',
        'https://warungmakcik.com/img/extra.jpg',
      ],
    },
    ...over,
  }
}

export function socialProfile(over: Partial<SocialProfileContent> = {}): SocialProfileContent {
  return {
    corpus: 'Warung Mak Cik. Nasi campur daily. Bangsar, Kuala Lumpur.',
    signals: { emails: [], phones: [], outboundLinks: ['https://wa.me/60123456789'] },
    page: {
      url: 'https://www.facebook.com/warungmakcik',
      title: 'Warung Mak Cik',
      images: ['https://scontent.example.com/profile.jpg', 'https://scontent.example.com/cover.jpg'],
    },
    ...over,
  }
}

export function asset(over: Partial<StoredAsset> = {}): StoredAsset {
  return {
    ownerId: OWNER_ID,
    businessId: BUSINESS_ID,
    type: 'photo',
    name: 'Rendang plate',
    fileName: 'rendang.jpg',
    contentType: 'image/jpeg',
    sizeBytes: 120_000,
    storagePath: `businesses/${BUSINESS_ID}/assets/asset_1/rendang.jpg`,
    productId: null,
    description: null,
    tags: ['food'],
    source: 'upload',
    status: 'active',
    allowAiUse: true,
    createdAt: NOW - 1000,
    updatedAt: NOW - 1000,
    ...over,
  }
}

export function analysis(over: Partial<WebsiteAnalysis> = {}): WebsiteAnalysis {
  return {
    identity: {
      businessName: 'Warung Mak Cik',
      legalName: null,
      tagline: 'Home-style Malay food',
      description: 'A neighbourhood warung in Bangsar serving nasi campur.',
      category: 'Restaurant',
      subIndustry: null,
      businessType: null,
      industry: 'food_and_beverage',
    },
    location: {
      addressLine1: null,
      city: 'Kuala Lumpur',
      state: 'Wilayah Persekutuan',
      postcode: null,
      countryCode: 'MY',
      serviceArea: null,
      openingHours: null,
    },
    contact: { email: null, phone: null, whatsapp: null, socialProfiles: [] },
    products: [
      { name: 'Rendang', description: null, price: null, currency: null, category: null, attributes: [], isSignature: true, sourceUrl: null, confidence: 0.8 },
      { name: 'Nasi campur', description: null, price: null, currency: null, category: null, attributes: [], isSignature: false, sourceUrl: null, confidence: 0.8 },
    ],
    audience: {
      summary: 'Office workers and families in Bangsar',
      customerTypes: [],
      demographics: [],
      useCases: [],
      needs: [],
      preferences: [],
      segments: [],
      sourceUrl: null,
      confidence: 0,
    },
    brand: {
      voice: 'Warm and homely',
      personalityTraits: ['Homely'],
      visualStyle: 'Rustic, food-photography led',
      keyMessages: ['Made fresh daily'],
      valuePropositions: [],
      sourceUrl: null,
      confidence: 0.5,
    },
    marketing: {
      positioning: 'The neighbourhood warung',
      valueProposition: null,
      differentiators: ['Family recipes'],
      activeChannels: [],
      promotions: [],
      callsToAction: [],
      themes: [],
      emphasizedProducts: ['Nasi campur', 'rendang'],
      sourceUrl: null,
      confidence: 0,
    },
    operations: {
      openingHours: null,
      orderingMethods: [],
      deliveryPlatforms: [],
      reservations: null,
      notes: [],
      sourceUrl: null,
      confidence: 0,
    },
    fieldSources: [],
    unknowns: ['Price range'],
    summary: 'A Malay warung in Bangsar.',
    ...over,
  }
}

export function brandDna(over: Partial<ValidatedBrandDna> = {}): ValidatedBrandDna {
  return {
    logoImageId: null,
    colors: [],
    detectedFont: null,
    supportedFont: null,
    typographyNotes: null,
    visualStyle: null,
    styleTraits: [],
    suggestedTraits: [],
    imageryStyle: null,
    compositionStyle: null,
    visualMood: null,
    confidence: 'low',
    ...over,
  }
}

export function dnaAnalysis(
  over: Partial<WebsiteAnalysis> = {},
  dna: Partial<ValidatedBrandDna> = {},
): BusinessDnaAnalysis {
  return { ...analysis(over), brandDna: brandDna(dna) }
}

export function emptyBrain(over: Partial<StoredBusiness> = {}): StoredBusiness {
  return {
    ownerId: OWNER_ID,
    name: 'Untitled business',
    industry: 'other',
    identity: {
      legalName: null,
      tagline: null,
      description: null,
      category: null,
      subIndustry: null,
      businessType: null,
      foundedYear: null,
    },
    contact: { email: null, phone: null, whatsapp: null, website: null, socialProfiles: [] },
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
    brainVersion: 2,
    createdAt: 1,
    updatedAt: 1,
    ...over,
  }
}
