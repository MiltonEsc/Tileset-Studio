// AI base-tile generation. Supports two providers, picked per model:
//   - Gemini (Google Generative Language API)
//   - OpenAI (Images API, gpt-image family)
// In dev, requests go through Vite proxies (/gemini, /openai) to avoid CORS.
// API keys are read ONLY from .env.local (never from the UI). See resolveApiKey.
//
// This module is only reached through the lazy AI panels, so image-q rides in
// the lazy AI chunk (not the initial bundle).
import { utils as iqUtils, buildPaletteSync, applyPaletteSync } from 'image-q'
import { downscaleRgba } from './imageResize.js'

// Dithering modes exposed in the AI tile panels (UI label → image-q mode).
export const DITHER_OPTIONS = [
  { value: 'nearest',         label: 'Off' },
  { value: 'floyd-steinberg', label: 'Floyd–Steinberg' },
  { value: 'atkinson',        label: 'Atkinson' },
]
const DEFAULT_DITHER = 'nearest'
const QUANT_FORMULA = 'euclidean-bt709'
// Exported so the text-generation path (aiText.js) reuses the same dev proxies.
const IS_DEV = import.meta.env?.DEV === true
export const GEMINI_BASE = IS_DEV ? '/gemini/v1beta' : 'https://generativelanguage.googleapis.com/v1beta'
export const OPENAI_BASE = IS_DEV ? '/openai/v1' : 'https://api.openai.com/v1'
// fal.ai (FLUX). Synchronous endpoint: POST /<model> returns the image inline
// (a data-URI) when sync_mode is set, so no polling / CDN-CORS handling needed.
export const FAL_BASE = IS_DEV ? '/fal' : 'https://fal.run'
// Cloudflare Workers AI (Stable Diffusion XL). POST /accounts/<id>/ai/run/<model>
// returns the PNG as RAW BINARY (not base64/JSON) — handled via blob + object-URL.
export const CLOUDFLARE_BASE = IS_DEV ? '/cloudflare/client/v4' : 'https://api.cloudflare.com/client/v4'
// Recraft V3. OpenAI-compatible images endpoint; request b64_json to skip the CDN.
export const RECRAFT_BASE = IS_DEV ? '/recraft' : 'https://external.api.recraft.com'
const DEFAULT_IMAGE_MODEL = 'gpt-image-2'
const FALLBACK_IMAGE_MODEL = 'gemini-2.5-flash-image'
const DEFAULT_QUALITY = 'low'
const DEFAULT_OUTPUT_FORMAT = 'png'
const MAX_TILE_COLORS = 10

export const AI_MODELS = [
  { id: 'gpt-image-2',            label: 'GPT Image 2 · Low (recommended)', provider: 'openai' },
  { id: 'gpt-image-1-mini',       label: 'GPT Image 1 Mini · cheapest',     provider: 'openai' },
  { id: 'gemini-2.5-flash-image', label: 'Gemini 2.5 Flash Image', provider: 'gemini' },
  { id: 'gemini-3-pro-image',     label: 'Gemini 3 Pro Image',     provider: 'gemini' },
  { id: 'gpt-image-1',            label: 'GPT Image 1',            provider: 'openai' },
  { id: 'fal-ai/flux/schnell',    label: 'FLUX.1 schnell (fal)',   provider: 'fal' },
  { id: 'fal-ai/flux/dev',        label: 'FLUX.1 dev (fal)',       provider: 'fal' },
  { id: '@cf/stabilityai/stable-diffusion-xl-base-1.0', label: 'Stable Diffusion XL (Cloudflare)', provider: 'cloudflare' },
  { id: 'recraftv3',              label: 'Recraft V3',             provider: 'recraft' },
]

// Diffusion models share FLUX's prompt biases (negations backfire, "pixel art"
// makes them draw centered sprites) and centered/vignetted compositions, so
// they reuse the fal caption-style prompt + the adaptive center-crop.
const CAPTION_PROVIDERS = new Set(['fal', 'cloudflare', 'recraft'])

export function providerForModel(model) {
  return AI_MODELS.find(m => m.id === model)?.provider || 'gemini'
}

