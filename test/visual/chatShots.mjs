/**
 * Visual QA for the EVA-first chat surfaces (Phase 7J §24).
 *
 * Wiring tests can prove a button exists; they cannot see that two buttons
 * say the same thing, that a card clips at 390px, or that a poster grid
 * pushes the thread sideways. So this renders the real components — the same
 * MessageBubble, cards, empty states and poster renderer the app ships —
 * against the fourteen scenes of §24, in a real browser, at each viewport and
 * in both themes, and writes one contact sheet per combination to be looked
 * at.
 *
 *   node test/visual/chatShots.mjs [--out DIR]
 *
 * It needs Google Chrome (or CHROME_PATH) and a built stylesheet
 * (`npm run build`, whose Tailwind output is inlined). No emulator, no API
 * key, no network: the five Firebase-backed service modules are aliased to
 * stubs that hand back fixture documents, and the poster photography is
 * synthetic, with the tonal structure the layout decisions key off.
 */
import { execFileSync } from 'node:child_process'
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { build } from 'esbuild'
import { CREATIVE_FIXTURES, SCENARIOS } from './chatScenarios.mjs'

const here = dirname(fileURLToPath(import.meta.url))
const root = resolve(here, '../..')

const outFlag = process.argv.indexOf('--out')
const outDir = outFlag > -1 ? resolve(process.argv[outFlag + 1]) : join(here, 'chat-out')
mkdirSync(outDir, { recursive: true })

const CHROME =
  process.env.CHROME_PATH ?? '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'
if (!existsSync(CHROME)) {
  console.error(`Chrome not found at ${CHROME}. Set CHROME_PATH.`)
  process.exit(2)
}

/* --- the app's own stylesheet ---------------------------------------------- */

const assets = join(root, 'dist/assets')
const cssFile = existsSync(assets)
  ? readdirSync(assets).find((name) => name.endsWith('.css'))
  : null
if (!cssFile) {
  console.error('No built stylesheet in dist/assets. Run `npm run build` first.')
  process.exit(2)
}
const css = readFileSync(join(assets, cssFile), 'utf8')

/* --- synthetic photography -------------------------------------------------- */

function scene(hue, label) {
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="1024" height="1024">
    <defs>
      <radialGradient id="key" cx="70%" cy="20%" r="85%">
        <stop offset="0" stop-color="hsl(${hue},34%,86%)"/>
        <stop offset="0.55" stop-color="hsl(${hue},28%,56%)"/>
        <stop offset="1" stop-color="hsl(${hue},32%,16%)"/>
      </radialGradient>
      <linearGradient id="floor" x1="0" y1="0" x2="0" y2="1">
        <stop offset="0" stop-color="rgba(0,0,0,0)"/>
        <stop offset="1" stop-color="rgba(0,0,0,0.45)"/>
      </linearGradient>
    </defs>
    <rect width="1024" height="1024" fill="url(#key)"/>
    <ellipse cx="620" cy="480" rx="260" ry="300" fill="hsl(${hue},24%,32%)" opacity="0.85"/>
    <circle cx="620" cy="270" r="120" fill="hsl(28,36%,60%)"/>
    <rect width="1024" height="1024" fill="url(#floor)"/>
    <text x="40" y="990" font-family="monospace" font-size="26" fill="rgba(255,255,255,0.5)">${label}</text>
  </svg>`
  return `data:image/svg+xml;base64,${Buffer.from(svg).toString('base64')}`
}

const images = {
  'scene:food': scene(24, 'synthetic scene — food'),
  'scene:table': scene(38, 'synthetic scene — table'),
  'scene:kitchen': scene(8, 'synthetic scene — kitchen'),
}

/* --- bundle the real components against stubbed Firebase leaves ------------- */

/**
 * The five modules that would open a Firestore connection at import time.
 * Aliased rather than mocked inside the components, so every component in
 * the shot is byte-for-byte the one the app ships.
 */
const STUBS = {
  '@/services/creatives/creative.service': 'stubs/services.ts',
  '@/services/campaigns/campaign.service': 'stubs/services.ts',
  '@/services/storage/storage.service': 'stubs/services.ts',
  '@/services/ai/ai.client': 'stubs/services.ts',
  '@/services/chat/attachment.service': 'stubs/services.ts',
  '@/services/assets/asset.service': 'stubs/services.ts',
  '@/features/creative/posterImages': 'stubs/posterImages.ts',
}

const stubPlugin = {
  name: 'firebase-stubs',
  setup(builder) {
    builder.onResolve({ filter: /.*/ }, (args) => {
      const stub = STUBS[args.path]
      return stub ? { path: join(here, stub) } : null
    })
  },
}

const bundle = await build({
  entryPoints: [join(here, 'chatEntry.tsx')],
  bundle: true,
  format: 'iife',
  write: false,
  absWorkingDir: root,
  alias: { '@': join(root, 'src') },
  plugins: [stubPlugin],
  jsx: 'automatic',
  loader: { '.ts': 'ts', '.tsx': 'tsx' },
  define: { 'process.env.NODE_ENV': '"production"' },
})
const script = bundle.outputFiles[0].text

/* --- the sheets -------------------------------------------------------------- */

const VIEWPORTS = [
  { name: 'desktop-1280', width: 1280 },
  { name: 'desktop-1024', width: 1024 },
  { name: 'mobile-390', width: 390 },
]
const THEMES = ['light', 'dark']

function page(theme) {
  const payload = {
    scenarios: SCENARIOS,
    creatives: CREATIVE_FIXTURES,
    images,
    language: 'en',
  }
  return `<!doctype html><html lang="en" class="${theme === 'dark' ? 'dark' : ''}" style="color-scheme:${theme}">
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><style>${css}</style></head>
<body><div id="root"></div>
<script>${script}</script>
<script>
  window.__renderChat(${JSON.stringify(payload)})
    .then((geometry) => { document.title = 'ready ' + JSON.stringify(geometry) })
    .catch((error) => { document.title = 'error: ' + error.message })
</script></body></html>`
}

/*
  Chrome on macOS refuses a window narrower than 500px, so a 390px phone
  cannot be shot by sizing the window. The page therefore renders inside an
  iframe of exactly the viewport width — media queries inside an iframe are
  evaluated against the iframe, so `sm:` and `lg:` behave as they would on
  the device — and the screenshot is cropped back to that width.
*/
function frame(pageFile, width, height, window_ = null) {
  const view = window_
    ? `#view{width:${width}px;height:${window_.height}px;overflow:hidden;position:relative}
       iframe{position:absolute;top:${-window_.top}px;left:0}`
    : ''
  return `<!doctype html><html><head><meta charset="utf-8"><style>
  html,body{margin:0;padding:0;background:#7f7f7f}
  iframe{border:0;display:block;width:${width}px;height:${height}px}
  ${view}
</style></head><body>
<div id="view"><iframe id="f" src="${pageFile}"></iframe></div>
<script>
  const f = document.getElementById('f')
  const poll = setInterval(() => {
    const title = f.contentDocument && f.contentDocument.title
    if (title && (title.startsWith('ready ') || title.startsWith('error'))) {
      clearInterval(poll)
      document.title = title
    }
  }, 100)
</script></body></html>`
}

const CHROME_FLAGS = [
  '--headless=new',
  '--disable-gpu',
  '--hide-scrollbars',
  '--allow-file-access-from-files',
  '--force-device-scale-factor=1',
  '--virtual-time-budget=15000',
]

function measure(framePath, width, height) {
  const dom = execFileSync(
    CHROME,
    [...CHROME_FLAGS, `--window-size=${Math.max(width + 20, 520)},${height}`, '--dump-dom', `file://${framePath}`],
    { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024, stdio: ['ignore', 'pipe', 'ignore'] },
  )
  const title = /<title>([\s\S]*?)<\/title>/.exec(dom)?.[1] ?? ''
  if (!title.startsWith('ready ')) throw new Error(`render failed: ${title.slice(0, 300)}`)
  return JSON.parse(title.slice(6))
}

