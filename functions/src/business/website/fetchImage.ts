import { assertResolvesToPublicAddress } from './guard'
import { normalizeWebsiteUrl } from './url'

/**
 * Fetches ONE image a source page already exposed, under the same SSRF
 * discipline as `fetchPage` (Phase 7E).
 *
 * This is not a second fetching pipeline. Every URL goes through the same
 * `normalizeWebsiteUrl` checks and the same DNS guard as a page, on every
 * redirect hop, and the same known DNS-rebind limitation applies (see
 * `guard.ts`). What differs is only what is accepted back: a raster image
 * type, under a hard byte cap, returned as a data URL for the model.
 *
 * Callers pass only URLs that an approved fetch put in front of them — an
 * `og:image`, an `<img>` on a crawled page, the icon the brand extractor
 * found. A URL the model produced is never fetched: the model refers to
 * images by the ids the evidence builder assigned, not by address.
 *
 * Failure is soft: an image that cannot be fetched is simply not evidence.
 * Nothing about why (status, host, library error) leaves this module.
 */

/** Per-image wall clock. */
const REQUEST_TIMEOUT_MS = 8_000

/** Enough for any logo or profile picture; a poster-size photo is refused. */
export const MAX_IMAGE_BYTES = 1_500_000

const MAX_REDIRECTS = 2

/** The raster types the model input accepts. SVG is a script container. */
export const IMAGE_MIME_TYPES = ['image/jpeg', 'image/png', 'image/webp'] as const

const USER_AGENT =
  'MarkaBot/1.0 (+https://marka.my/bot; AI marketing assistant reading a customer-supplied website)'

export interface FetchedImage {
  /** The URL that finally served the bytes. */
  url: string
  contentType: (typeof IMAGE_MIME_TYPES)[number]
  bytes: number
  dataUrl: string
}

/** Injectable transport so the guard logic is testable without a network. */
export interface ImageFetchDeps {
  request: (url: string) => Promise<Response>
  assertPublic: (hostname: string) => Promise<void>
}

const REAL_DEPS: ImageFetchDeps = {
  async request(url) {
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS)
    try {
      return await fetch(url, {
        method: 'GET',
        redirect: 'manual',
        signal: controller.signal,
        headers: { 'user-agent': USER_AGENT, accept: 'image/jpeg,image/png,image/webp' },
      })
    } finally {
      clearTimeout(timer)
    }
  },
  assertPublic: assertResolvesToPublicAddress,
}

/**
 * Resolves to the image, or null when it cannot be safely used as evidence.
 * Never throws: an SSRF refusal, a timeout and a wrong type all mean "no
 * image" to the caller, and the reason stays here.
 */
export async function fetchSourceImage(
  rawUrl: string,
  deps: ImageFetchDeps = REAL_DEPS,
): Promise<FetchedImage | null> {
  try {
    let current = normalizeWebsiteUrl(rawUrl)

    for (let hop = 0; hop <= MAX_REDIRECTS; hop += 1) {
      await deps.assertPublic(new URL(current).hostname)
      const response = await deps.request(current)

      if (isRedirect(response.status)) {
        const location = response.headers.get('location')
        await response.body?.cancel().catch(() => undefined)
        if (!location) return null
        // Back through the same validation the original URL faced.
        current = normalizeWebsiteUrl(new URL(location, current).toString())
        continue
      }

      if (!response.ok) {
        await response.body?.cancel().catch(() => undefined)
        return null
      }

      const contentType = imageType(response.headers.get('content-type'))
      const declaredLength = Number(response.headers.get('content-length') ?? '0')
      if (!contentType || declaredLength > MAX_IMAGE_BYTES) {
        await response.body?.cancel().catch(() => undefined)
        return null
      }

      const bytes = await readCapped(response)
      if (!bytes) return null
      return {
        url: current,
        contentType,
        bytes: bytes.byteLength,
        dataUrl: `data:${contentType};base64,${Buffer.from(bytes).toString('base64')}`,
      }
    }
    return null
  } catch {
    return null
  }
}

function isRedirect(status: number): boolean {
  return status === 301 || status === 302 || status === 303 || status === 307 || status === 308
}

function imageType(header: string | null): FetchedImage['contentType'] | null {
  const type = (header ?? '').split(';')[0]?.trim().toLowerCase() ?? ''
  return (IMAGE_MIME_TYPES as readonly string[]).includes(type)
    ? (type as FetchedImage['contentType'])
    : null
}

/** Streams the body, giving up the moment it exceeds the cap. */
async function readCapped(response: Response): Promise<Uint8Array | null> {
  const body = response.body
  if (!body) return null

  const reader = body.getReader()
  const chunks: Uint8Array[] = []
  let received = 0
  try {
    for (;;) {
      const { done, value } = await reader.read()
      if (done) break
      if (!value) continue
      received += value.byteLength
      if (received > MAX_IMAGE_BYTES) return null
      chunks.push(value)
    }
  } finally {
    reader.releaseLock()
    await body.cancel().catch(() => undefined)
  }

  if (received === 0) return null
  const buffer = new Uint8Array(received)
  let offset = 0
  for (const chunk of chunks) {
    buffer.set(chunk, offset)
    offset += chunk.byteLength
  }
  return buffer
}