// Keys live only in .env.local (git-ignored). VITE_* vars are still embedded in
// the client bundle at build time, so this is "not shown in the UI", not secret.
export function resolveApiKey(provider) {
  const env = import.meta.env || {}
  if (provider === 'openai') return env.VITE_OPENAI_API_KEY || ''
  if (provider === 'fal') return env.VITE_FAL_API_KEY || ''
  // Cloudflare also needs an account id; that's read separately in runCloudflareAttempt.
  if (provider === 'cloudflare') return env.VITE_CLOUDFLARE_API_TOKEN || ''
  if (provider === 'recraft') return env.VITE_RECRAFT_API_KEY || ''
  return env.VITE_GEMINI_API_KEY || ''
}

export function buildTilePrompt({
  subject,
  role = 'center',
  tileSize = 16,
  paletteHint = null,
  contextPrompt = '',
  provider = 'gemini',
}) {
  const cleanedSubject = (subject || '').trim()
  const palette = paletteHint
    ? [
        paletteHint.primary,
        paletteHint.secondary,
        paletteHint.border,
        paletteHint.highlight,
        paletteHint.shadow,
      ].filter(Boolean).join(', ')
    : ''

  // Diffusion models (FLUX/SDXL/Recraft) ignore instruction-style prompts and
  // invert negations (mentioning "border", even to forbid it, draws one). An
  // earlier version asked for a realistic MATERIAL texture, but SDXL took that
  // literally and returned photoreal 3D rock with relief + cast shadows that
  // turns to mush when downscaled. So we now ask straight for FLAT 2D pixel-art
  // top-down terrain (fantasy RPG game art) — what we actually want — while
  // keeping strong "uniform / fills the whole square / repeats past every edge"
  // anchors so the model doesn't draw a single centered sprite (which breaks
  // autotiling). The app's downscale + quantize still cleans it into tiles.
  if (CAPTION_PROVIDERS.has(provider)) {
    const material = role === 'edge'
      ? `${cleanedSubject}, as a terrain border${contextPrompt ? ` that visually matches ${contextPrompt.trim()}` : ''}`
      : cleanedSubject
    return [
      `2D pixel art terrain tile, top-down view, fantasy RPG game art: ${material}.`,
      'A seamless tileable ground texture that fills the whole square evenly —',
      'the same flat surface detail repeats across the entire image',
      'and continues past all four edges.',
      'Flat shading, flat even lighting, simple bold shapes, hard edges,',
      `a limited color palette, crisp pixel-art look readable as a ${tileSize} px game tile.`,
      palette ? `Color mood: ${palette}.` : '',
    ].filter(Boolean).join(' ')
  }

  const shared = [
    'Pixel art video-game terrain material.',
    'Top-down orthographic view.',
    'Seamless tileable square texture.',
    'No objects, characters, icons, text, labels, shadows, UI, or perspective.',
    'Large readable pixel clusters, limited palette, crisp material identity.',
    `Must remain readable when downscaled to ${tileSize}px.`,
    palette ? `Use this color mood as guidance, not as exact text: ${palette}.` : '',
  ].filter(Boolean)

  if (role === 'edge') {
    return [
      ...shared,
      'Generate the exposed edge or border material for an autotile.',
      'Use slightly stronger contrast than the center material.',
      contextPrompt ? `It must visually match this center material: ${contextPrompt.trim()}.` : '',
      `Border material subject: ${cleanedSubject}`,
    ].filter(Boolean).join(' ')
  }

  return [
    ...shared,
    'Generate the center fill material only.',
    'Avoid drawing an outer border; the app will compose autotile borders separately.',
    `Center material subject: ${cleanedSubject}`,
  ].join(' ')
}

// Gemini image request body. Note: the field is `imageConfig` (NOT
// `responseFormat`, which the API rejects with "Unknown name responseFormat"),
// and `responseModalities` requires the v1beta endpoint.
export function buildImageRequestBody(model, prompt, {
  quality = DEFAULT_QUALITY,
  outputFormat = DEFAULT_OUTPUT_FORMAT,
} = {}) {
  return {
    contents: [{
      parts: [{ text: prompt }],
    }],
    generationConfig: {
      responseModalities: ['IMAGE'],
      imageConfig: {
        aspectRatio: '1:1',
      },
    },
    meta: {
      model,
      quality,
      outputFormat,
    },
  }
}

