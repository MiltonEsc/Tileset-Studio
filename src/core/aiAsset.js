// AI scenery-prop generation via the Gemini API.
// Props are generated on a solid chroma background, then keyed out locally.

import { AI_MODELS, generateImage } from './aiTile.js'

export { AI_MODELS }

const DEFAULT_ASSET_MODEL = 'gemini-2.5-flash-image'
const DEFAULT_QUALITY = 'medium'

const STYLE_BASE = `
Generate a single isolated pixel-art game prop.
Use a clear game sprite silhouette.
Design the object specifically to remain readable at small pixel sizes.
Use large shapes.
Use a limited color palette.
Avoid tiny details.
Avoid sub-pixel features.
Avoid anti-aliasing.
Avoid gradients.
Avoid soft shading.
No text, labels, UI, ground, or cast shadow.
`

const BG_SOLID =
  'Place the prop on a plain solid flat magenta (#FF00FF) background filling all empty space. ' +
  'Do not use magenta inside the prop itself. Subject: '

const CHROMA_TOLERANCE = 60
// Levels per RGB channel. Was 999 (a no-op — the rounding step collapsed to
// ~1); 6 actually flattens the AI's soft gradients into pixel-art color bands.
const POSTERIZE_LEVELS = 6
const ALPHA_THRESHOLD = 128

function chromaKey(data, w, h, tolerance = CHROMA_TOLERANCE) {
  const corners = [
    [0, 0],
    [w - 1, 0],
    [0, h - 1],
    [w - 1, h - 1],
  ].map(([x, y]) => {
    const i = (y * w + x) * 4
    return [data[i], data[i + 1], data[i + 2]]
  })

  const bg = [0, 1, 2].map(c =>
    Math.round(corners.reduce((sum, pixel) => sum + pixel[c], 0) / corners.length),
  )

  for (let i = 0; i < data.length; i += 4) {
    const dr = data[i] - bg[0]
    const dg = data[i + 1] - bg[1]
    const db = data[i + 2] - bg[2]
    const distance = Math.sqrt(dr * dr + dg * dg + db * db)

    if (distance <= tolerance) {
      data[i + 3] = 0
    }
  }
}

function deFringeMagenta(data) {
  for (let i = 0; i < data.length; i += 4) {
    if (data[i + 3] === 0) continue

    const r = data[i]
    const g = data[i + 1]
    const b = data[i + 2]

    if (r - g > 60 && b - g > 60) {
      data[i + 3] = 0
    }
  }
}

function solidifyAlpha(data, threshold = ALPHA_THRESHOLD) {
  for (let i = 0; i < data.length; i += 4) {
    data[i + 3] = data[i + 3] < threshold ? 0 : 255
  }
}

function posterize(data, levels = POSTERIZE_LEVELS) {
  const step = 255 / (levels - 1)

  for (let i = 0; i < data.length; i += 4) {
    if (data[i + 3] === 0) continue

    data[i] = Math.round(Math.round(data[i] / step) * step)
    data[i + 1] = Math.round(Math.round(data[i + 1] / step) * step)
    data[i + 2] = Math.round(Math.round(data[i + 2] / step) * step)
  }
}

function cropTransparentBounds(canvas) {
  const ctx = canvas.getContext('2d')
  const { width, height } = canvas
  const id = ctx.getImageData(0, 0, width, height)
  const data = id.data

  let minX = width
  let minY = height
  let maxX = -1
  let maxY = -1

  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const alpha = data[(y * width + x) * 4 + 3]

      if (alpha > 0) {
        minX = Math.min(minX, x)
        minY = Math.min(minY, y)
        maxX = Math.max(maxX, x)
        maxY = Math.max(maxY, y)
      }
    }
  }

  if (maxX < minX || maxY < minY) return canvas

  const cropW = maxX - minX + 1
  const cropH = maxY - minY + 1

  const out = document.createElement('canvas')
  out.width = cropW
  out.height = cropH

  const outCtx = out.getContext('2d')
  outCtx.imageSmoothingEnabled = false
  outCtx.drawImage(canvas, minX, minY, cropW, cropH, 0, 0, cropW, cropH)

  return out
}

function containToTargetCanvas(srcCanvas, pxW, pxH) {
  const out = document.createElement('canvas')
  out.width = pxW
  out.height = pxH

  const ctx = out.getContext('2d')
  ctx.imageSmoothingEnabled = false
  ctx.clearRect(0, 0, pxW, pxH)

  const scale = Math.min(pxW / srcCanvas.width, pxH / srcCanvas.height)
  const drawW = Math.max(1, Math.floor(srcCanvas.width * scale))
  const drawH = Math.max(1, Math.floor(srcCanvas.height * scale))
  const dx = Math.floor((pxW - drawW) / 2)
  const dy = Math.floor((pxH - drawH) / 2)

  ctx.drawImage(srcCanvas, 0, 0, srcCanvas.width, srcCanvas.height, dx, dy, drawW, drawH)

  return out
}

function downscaleCanvasPixelPerfect(srcCanvas, pxW, pxH) {
  const out = document.createElement('canvas')
  out.width = pxW
  out.height = pxH

  const ctx = out.getContext('2d')
  ctx.imageSmoothingEnabled = false
  ctx.clearRect(0, 0, pxW, pxH)
  ctx.drawImage(srcCanvas, 0, 0, srcCanvas.width, srcCanvas.height, 0, 0, pxW, pxH)

  return out
}

function pixelsToCanvas(data, width, height) {
  const canvas = document.createElement('canvas')
  canvas.width = width
  canvas.height = height

  const ctx = canvas.getContext('2d')
  ctx.imageSmoothingEnabled = false
  const id = ctx.createImageData(width, height)
  id.data.set(data)
  ctx.putImageData(id, 0, 0)

  return canvas
}

function postprocessAssetCanvas(srcCanvas, pxW, pxH) {
  let canvas = srcCanvas
  const sourceCtx = canvas.getContext('2d')
  const sourceId = sourceCtx.getImageData(0, 0, canvas.width, canvas.height)

  chromaKey(sourceId.data, canvas.width, canvas.height)
  deFringeMagenta(sourceId.data)
  solidifyAlpha(sourceId.data)
  sourceCtx.putImageData(sourceId, 0, 0)

  canvas = cropTransparentBounds(canvas)
  canvas = containToTargetCanvas(canvas, pxW, pxH)
  canvas = downscaleCanvasPixelPerfect(canvas, pxW, pxH)

  const ctx = canvas.getContext('2d')
  const id = ctx.getImageData(0, 0, pxW, pxH)

  solidifyAlpha(id.data)
  posterize(id.data)

  return new Uint8ClampedArray(id.data)
}

export async function generateAssetWithAI({
  prompt,
  model = DEFAULT_ASSET_MODEL,
  quality = DEFAULT_QUALITY,
  pxW,
  pxH,
}) {
  if (!prompt || !prompt.trim()) throw new Error('Enter a prompt describing the prop.')
  if (!pxW || !pxH) throw new Error('Missing target pixel size.')

  const subject = prompt.trim()
  const generated = await generateImage({
    prompt: STYLE_BASE + BG_SOLID + subject,
    model,
    quality,
    outputFormat: 'png',
  })

  return postprocessAssetCanvas(
    pixelsToCanvas(generated.data, generated.width, generated.height),
    pxW,
    pxH,
  )
}
