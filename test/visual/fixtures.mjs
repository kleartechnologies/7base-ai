/**
 * The posters the visual harness draws.
 *
 * These are persisted-creative shapes, not model output: the harness renders
 * them through the real client renderer so what is inspected is the picture
 * an owner would actually get. Matheasy is the primary case (Phase 7G.1 §19)
 * — an app business with real screenshots, a real logo and a green palette —
 * with a food business and a no-brand business alongside it so a fix for one
 * cannot quietly break the others.
 */

const MATHEASY_PALETTE = ['#22c55e', '#0f172a', '#86efac']

function creative(overrides) {
  return {
    id: overrides.id,
    ownerId: 'visual-harness',
    businessId: 'biz',
    campaignId: 'camp',
    conversationId: null,
    sourceRecommendationId: null,
    name: overrides.name,
    format: overrides.format ?? 'square_post',
    status: 'ready',
    captions: { facebook: null, instagram: null, short: null, whatsapp: null },
    render: null,
    userEdited: [],
    ownerDirectives: [],
    imageError: null,
    ...overrides,
    content: {
      body: null,
      layout: overrides.content?.image ? 'image_full_bleed' : 'text_only',
      deviceImage: null,
      ...overrides.content,
    },
    style: {
      headingFont: null,
      bodyFont: null,
      logoStoragePath: null,
      brandApplied: null,
      artDirection: null,
      ...overrides.style,
    },
  }
}