async function requestGeminiImage(apiKey, body) {
  const model = body?.meta?.model || DEFAULT_IMAGE_MODEL
  const { meta, ...requestBody } = body
  return fetch(`${GEMINI_BASE}/models/${model}:generateContent`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-goog-api-key': apiKey,
    },
    body: JSON.stringify(requestBody),
  })
}

function openAISize(quality) {
  // gpt-image models only accept fixed sizes; 1:1 square for tiles/props.
  return '1024x1024'
}

export function buildOpenAIRequestBody(model, prompt, { quality = DEFAULT_QUALITY } = {}) {
  return {
    model,
    prompt,
    n: 1,
    size: openAISize(quality),
    quality,
  }
}

async function requestOpenAIImage(apiKey, model, prompt, { quality = DEFAULT_QUALITY } = {}) {
  return fetch(`${OPENAI_BASE}/images/generations`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify(buildOpenAIRequestBody(model, prompt, { quality })),
  })
}

// fal.ai (FLUX) request body. `sync_mode: true` makes fal.run return the image
// inline as a data-URI instead of uploading it to a CDN, so we never deal with
// polling or cross-origin canvas tainting. schnell uses 4 steps by default; we
// don't pin num_inference_steps so each FLUX variant keeps its own default.
export function buildFalRequestBody(model, prompt, { outputFormat = DEFAULT_OUTPUT_FORMAT } = {}) {
  return {
    prompt,
    image_size: 'square_hd', // 1024×1024, matches the OpenAI square path
    num_images: 1,
    sync_mode: true,
    enable_safety_checker: true,
    output_format: outputFormat === 'png' ? 'png' : 'jpeg',
  }
}

