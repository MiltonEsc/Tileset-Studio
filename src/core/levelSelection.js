import { bytesToBase64, base64ToBytes } from '../lib/serialize.js'

export const REGION_VERSION = 1
export const PASTE_MODES = ['overlay', 'replace']

export function normalizeRegion(a, b = a) {
  const x0 = Math.floor(Math.min(a?.x ?? 0, b?.x ?? 0))
  const y0 = Math.floor(Math.min(a?.y ?? 0, b?.y ?? 0))
  const x1 = Math.floor(Math.max(a?.x ?? 0, b?.x ?? 0))
  const y1 = Math.floor(Math.max(a?.y ?? 0, b?.y ?? 0))
  return { x: x0, y: y0, width: x1 - x0 + 1, height: y1 - y0 + 1 }
}

export function pointInRegion(x, y, rect) {
  return x >= rect.x && y >= rect.y && x < rect.x + rect.width && y < rect.y + rect.height
}

function int16ToBase64(values) {
  const copy = new Int16Array(values)
  return bytesToBase64(new Uint8Array(copy.buffer))
}

function base64ToInt16(value, length) {
  const bytes = base64ToBytes(value || '')
  const aligned = new Uint8Array(length * 2)
  aligned.set(bytes.subarray(0, aligned.length))
  return new Int16Array(aligned.buffer)
}

export function decodeRegionPlane(plane, width, height) {
  const length = width * height
  const rawGrid = base64ToBytes(plane.gridB64 || '')
  const grid = new Uint8Array(length)
  grid.set(rawGrid.subarray(0, length))
  return { grid, manualTiles: base64ToInt16(plane.manualTilesB64, length) }
}

export function captureRegion({
  width, height, layers, placedProps = [], rect, layerIds,
  includeProps = true, tileSize, effectiveTilesets = {}, assetsById = {},
  sourceLevelId = null,
}) {
  const safe = {
    x: Math.max(0, rect.x), y: Math.max(0, rect.y),
    width: Math.max(0, Math.min(width, rect.x + rect.width) - Math.max(0, rect.x)),
    height: Math.max(0, Math.min(height, rect.y + rect.height) - Math.max(0, rect.y)),
  }
  const wanted = new Set(layerIds || [])
  const planes = []
  layers.forEach((layer, order) => {
    if (!wanted.has(layer.id)) return
    const grid = new Uint8Array(safe.width * safe.height)
    const manual = new Int16Array(safe.width * safe.height).fill(-1)
    for (let y = 0; y < safe.height; y++) {
      for (let x = 0; x < safe.width; x++) {
        const src = (safe.y + y) * width + safe.x + x
        const dst = y * safe.width + x
        grid[dst] = layer.grid?.[src] || 0
        manual[dst] = layer.manualTiles?.[src] ?? -1
      }
    }
    planes.push({
      sourceLayerId: layer.id,
      name: layer.name,
      kind: layer.kind || 'autotile',
      order,
      tileset: effectiveTilesets[layer.id] ?? layer.tileset ?? null,
      gridB64: bytesToBase64(grid),
      manualTilesB64: int16ToBase64(manual),
    })
  })

  const props = includeProps
    ? placedProps.filter(p => pointInRegion(p.x, p.y, safe)).map((p, zOrder) => {
        const asset = assetsById[p.assetId]
        return {
          assetId: p.assetId,
          dx: p.x - safe.x,
          dy: p.y - safe.y,
          flipX: !!p.flipX,
          flipY: !!p.flipY,
          rotation: ((p.rotation || 0) % 360 + 360) % 360,
          zOrder,
          ...(asset ? { cols: asset.cols, rows: asset.rows } : {}),
        }
      })
    : []

  return { version: REGION_VERSION, width: safe.width, height: safe.height, tileSize, sourceLevelId, planes, props }
}

const MATRICES = {
  rotate: [0, 1, -1, 0],
  rotate180: [-1, 0, 0, -1],
  rotate270: [0, -1, 1, 0],
  flipX: [-1, 0, 0, 1],
  flipY: [1, 0, 0, -1],
}

function multiply(a, b) {
  return [
    a[0] * b[0] + a[2] * b[1], a[1] * b[0] + a[3] * b[1],
    a[0] * b[2] + a[2] * b[3], a[1] * b[2] + a[3] * b[3],
  ]
}

function orientationMatrix(prop) {
  const turns = ((((prop.rotation || 0) / 90) | 0) % 4 + 4) % 4
  let out = [1, 0, 0, 1]
  if (prop.flipX) out = multiply(out, MATRICES.flipX)
  if (prop.flipY) out = multiply(out, MATRICES.flipY)
  for (let i = 0; i < turns; i++) out = multiply(MATRICES.rotate, out)
  return out
}

function sameMatrix(a, b) { return a.every((v, i) => v === b[i]) }

