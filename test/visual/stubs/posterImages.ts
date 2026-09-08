/** Poster art loaded from the harness's synthetic scenes instead of Storage. */
import { IMAGES } from './services'

interface PosterImages {
  image: HTMLImageElement | null
  logo: HTMLImageElement | null
  device: HTMLImageElement | null
}

function load(path: string | null): Promise<HTMLImageElement | null> {
  const src = path ? IMAGES[path] : null
  if (!src) return Promise.resolve(null)
  return new Promise((resolve) => {
    const image = new Image()
    image.onload = () => resolve(image)
    image.onerror = () => resolve(null)
    image.src = src
  })
}

export async function loadPosterImages(paths: {
  imageStoragePath: string | null
  logoStoragePath: string | null
  deviceStoragePath: string | null
}): Promise<PosterImages> {
  const [image, logo, device] = await Promise.all([
    load(paths.imageStoragePath),
    load(paths.logoStoragePath),
    load(paths.deviceStoragePath),
  ])
  return { image, logo, device }
}