async function requestFalImage(apiKey, model, prompt, { outputFormat = DEFAULT_OUTPUT_FORMAT } = {}) {
  return fetch(`${FAL_BASE}/${model}`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Key ${apiKey}`,
    },
    body: JSON.stringify(buildFalRequestBody(model, prompt, { outputFormat })),
  })
}

// Cloudflare Workers AI (SDXL) request body. The model takes width/height and
// num_steps; SDXL base caps steps at 20. Square 1024 matches the OpenAI path.
export function buildCloudflareRequestBody(model, prompt) {
  return {
    prompt,
    width: 1024,
    height: 1024,
    num_steps: 20,
  }
}

async function requestCloudflareImage(apiKey, accountId, model, prompt) {
  return fetch(`${CLOUDFLARE_BASE}/accounts/${accountId}/ai/run/${model}`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify(buildCloudflareRequestBody(model, prompt)),
  })
}

// Recraft V3 request body. OpenAI-compatible images endpoint; b64_json skips the
// CDN url (no cross-origin canvas tainting). realistic_image suits material tiles.
export function buildRecraftRequestBody(model, prompt) {
  return {
    model,
    prompt,
    n: 1,
    size: '1024x1024',
    style: 'realistic_image',
    response_format: 'b64_json',
  }
}

async function requestRecraftImage(apiKey, model, prompt) {
  return fetch(`${RECRAFT_BASE}/v1/images/generations`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify(buildRecraftRequestBody(model, prompt)),
  })
}

const PROVIDER_LABEL = { openai: 'OpenAI', fal: 'fal', gemini: 'Gemini', cloudflare: 'Cloudflare', recraft: 'Recraft' }

async function readError(res, provider) {
  let msg = `${PROVIDER_LABEL[provider] || 'Gemini'} request failed (HTTP ${res.status}).`
  try {
    const err = await res.json()
    // Gemini/OpenAI use { error: { message } }; fal uses { detail } (string or
    // an array of validation issues) or { message }.
    if (err?.error?.message) msg = err.error.message
    else if (typeof err?.detail === 'string') msg = err.detail
    else if (Array.isArray(err?.detail) && err.detail[0]?.msg) msg = err.detail[0].msg
    // Cloudflare wraps errors as { errors: [{ message }] }.
    else if (Array.isArray(err?.errors) && err.errors[0]?.message) msg = err.errors[0].message
    else if (err?.message) msg = err.message
  } catch {
    // Ignore parse error.
  }
  return msg
}

function decodeGeneratedImage(src, crossOrigin) {
  return new Promise((resolve, reject) => {
    const img = new Image()
    if (crossOrigin) img.crossOrigin = 'anonymous'
    img.onload = () => {
      const c = document.createElement('canvas')
      c.width = img.width
      c.height = img.height
      const ctx = c.getContext('2d')
      ctx.imageSmoothingEnabled = false
      ctx.drawImage(img, 0, 0)
      try {
        const id = ctx.getImageData(0, 0, c.width, c.height)
        resolve({
          data: new Uint8ClampedArray(id.data),
          width: c.width,
          height: c.height,
        })
      } catch {
        reject(new Error('Could not read the Gemini image response. Check browser CORS or model access.'))
      }
    }
    img.onerror = () => reject(new Error('Failed to load the generated image.'))
    img.src = src
  })
}

function findGeminiInlineImage(json) {
  const candidates = json?.candidates || []
  for (const candidate of candidates) {
    const parts = candidate?.content?.parts || candidate?.parts || []
    for (const part of parts) {
      const inline = part.inlineData || part.inline_data
      if (inline?.data) return inline
    }
  }

  const parts = json?.content?.parts || json?.parts || []
  for (const part of parts) {
    const inline = part.inlineData || part.inline_data
    if (inline?.data) return inline
  }

  return null
}

async function runGeminiAttempt(apiKey, model, prompt, { quality, outputFormat }) {
  const body = buildImageRequestBody(model, prompt, { quality, outputFormat })
  const attemptBody = { ...body, meta: { ...body.meta, model } }
  const res = await requestGeminiImage(apiKey, attemptBody)
  if (!res.ok) throw new Error(await readError(res, 'gemini'))

  const json = await res.json()
  const inline = findGeminiInlineImage(json)
  if (!inline) throw new Error('No image returned by the Gemini API.')

  const mimeType = inline.mimeType || inline.mime_type || 'image/png'
  const decoded = await decodeGeneratedImage(`data:${mimeType};base64,${inline.data}`, false)
  return { decoded, mimeType }
}

async function runOpenAIAttempt(apiKey, model, prompt, { quality }) {
  const res = await requestOpenAIImage(apiKey, model, prompt, { quality })
  if (!res.ok) throw new Error(await readError(res, 'openai'))

  const json = await res.json()
  const b64 = json?.data?.[0]?.b64_json
  if (!b64) throw new Error('No image returned by the OpenAI API.')

  const mimeType = 'image/png'
  const decoded = await decodeGeneratedImage(`data:${mimeType};base64,${b64}`, false)
  return { decoded, mimeType }
}

async function runFalAttempt(apiKey, model, prompt, { outputFormat }) {
  const res = await requestFalImage(apiKey, model, prompt, { outputFormat })
  if (!res.ok) throw new Error(await readError(res, 'fal'))

  const json = await res.json()
  const img = json?.images?.[0]
  const url = img?.url
  if (!url) throw new Error('No image returned by the fal API.')

  const mimeType = img.content_type || 'image/png'
  // With sync_mode the url is a data-URI (no CORS); a CDN url needs crossOrigin.
  const decoded = await decodeGeneratedImage(url, !url.startsWith('data:'))
  return { decoded, mimeType }
}

async function runCloudflareAttempt(apiKey, model, prompt) {
  const accountId = (import.meta.env || {}).VITE_CLOUDFLARE_ACCOUNT_ID || ''
  if (!accountId) throw new Error('Missing VITE_CLOUDFLARE_ACCOUNT_ID in .env.local for the selected model.')
  const res = await requestCloudflareImage(apiKey, accountId, model, prompt)
  if (!res.ok) throw new Error(await readError(res, 'cloudflare'))

  // Workers AI returns the PNG as raw binary, not base64/JSON. Decode it from an
  // object-URL and revoke it once the image has loaded.
  const blob = await res.blob()
  const url = URL.createObjectURL(blob)
  try {
    const decoded = await decodeGeneratedImage(url, false)
    return { decoded, mimeType: 'image/png' }
  } finally {
    URL.revokeObjectURL(url)
  }
}

async function runRecraftAttempt(apiKey, model, prompt) {
  const res = await requestRecraftImage(apiKey, model, prompt)
  if (!res.ok) throw new Error(await readError(res, 'recraft'))

  const json = await res.json()
  const b64 = json?.data?.[0]?.b64_json
  if (!b64) throw new Error('No image returned by the Recraft API.')

  const mimeType = 'image/png'
  const decoded = await decodeGeneratedImage(`data:${mimeType};base64,${b64}`, false)
  return { decoded, mimeType }
}

// Generic image generation. Picks the provider from the model id and resolves
// the API key from .env.local (VITE_GEMINI_API_KEY / VITE_OPENAI_API_KEY).
export async function generateImage({
  prompt,
  model = DEFAULT_IMAGE_MODEL,
  quality = DEFAULT_QUALITY,
  outputFormat = DEFAULT_OUTPUT_FORMAT,
}) {
  const provider = providerForModel(model)
  const apiKey = resolveApiKey(provider)
  if (!apiKey) {
    const envVar = {
      openai: 'VITE_OPENAI_API_KEY',
      fal: 'VITE_FAL_API_KEY',
      cloudflare: 'VITE_CLOUDFLARE_API_TOKEN',
      recraft: 'VITE_RECRAFT_API_KEY',
    }[provider] || 'VITE_GEMINI_API_KEY'
    throw new Error(`Missing ${envVar} in .env.local for the selected model.`)
  }

  // Gemini gets a same-provider fallback model; OpenAI/fal do not.
  const attempts = provider === 'gemini' && model === DEFAULT_IMAGE_MODEL && FALLBACK_IMAGE_MODEL !== model
    ? [model, FALLBACK_IMAGE_MODEL]
    : [model]
  let lastError = null

  for (const attemptModel of attempts) {
    try {
      const { decoded, mimeType } =
        provider === 'openai' ? await runOpenAIAttempt(apiKey, attemptModel, prompt, { quality })
        : provider === 'fal'  ? await runFalAttempt(apiKey, attemptModel, prompt, { outputFormat })
        : provider === 'cloudflare' ? await runCloudflareAttempt(apiKey, attemptModel, prompt)
        : provider === 'recraft' ? await runRecraftAttempt(apiKey, attemptModel, prompt)
        : await runGeminiAttempt(apiKey, attemptModel, prompt, { quality, outputFormat })
      return {
        ...decoded,
        meta: {
          provider,
          model: attemptModel,
          requestedModel: model,
          fallbackFrom: attemptModel !== model ? model : null,
          quality,
          outputFormat,
          mimeType,
        },
      }
    } catch (e) {
      lastError = e
    }
  }

  throw lastError || new Error('Image generation failed.')
}

// Image-to-image coloring for structured sheets. The source PNG carries the
// exact tile geometry; GPT Image is asked to repaint it without moving cells.
// Kept in the shared dispatcher so API-key resolution, dev proxying and image
// decoding stay identical to the text-to-image path.
export async function editImageWithAI({
  imageBlob,
  prompt,
  model = 'gpt-image-2',
  quality = 'low',
  size = '1024x1024',
}) {
  if (!imageBlob) throw new Error('Missing source tileset image.')
  if (!prompt?.trim()) throw new Error('Describe how GPT should color the tiles.')
  const apiKey = resolveApiKey('openai')
  if (!apiKey) throw new Error('Missing VITE_OPENAI_API_KEY in .env.local for GPT Image.')

  const body = new FormData()
  body.append('model', model)
  body.append('prompt', prompt.trim())
  body.append('image', imageBlob, 'tileset-base.png')
  body.append('n', '1')
  body.append('size', size)
  body.append('quality', quality)
  body.append('output_format', 'png')

  const res = await fetch(`${OPENAI_BASE}/images/edits`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${apiKey}` },
    body,
  })
  if (!res.ok) throw new Error(await readError(res, 'openai'))
  const json = await res.json()
  const b64 = json?.data?.[0]?.b64_json
  if (!b64) throw new Error('No edited image returned by the OpenAI API.')
  const decoded = await decodeGeneratedImage(`data:image/png;base64,${b64}`, false)
  return {
    ...decoded,
    meta: { provider: 'openai', model, quality, size, operation: 'edit' },
  }
}