const slug = (title) => title.split('\u00b7')[0].trim().padStart(2, '0')

for (const theme of THEMES) {
  const pageFile = `page-${theme}.html`
  writeFileSync(join(outDir, pageFile), page(theme))

  for (const viewport of VIEWPORTS) {
    const name = `${viewport.name}-${theme}`
    const framePath = join(outDir, `${name}.html`)

    writeFileSync(framePath, frame(pageFile, viewport.width, 2000))
    const geometry = measure(framePath, viewport.width, 2000)
    if (geometry.width > viewport.width) {
      console.log(`[visual] !! ${name} scrolls sideways: ${geometry.width}px > ${viewport.width}px`)
      for (const entry of geometry.overflow) console.log(`[visual]    ${entry}`)
    }

    const height = Math.min(geometry.height, 15000)
    writeFileSync(framePath, frame(pageFile, viewport.width, height))
    const sheet = join(outDir, `${name}.png`)
    execFileSync(
      CHROME,
      [...CHROME_FLAGS, `--window-size=${Math.max(viewport.width + 20, 520)},${height + 40}`, `--screenshot=${sheet}`, `file://${framePath}`],
      { stdio: 'ignore' },
    )

    // One image per scene: a scene has to be judged at its own size, not as
    // a band of a 9,000px screenshot. The page is rendered once more per
    // scene with the iframe scrolled to it, which is exact — cropping the
    // sheet afterwards is not.
    const sceneDir = join(outDir, name)
    mkdirSync(sceneDir, { recursive: true })
    for (const scene of geometry.scenes) {
      const scenePath = join(outDir, `${name}-scene.html`)
      writeFileSync(scenePath, frame(pageFile, viewport.width, height, scene))
      execFileSync(
        CHROME,
        [...CHROME_FLAGS, `--window-size=${Math.max(viewport.width + 20, 520)},${scene.height + 20}`,
         `--screenshot=${join(sceneDir, `${slug(scene.title ?? '')}.png`)}`, `file://${scenePath}`],
        { stdio: 'ignore' },
      )
    }
    console.log(`[visual] ${name} → ${sheet} (+${geometry.scenes.length} scenes, ${height}px)`)
  }
}
