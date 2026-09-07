/**
 * Visual QA for the poster renderer (Phase 7G.1 §18).
 *
 * Unit tests assert that canvas *operations* happened; they cannot see that a
 * headline landed on a subject's face, that a logo vanished into a dark
 * photo, or that a poster came out looking like a template. So this renders
 * the fixture posters through the real client renderer in a real browser and
 * writes a contact sheet PNG, to be looked at by a human (or by a model with
 * eyes) before a creative change is called done.
 *
 *   node test/visual/render.mjs [--out DIR]
 *
 * Phase 7G.2 §3 adds live mode, which is the one that settles arguments:
 *
 *   node test/visual/render.mjs --manifest <smoke-out>/manifest.json
 *
 * It renders the posters from a real smoke run and lays each one out as
 * generated photograph | finished poster | the decisions behind it, so a
 * defect can be pinned to the image, the art direction or the composition.
 *
 * It needs Google Chrome (or CHROME_PATH) and nothing else — no emulator, no
 * API key, no network. The scene images are synthetic stand-ins with the
 * luminance distribution of real advertising photography (bright sky side,
 * shadowed floor side, a mid-tone subject), which is what the layout
 * decisions actually key off; real generated photography is judged separately
 * against the live smoke run.
 */
import { execFileSync } from 'node:child_process'
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { build } from 'esbuild'
import { FIXTURES } from './fixtures.mjs'

const here = dirname(fileURLToPath(import.meta.url))
const root = resolve(here, '../..')

const manifestFlag = process.argv.indexOf('--manifest')
const manifestPath = manifestFlag > -1 ? resolve(process.argv[manifestFlag + 1]) : null

const outFlag = process.argv.indexOf('--out')
const outDir = outFlag > -1 ? resolve(process.argv[outFlag + 1]) : join(here, 'out')
mkdirSync(outDir, { recursive: true })

const CHROME =
  process.env.CHROME_PATH ?? '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'
if (!existsSync(CHROME)) {
  console.error(`Chrome not found at ${CHROME}. Set CHROME_PATH.`)
  process.exit(2)
}

/* --- the images the fixtures reference ------------------------------------ */

const HOME = process.env.HOME ?? ''
const REAL_FILES = {
  'logo:matheasy': `${HOME}/Desktop/MATHEASY-APP.nosync/brand/matheasy-logo-source.png`,
  'shot:solution': `${HOME}/Desktop/MATHEASY-SS/ME_SOLUTION SCREEN.PNG`,
  'shot:chat': `${HOME}/Desktop/MATHEASY-SS/ME_NUMI CHAT.png`,
}

function dataUrl(file) {
  const ext = file.toLowerCase().endsWith('.png') ? 'png' : 'jpeg'
  return `data:image/${ext};base64,${readFileSync(file).toString('base64')}`
}

const images = {}
for (const [key, file] of Object.entries(REAL_FILES)) {
  if (existsSync(file)) images[key] = dataUrl(file)
  else console.warn(`[visual] missing ${key} (${file}) — that slot draws empty`)
}

/**
 * A stand-in for generated photography: an SVG with the tonal structure a
 * real advertising frame has, so scrims, logo plates and contrast decisions
 * are exercised honestly rather than against flat grey.
 */