const clampByte = (v) => Math.max(0, Math.min(255, Math.round(v)))

function sharpenPixels(data, w, h, amount = 0.38) {
  const out = new Uint8ClampedArray(data)
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const i = (y * w + x) * 4
      let br = 0, bg = 0, bb = 0, samples = 0
      for (let dy = -1; dy <= 1; dy++) {
        const sy = y + dy
        if (sy < 0 || sy >= h) continue
        for (let dx = -1; dx <= 1; dx++) {
          const sx = x + dx
          if (sx < 0 || sx >= w) continue
          const bi = (sy * w + sx) * 4
          br += data[bi]
          bg += data[bi + 1]
          bb += data[bi + 2]
          samples++
        }
      }
      br /= samples
      bg /= samples
      bb /= samples
      out[i] = clampByte(data[i] + (data[i] - br) * amount)
      out[i + 1] = clampByte(data[i + 1] + (data[i + 1] - bg) * amount)
      out[i + 2] = clampByte(data[i + 2] + (data[i + 2] - bb) * amount)
      out[i + 3] = 255
    }
  }
  return out
}

function nearestPaletteColor(r, g, b, palette) {
  let best = palette[0]
  let bestDist = Number.POSITIVE_INFINITY
  for (const c of palette) {
    const dr = r - c[0]
    const dg = g - c[1]
    const db = b - c[2]
    const dist = dr * dr + dg * dg + db * db
    if (dist < bestDist) {
      bestDist = dist
      best = c
    }
  }
  return best
}

