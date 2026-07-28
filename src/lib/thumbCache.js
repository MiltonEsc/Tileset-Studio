// Persistent gallery-thumbnail cache (survives reloads / new sessions).
//
// Generating a saved tileset's 48-tile preview is CPU-heavy, and with dozens of
// saved tilesets it's the main cause of scroll jank in the library. The in-memory
// WeakMap in tilesetDefinition.js only helps within a session; this stores the
// already-rendered thumbnail (a tiny PNG data-URL) in IndexedDB keyed by tileset
// id, so reopening the app shows thumbnails instantly with zero tile generation.
//
// IndexedDB (not localStorage): async so it never blocks the main thread, and no
// ~5 MB cap. Every call fails soft — a cache miss/error just falls back to live
// generation, so the gallery always works even if storage is unavailable.

const DB_NAME = 'tileset-studio'
const STORE = 'thumbs'
const VERSION = 1

let dbPromise = null
function openDB() {
  if (dbPromise) return dbPromise
  dbPromise = new Promise((resolve) => {
    if (typeof indexedDB === 'undefined') { resolve(null); return }
    let req
    try { req = indexedDB.open(DB_NAME, VERSION) }
    catch { resolve(null); return }
    req.onupgradeneeded = () => {
      const db = req.result
      if (!db.objectStoreNames.contains(STORE)) db.createObjectStore(STORE)
    }
    req.onsuccess = () => resolve(req.result)
    req.onerror = () => resolve(null)
  })
  return dbPromise
}

export async function getThumb(key) {
  const db = await openDB()
  if (!db) return null
  return new Promise((resolve) => {
    try {
      const req = db.transaction(STORE, 'readonly').objectStore(STORE).get(key)
      req.onsuccess = () => resolve(req.result || null)
      req.onerror = () => resolve(null)
    } catch { resolve(null) }
  })
}

export async function setThumb(key, dataUrl) {
  const db = await openDB()
  if (!db) return
  return new Promise((resolve) => {
    try {
      const tx = db.transaction(STORE, 'readwrite')
      tx.objectStore(STORE).put(dataUrl, key)
      tx.oncomplete = () => resolve()
      tx.onerror = () => resolve()
    } catch { resolve() }
  })
}

// Drop cached thumbnails whose key is not in `validKeys` (a Set). Called after the
// saved list loads so deleted tilesets don't leave their thumbnails behind forever.
export async function pruneThumbs(validKeys) {
  const db = await openDB()
  if (!db) return
  try {
    const store = db.transaction(STORE, 'readwrite').objectStore(STORE)
    const req = store.getAllKeys()
    req.onsuccess = () => {
      for (const k of req.result || []) {
        if (!validKeys.has(k)) store.delete(k)
      }
    }
  } catch { /* fail soft */ }
}
