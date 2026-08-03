import test from 'node:test'
import assert from 'node:assert/strict'

if (!globalThis.ImageData) {
  globalThis.ImageData = class ImageData {
    constructor(data, width, height) {
      this.data = data
      this.width = width
      this.height = height
    }
  }
}

const aiTile = await import('./aiTile.js')
const procedural = await import('./proceduralGen.js')

test('buildImageRequestBody uses Gemini image generation defaults', () => {
  const prompt = aiTile.buildTilePrompt({
    subject: 'mossy stone floor',
    role: 'center',
    tileSize: 16,
    paletteHint: {
      primary: '#445533',
      secondary: '#667744',
      border: '#223311',
      highlight: '#99aa66',
      shadow: '#112211',
    },
  })
  const body = aiTile.buildImageRequestBody('gemini-2.5-flash-image', prompt)

  assert.equal(body.meta.model, 'gemini-2.5-flash-image')
  assert.equal(body.meta.quality, 'low')
  assert.equal(body.meta.outputFormat, 'png')
  assert.deepEqual(body.generationConfig.responseModalities, ['IMAGE'])
  assert.equal(body.generationConfig.imageConfig.aspectRatio, '1:1')
  assert.equal(body.generationConfig.responseFormat, undefined)
  assert.match(body.contents[0].parts[0].text, /Center material subject: mossy stone floor/)
  assert.match(body.contents[0].parts[0].text, /readable when downscaled to 16px/)
})

test('providerForModel maps each model to its API provider', () => {
  assert.equal(aiTile.providerForModel('gpt-image-2'), 'openai')
  assert.equal(aiTile.providerForModel('gemini-2.5-flash-image'), 'gemini')
  assert.equal(aiTile.providerForModel('gpt-image-1'), 'openai')
  assert.equal(aiTile.providerForModel('fal-ai/flux/schnell'), 'fal')
  assert.equal(aiTile.providerForModel('fal-ai/flux/dev'), 'fal')
  assert.equal(aiTile.providerForModel('unknown-model'), 'gemini')
})

test('GPT Image 2 defaults to the low-cost square request', () => {
  const body = aiTile.buildOpenAIRequestBody('gpt-image-2', 'seamless mossy stone')

  assert.deepEqual(body, {
    model: 'gpt-image-2',
    prompt: 'seamless mossy stone',
    n: 1,
    size: '1024x1024',
    quality: 'low',
  })
})

test('diffusion caption prompts ask for flat 2D pixel-art terrain with tileability anchors', () => {
  for (const provider of ['fal', 'cloudflare', 'recraft']) {
    const center = aiTile.buildTilePrompt({
      subject: 'lava rock', role: 'center', tileSize: 32, provider,
      paletteHint: { primary: '#aa3311', secondary: '#882200', border: '#441100', highlight: '#ff7733', shadow: '#220800' },
    })
    // Lead with the 2D pixel-art / flat-shading framing (SDXL otherwise returns
    // photoreal 3D rock that turns to mush when downscaled).
    assert.match(center, /2D pixel art terrain tile/)
    assert.match(center, /lava rock/)
    assert.match(center, /Flat shading/)
    assert.match(center, /Color mood:/)
    // Tileability anchors keep the model from drawing a single centered sprite.
    assert.match(center, /fills the whole square evenly/)
    assert.match(center, /continues past all four edges/)
    // Diffusion models invert negations — no instruction-style "No ..." / "Avoid ...".
    assert.doesNotMatch(center, /\bAvoid\b|\bNo objects\b/)
  }

  const edge = aiTile.buildTilePrompt({
    subject: 'powder snow', role: 'edge', provider: 'fal', contextPrompt: 'dark cave rock',
  })
  assert.match(edge, /powder snow, as a terrain border/)
  assert.match(edge, /matches dark cave rock/)

  // Other providers keep the instruction-style prompt untouched.
  const gemini = aiTile.buildTilePrompt({ subject: 'lava rock', role: 'center', provider: 'gemini' })
  assert.match(gemini, /Avoid drawing an outer border/)
  assert.match(gemini, /Pixel art video-game terrain material/)
})

