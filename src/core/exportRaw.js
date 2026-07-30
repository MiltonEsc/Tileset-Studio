// Helpers to inspect/save the RAW image an AI returns, BEFORE the tile pipeline
// (downscale + sharpen + quantize) turns it into pixel art. The raw RGBA buffer
// is `generateBaseTileWithAI`'s `rawPixels`, sized by `meta.rawSize` ("WxH").

// Parse a "1024x1024" rawSize string into { width, height } (0s if malformed).
export function parseRawSize(rawSize) {
  const [w, h] = String(rawSize || '').split('x').map(n => parseInt(n, 10))
  return { width: w || 0, height: h || 0 }
}

function rgbaToCanvas(data, width, height) {
  const canvas = document.createElement('canvas')
  canvas.width = width
  canvas.height = height
  const ctx = canvas.getContext('2d')
  // Clone so the source buffer is never adopted/detached by ImageData.
  const expected = width * height * 4; const safeData = data.length === expected ? data : new Uint8ClampedArray(expected); safeData.set(data.subarray(0, Math.min(data.length, expected))); ctx.putImageData(new ImageData(new Uint8ClampedArray(safeData), width, height), 0, 0)
  return canvas
}

// A PNG data-URL for an <img> thumbnail of the raw image.
export function rgbaToDataURL(data, width, height) {
  if (!width || !height) return ''
  return rgbaToCanvas(data, width, height).toDataURL('image/png')
}

// Build a lightweight, self-contained preview of the RAW AI image: a PNG
// data-URL (used for BOTH the <img> and the download anchor) plus its dimensions
// and provider. Crucially this returns the data-URL string and lets the multi-MB
// `rawPixels` buffer be garbage-collected — keeping that buffer in React state /
// passing it as a prop blows up React 19's dev performance tracking (it tries to
// structured-clone the large typed array and runs out of memory).
export function rawToPreview(result) {
  if (!result?.rawPixels) return null
  const { width, height } = parseRawSize(result.meta?.rawSize)
  if (!width || !height) return null
  return {
    url: rgbaToDataURL(result.rawPixels, width, height),
    width,
    height,
    provider: result.meta?.provider || 'img',
  }
}