// Quantize to <= maxColors using image-q (Wu palette + optional dithering),
// replacing the hand-rolled median cut. Returns the quantized RGBA plus the
// actually-used palette as [[r,g,b]] (for seam repair) — same shape as before.
function quantizePixels(data, w, h, maxColors = MAX_TILE_COLORS, dither = DEFAULT_DITHER) {
  const pc = iqUtils.PointContainer.fromUint8Array(data, w, h)
  const palette = buildPaletteSync([pc], {
    colors: maxColors,
    paletteQuantization: 'wuquant',
    colorDistanceFormula: QUANT_FORMULA,
  })
  const outPc = applyPaletteSync(pc, palette, {
    imageQuantization: dither,
    colorDistanceFormula: QUANT_FORMULA,
  })
  const out = new Uint8ClampedArray(outPc.toUint8Array())
  for (let i = 3; i < out.length; i += 4) out[i] = 255 // keep tiles opaque

  const seen = new Set()
  const pal = []
  for (let i = 0; i < out.length; i += 4) {
    const key = (out[i] << 16) | (out[i + 1] << 8) | out[i + 2]
    if (!seen.has(key)) { seen.add(key); pal.push([out[i], out[i + 1], out[i + 2]]) }
  }
  return { data: out, palette: pal, colorCount: pal.length }
}

export function measureSeamScore(data, w, h) {
  let total = 0
  let samples = 0
  for (let x = 0; x < w; x++) {
    const top = x * 4
    const bottom = ((h - 1) * w + x) * 4
    total += Math.abs(data[top] - data[bottom])
      + Math.abs(data[top + 1] - data[bottom + 1])
      + Math.abs(data[top + 2] - data[bottom + 2])
    samples += 3
  }
  for (let y = 0; y < h; y++) {
    const left = (y * w) * 4
    const right = (y * w + w - 1) * 4
    total += Math.abs(data[left] - data[right])
      + Math.abs(data[left + 1] - data[right + 1])
      + Math.abs(data[left + 2] - data[right + 2])
    samples += 3
  }
  return samples ? Number((total / samples).toFixed(2)) : 0
}

function repairSeams(data, w, h, palette = null) {
  const out = new Uint8ClampedArray(data)
  for (let x = 0; x < w; x++) {
    const top = x * 4
    const bottom = ((h - 1) * w + x) * 4
    const snapped = palette
      ? nearestPaletteColor(
          Math.round((out[top] + out[bottom]) / 2),
          Math.round((out[top + 1] + out[bottom + 1]) / 2),
          Math.round((out[top + 2] + out[bottom + 2]) / 2),
          palette,
        )
      : null
    for (let c = 0; c < 3; c++) {
      const avg = snapped ? snapped[c] : Math.round((out[top + c] + out[bottom + c]) / 2)
      out[top + c] = avg
      out[bottom + c] = avg
    }
    out[top + 3] = 255
    out[bottom + 3] = 255
  }
  for (let y = 0; y < h; y++) {
    const left = (y * w) * 4
    const right = (y * w + w - 1) * 4
    const snapped = palette
      ? nearestPaletteColor(
          Math.round((out[left] + out[right]) / 2),
          Math.round((out[left + 1] + out[right + 1]) / 2),
          Math.round((out[left + 2] + out[right + 2]) / 2),
          palette,
        )
      : null
    for (let c = 0; c < 3; c++) {
      const avg = snapped ? snapped[c] : Math.round((out[left + c] + out[right + c]) / 2)
      out[left + c] = avg
      out[right + c] = avg
    }
    out[left + 3] = 255
    out[right + 3] = 255
  }
  return out
}