function matrixToOrientation(matrix) {
  const candidates = []
  for (const rotation of [0, 90, 180, 270]) {
    for (const flipX of [false, true]) {
      for (const flipY of [false, true]) {
        const value = { rotation, flipX, flipY }
        if (sameMatrix(orientationMatrix(value), matrix)) candidates.push(value)
      }
    }
  }
  candidates.sort((a, b) => (Number(a.flipX) + Number(a.flipY)) - (Number(b.flipX) + Number(b.flipY)) || a.rotation - b.rotation)
  return candidates[0] || { rotation: 0, flipX: false, flipY: false }
}

function transformOrientation(prop, operation) {
  return matrixToOrientation(multiply(MATRICES[operation], orientationMatrix(prop)))
}

function transformPoint(x, y, width, height, operation) {
  if (operation === 'rotate') return { x: height - 1 - y, y: x }
  if (operation === 'rotate180') return { x: width - 1 - x, y: height - 1 - y }
  if (operation === 'rotate270') return { x: y, y: width - 1 - x }
  if (operation === 'flipX') return { x: width - 1 - x, y }
  return { x, y: height - 1 - y }
}

export function transformRegionPayload(payload, operation) {
  if (!MATRICES[operation]) throw new Error(`Unknown region transform: ${operation}`)
  const swapsAxes = operation === 'rotate' || operation === 'rotate270'
  const nextWidth = swapsAxes ? payload.height : payload.width
  const nextHeight = swapsAxes ? payload.width : payload.height
  const planes = payload.planes.map(plane => {
    const src = decodeRegionPlane(plane, payload.width, payload.height)
    const grid = new Uint8Array(nextWidth * nextHeight)
    const manualTiles = new Int16Array(nextWidth * nextHeight).fill(-1)
    for (let y = 0; y < payload.height; y++) {
      for (let x = 0; x < payload.width; x++) {
        const p = transformPoint(x, y, payload.width, payload.height, operation)
        const from = y * payload.width + x
        const to = p.y * nextWidth + p.x
        grid[to] = src.grid[from]
        manualTiles[to] = src.manualTiles[from]
      }
    }
    return { ...plane, gridB64: bytesToBase64(grid), manualTilesB64: int16ToBase64(manualTiles) }
  })
  const props = payload.props.map(prop => {
    const point = transformPoint(prop.dx, prop.dy, payload.width, payload.height, operation)
    return { ...prop, dx: point.x, dy: point.y, ...transformOrientation(prop, operation) }
  })
  return { ...payload, width: nextWidth, height: nextHeight, planes, props }
}

function tilesetsEqual(a, b) {
  return JSON.stringify(a ?? null) === JSON.stringify(b ?? null)
}

export function resolveRegionLayers(planes, layers, idFactory = () => `layer-${Date.now()}-${Math.random()}`, effectiveTilesets = {}, allowSourceIds = true) {
  const nextLayers = [...layers]
  const used = new Set()
  const mappings = []
  const ordered = [...planes].sort((a, b) => a.order - b.order)
  for (const plane of ordered) {
    let idx = allowSourceIds ? nextLayers.findIndex((layer, i) => !used.has(i) && layer.id === plane.sourceLayerId) : -1
    if (idx < 0) {
      idx = nextLayers.findIndex((layer, i) => {
        if (used.has(i) || (layer.kind || 'autotile') !== plane.kind) return false
        if (String(layer.name).trim().toLowerCase() !== String(plane.name).trim().toLowerCase()) return false
        return plane.kind !== 'manual' || tilesetsEqual(effectiveTilesets[layer.id] ?? layer.tileset, plane.tileset)
      })
    }
    if (idx < 0) {
      idx = nextLayers.length
      nextLayers.push({
        id: idFactory(), name: plane.name || `Stamp layer ${idx + 1}`,
        kind: plane.kind || 'autotile', visible: true, tileset: plane.tileset ?? null,
        grid: null, manualTiles: null,
      })
    }
    used.add(idx)
    mappings.push({ plane, layerIdx: idx })
  }
  return { layers: nextLayers, mappings }
}

function makePropId() {
  return globalThis.crypto?.randomUUID?.() ?? String(Date.now() + Math.random())
}

function expandState(state, rect, maxWidth = Infinity, maxHeight = Infinity) {
  const left = Math.min(0, rect.x)
  const top = Math.min(0, rect.y)
  const right = Math.max(state.width, rect.x + rect.width)
  const bottom = Math.max(state.height, rect.y + rect.height)
  const width = right - left
  const height = bottom - top
  if (width > maxWidth || height > maxHeight) {
    return { error: `Selection would expand the map to ${width}x${height}, beyond the render limit.` }
  }
  const shiftX = left < 0 ? -left : 0
  const shiftY = top < 0 ? -top : 0
  const layers = state.layers.map(layer => {
    const grid = new Uint8Array(width * height)
    const manualTiles = new Int16Array(width * height).fill(-1)
    if (layer.grid && layer.manualTiles) {
      for (let y = 0; y < state.height; y++) {
        const from = y * state.width
        const to = (y + shiftY) * width + shiftX
        grid.set(layer.grid.subarray(from, from + state.width), to)
        manualTiles.set(layer.manualTiles.subarray(from, from + state.width), to)
      }
    }
    return { ...layer, grid, manualTiles, _dirtyTerrain: null, _dirtyManual: null }
  })
  const placedProps = state.placedProps.map(p => ({ ...p, x: p.x + shiftX, y: p.y + shiftY }))
  return { width, height, layers, placedProps, shiftX, shiftY }
}

