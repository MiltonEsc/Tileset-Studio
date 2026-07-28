// Level export to game-engine formats.
//   - Tiled:  native .tmj (JSON map) + tileset PNG(s)
//   - Godot:  generic .json + GDScript importer (level_importer.gd) + PNG(s)
//   - Unity:  generic .json + C# importer (LevelImporter.cs) + PNG(s)
// The tileset image is the same 8×6 / 48-tile sheet the app renders; each cell's
// tile index (0..47) maps to atlas coords (idx % 8, idx / 8). Empty cells are -1
// in the generic JSON and gid 0 in Tiled. Prop *placement* is preserved; prop
// images live in a separate atlas and are not exported here.
import { computeIndexMap } from './autotile.js'
import { composeNativeSheet, SHEET_COLS, SHEET_ROWS } from './composeSheet.js'
import { FILL_INDEX, makeFillVariants, pickVariant } from './tileVariants.js'
import { ANIM_FRAME_MS } from './tilesetDefinition.js'

const TILE_COUNT = SHEET_COLS * SHEET_ROWS // 48

// Builds the tileset sheet canvas. Layout: 48 base tiles, then fill-tile
// variants (anti-repetition, indices 48..48+V-1), then one full 48-tile block
// per animation frame starting at frameStart = 48+V.
function buildSheetCanvas(tiles, variants, tileSize, frames = []) {
  if (!variants.length && !frames.length) {
    return { canvas: composeNativeSheet(tiles, tileSize), rows: SHEET_ROWS, tileCount: TILE_COUNT, frameStart: 0 }
  }
  const frameStart = TILE_COUNT + variants.length
  const total = frameStart + frames.length * TILE_COUNT
  const rows = Math.ceil(total / SHEET_COLS)
  const canvas = document.createElement('canvas')
  canvas.width = SHEET_COLS * tileSize
  canvas.height = rows * tileSize
  const ctx = canvas.getContext('2d')
  ctx.imageSmoothingEnabled = false
  const blit = (img, idx) => {
    if (img) ctx.putImageData(img, (idx % SHEET_COLS) * tileSize, Math.floor(idx / SHEET_COLS) * tileSize)
  }
  for (let i = 0; i < TILE_COUNT; i++) blit(tiles[i], i)
  variants.forEach((v, k) => blit(v, TILE_COUNT + k))
  frames.forEach((frameTiles, f) => {
    for (let i = 0; i < TILE_COUNT; i++) blit(frameTiles?.[i], frameStart + f * TILE_COUNT + i)
  })
  return { canvas, rows, tileCount: total, frameStart }
}

// ── Shared model ─────────────────────────────────────────────────────────────
// Resolves every visible layer to a flat array of tile indices (-1 = empty),
// dedupes tilesets by their layerTiles reference, and renders each to a canvas.
function buildLevelModel({ level, layerTiles, tileSize, assetsById = {}, tileVariation = false }) {
  const { width, height, layers } = level
  const border = level.seamlessEdges ? 1 : 0

  const tilesetIdByRef = new Map()
  const tilesets = []
  const getTilesetId = (layerTile) => {
    if (tilesetIdByRef.has(layerTile)) return tilesetIdByRef.get(layerTile)
    const id = tilesets.length
    const ts = layerTile.tileSize || tileSize
    const variants = tileVariation ? makeFillVariants(layerTile.tiles[FILL_INDEX], ts) : []
    const frames = layerTile.frames || []
    const { canvas, rows, tileCount, frameStart } = buildSheetCanvas(layerTile.tiles, variants, ts, frames)
    tilesets.push({
      id, tileSize: ts, columns: SHEET_COLS, rows, tileCount, variantCount: variants.length, canvas,
      frameCount: frames.length, frameStart, frameDuration: ANIM_FRAME_MS,
    })
    tilesetIdByRef.set(layerTile, id)
    return id
  }

  const outLayers = []
  layers.forEach((layer, li) => {
    const layerTile = layerTiles[li]
    if (!layerTile?.tiles) return
    const tilesetId = getTilesetId(layerTile)
    const variantCount = tilesets[tilesetId].variantCount
    const indexMap = layer.kind === 'manual' ? null : computeIndexMap(layer.grid, width, height, border)
    const data = new Array(width * height)
    for (let cell = 0; cell < width * height; cell++) {
      const manualIdx = layer.manualTiles[cell]
      let idx = layer.kind === 'manual'
        ? manualIdx
        : (manualIdx >= 0 ? manualIdx : (indexMap?.[cell] ?? 0))
      const isEmpty = layer.kind === 'manual' ? idx < 0 : !idx
      // Bake the per-cell fill variant into the tile index (variant tiles live at 48..).
      if (!isEmpty && variantCount > 0 && idx === FILL_INDEX) {
        const pick = pickVariant(cell % width, (cell / width) | 0, 1 + variantCount)
        if (pick > 0) idx = TILE_COUNT + (pick - 1)
      }
      data[cell] = isEmpty ? -1 : idx
    }
    outLayers.push({ name: layer.name, visible: layer.visible !== false, tilesetId, data })
  })

  const props = (level.placedProps || []).map(p => {
    const a = assetsById[p.assetId]
    return {
      asset: String(p.assetId), x: p.x, y: p.y, cols: a?.cols ?? 1, rows: a?.rows ?? 1,
      flipX: !!p.flipX, flipY: !!p.flipY, rotation: p.rotation || 0,
    }
  })

  return { width, height, tileSize, tilesets, layers: outLayers, props }
}

