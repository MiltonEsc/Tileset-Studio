// Default biome tilesets. Tuned to read well as 32px procedural tiles: each has
// a distinctive texture (`patternFn`, see proceduralGen.applyBiomePattern) plus a
// light `dither` grain, and a cohesive 5-colour palette (primary fill, secondary
// mottle, border edge, highlight, shadow).
export const BIOMES = [
  {
    id: 'forest',
    label: 'Forest',
    emoji: '🌲',
    colors: {
      primary:   '#3f7a33',
      secondary: '#2e5e24',
      border:    '#173809',
      highlight: '#74c24f',
      shadow:    '#214a16',
    },
    proceduralParams: {
      edgeWidth: 2,
      dither: true,
      ditherStrength: 0.18,
      cornerStyle: 'organic',
      patternFn: 'grass',
    },
  },
  {
    id: 'desert',
    label: 'Desert',
    emoji: '🏜️',
    colors: {
      primary:   '#e0b455',
      secondary: '#cb9836',
      border:    '#8a5c1a',
      highlight: '#f8e0a0',
      shadow:    '#9a6a1c',
    },
    proceduralParams: {
      edgeWidth: 2,
      dither: true,
      ditherStrength: 0.14,
      cornerStyle: 'sharp',
      patternFn: 'sand',
    },
  },
  {
    id: 'snow',
    label: 'Snow',
    emoji: '❄️',
    colors: {
      primary:   '#e6eff7',
      secondary: '#cfdeec',
      border:    '#8aa8c0',
      highlight: '#ffffff',
      shadow:    '#aec6da',
    },
    proceduralParams: {
      edgeWidth: 2,
      dither: false,
      ditherStrength: 0.2,
      cornerStyle: 'rounded',
      patternFn: 'snow',
    },
  },
  {
    id: 'cave',
    label: 'Cave',
    emoji: '🪨',
    colors: {
      primary:   '#413949',
      secondary: '#2f2836',
      border:    '#171121',
      highlight: '#7a6c88',
      shadow:    '#211a2b',
    },
    proceduralParams: {
      edgeWidth: 2,
      dither: true,
      ditherStrength: 0.18,
      cornerStyle: 'organic',
      patternFn: 'stone',
    },
  },
  {
    id: 'ocean',
    label: 'Ocean',
    emoji: '🌊',
    colors: {
      primary:   '#2e6cab',
      secondary: '#1f5285',
      border:    '#103a5f',
      highlight: '#67b6ee',
      shadow:    '#173f6c',
    },
    proceduralParams: {
      edgeWidth: 2,
      dither: false,
      ditherStrength: 0.3,
      cornerStyle: 'rounded',
      patternFn: 'water',
    },
  },
  {
    id: 'lava',
    label: 'Lava',
    emoji: '🌋',
    colors: {
      primary:   '#e0490a', // molten-orange glow halo around the cracks
      secondary: '#6e1d04', // lighter charred plates
      border:    '#360a01',
      highlight: '#ffd24a', // white-hot crack core
      shadow:    '#240a02', // near-black basalt plates
    },
    proceduralParams: {
      edgeWidth: 2,
      dither: true,
      ditherStrength: 0.16,
      cornerStyle: 'sharp',
      patternFn: 'lava',
    },
  },
  {
    id: 'grassland',
    label: 'Grassland',
    emoji: '🌿',
    colors: {
      primary:   '#62b03d',
      secondary: '#4f9a2c',
      border:    '#2c5e15',
      highlight: '#a2e565',
      shadow:    '#3d7a22',
    },
    proceduralParams: {
      edgeWidth: 2,
      dither: true,
      ditherStrength: 0.16,
      cornerStyle: 'organic',
      patternFn: 'grass',
    },
  },
  {
    id: 'dungeon',
    label: 'Dungeon',
    emoji: '🏰',
    colors: {
      primary:   '#585158',
      secondary: '#433d46',
      border:    '#211b25',
      highlight: '#8d8294',
      shadow:    '#2c2630',
    },
    proceduralParams: {
      edgeWidth: 2,
      dither: false,
      ditherStrength: 0.2,
      cornerStyle: 'sharp',
      patternFn: 'brick',
    },
  },
]

