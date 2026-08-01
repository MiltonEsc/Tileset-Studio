import { fileToRgba } from './imageImport.js'

export const PIXEL_SNAPPER_COLOR_OPTIONS = [8, 16, 24, 32]

let modulePromise

function loadPixelSnapper() {
  if (!modulePromise) {
    modulePromise = import('../vendor/spritefusion-pixel-snapper/spritefusion_pixel_snapper.js')
      .then(async (mod) => {
        await mod.default()
        return mod
      })
      .catch((error) => {
        modulePromise = null
        throw error
      })
  }
  return modulePromise
}

// Keep option validation outside WASM so bad form values produce a useful UI
// error instead of a generic WebAssembly exception.
export function normalizePixelSnapOptions({ colorCount = 16, pixelSize = null } = {}) {
  const colors = Number(colorCount)
  if (!Number.isInteger(colors) || colors < 1 || colors > 256) {
    throw new Error('Pixel Snapper color count must be between 1 and 256.')
  }

  if (pixelSize === '' || pixelSize == null) return { colorCount: colors, pixelSize: null }
  const size = Number(pixelSize)
  if (!Number.isFinite(size) || size < 1) {
    throw new Error('Pixel size must be a positive number or left empty for auto detection.')
  }
  return { colorCount: colors, pixelSize: size }
}

// Runs Sprite Fusion Pixel Snapper entirely in the browser. Its PNG output is
// decoded back to RGBA so the existing procedural texture pipeline can consume
// it without knowing about WASM or encoded image formats.
export async function snapImageFile(file, options) {
  if (!file?.arrayBuffer) throw new Error('Choose a PNG or JPEG image first.')
  const { colorCount, pixelSize } = normalizePixelSnapOptions(options)
  const input = new Uint8Array(await file.arrayBuffer())
  const { process_image: processImage } = await loadPixelSnapper()
  const pngBytes = processImage(input, colorCount, pixelSize, null)
  const rgba = await fileToRgba(new Blob([pngBytes], { type: 'image/png' }))
  return { ...rgba, pngBytes }
}