test('processImageToTile runs an imported image through the tile pipeline', () => {
  const w = 24, h = 24
  const raw = new Uint8ClampedArray(w * h * 4)
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const i = (y * w + x) * 4
      raw[i] = (x * 9) % 256; raw[i + 1] = (y * 13) % 256; raw[i + 2] = ((x + y) * 5) % 256
      raw[i + 3] = 200 // a non-opaque source must come out opaque
    }
  }
  const result = aiTile.processImageToTile({ data: raw, width: w, height: h, tileSize: 16, source: 'import' })

  assert.equal(result.pixels.length, 16 * 16 * 4)
  assert.equal(result.meta.provider, 'import')
  assert.equal(result.meta.role, 'center')
  assert.equal(result.meta.rawSize, '24x24')
  assert.ok(result.meta.colorCount <= 12)
  for (let i = 3; i < result.pixels.length; i += 4) assert.equal(result.pixels[i], 255)
  // rawPixels is a copy of the source (so the caller's buffer isn't aliased).
  assert.equal(result.rawPixels.length, raw.length)
  assert.notEqual(result.rawPixels, raw)
})

test('vignetteScore tells uniform textures from centered blobs; crop adapts', () => {
  const size = 128
  const uniform = new Uint8ClampedArray(size * size * 4)
  for (let i = 0; i < uniform.length; i += 4) {
    uniform[i] = 120; uniform[i + 1] = 90; uniform[i + 2] = 60; uniform[i + 3] = 255
  }
  assert.ok(aiTile.vignetteScore(uniform, size, size) < 5)

  // Bright centered blob on a dark background (the FLUX failure mode).
  const blob = new Uint8ClampedArray(size * size * 4)
  const c = size / 2, r = size * 0.3
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const i = (y * size + x) * 4
      const inside = (x - c) ** 2 + (y - c) ** 2 < r * r
      blob[i] = inside ? 220 : 20
      blob[i + 1] = inside ? 200 : 25
      blob[i + 2] = inside ? 90 : 35
      blob[i + 3] = 255
    }
  }
  assert.ok(aiTile.vignetteScore(blob, size, size) > 48)
  // Blob → tighter crop than a uniform texture (same tile size).
  assert.ok(aiTile.pickFalCropFraction(blob, size, size, 16) < aiTile.pickFalCropFraction(uniform, size, size, 16))
  // Crop adapts to tile size: smaller tiles crop tighter so detail stays legible.
  assert.ok(aiTile.pickFalCropFraction(uniform, size, size, 16) < aiTile.pickFalCropFraction(uniform, size, size, 64))
  assert.ok(aiTile.pickFalCropFraction(uniform, size, size, 8) < aiTile.pickFalCropFraction(uniform, size, size, 32))
})

test('postprocessTilePixels keeps a larger color budget for bigger tiles', () => {
  // A smooth gradient at 64 px should retain more colors than the same at 16 px.
  const make = (n) => {
    const raw = new Uint8ClampedArray(n * n * 4)
    for (let y = 0; y < n; y++) {
      for (let x = 0; x < n; x++) {
        const i = (y * n + x) * 4
        raw[i] = (x * 255 / n) | 0; raw[i + 1] = (y * 255 / n) | 0; raw[i + 2] = ((x + y) * 127 / n) | 0; raw[i + 3] = 255
      }
    }
    return raw
  }
  const small = aiTile.postprocessTilePixels(make(64), 64, 64, 16)
  const large = aiTile.postprocessTilePixels(make(64), 64, 64, 64)
  assert.ok(small.meta.colorCount <= 12)
  assert.ok(large.meta.colorCount > small.meta.colorCount)
})

test('cropCenterRgba keeps the central region', () => {
  // 4×4 image whose central 2×2 pixels are marked 255.
  const w = 4, h = 4
  const data = new Uint8ClampedArray(w * h * 4)
  for (const [x, y] of [[1, 1], [2, 1], [1, 2], [2, 2]]) data[(y * w + x) * 4] = 255
  const { data: out, width, height } = aiTile.cropCenterRgba(data, w, h, 0.5)
  assert.equal(width, 2)
  assert.equal(height, 2)
  for (let i = 0; i < out.length; i += 4) assert.equal(out[i], 255)
  // frac >= 1 → untouched passthrough (same reference, same dims)
  const same = aiTile.cropCenterRgba(data, w, h, 1)
  assert.equal(same.data, data)
  assert.equal(same.width, w)
})