// Color budget scales with tile size: tiny tiles read best with a tight palette,
// larger tiles can hold more colors so AI shading/detail survives the downscale.
function tileColorBudget(tileSize) {
  if (tileSize <= 8) return 8
  if (tileSize <= 16) return 12
  if (tileSize <= 32) return 16
  return 20
}

// Stronger unsharp on heavy downscales — small tiles lose the most edge contrast.
function tileSharpenAmount(tileSize) {
  if (tileSize <= 16) return 0.5
  if (tileSize <= 32) return 0.42
  return 0.34
}

export function postprocessTilePixels(rawPixels, rawWidth, rawHeight, tileSize, {
  maxColors = null,
  dither = DEFAULT_DITHER,
  smooth = false,
} = {}) {
  let pixels = downscaleRgba(rawPixels, rawWidth, rawHeight, tileSize, tileSize)
  for (let i = 0; i < pixels.length; i += 4) pixels[i + 3] = 255
  if (smooth) {
    // Non-pixel ("smooth") tilesets: keep the full colour + gradients of the
    // source (cartoon/anime). No palette quantize and no posterize — just a
    // gentle sharpen and a plain seam repair so the tile still tiles seamlessly.
    pixels = sharpenPixels(pixels, tileSize, tileSize, 0.12)
    pixels = repairSeams(pixels, tileSize, tileSize)
  } else {
    const budget = maxColors ?? tileColorBudget(tileSize)
    pixels = sharpenPixels(pixels, tileSize, tileSize, tileSharpenAmount(tileSize))
    pixels = repairSeams(pixels, tileSize, tileSize)
    const quantized = quantizePixels(pixels, tileSize, tileSize, budget, dither)
    pixels = repairSeams(quantized.data, tileSize, tileSize, quantized.palette)
  }
  const colorCount = new Set(Array.from({ length: pixels.length / 4 }, (_, idx) => {
    const i = idx * 4
    return `${pixels[i]},${pixels[i + 1]},${pixels[i + 2]}`
  })).size

  return {
    pixels,
    meta: {
      seamScore: measureSeamScore(pixels, tileSize, tileSize),
      colorCount,
    },
  }
}

// Keep the central fraction of an RGBA image (returns { data, width, height }).
// Exported for tests.
export function cropCenterRgba(data, width, height, frac) {
  if (!frac || frac >= 1) return { data, width, height }
  const cw = Math.max(1, Math.round(width * frac))
  const ch = Math.max(1, Math.round(height * frac))
  const x0 = (width - cw) >> 1
  const y0 = (height - ch) >> 1
  const out = new Uint8ClampedArray(cw * ch * 4)
  for (let y = 0; y < ch; y++) {
    const src = ((y0 + y) * width + x0) * 4
    out.set(data.subarray(src, src + cw * 4), y * cw * 4)
  }
  return { data: out, width: cw, height: ch }
}

// Diffusion models bias toward centered compositions with vignettes/frames even
// when prompted for a uniform texture; keeping only the central region cuts that
// off before the downscale. The fraction ALSO adapts to tile size: small tiles
// crop TIGHTER so fewer, bigger features survive the heavy downscale (legible
// detail at 16/32 px), while large tiles keep more of the frame for coverage.
const TILE_CROP_BASE = { 8: 0.30, 16: 0.40, 32: 0.55, 64: 0.72 }
const DEFAULT_CROP = 0.6
// When the image reads as a centered blob/vignette (centre colour far from the
// outer ring's), crop harder still to sample the blob's interior material.
const BLOB_CROP_MULT = 0.7
const VIGNETTE_THRESHOLD = 48

