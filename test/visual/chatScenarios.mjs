/**
 * The fourteen chat scenes Phase 7J §24 asks to be looked at.
 *
 * Each one is message documents in the shape the backend actually writes —
 * the prose comes from `present.ts`, the proposal labels from
 * `buildProposalBlock`, the follow-up from the creative-set block — so a
 * screenshot shows the layout of a real turn, not a mock-up of one.
 */

const PALETTE = ['#c2410c', '#0f172a', '#fdba74']

function poster(id, position, headline, sub, cta, offer, scene = 'scene:food') {
  return {
    id,
    ownerId: 'visual',
    businessId: 'biz1',
    campaignId: 'camp1',
    conversationId: 'conv1',
    sourceRecommendationId: null,
    name: `Weekday lunch ${position}/3`,
    format: 'square_post',
    status: 'ready',
    captions: {
      facebook:
        'Lunch on a weekday should not be a compromise. Warung Pak Din serves home-style Malay food from 11.30am, and the weekday set is RM12 with a drink. Come as you are — we will keep a table.',
      instagram: 'Weekday lunch, sorted. RM12 set with a drink, 11.30am–3pm. 🍛',
      short: 'Weekday set lunch RM12, 11.30am–3pm.',
      whatsapp: 'Hi! Our weekday set lunch is RM12 with a drink, 11.30am–3pm. Reply to reserve a table.',
      x: 'Weekday set lunch: RM12 with a drink, 11.30am–3pm.',
      tiktok: 'RM12 weekday set lunch 🍛 home-style, every weekday 11.30am.',
    },
    render: null,
    userEdited: [],
    ownerDirectives: [],
    imageError: null,
    content: {
      headline,
      subheadline: sub,
      callToAction: cta,
      offerText: offer,
      body: null,
      layout: 'image_full_bleed',
      deviceImage: null,
      image: { storagePath: scene, prompt: null, altText: 'Lunch on the table', source: 'generated' },
    },
    style: {
      palette: PALETTE,
      headingFont: null,
      bodyFont: null,
      logoStoragePath: null,
      brandApplied: null,
      direction: 'appetite',
      artDirection: { composition: 'editorial_split', accent: 'field', cta: 'outline', device: false },
    },
  }
}

export const CREATIVE_FIXTURES = [
  poster('cr1', 1, 'Lunch that tastes like home', 'Home-style Malay food, every weekday from 11.30am.', 'Come for lunch', 'Set RM12'),
  poster('cr2', 2, 'RM12. Weekdays. Done.', 'A full set with a drink, served hot from 11.30am.', 'See the menu', 'Set RM12', 'scene:table'),
  poster('cr3', 3, 'Beat the 1pm queue', 'Order ahead and your table is ready when you are.', 'Order ahead', null, 'scene:kitchen'),
  // The unbranded case (§9): no palette of its own, so the renderer's
  // neutral styling has to hold up on its own.
  ...unbranded(),
]

/** Three posters for a business with no Brand Identity saved yet. */
function unbranded() {
  const neutral = (id, headline, sub, cta, scene, composition) => ({
    ...poster(id, 1, headline, sub, cta, null, scene),
    name: 'New menu',
    campaignId: 'camp2',
    style: {
      palette: ['#111827', '#374151', '#9ca3af'],
      headingFont: null,
      bodyFont: null,
      logoStoragePath: null,
      brandApplied: null,
      direction: 'announcement',
      artDirection: { composition, accent: 'rule', cta: 'solid', device: false },
    },
  })
  return [
    neutral('cr4', 'New on the menu', 'Nasi lemak ayam berempah, from Friday.', 'Try it Friday', 'scene:food', 'centred_statement'),
    neutral('cr5', 'Ayam berempah, done properly', 'Marinated overnight, fried to order.', 'See the menu', 'scene:kitchen', 'editorial_split'),
    neutral('cr6', 'From Friday', 'One new dish, every Friday this month.', 'Come try it', 'scene:table', 'corner_anchor'),
  ]
}