function scene(hue, label) {
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="1024" height="1024">
    <defs>
      <radialGradient id="key" cx="72%" cy="18%" r="85%">
        <stop offset="0" stop-color="hsl(${hue},32%,88%)"/>
        <stop offset="0.55" stop-color="hsl(${hue},26%,58%)"/>
        <stop offset="1" stop-color="hsl(${hue},30%,17%)"/>
      </radialGradient>
      <linearGradient id="floor" x1="0" y1="0" x2="0" y2="1">
        <stop offset="0" stop-color="rgba(0,0,0,0)"/>
        <stop offset="1" stop-color="rgba(0,0,0,0.45)"/>
      </linearGradient>
    </defs>
    <rect width="1024" height="1024" fill="url(#key)"/>
    <ellipse cx="640" cy="470" rx="250" ry="330" fill="hsl(${hue},22%,34%)" opacity="0.85"/>
    <circle cx="640" cy="250" r="118" fill="hsl(28,34%,62%)"/>
    <rect width="1024" height="1024" fill="url(#floor)"/>
    <text x="40" y="990" font-family="monospace" font-size="26" fill="rgba(255,255,255,0.5)">${label}</text>
  </svg>`
  return `data:image/svg+xml;base64,${Buffer.from(svg).toString('base64')}`
}
images['scene:study'] = scene(150, 'synthetic scene — study')
images['scene:app'] = scene(198, 'synthetic scene — app in use')
images['scene:food'] = scene(24, 'synthetic scene — food')

/* --- bundle the real renderer --------------------------------------------- */

const bundle = await build({
  entryPoints: [join(here, 'entry.ts')],
  bundle: true,
  format: 'iife',
  write: false,
  absWorkingDir: root,
  alias: { '@': join(root, 'src') },
  loader: { '.ts': 'ts' },
})
const script = bundle.outputFiles[0].text

/* --- what goes on the sheet ------------------------------------------------ */

const escape = (value) =>
  String(value ?? '').replace(/[&<>]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' })[c])

/**
 * Live mode (§3): posters built from a real smoke run — the manifest carries
 * the copy the model wrote, the art direction the pipeline chose, the prompt
 * that was sent and the photograph that came back.
 */
function liveEntries() {
  const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'))
  const dir = dirname(manifestPath)
  return manifest.map((entry) => {
    const key = `gen:${entry.file}`
    images[key] = dataUrl(join(dir, entry.file))
    const meta = [
      `<h2>${escape(entry.position + 1)}. ${escape(entry.direction)}</h2>`,
      `<dl>`,
      `<dt>B — art direction</dt><dd>composition <b>${escape(entry.art.composition)}</b> · accent ${escape(entry.art.accent)} · cta ${escape(entry.art.cta)} · device ${entry.art.device ? 'yes' : 'no'}</dd>`,
      `<dt>D — copy</dt><dd><b>${escape(entry.content.headline)}</b><br>${escape(entry.content.subheadline)}<br>cta: ${escape(entry.content.callToAction)} · offer: ${escape(entry.content.offerText)}</dd>`,
      `<dt>A — prompt</dt><dd class="prompt">${escape(entry.prompt)}</dd>`,
      `</dl>`,
    ].join('')
    return {
      imageKey: key,
      meta,
      creative: {
        id: `live-${entry.position}`,
        ownerId: 'visual-harness', businessId: 'biz', campaignId: 'camp',
        conversationId: null, sourceRecommendationId: null,
        name: entry.name, format: 'square_post', status: 'ready',
        captions: { facebook: null, instagram: null, short: null, whatsapp: null },
        render: null, userEdited: [], ownerDirectives: [], imageError: null,
        content: {
          ...entry.content,
          layout: 'image_full_bleed',
          deviceImage: null,
          image: { storagePath: key, prompt: entry.prompt, altText: null, source: 'generated' },
        },
        style: {
          palette: entry.style.palette,
          headingFont: entry.style.headingFont,
          bodyFont: entry.style.bodyFont,
          logoStoragePath: images['logo:matheasy'] ? 'logo:matheasy' : null,
          brandApplied: null,
          artDirection: entry.art,
        },
      },
    }
  })
}

const live = manifestPath !== null
const entries = live ? liveEntries() : FIXTURES

/* --- the contact sheet ------------------------------------------------------ */

const COLUMNS = 3
const CELL = live ? 460 : 520
const STYLE = `
  body { margin: 0; background: #e9e9ea; font: 13px -apple-system, sans-serif; }
  #sheet { display: grid; grid-template-columns: repeat(${COLUMNS}, ${CELL}px); gap: 28px; padding: 28px; align-items: start; }
  .row { display: contents; }
  .cell { margin: 0; }
  canvas, .cell img { width: ${CELL}px; height: auto; display: block; box-shadow: 0 6px 22px rgba(0,0,0,0.18); border-radius: 4px; background: #fff; }
  figcaption { padding-top: 8px; color: #444; font-size: 12px; }
  .meta { background: #fff; border-radius: 4px; padding: 16px 18px; color: #222; line-height: 1.45; box-shadow: 0 6px 22px rgba(0,0,0,0.10); }
  .meta h2 { margin: 0 0 10px; font-size: 15px; }
  .meta dt { font-weight: 600; margin-top: 10px; color: #666; font-size: 11px; text-transform: uppercase; letter-spacing: .04em; }
  .meta dd { margin: 4px 0 0; }
  .meta .prompt { font: 10px/1.35 ui-monospace, monospace; color: #555; white-space: pre-wrap; }
`

function page(payload, fn) {
  return `<!doctype html><html><head><meta charset="utf-8"><style>${STYLE}</style></head>
<body><div id="sheet"></div>
<script>${script}</script>
<script>
  window.${fn}(${JSON.stringify(payload)}, ${JSON.stringify(images)})
    .then(() => { document.title = 'ready' })
    .catch((error) => { document.title = 'error: ' + error.message })
</script></body></html>`
}

function shoot(html, name, windowSize) {
  const pagePath = join(outDir, `${name}.html`)
  writeFileSync(pagePath, html)
  const shot = join(outDir, `${name}.png`)
  execFileSync(
    CHROME,
    [
      '--headless=new', '--disable-gpu', '--hide-scrollbars', '--force-device-scale-factor=1',
      `--window-size=${windowSize}`, '--virtual-time-budget=8000',
      `--screenshot=${shot}`, `file://${pagePath}`,
    ],
    { stdio: 'ignore' },
  )
  return shot
}

const width = COLUMNS * (CELL + 28) + 28

if (live) {
  // One screenshot per poster: the metadata column is long, and a poster that
  // has to be judged on craft has to be looked at large.
  entries.forEach((entry, index) => {
    const shot = shoot(page([entry], '__renderLive'), `live-${index + 1}`, `${width},${CELL * 1.25 + 900}`)
    console.log(`[visual] poster ${index + 1} \u2192 ${shot}`)
  })
} else {
  const rows = Math.ceil(entries.length / COLUMNS)
  const shot = shoot(
    page(entries, '__renderPosters'),
    'posters',
    // Portrait cells are the tallest, so size the window for those plus captions.
    `${width},${rows * (CELL * 1.25 + 60) + 56}`,
  )
  console.log(`[visual] ${entries.length} posters \u2192 ${shot}`)
}