const baseName = (level) => `level_${level.width}x${level.height}`
const tilesetFile = (base, id) => `${base}_tileset_${id}.png`

// ── Download helpers ─────────────────────────────────────────────────────────
function canvasToBlob(canvas) {
  return new Promise(resolve => canvas.toBlob(resolve, 'image/png'))
}

function textBlob(text, type = 'application/json') {
  return new Blob([text], { type })
}

// Browsers may only honour the last of several synchronous downloads, so space
// them out a little.
async function downloadFiles(files) {
  for (let i = 0; i < files.length; i++) {
    const url = URL.createObjectURL(files[i].blob)
    const a = document.createElement('a')
    a.href = url
    a.download = files[i].name
    a.click()
    setTimeout(() => URL.revokeObjectURL(url), 1000)
    if (i < files.length - 1) await new Promise(r => setTimeout(r, 200))
  }
}

async function tilesetFiles(model, base) {
  const files = []
  for (const ts of model.tilesets) {
    files.push({ name: tilesetFile(base, ts.id), blob: await canvasToBlob(ts.canvas) })
  }
  return files
}

// ── Tiled (.tmj) ─────────────────────────────────────────────────────────────
function tiledMap(model, base) {
  let firstgid = 1
  const firstgids = []
  const tilesets = model.tilesets.map(ts => {
    firstgids[ts.id] = firstgid
    const entry = {
      firstgid,
      name: `tileset_${ts.id}`,
      image: tilesetFile(base, ts.id),
      imagewidth: ts.columns * ts.tileSize,
      imageheight: ts.rows * ts.tileSize,
      tilewidth: ts.tileSize,
      tileheight: ts.tileSize,
      tilecount: ts.tileCount,
      columns: ts.columns,
      margin: 0,
      spacing: 0,
      // Animated tilesets: every autotile id (1..47) cycles through its frame
      // copies, which live in full 48-tile blocks starting at frameStart.
      ...(ts.frameCount > 0 ? {
        tiles: Array.from({ length: 47 }, (_, k) => {
          const id = k + 1
          return {
            id,
            animation: [
              { tileid: id, duration: ts.frameDuration },
              ...Array.from({ length: ts.frameCount }, (_, f) => ({
                tileid: ts.frameStart + f * 48 + id,
                duration: ts.frameDuration,
              })),
            ],
          }
        }),
      } : {}),
    }
    firstgid += ts.tileCount
    return entry
  })

  const layers = model.layers.map((layer, idx) => ({
    type: 'tilelayer',
    id: idx + 1,
    name: layer.name,
    width: model.width,
    height: model.height,
    x: 0,
    y: 0,
    opacity: 1,
    visible: layer.visible,
    data: layer.data.map(v => (v < 0 ? 0 : firstgids[layer.tilesetId] + v)),
  }))

  if (model.props.length) {
    layers.push({
      type: 'objectgroup',
      id: layers.length + 1,
      name: 'props',
      opacity: 1,
      visible: true,
      x: 0,
      y: 0,
      draworder: 'topdown',
      objects: model.props.map((p, i) => ({
        id: i + 1,
        name: p.asset,
        type: 'prop',
        x: p.x * model.tileSize,
        y: p.y * model.tileSize,
        width: p.cols * model.tileSize,
        height: p.rows * model.tileSize,
        rotation: p.rotation || 0,
        visible: true,
        // Tiled rectangle objects have no native flip flag; carry it as props.
        ...((p.flipX || p.flipY) ? {
          properties: [
            ...(p.flipX ? [{ name: 'flipX', type: 'bool', value: true }] : []),
            ...(p.flipY ? [{ name: 'flipY', type: 'bool', value: true }] : []),
          ],
        } : {}),
      })),
    })
  }

  return {
    type: 'map',
    version: '1.10',
    tiledversion: '1.10.2',
    orientation: 'orthogonal',
    renderorder: 'right-down',
    infinite: false,
    width: model.width,
    height: model.height,
    tilewidth: model.tileSize,
    tileheight: model.tileSize,
    nextlayerid: layers.length + 1,
    nextobjectid: model.props.length + 1,
    tilesets,
    layers,
  }
}

