import { useEffect, useMemo, useRef, useState } from 'react'
import { waitForBrandFonts } from '@/features/business/brand/fonts'
import type { Creative } from '@/types'
import { posterDesign, posterInput } from './posterDesign'
import { drawPoster, type PosterImages } from './posterDraw'
import { loadPosterImages } from './posterImages'

/**
 * The poster, as the owner will download it — drawn by the same renderer
 * the download uses, from the persisted creative and nothing else.
 *
 * This is the only way a creative is shown anywhere in the app (Creative
 * page, chat, campaign page): one input mapping, one design, one drawing.
 * The canvas is sized to its CSS box (capped at export resolution) and
 * redrawn when the box, the images or the brand fonts change.
 */

interface PosterCanvasProps {
  creative: Creative
  className?: string
}

const EMPTY: PosterImages = { image: null, logo: null }

export function PosterCanvas({ creative, className }: PosterCanvasProps) {
  const input = useMemo(() => posterInput(creative), [creative])
  const design = useMemo(() => posterDesign(input), [input])
  const canvasRef = useRef<HTMLCanvasElement | null>(null)

  const imageKey = `${input.imageStoragePath ?? ''}|${input.logoStoragePath ?? ''}`
  const [loaded, setLoaded] = useState<{ key: string; images: PosterImages } | null>(null)
  const images = loaded && loaded.key === imageKey ? loaded.images : EMPTY

  const fontKey = `${input.headingFont ?? ''}|${input.bodyFont ?? ''}`
  const [fontsReadyFor, setFontsReadyFor] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    const [imageStoragePath, logoStoragePath] = imageKey.split('|').map((p) => p || null)
    loadPosterImages({
      imageStoragePath: imageStoragePath ?? null,
      logoStoragePath: logoStoragePath ?? null,
    }).then((next) => {
      if (!cancelled) setLoaded({ key: imageKey, images: next })
    })
    return () => {
      cancelled = true
    }
  }, [imageKey])

  useEffect(() => {
    let cancelled = false
    const [heading, body] = fontKey.split('|')
    waitForBrandFonts([heading || null, body || null]).then(() => {
      if (!cancelled) setFontsReadyFor(fontKey)
    })
    return () => {
      cancelled = true
    }
  }, [fontKey])

  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return
    const draw = () => {
      const cssWidth = canvas.clientWidth || 360
      const dpr = Math.min(window.devicePixelRatio || 1, 2)
      const pixelWidth = Math.max(1, Math.min(Math.round(cssWidth * dpr), design.width))
      const scale = pixelWidth / design.width
      canvas.width = pixelWidth
      canvas.height = Math.max(1, Math.round(design.height * scale))
      const ctx = canvas.getContext('2d')
      if (!ctx) return
      ctx.setTransform(scale, 0, 0, scale, 0, 0)
      drawPoster(ctx, design, input, images)
    }
    draw()
    if (typeof ResizeObserver === 'undefined') return
    const observer = new ResizeObserver(() => draw())
    observer.observe(canvas)
    return () => observer.disconnect()
    // fontsReadyFor is a redraw trigger: the brand faces arrived.
  }, [design, input, images, fontsReadyFor])

  return (
    <canvas
      ref={canvasRef}
      className={className}
      role="img"
      aria-label={input.imageAltText ?? input.headline ?? input.name}
      // Phase 7G §16: which persisted creative this is, on every surface
      // that shows one. The same id must draw the same poster in chat, on
      // the Creative page and in the download — this makes that checkable.
      data-creative-id={input.creativeId}
      data-image-path={input.imageStoragePath ?? undefined}
      style={{ aspectRatio: `${design.width} / ${design.height}` }}
    />
  )
}