// Mean RGB distance between the image's central box (middle 30%) and its outer
// ring (outermost 12%). Uniform textures score near 0; centered blob/vignette
// compositions score high. Sampled with a stride for speed. Exported for tests.
export function vignetteScore(data, width, height) {
  const cx0 = Math.floor(width * 0.35), cx1 = Math.ceil(width * 0.65)
  const cy0 = Math.floor(height * 0.35), cy1 = Math.ceil(height * 0.65)
  const ring = Math.max(1, Math.floor(Math.min(width, height) * 0.12))
  const step = Math.max(1, Math.floor(Math.min(width, height) / 128))
  let cr = 0, cg = 0, cb = 0, cn = 0
  let rr = 0, rg = 0, rb = 0, rn = 0
  for (let y = 0; y < height; y += step) {
    for (let x = 0; x < width; x += step) {
      const i = (y * width + x) * 4
      if (x >= cx0 && x < cx1 && y >= cy0 && y < cy1) {
        cr += data[i]; cg += data[i + 1]; cb += data[i + 2]; cn++
      } else if (x < ring || x >= width - ring || y < ring || y >= height - ring) {
        rr += data[i]; rg += data[i + 1]; rb += data[i + 2]; rn++
      }
    }
  }
  if (!cn || !rn) return 0
  const dr = cr / cn - rr / rn
  const dg = cg / cn - rg / rn
  const db = cb / cn - rb / rn
  return Math.sqrt(dr * dr + dg * dg + db * db)
}

// Crop fraction for a diffusion image: tighter for small tiles (more legible
// detail) and tighter still when it reads as a centered blob. Exported for tests.
export function pickFalCropFraction(data, width, height, tileSize = 16) {
  const base = TILE_CROP_BASE[tileSize] ?? DEFAULT_CROP
  return vignetteScore(data, width, height) > VIGNETTE_THRESHOLD ? base * BLOB_CROP_MULT : base
}

export async function generateBaseTileWithAI({
  prompt,
  model = DEFAULT_IMAGE_MODEL,
  tileSize,
  quality = DEFAULT_QUALITY,
  outputFormat = DEFAULT_OUTPUT_FORMAT,
  role = 'center',
  paletteHint = null,
  contextPrompt = '',
  dither = DEFAULT_DITHER,
}) {
  if (!prompt || !prompt.trim()) throw new Error('Enter a prompt describing the tile.')

  const provider = providerForModel(model)
  const finalPrompt = buildTilePrompt({ subject: prompt, role, tileSize, paletteHint, contextPrompt, provider })
  const decoded = await generateImage({ prompt: finalPrompt, model, quality, outputFormat })
  // Props keep the full frame (a centered subject is the point there); this
  // crop only runs on the tile path, for diffusion providers (fal/Cloudflare/
  // Recraft). The fraction adapts to tile size (tighter for small tiles) and to
  // centered-blob/vignette compositions.
  const source = CAPTION_PROVIDERS.has(decoded.meta.provider)
    ? cropCenterRgba(decoded.data, decoded.width, decoded.height,
        pickFalCropFraction(decoded.data, decoded.width, decoded.height, tileSize))
    : decoded
  const processed = postprocessTilePixels(source.data, source.width, source.height, tileSize, { dither })

  return {
    pixels: processed.pixels,
    rawPixels: decoded.data,
    meta: {
      ...decoded.meta,
      role,
      prompt: finalPrompt,
      rawSize: `${decoded.width}x${decoded.height}`,
      tileSize,
      seamScore: processed.meta.seamScore,
      colorCount: processed.meta.colorCount,
    },
  }
}

// Run an arbitrary RGBA image through the same downscale + sharpen + quantize
// pipeline as generateBaseTileWithAI — minus the network call — so a user can
// IMPORT their own 1024×1024 texture and feed it to the procedural composer.
// Returns the same shape (pixels + rawPixels + meta) so callers (the procedural
// handler, the raw-image preview) treat it exactly like an AI generation. No
// center-crop here: the user controls the image, so we process the whole frame.
export function processImageToTile({ data, width, height, tileSize, role = 'center', dither = DEFAULT_DITHER, source = 'import', smooth = false }) {
  if (!data || !width || !height) throw new Error('Invalid image data to import.')
  const processed = postprocessTilePixels(data, width, height, tileSize, { dither, smooth })
  return {
    pixels: processed.pixels,
    rawPixels: new Uint8ClampedArray(data),
    meta: {
      provider: source,
      model: source,
      role,
      rawSize: `${width}x${height}`,
      tileSize,
      smooth,
      seamScore: processed.meta.seamScore,
      colorCount: processed.meta.colorCount,
    },
  }
}