// ── Generic JSON (Godot / Unity importers consume this) ──────────────────────
function genericJson(model, base) {
  return {
    format: 'tileset-studio-level',
    version: 1,
    width: model.width,
    height: model.height,
    tileSize: model.tileSize,
    tilesets: model.tilesets.map(ts => ({
      id: ts.id,
      image: tilesetFile(base, ts.id),
      columns: ts.columns,
      rows: ts.rows,
      tileCount: ts.tileCount,
      tileSize: ts.tileSize,
      // Frame copies of tiles 0..47 start at frameStart in blocks of 48; the
      // bundled Godot/Unity importers place the static frame and ignore this.
      ...(ts.frameCount > 0 ? {
        animation: { frameCount: ts.frameCount, frameStart: ts.frameStart, frameDuration: ts.frameDuration },
      } : {}),
    })),
    layers: model.layers.map(l => ({ name: l.name, visible: l.visible, tileset: l.tilesetId, data: l.data })),
    props: model.props,
  }
}

const GODOT_IMPORTER = `@tool
extends EditorScript
# Tileset Studio -> Godot 4 importer.
# 1. Copy the exported <name>.json and <name>_tileset_*.png into your project
#    (e.g. res://), and set JSON_PATH below to match the .json file.
# 2. Open a scene (the level is added to it), open this script in the Godot
#    script editor, and run it with File > Run (Ctrl+Shift+X).

const JSON_PATH := "res://level.json"  # <- adjust to your exported file name

func _run() -> void:
	var file := FileAccess.open(JSON_PATH, FileAccess.READ)
	if file == null:
		push_error("Cannot open %s" % JSON_PATH)
		return
	var data: Dictionary = JSON.parse_string(file.get_as_text())
	var dir := JSON_PATH.get_base_dir()
	var tile_size := int(data.tileSize)

	# One shared TileSet with an atlas source per exported tileset.
	var tile_set := TileSet.new()
	tile_set.tile_size = Vector2i(tile_size, tile_size)
	var source_ids := {}
	for ts in data.tilesets:
		var atlas := TileSetAtlasSource.new()
		atlas.texture = load(dir.path_join(String(ts.image)))
		atlas.texture_region_size = Vector2i(int(ts.tileSize), int(ts.tileSize))
		var cols := int(ts.columns)
		for i in int(ts.tileCount):
			atlas.create_tile(Vector2i(i % cols, i / cols))
		source_ids[int(ts.id)] = tile_set.add_source(atlas)

	var width := int(data.width)
	var root := Node2D.new()
	root.name = "ImportedLevel"
	for layer in data.layers:
		var tml := TileMapLayer.new()
		tml.name = String(layer.name)
		tml.tile_set = tile_set
		tml.visible = bool(layer.visible)
		var sid := int(source_ids[int(layer.tileset)])
		var cols := int(data.tilesets[int(layer.tileset)].columns)
		var cells: Array = layer.data
		for cell in cells.size():
			var idx := int(cells[cell])
			if idx < 0:
				continue
			tml.set_cell(Vector2i(cell % width, cell / width), sid, Vector2i(idx % cols, idx / cols))
		root.add_child(tml)

	var scene_root := get_editor_interface().get_edited_scene_root()
	if scene_root == null:
		push_error("Open a scene first; the level is added to the open scene.")
		return
	scene_root.add_child(root)
	root.owner = scene_root
	for child in root.get_children():
		child.owner = scene_root
	print("Imported level: %d layer(s), %dx%d." % [data.layers.size(), width, int(data.height)])
`