/** image/logo/scene keys resolve to real files in render.mjs. */
export const FIXTURES = [
  // The Matheasy set: one brand, three campaign creatives (§11). The art
  // direction on each is what `selectArtDirection` actually returns for set
  // positions 0, 1 and 2 — pinned by artDirection.test.ts, so this sheet
  // cannot drift into showing posters the pipeline would never produce.
  creative({
    id: 'matheasy-1',
    name: 'Matheasy 1/3 — learning benefit',
    content: {
      headline: 'Daripada soalan kepada faham',
      subheadline: 'Scan soalan Matematik dan faham penyelesaiannya langkah demi langkah.',
      callToAction: 'Cuba percuma',
      offerText: 'Percuma 7 hari',
      image: { storagePath: 'scene:study', prompt: null, altText: 'Student studying', source: 'generated' },
    },
    style: {
      palette: MATHEASY_PALETTE,
      logoStoragePath: 'logo:matheasy',
      direction: 'educational',
      artDirection: { composition: 'editorial_split', accent: 'field', cta: 'outline', device: false },
    },
  }),
  creative({
    id: 'matheasy-2',
    name: 'Matheasy 2/3 — the app in use',
    content: {
      headline: 'Scan. Selesai. Faham.',
      subheadline: 'Penyelesaian langkah demi langkah untuk setiap soalan.',
      callToAction: 'Muat turun',
      offerText: null,
      image: { storagePath: 'scene:app', prompt: null, altText: 'Student with a phone', source: 'generated' },
      // The owner's real screen, composited onto the phone in the scene (§10).
      deviceImage: { storagePath: 'shot:solution', prompt: null, altText: 'App screen', source: 'upload', assetId: 'a1' },
    },
    style: {
      palette: MATHEASY_PALETTE,
      logoStoragePath: 'logo:matheasy',
      direction: 'app_showcase',
      artDirection: { composition: 'device_beside', accent: 'emphasis_word', cta: 'solid', device: true },
    },
  }),
  creative({
    id: 'matheasy-3',
    name: 'Matheasy 3/3 — Numi explains',
    content: {
      headline: 'Setiap langkah, diterangkan',
      subheadline: 'Numi jelaskan sebabnya, bukan sekadar jawapannya.',
      callToAction: 'Cuba Numi',
      offerText: 'Numi AI',
      image: { storagePath: 'scene:app', prompt: null, altText: 'Student with a phone', source: 'generated' },
      deviceImage: { storagePath: 'shot:chat', prompt: null, altText: 'Numi chat', source: 'upload', assetId: 'a2' },
    },
    style: {
      palette: MATHEASY_PALETTE,
      logoStoragePath: 'logo:matheasy',
      direction: 'app_showcase',
      artDirection: { composition: 'device_hero', accent: 'rule', cta: 'chip', device: true },
    },
  }),
  creative({
    id: 'matheasy-4',
    name: 'Matheasy — portrait editorial',
    format: 'portrait_post',
    content: {
      headline: 'Matematik tak perlu menakutkan',
      subheadline: 'Belajar ikut rentak sendiri, setiap malam.',
      callToAction: 'Mula hari ini',
      offerText: null,
      image: { storagePath: 'scene:study', prompt: null, altText: 'Student', source: 'generated' },
    },
    style: {
      palette: MATHEASY_PALETTE,
      logoStoragePath: 'logo:matheasy',
      direction: 'clean_editorial',
      artDirection: { composition: 'full_bleed', accent: 'emphasis_word', cta: 'solid', device: false },
    },
  }),
  creative({
    id: 'matheasy-5',
    name: 'Matheasy — tilted device, portrait',
    format: 'portrait_post',
    content: {
      headline: 'Belajar tanpa tertekan',
      subheadline: 'Satu soalan, satu langkah, sampai faham.',
      callToAction: 'Mula sekarang',
      offerText: 'Percuma',
      image: { storagePath: 'scene:app', prompt: null, altText: 'Student with a phone', source: 'generated' },
      deviceImage: { storagePath: 'shot:solution', prompt: null, altText: 'App screen', source: 'upload', assetId: 'a1' },
    },
    style: {
      palette: MATHEASY_PALETTE,
      logoStoragePath: 'logo:matheasy',
      direction: 'app_showcase',
      artDirection: { composition: 'device_stack', accent: 'chip', cta: 'solid', device: true },
    },
  }),
  creative({
    id: 'food-promo',
    name: 'Kedai — promo band',
    content: {
      headline: 'Beat the lunch rush',
      subheadline: 'Weekday sets, ready in ten minutes flat.',
      callToAction: 'Order on WhatsApp',
      offerText: 'RM12.90 set',
      image: { storagePath: 'scene:food', prompt: null, altText: 'Lunch set', source: 'upload', assetId: 'f1' },
    },
    style: {
      palette: ['#b91c1c', '#facc15'],
      logoStoragePath: null,
      direction: 'bold_promotional',
      artDirection: { composition: 'bottom_band', accent: 'field', cta: 'outline', device: false },
    },
  }),
  creative({
    id: 'food-card',
    name: 'Kedai — card overlay',
    content: {
      headline: 'Fresh every single morning',
      subheadline: 'Baked before six, on the shelf by seven.',
      callToAction: 'Find us',
      offerText: null,
      image: { storagePath: 'scene:food', prompt: null, altText: 'Bread', source: 'generated' },
    },
    style: {
      palette: ['#b91c1c', '#facc15'],
      logoStoragePath: 'logo:matheasy',
      direction: 'lifestyle',
      artDirection: { composition: 'card_overlay', accent: 'emphasis_word', cta: 'chip', device: false },
    },
  }),
  creative({
    id: 'no-brand',
    name: 'No brand identity',
    content: {
      headline: 'Fresh bread, every morning',
      subheadline: 'Baked before six, on the shelf by seven.',
      callToAction: 'Visit us',
      offerText: null,
      image: { storagePath: 'scene:food', prompt: null, altText: 'Bread', source: 'generated' },
    },
    style: {
      palette: null,
      logoStoragePath: null,
      direction: 'lifestyle',
      artDirection: { composition: 'hero_right', accent: 'rule', cta: 'solid', device: false },
    },
  }),
  creative({
    id: 'text-only',
    name: 'No visual at all',
    content: {
      headline: 'We are open again',
      subheadline: 'Back from Raya break, same hours as always.',
      callToAction: 'Come by',
      offerText: null,
      image: null,
    },
    style: {
      palette: MATHEASY_PALETTE,
      logoStoragePath: 'logo:matheasy',
      direction: 'minimal_premium',
      artDirection: null,
    },
  }),
  // A pre-7G.1 creative: no art direction at all. It must still compose.
  creative({
    id: 'legacy',
    name: 'Made before art direction existed',
    content: {
      headline: 'Kopi panas, roti bakar',
      subheadline: 'Buka dari pukul tujuh pagi.',
      callToAction: 'Jumpa kami',
      offerText: null,
      image: { storagePath: 'scene:food', prompt: null, altText: 'Kopitiam', source: 'generated' },
    },
    style: {
      palette: ['#b91c1c'],
      logoStoragePath: 'logo:matheasy',
      direction: 'hero_product',
      artDirection: null,
    },
  }),
]