// Ground-terrain templates (a curated category in the gallery). Same shape as a
// biome — a `patternFn` (the "form") + a default palette — so clicking one builds
// the procedural tileset instantly; AI textures can then re-skin the colour on
// top. IDs are 'g-*' to avoid colliding with the biome IDs above.
export const GROUND_TEMPLATES = [
  {
    id: 'g-grass', label: 'Césped',
    colors: { primary: '#5aa83a', secondary: '#4a9030', border: '#2a5612', highlight: '#9be05a', shadow: '#386a20' },
    proceduralParams: { edgeWidth: 2, dither: true, ditherStrength: 0.16, cornerStyle: 'organic', patternFn: 'grass' },
  },
  {
    id: 'g-dirt', label: 'Tierra',
    colors: { primary: '#8a6038', secondary: '#6e4a28', border: '#432a14', highlight: '#b08a5c', shadow: '#4f3318' },
    proceduralParams: { edgeWidth: 2, dither: true, ditherStrength: 0.16, cornerStyle: 'organic', patternFn: 'dirt' },
  },
  {
    id: 'g-sand', label: 'Arena',
    colors: { primary: '#e0c068', secondary: '#cba84a', border: '#8a6a26', highlight: '#f6e6a8', shadow: '#9a7a2c' },
    proceduralParams: { edgeWidth: 2, dither: true, ditherStrength: 0.14, cornerStyle: 'sharp', patternFn: 'sand' },
  },
  {
    // Sand strewn with rounded pebbles (greyish-tan body so they pop on the sand).
    id: 'g-sandstone', label: 'Arena con piedrecitas',
    colors: { primary: '#e2c46e', secondary: '#a8946a', border: '#75592a', highlight: '#f4e4a6', shadow: '#7c6440' },
    proceduralParams: { edgeWidth: 2, dither: true, ditherStrength: 0.12, cornerStyle: 'sharp', patternFn: 'sandpebble' },
  },
  {
    id: 'g-snow', label: 'Nieve',
    colors: { primary: '#e6eff7', secondary: '#cfdeec', border: '#8aa8c0', highlight: '#ffffff', shadow: '#aec6da' },
    proceduralParams: { edgeWidth: 2, dither: false, ditherStrength: 0.2, cornerStyle: 'rounded', patternFn: 'snow' },
  },
  {
    // Cracked ice: clean pale plates with thin deep-blue fracture lines + sheen.
    id: 'g-ice', label: 'Hielo agrietado',
    colors: { primary: '#dcf0fa', secondary: '#bcdcee', border: '#4e7a9c', highlight: '#ffffff', shadow: '#5a86a8' },
    proceduralParams: { edgeWidth: 2, dither: false, ditherStrength: 0.14, cornerStyle: 'rounded', patternFn: 'ice' },
  },
  {
    id: 'g-mud', label: 'Barro',
    colors: { primary: '#5e4630', secondary: '#463320', border: '#281a0e', highlight: '#7a5e40', shadow: '#2e2012' },
    proceduralParams: { edgeWidth: 2, dither: true, ditherStrength: 0.14, cornerStyle: 'organic', patternFn: 'mud' },
  },
  {
    id: 'g-stone', label: 'Piedra',
    colors: { primary: '#83838c', secondary: '#62626a', border: '#34343c', highlight: '#aeaeb6', shadow: '#3a3a42' },
    proceduralParams: { edgeWidth: 2, dither: false, ditherStrength: 0.18, cornerStyle: 'sharp', patternFn: 'cobble' },
  },
  {
    id: 'g-lava', label: 'Lava',
    colors: { primary: '#e0490a', secondary: '#6e1d04', border: '#360a01', highlight: '#ffd24a', shadow: '#240a02' },
    proceduralParams: { edgeWidth: 2, dither: true, ditherStrength: 0.16, cornerStyle: 'sharp', patternFn: 'lava' },
  },
  {
    id: 'g-ash', label: 'Ceniza volcánica',
    colors: { primary: '#4a4748', secondary: '#383537', border: '#1e1c1d', highlight: '#ff7a3c', shadow: '#262324' },
    proceduralParams: { edgeWidth: 2, dither: true, ditherStrength: 0.18, cornerStyle: 'sharp', patternFn: 'ash' },
  },
  {
    // Mossy stone: grey cobbles with green moss in the cracks (shadow) + on top
    // (highlight), like the reference mossy-stone tile.
    id: 'g-moss', label: 'Musgo',
    colors: { primary: '#6e6e64', secondary: '#56564e', border: '#2c3a1e', highlight: '#86c24a', shadow: '#3a4a22' },
    proceduralParams: { edgeWidth: 2, dither: false, ditherStrength: 0.16, cornerStyle: 'organic', patternFn: 'cobble' },
  },
  {
    id: 'g-swamp', label: 'Pantano',
    colors: { primary: '#4a5a3a', secondary: '#38462a', border: '#1e2814', highlight: '#6a8a4a', shadow: '#26301a' },
    proceduralParams: { edgeWidth: 2, dither: false, ditherStrength: 0.2, cornerStyle: 'rounded', patternFn: 'swamp' },
  },
  {
    id: 'g-gravel', label: 'Grava',
    colors: { primary: '#8a8a82', secondary: '#6c6c64', border: '#3a3a34', highlight: '#b4b4ac', shadow: '#4a4a44' },
    proceduralParams: { edgeWidth: 2, dither: false, ditherStrength: 0.2, cornerStyle: 'organic', patternFn: 'gravel' },
  },
  {
    id: 'g-brick', label: 'Ladrillo',
    colors: { primary: '#b04a32', secondary: '#8a3824', border: '#4a1c12', highlight: '#d4785a', shadow: '#5e2418' },
    proceduralParams: { edgeWidth: 2, dither: false, ditherStrength: 0.2, cornerStyle: 'sharp', patternFn: 'brick' },
  },
  {
    id: 'g-stonebrick', label: 'Bloque de piedra',
    colors: { primary: '#c6bc98', secondary: '#aea282', border: '#6e6448', highlight: '#e6dcc0', shadow: '#7c7256' },
    proceduralParams: { edgeWidth: 2, dither: false, ditherStrength: 0.2, cornerStyle: 'sharp', patternFn: 'brick' },
  },
]

// Map covers BOTH biomes and ground templates so any id resolves to its params
// when a saved {mode:'procedural', biomeId, colors} definition regenerates.
export const BIOME_MAP = Object.fromEntries([...BIOMES, ...GROUND_TEMPLATES].map(b => [b.id, b]))

// The tileset the editor loads on startup. (BIOMES[0] stays the generic
// "unknown biome" fallback / gallery-order first; this is just the default.)
export const DEFAULT_BIOME = BIOME_MAP.dungeon