function clearRectFromLayers(layers, width, rect, layerIds) {
  const ids = new Set(layerIds)
  return layers.map(layer => {
    if (!ids.has(layer.id)) return layer
    const grid = new Uint8Array(layer.grid)
    const manualTiles = new Int16Array(layer.manualTiles)
    for (let y = rect.y; y < rect.y + rect.height; y++) {
      for (let x = rect.x; x < rect.x + rect.width; x++) {
        const i = y * width + x
        grid[i] = 0
        manualTiles[i] = -1
      }
    }
    return { ...layer, grid, manualTiles, _dirtyTerrain: null, _dirtyManual: null }
  })
}

export function deleteRegionFromState(state, rect, layerIds, includeProps = true) {
  const layers = clearRectFromLayers(state.layers, state.width, rect, layerIds)
  const placedProps = includeProps ? state.placedProps.filter(p => !pointInRegion(p.x, p.y, rect)) : state.placedProps
  return { ...state, layers, placedProps }
}

export function applyRegionToState(state, payload, {
  x, y, mode = 'overlay', clearSource = null, includeProps = true,
  validAssetIds = null, maxWidth = Infinity, maxHeight = Infinity,
  idFactory, propIdFactory = makePropId, destinationTilesets = {},
  currentLevelId = null,
} = {}) {
  if (!PASTE_MODES.includes(mode)) throw new Error(`Unknown paste mode: ${mode}`)
  const allowSourceIds = payload.sourceLevelId != null && currentLevelId != null && payload.sourceLevelId === currentLevelId
  const resolved = resolveRegionLayers(payload.planes, state.layers, idFactory, destinationTilesets, allowSourceIds)
  const withCreated = { ...state, layers: resolved.layers }
  const expanded = expandState(withCreated, { x, y, width: payload.width, height: payload.height }, maxWidth, maxHeight)
  if (expanded.error) return expanded
  const target = { x: x + expanded.shiftX, y: y + expanded.shiftY, width: payload.width, height: payload.height }
  let layers = expanded.layers
  let props = expanded.placedProps

  if (clearSource) {
    const source = { ...clearSource.rect, x: clearSource.rect.x + expanded.shiftX, y: clearSource.rect.y + expanded.shiftY }
    layers = clearRectFromLayers(layers, expanded.width, source, clearSource.layerIds)
    if (clearSource.includeProps) props = props.filter(p => !pointInRegion(p.x, p.y, source))
  }

  if (mode === 'replace') {
    layers = clearRectFromLayers(layers, expanded.width, target, resolved.mappings.map(m => layers[m.layerIdx].id))
    if (includeProps) props = props.filter(p => !pointInRegion(p.x, p.y, target))
  }

  const nextLayers = [...layers]
  for (const { plane, layerIdx } of resolved.mappings) {
    const layer = nextLayers[layerIdx]
    const decoded = decodeRegionPlane(plane, payload.width, payload.height)
    const grid = new Uint8Array(layer.grid)
    const manualTiles = new Int16Array(layer.manualTiles)
    for (let py = 0; py < payload.height; py++) {
      for (let px = 0; px < payload.width; px++) {
        const from = py * payload.width + px
        const occupied = decoded.manualTiles[from] >= 0 || decoded.grid[from] === 1
        if (mode === 'overlay' && !occupied) continue
        const to = (target.y + py) * expanded.width + target.x + px
        grid[to] = decoded.grid[from]
        manualTiles[to] = decoded.manualTiles[from]
      }
    }
    nextLayers[layerIdx] = { ...layer, grid, manualTiles, _dirtyTerrain: null, _dirtyManual: null }
  }

  const missingAssets = new Set()
  if (includeProps) {
    const additions = [...payload.props].sort((a, b) => a.zOrder - b.zOrder).flatMap(prop => {
      if (validAssetIds && !validAssetIds.has(prop.assetId)) { missingAssets.add(prop.assetId); return [] }
      return [{
        id: propIdFactory(), assetId: prop.assetId,
        x: target.x + prop.dx, y: target.y + prop.dy,
        ...(prop.flipX ? { flipX: true } : {}),
        ...(prop.flipY ? { flipY: true } : {}),
        ...(prop.rotation ? { rotation: prop.rotation } : {}),
      }]
    })
    props = [...props, ...additions]
  }

  return {
    width: expanded.width, height: expanded.height,
    layers: nextLayers, placedProps: props,
    shiftX: expanded.shiftX, shiftY: expanded.shiftY,
    selectionRect: target, missingAssetIds: [...missingAssets],
    selectedLayerIds: resolved.mappings.map(m => nextLayers[m.layerIdx].id),
  }
}