test('buildFalRequestBody requests inline sync_mode square images', () => {
  const png = aiTile.buildFalRequestBody('fal-ai/flux/schnell', 'lava rock', { outputFormat: 'png' })
  assert.equal(png.prompt, 'lava rock')
  assert.equal(png.image_size, 'square_hd')
  assert.equal(png.num_images, 1)
  assert.equal(png.sync_mode, true)            // returns a data-URI, not a CDN url
  assert.equal(png.output_format, 'png')
  assert.equal(png.num_inference_steps, undefined) // schnell keeps its own default

  // Any non-png outputFormat falls back to jpeg.
  const jpg = aiTile.buildFalRequestBody('fal-ai/flux/dev', 'lava rock', { outputFormat: 'webp' })
  assert.equal(jpg.output_format, 'jpeg')
  // Default (no opts) is png per DEFAULT_OUTPUT_FORMAT.
  assert.equal(aiTile.buildFalRequestBody('fal-ai/flux/schnell', 'x').output_format, 'png')
})

test('edge prompt includes role-specific border guidance', () => {
  const prompt = aiTile.buildTilePrompt({
    subject: 'icy snow lip',
    role: 'edge',
    contextPrompt: 'dark cave rock',
  })

  assert.match(prompt, /exposed edge or border material/)
  assert.match(prompt, /dark cave rock/)
  assert.match(prompt, /Border material subject: icy snow lip/)
})

test('postprocessTilePixels returns opaque limited-color seamless pixels', () => {
  const w = 16
  const h = 16
  const raw = new Uint8ClampedArray(w * h * 4)
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const i = (y * w + x) * 4
      raw[i] = (x * 17 + y * 3) % 256
      raw[i + 1] = (x * 5 + y * 19) % 256
      raw[i + 2] = (x * 11 + y * 7) % 256
      raw[i + 3] = y === 0 ? 120 : 255
    }
  }

  const result = aiTile.postprocessTilePixels(raw, w, h, 16)

  assert.equal(result.pixels.length, 16 * 16 * 4)
  assert.ok(result.meta.colorCount <= 12)
  assert.equal(result.meta.seamScore, 0)
  for (let i = 3; i < result.pixels.length; i += 4) assert.equal(result.pixels[i], 255)
})

test('image-q dithering stays in-palette, opaque, and changes the result vs none', () => {
  const w = 16, h = 16
  const raw = new Uint8ClampedArray(w * h * 4)
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const i = (y * w + x) * 4
      raw[i] = (x * 12) % 256          // smooth horizontal gradient → dithering shows
      raw[i + 1] = (y * 12) % 256
      raw[i + 2] = ((x + y) * 6) % 256
      raw[i + 3] = 255
    }
  }
  const none = aiTile.postprocessTilePixels(raw, w, h, 16, { dither: 'nearest' })
  const fs = aiTile.postprocessTilePixels(raw, w, h, 16, { dither: 'floyd-steinberg' })

  assert.ok(fs.meta.colorCount <= 12)
  for (let i = 3; i < fs.pixels.length; i += 4) assert.equal(fs.pixels[i], 255)
  // Dithering must actually alter the pixels relative to plain nearest.
  let differs = false
  for (let i = 0; i < fs.pixels.length; i++) if (fs.pixels[i] !== none.pixels[i]) { differs = true; break }
  assert.ok(differs)
})

test('postprocessTilePixels smooth mode keeps full colour (no quantize), opaque + seamless', () => {
  const w = 32, h = 32
  const raw = new Uint8ClampedArray(w * h * 4)
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const i = (y * w + x) * 4
      raw[i] = (x * 255 / w) | 0; raw[i + 1] = (y * 255 / h) | 0; raw[i + 2] = ((x + y) * 127 / w) | 0; raw[i + 3] = 255
    }
  }
  const pixel = aiTile.postprocessTilePixels(raw, w, h, 32)                    // pixel-art (quantized)
  const smooth = aiTile.postprocessTilePixels(raw, w, h, 32, { smooth: true }) // non-pixel (no quantize)
  assert.ok(smooth.meta.colorCount > pixel.meta.colorCount) // smooth keeps far more colours
  assert.ok(smooth.meta.colorCount > 20)                    // well beyond the pixel colour budget
  for (let i = 3; i < smooth.pixels.length; i += 4) assert.equal(smooth.pixels[i], 255) // opaque
  assert.equal(smooth.meta.seamScore, 0)                    // still tiles seamlessly
})