const UNITY_IMPORTER = `// Tileset Studio -> Unity importer.
// 1. Copy <name>.json and the tileset PNG(s) into Assets/. Unity imports .json
//    as a TextAsset. For each tileset PNG set: Texture Type = Sprite (2D),
//    Filter = Point (no filter), Compression = None.
// 2. Add this component to an empty GameObject, assign the JSON TextAsset and the
//    tileset Texture2D(s) in tileset-id order, then use the "Build Level" context
//    menu (gear icon on the component).
using System;
using System.Collections.Generic;
using UnityEngine;
using UnityEngine.Tilemaps;

public class LevelImporter : MonoBehaviour
{
    public TextAsset levelJson;
    public Texture2D[] tilesets;

    [Serializable] public class TilesetInfo { public int id; public int columns; public int rows; public int tileCount; public int tileSize; }
    [Serializable] public class LayerInfo { public string name; public bool visible; public int tileset; public int[] data; }
    [Serializable] public class LevelData { public int width; public int height; public int tileSize; public TilesetInfo[] tilesets; public LayerInfo[] layers; }

    [ContextMenu("Build Level")]
    public void Build()
    {
        var data = JsonUtility.FromJson<LevelData>(levelJson.text);
        var grid = new GameObject("ImportedLevel").AddComponent<Grid>();
        grid.cellSize = new Vector3(1f, 1f, 0f);

        var tilesByTileset = new Dictionary<int, Tile[]>();
        foreach (var ts in data.tilesets)
        {
            var tex = tilesets[ts.id];
            var tiles = new Tile[ts.tileCount];
            int px = ts.tileSize;
            for (int i = 0; i < ts.tileCount; i++)
            {
                int cx = i % ts.columns;
                int cy = i / ts.columns;
                // Unity texture origin is bottom-left, so flip the atlas row.
                var rect = new Rect(cx * px, tex.height - (cy + 1) * px, px, px);
                var sprite = Sprite.Create(tex, rect, new Vector2(0.5f, 0.5f), px);
                var tile = ScriptableObject.CreateInstance<Tile>();
                tile.sprite = sprite;
                tiles[i] = tile;
            }
            tilesByTileset[ts.id] = tiles;
        }

        foreach (var layer in data.layers)
        {
            var go = new GameObject(layer.name);
            go.transform.SetParent(grid.transform);
            var tilemap = go.AddComponent<Tilemap>();
            var renderer = go.AddComponent<TilemapRenderer>();
            renderer.enabled = layer.visible;
            var tiles = tilesByTileset[layer.tileset];
            for (int cell = 0; cell < layer.data.Length; cell++)
            {
                int idx = layer.data[cell];
                if (idx < 0) continue;
                int x = cell % data.width;
                int y = cell / data.width;
                // Flip Y so the map reads top-down like the editor.
                tilemap.SetTile(new Vector3Int(x, data.height - 1 - y, 0), tiles[idx]);
            }
        }
        Debug.Log($"Imported level: {data.layers.Length} layer(s), {data.width}x{data.height}.");
    }
}
`

// ── Public API ───────────────────────────────────────────────────────────────
export async function exportLevelTiled(ctx) {
  const base = baseName(ctx.level)
  const model = buildLevelModel(ctx)
  const files = await tilesetFiles(model, base)
  files.push({ name: `${base}.tmj`, blob: textBlob(JSON.stringify(tiledMap(model, base), null, 2)) })
  await downloadFiles(files)
}

export async function exportLevelGodot(ctx) {
  const base = baseName(ctx.level)
  const model = buildLevelModel(ctx)
  const files = await tilesetFiles(model, base)
  files.push({ name: `${base}.json`, blob: textBlob(JSON.stringify(genericJson(model, base), null, 2)) })
  files.push({ name: 'level_importer.gd', blob: textBlob(GODOT_IMPORTER, 'text/plain') })
  await downloadFiles(files)
}

export async function exportLevelUnity(ctx) {
  const base = baseName(ctx.level)
  const model = buildLevelModel(ctx)
  const files = await tilesetFiles(model, base)
  files.push({ name: `${base}.json`, blob: textBlob(JSON.stringify(genericJson(model, base), null, 2)) })
  files.push({ name: 'LevelImporter.cs', blob: textBlob(UNITY_IMPORTER, 'text/plain') })
  await downloadFiles(files)
}

// Exported for tests.
export { buildLevelModel, tiledMap, genericJson }
