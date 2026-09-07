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

/* --- the contact sheet ------------------------------------------------------ */

const COLUMNS = 3
const CELL = 520
const html = `<!doctype html><html><head><meta charset="utf-8"><style>
  body { margin: 0; background: #e9e9ea; font: 13px -apple-system, sans-serif; }
  #sheet { display: grid; grid-template-columns: repeat(${COLUMNS}, ${CELL}px); gap: 28px; padding: 28px; align-items: start; }
  .cell { margin: 0; }
  canvas { width: ${CELL}px; height: auto; display: block; box-shadow: 0 6px 22px rgba(0,0,0,0.18); border-radius: 4px; background: #fff; }
  figcaption { padding-top: 8px; color: #444; font-size: 12px; }
</style></head><body><div id="sheet"></div>
<script>${script}</script>
<script>
  window.__renderPosters(${JSON.stringify(FIXTURES)}, ${JSON.stringify(images)})
    .then(() => { document.title = 'ready' })
    .catch((error) => { document.title = 'error: ' + error.message })
</script></body></html>`

const pagePath = join(outDir, 'sheet.html')
writeFileSync(pagePath, html)

const rows = Math.ceil(FIXTURES.length / COLUMNS)
// Portrait cells are the tallest, so size the window for those plus captions.
const windowSize = `${COLUMNS * (CELL + 28) + 28},${rows * (CELL * 1.25 + 60) + 56}`
const shot = join(outDir, 'posters.png')

execFileSync(
  CHROME,
  [
    '--headless=new',
    '--disable-gpu',
    '--hide-scrollbars',
    '--force-device-scale-factor=1',
    `--window-size=${windowSize}`,
    '--virtual-time-budget=8000',
    `--screenshot=${shot}`,
    `file://${pagePath}`,
  ],
  { stdio: 'ignore' },
)

console.log(`[visual] ${FIXTURES.length} posters → ${shot}`)