test('generateTilesFromTextures composes 48 smooth tiles with a gradient border', () => {
  const size = 64
  const center = new Uint8ClampedArray(size * size * 4)
  for (let i = 0; i < center.length; i += 4) { center[i] = 120; center[i + 1] = 170; center[i + 2] = 90; center[i + 3] = 255 }
  const tiles = procedural.generateTilesFromTextures(new ImageData(center, size, size), null, size, {}, true)
  assert.equal(tiles.length, 48)
  assert.equal(tiles.filter(Boolean).length, 48)
  // Isolated tile (index 1, mask 0): all edges painted → outer corner is darker
  // than the flat green center (the gradient border darkens the rim).
  assert.ok(tiles[1].data[0] < 120)
  assert.ok(tiles[1].data[1] < 170)
})

test('AI texture composition still creates 48 tiles for all supported grid sizes', () => {
  for (const size of [8, 16, 32, 64, 128]) {
    const center = new Uint8ClampedArray(size * size * 4)
    const edge = new Uint8ClampedArray(size * size * 4)
    for (let i = 0; i < center.length; i += 4) {
      center[i] = 80; center[i + 1] = 120; center[i + 2] = 70; center[i + 3] = 255
      edge[i] = 30; edge[i + 1] = 50; edge[i + 2] = 40; edge[i + 3] = 255
    }

    const tiles = procedural.generateTilesFromTextures(
      new ImageData(center, size, size),
      new ImageData(edge, size, size),
      size,
      { border: '#223311', shadow: '#112211', highlight: '#99aa66' },
    )

    assert.equal(tiles.length, 48)
    assert.equal(tiles.filter(Boolean).length, 48)
    for (const tile of tiles) {
      assert.equal(tile.width, size)
      assert.equal(tile.height, size)
    }
  }
})

test('synthesized edge (no edge texture) derives from the center, not the palette', () => {
  const size = 16
  // Red "lava" center WITH a white artifact band in its bottom rows (AI images
  // often carry bands/watermark remnants at their boundary); the active palette
  // is deliberately green.
  const center = new Uint8ClampedArray(size * size * 4)
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const i = (y * size + x) * 4
      const artifact = y >= size - 2
      center[i] = artifact ? 255 : 200
      center[i + 1] = artifact ? 255 : 40
      center[i + 2] = artifact ? 255 : 30
      center[i + 3] = 255
    }
  }
  const tiles = procedural.generateTilesFromTextures(
    new ImageData(center, size, size),
    null, // no edge texture → synthesized
    size,
    { border: '#223311', shadow: '#112211', highlight: '#99aa66' }, // green palette must NOT leak in
  )
  // Index 1 = the isolated tile (bitmask 0): every edge is painted. Corner
  // pixels must be a darkened red — never the palette's green, and never the
  // artifact's white copied from the center's boundary rows.
  const px = tiles[1].data
  const top = [px[0], px[1], px[2]]
  const bi = ((size - 1) * size) * 4 // bottom-left corner
  const bottom = [px[bi], px[bi + 1], px[bi + 2]]
  for (const [r, g, b] of [top, bottom]) {
    assert.ok(r > g, 'edge keeps the center hue (red > green)')
    assert.ok(r > b, 'edge keeps the center hue (red > blue)')
    assert.ok(r < 200, 'edge is darker than the center')
    assert.ok(r > 0, 'edge is not black')
    assert.ok(g < 150, 'edge does not copy the white artifact band')
  }
  // An explicit edge texture still wins over synthesis.
  const blue = new Uint8ClampedArray(size * size * 4)
  for (let i = 0; i < blue.length; i += 4) { blue[i + 2] = 220; blue[i + 3] = 255 }
  const withEdge = procedural.generateTilesFromTextures(
    new ImageData(center, size, size), new ImageData(blue, size, size), size, {},
  )
  assert.ok(withEdge[1].data[2] > withEdge[1].data[0], 'explicit edge texture is used as-is')
})

