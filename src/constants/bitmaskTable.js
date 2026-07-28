// Bit positions for 8-way neighbor detection
export const BITS = {
  TL: 0x01, // Top-Left
  T:  0x02, // Top
  TR: 0x04, // Top-Right
  L:  0x08, // Left
  R:  0x10, // Right
  BL: 0x20, // Bottom-Left
  B:  0x40, // Bottom
  BR: 0x80, // Bottom-Right
}

// Returns true if the 8-bit neighbor value passes the diagonal pruning rule.
// Diagonals are only valid when both adjacent cardinal neighbors are set.
function isValidBitmask(raw) {
  const tl = (raw & BITS.TL) !== 0
  const t  = (raw & BITS.T)  !== 0
  const tr = (raw & BITS.TR) !== 0
  const l  = (raw & BITS.L)  !== 0
  const r  = (raw & BITS.R)  !== 0
  const bl = (raw & BITS.BL) !== 0
  const b  = (raw & BITS.B)  !== 0
  const br = (raw & BITS.BR) !== 0

  if (tl && !(t && l)) return false
  if (tr && !(t && r)) return false
  if (bl && !(b && l)) return false
  if (br && !(b && r)) return false
  return true
}

// Category labels for tooltips
function getCategory(raw) {
  const t  = (raw & BITS.T)  !== 0
  const b  = (raw & BITS.B)  !== 0
  const l  = (raw & BITS.L)  !== 0
  const r  = (raw & BITS.R)  !== 0
  const tl = (raw & BITS.TL) !== 0
  const tr = (raw & BITS.TR) !== 0
  const bl = (raw & BITS.BL) !== 0
  const br = (raw & BITS.BR) !== 0

  const cardinals = [t, b, l, r].filter(Boolean).length
  const diagonals = [tl, tr, bl, br].filter(Boolean).length

  if (raw === 0x00) return 'Isolated'
  if (raw === 0xFF) return 'Center (all neighbors)'
  if (cardinals === 4 && diagonals === 4) return 'Center (all neighbors)'
  if (cardinals === 4) return `Internal Corner${diagonals > 1 ? 's' : ''} ×${4 - diagonals}`
  if (cardinals === 1) return 'Single Border'
  if (cardinals === 2) {
    if ((t && b) || (l && r)) return 'Corridor (opposite sides)'
    return 'Outer Corner'
  }
  if (cardinals === 3) return 'T-Junction'
  return 'Border + Corner Combo'
}

// Build the lookup tables at module load time
const validMasks = []
for (let raw = 0; raw <= 255; raw++) {
  if (isValidBitmask(raw)) validMasks.push(raw)
}

// Sanity check — must be exactly 47
if (validMasks.length !== 47) {
  console.error(`bitmaskTable: expected 47 valid masks, got ${validMasks.length}`)
}

// Sheet index 0 = empty tile (transparent)
// Sheet indices 1..47 = autotile configurations sorted by bitmask value
export const BITMASK_TO_INDEX = new Map()
export const INDEX_TO_BITMASK = new Array(48).fill(0)
export const INDEX_TO_CATEGORY = new Array(48).fill('')

INDEX_TO_CATEGORY[0] = 'Empty'

validMasks.forEach((mask, i) => {
  const sheetIndex = i + 1  // 1-based, 0 is the empty tile
  BITMASK_TO_INDEX.set(mask, sheetIndex)
  INDEX_TO_BITMASK[sheetIndex] = mask
  INDEX_TO_CATEGORY[sheetIndex] = getCategory(mask)
})

export { validMasks }