const setItems = (ids) =>
  ids.map((id, index) => {
    const creative = CREATIVE_FIXTURES.find((entry) => entry.id === id)
    return {
      creativeId: id,
      position: index + 1,
      name: creative.name,
      format: 'square_post',
      headline: creative.content.headline,
      subheadline: creative.content.subheadline,
      callToAction: creative.content.callToAction,
      offerText: creative.content.offerText,
      image: creative.content.image,
      imageFailed: false,
    }
  })

function message(id, role, blocks, plainText) {
  return {
    id,
    ownerId: 'visual',
    conversationId: 'conv1',
    role,
    blocks,
    plainText,
    status: 'complete',
    meta: null,
    createdAt: 0,
    updatedAt: 0,
  }
}

const text = (id, value) => ({ id, type: 'text', text: value })

const LUNCH_SPEC = { format: 'square_post', brief: 'promote our weekday lunch', positions: [0, 1, 2], size: 3 }

export const SCENARIOS = [
  {
    title: '1 · Overview with nothing made yet',
    note: '§15 — the empty state has to give the owner a first move, not a status.',
    kind: 'overview',
    data: null,
  },
  {
    title: '2 · An empty chat',
    note: '§15/§16 — goal chips in the owner’s words, no product vocabulary.',
    kind: 'empty_chat',
    data: null,
  },
  {
    title: '3 · Asking EVA to promote something',
    note: '§2/§3 — the goal is understood and acted on without an interview.',
    kind: 'thread',
    data: [
      message('m1', 'user', [text('b1', 'I want to promote our weekday lunch.')], 'I want to promote our weekday lunch.'),
      message(
        'm2',
        'assistant',
        [
          text(
            'b1',
            'Weekday lunch is a good thing to push — midday trade is where a warung either fills its tables or watches them sit empty, and a set price does the persuading for you.',
          ),
        ],
        '',
      ),
    ],
  },
  {
    title: '4 · The offer',
    note: '§5/§6 — one primary button in plain words, one quiet way to change it.',
    kind: 'thread',
    data: [
      message(
        'm3',
        'assistant',
        [
          text('b1', 'I can turn this into a campaign and make 3 posters for it.'),
          {
            id: 'b2',
            type: 'action_proposal',
            action: { kind: 'campaign.build', recommendationId: 'rec1', title: 'Weekday lunch', then: LUNCH_SPEC },
            confirmLabel: 'Create the campaign',
            summary: '3 posters · Instagram & Facebook · Square',
          },
        ],
        '',
      ),
    ],
  },
  {
    title: '5 · Saying yes',
    note: '§26 — the confirmation is an ordinary sentence, not a control.',
    kind: 'thread',
    data: [
      message('m4', 'user', [text('b1', 'Yes, do it.')], 'Yes, do it.'),
    ],
  },
  {
    title: '6 · EVA working',
    note: '§7 — the steps read as work, never as function names.',
    kind: 'progress',
    data: [
      { key: 'campaign_create', state: 'done' },
      { key: 'brand', state: 'done' },
      { key: 'assets', state: 'done' },
      { key: 'concepts', state: 'done' },
      { key: 'poster', state: 'active', index: 2, total: 3 },
    ],
  },
  {
    title: '7 · What came back',
    note: '§11 — the result says plainly what was made, and shows it.',
    kind: 'thread',
    data: [
      message(
        'm5',
        'assistant',
        [
          text('b1', 'Done — I created 3 different poster angles for Weekday lunch. Each one has its own social copy under it.'),
          {
            id: 'b2',
            type: 'creative_set',
            campaignId: 'camp1',
            campaignName: 'Weekday lunch',
            requested: 3,
            items: setItems(['cr1', 'cr2', 'cr3']),
            followUp: { label: 'Another angle', text: 'Make one more poster with a different angle.' },
          },
        ],
        '',
      ),
    ],
  },
  {
    title: '8 · The copy under one poster',
    note: '§11 — platform copy opened: one platform at a time, editable, copyable.',
    kind: 'platform_copy',
    data: 'cr1',
  },
  {
    title: '9 · Editing a poster in conversation',
    note: '§13 — an edit is a sentence; the same creative comes back changed.',
    kind: 'thread',
    data: [
      message('m6', 'user', [text('b1', 'Make the first headline shorter.')], 'Make the first headline shorter.'),
      message(
        'm7',
        'assistant',
        [
          text('b1', 'Shortened the headline on the first poster.'),
          {
            id: 'b2',
            type: 'creative_preview',
            creativeId: 'cr1',
            campaignId: 'camp1',
            name: 'Weekday lunch 1/3',
            format: 'square_post',
            headline: 'Lunch that tastes like home',
            subheadline: 'Home-style Malay food, every weekday from 11.30am.',
            callToAction: 'Come for lunch',
            offerText: 'Set RM12',
            image: { storagePath: 'scene:food', source: 'generated', altText: null },
            imageFailed: false,
            captions: CREATIVE_FIXTURES[0].captions,
          },
        ],
        '',
      ),
    ],
  },
  {
    title: '10 · A campaign that already exists',
    note: '§8 — the open campaign is reused; nothing duplicate is offered.',
    kind: 'thread',
    data: [
      message('m8', 'user', [text('b1', 'Can you make 3 posters for this?')], 'Can you make 3 posters for this?'),
      message(
        'm9',
        'assistant',
        [
          text('b1', 'Weekday lunch is ready — I can make 3 posters for it now.'),
          {
            id: 'b2',
            type: 'action_proposal',
            action: { kind: 'creative.generate', campaignId: 'camp1', campaignName: 'Weekday lunch', spec: LUNCH_SPEC },
            confirmLabel: 'Create the posters',
            summary: '3 posters · Instagram & Facebook · Square',
          },
        ],
        '',
      ),
    ],
  },
  {
    title: '11 · Which campaign?',
    note: '§8 — the only question worth asking, answered by campaign name.',
    kind: 'thread',
    data: [
      message(
        'm10',
        'assistant',
        [
          text('b1', 'Which campaign should these go to?'),
          {
            id: 'b2',
            type: 'action_proposal',
            action: {
              kind: 'campaign.choose',
              choices: [
                { campaignId: 'camp1', name: 'Weekday lunch' },
                { campaignId: 'camp2', name: 'Raya open house' },
              ],
              then: LUNCH_SPEC,
            },
            confirmLabel: 'Create the posters',
            summary: '3 posters · Instagram & Facebook · Square',
          },
        ],
        '',
      ),
    ],
  },
  {
    title: '12 · One question, only when it changes the outcome',
    note: '§4/§10 — two equally plausible photos, so EVA asks once and stops.',
    kind: 'thread',
    data: [
      message('m11', 'user', [text('b1', 'Use one of our photos for this.')], 'Use one of our photos for this.'),
      message(
        'm12',
        'assistant',
        [text('b1', 'You have a shot of the nasi lemak and one of the shop front. Which should lead?')],
        '',
      ),
    ],
  },
  {
    title: '13 · No Brand Identity yet',
    note: '§9 — the posters are still made; the note about style comes after, once.',
    kind: 'thread',
    data: [
      message(
        'm13',
        'assistant',
        [
          text(
            'b1',
            'Done — I created 3 different poster angles for New menu. Each one has its own social copy under it.\n\nI used neutral styling — add your colours and logo in Brand Identity and the next set will match your look.',
          ),
          {
            id: 'b2',
            type: 'creative_set',
            campaignId: 'camp2',
            campaignName: 'New menu',
            requested: 3,
            items: setItems(['cr4', 'cr5', 'cr6']),
            followUp: { label: 'Another angle', text: 'Make one more poster with a different angle.' },
          },
        ],
        '',
      ),
    ],
  },
  {
    title: '14 · The same conversation in Malay',
    note: '§18 — natural Malaysian BM, the identical flow.',
    kind: 'thread',
    language: 'ms',
    data: [
      message('m14', 'user', [text('b1', 'Saya nak promote lunch weekday kami.')], 'Saya nak promote lunch weekday kami.'),
      message(
        'm15',
        'assistant',
        [
          text('b1', 'Saya boleh jadikan ini satu kempen dan buat 3 poster untuknya.'),
          {
            id: 'b2',
            type: 'action_proposal',
            action: { kind: 'campaign.build', recommendationId: 'rec1', title: 'Lunch hari biasa', then: LUNCH_SPEC },
            confirmLabel: 'Buat kempen',
            summary: '3 poster · Instagram & Facebook · Segi empat',
          },
        ],
        '',
      ),
    ],
  },
]