test('composed border tiles tile seamlessly along their run (uniform width, no doubled pixels)', async () => {
  const { BITS, BITMASK_TO_INDEX } = await import('../constants/bitmaskTable.js')
  const s = 16
  const ew = Math.max(2, Math.round(s / 6))
  // A textured center, seam-repaired by the pipeline so opposite edges match.
  const raw = new Uint8ClampedArray(s * s * 4)
  for (let y = 0; y < s; y++) for (let x = 0; x < s; x++) {
    const i = (y * s + x) * 4
    raw[i] = 70 + ((x * 9 + y * 5) % 70); raw[i + 1] = 90 + ((x * 7) % 60); raw[i + 2] = 110 + ((y * 11) % 45); raw[i + 3] = 255
  }
  const center = aiTile.postprocessTilePixels(raw, s, s, s).pixels
  const tiles = procedural.generateTilesFromTextures(new ImageData(center, s, s), null, s)

  // Fill tile (all neighbors present) must be seamless with itself.
  const fill = tiles[BITMASK_TO_INDEX.get(0xFF)]
  assert.equal(aiTile.measureSeamScore(fill.data, s, s), 0)

  // Top-edge tile repeats horizontally → its left column must equal its right
  // column (no seam / no doubled pixels in a run of border tiles).
  const topEdge = tiles[BITMASK_TO_INDEX.get(BITS.L | BITS.R | BITS.B | BITS.BL | BITS.BR)]
  for (let y = 0; y < s; y++) {
    const l = (y * s) * 4, r = (y * s + s - 1) * 4
    assert.deepEqual([topEdge.data[l], topEdge.data[l + 1], topEdge.data[l + 2]],
                     [topEdge.data[r], topEdge.data[r + 1], topEdge.data[r + 2]])
  }
  // The top border is a UNIFORM band: every column matches column 0 across the
  // border depth (constant width → no doubling at the junction).
  for (let x = 1; x < s; x++) {
    for (let d = 0; d < ew; d++) {
      const a = (d * s) * 4, c = (d * s + x) * 4
      assert.deepEqual([topEdge.data[a], topEdge.data[a + 1], topEdge.data[a + 2]],
                       [topEdge.data[c], topEdge.data[c + 1], topEdge.data[c + 2]])
    }
  }
})

test('inner (concave) corners are a defined notch, not a single pixel', async () => {
  const { BITS, BITMASK_TO_INDEX } = await import('../constants/bitmaskTable.js')
  const s = 32
  const center = new Uint8ClampedArray(s * s * 4)
  for (let i = 0; i < center.length; i += 4) { center[i] = 90; center[i + 1] = 110; center[i + 2] = 130; center[i + 3] = 255 }
  const tiles = procedural.generateTilesFromTextures(new ImageData(center, s, s), null, s)

  // A tile with all cardinals present but the top-left diagonal missing has a
  // TL inner corner. mask = all 4 cardinals + the other 3 diagonals.
  const mask = (BITS.T | BITS.B | BITS.L | BITS.R | BITS.TR | BITS.BL | BITS.BR)
  const tile = tiles[BITMASK_TO_INDEX.get(mask)].data
  // The corner must differ from the flat center in MORE than one pixel near (0,0).
  let changed = 0
  for (let y = 0; y < 6; y++) for (let x = 0; x < 6; x++) {
    const i = (y * s + x) * 4
    if (tile[i] !== 90 || tile[i + 1] !== 110 || tile[i + 2] !== 130) changed++
  }
  assert.ok(changed > 1, 'inner corner should mark several pixels, not just one')
})

test('cobble (Voronoi) pattern generates 48 opaque tiles', () => {
  const biome = {
    colors: { primary: '#808088', secondary: '#606068', border: '#303038', highlight: '#a8a8b0', shadow: '#383840' },
    proceduralParams: { edgeWidth: 2, dither: false, cornerStyle: 'sharp', patternFn: 'cobble' },
  }
  const tiles = procedural.generateAllBiomeTiles(biome, 32)
  assert.equal(tiles.length, 48)
  assert.equal(tiles.filter(Boolean).length, 48)
  for (const t of tiles) {
    assert.equal(t.width, 32)
    for (let i = 3; i < t.data.length; i += 4) assert.equal(t.data[i], 255) // opaque
  }
})

test('generateAllBiomeTiles memoizes by colors + params, not just identity', () => {
  const colors = { primary: '#445533', secondary: '#667744', border: '#223311', highlight: '#99aa66', shadow: '#112211' }
  const proceduralParams = { edgeWidth: 2, dither: true, ditherStrength: 0.35, cornerStyle: 'organic' }
  const biome = { colors, proceduralParams }

  const first = procedural.generateAllBiomeTiles(biome, 16)
  const again = procedural.generateAllBiomeTiles({ colors: { ...colors }, proceduralParams }, 16)
  // Same colors + params + size → cached sheet is reused (same array reference).
  assert.equal(first, again)

  // A color edit must bust the cache and regenerate.
  const edited = procedural.generateAllBiomeTiles({ colors: { ...colors, primary: '#ff0000' }, proceduralParams }, 16)
  assert.notEqual(edited, first)
  assert.equal(edited.length, 48)
})
