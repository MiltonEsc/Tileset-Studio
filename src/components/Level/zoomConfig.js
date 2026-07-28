// Shared zoom bounds for the Level Designer canvas (px per cell).
// MAX raised so high-res tiles (128/256 px) can be magnified well past 1:1.
export const MIN_CELL_PX = 4
export const MAX_CELL_PX = 512
export const ZOOM_STEP   = 2
// Wheel zoom is MULTIPLICATIVE (proportional) — each tick scales cellPx by this
// factor, so zooming is fast and consistent across the whole range (an additive
// step felt glacial once zoomed in).
export const ZOOM_FACTOR = 1.3

export const clampCellPx = (v) => Math.max(MIN_CELL_PX, Math.min(MAX_CELL_PX, v))
