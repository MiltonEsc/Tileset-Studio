// Decode an image File/Blob into a raw RGBA buffer at its native size, so an
// imported texture can be fed to the same tile pipeline as an AI image
// (processImageToTile in aiTile.js). Mirrors decodeGeneratedImage but reads
// from a user-provided file.
export function fileToRgba(file) {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file)
    const img = new Image()
    img.onload = () => {
      const canvas = document.createElement('canvas')
      canvas.width = img.naturalWidth
      canvas.height = img.naturalHeight
      const ctx = canvas.getContext('2d')
      ctx.imageSmoothingEnabled = false
      ctx.drawImage(img, 0, 0)
      try {
        const id = ctx.getImageData(0, 0, canvas.width, canvas.height)
        resolve({ data: new Uint8ClampedArray(id.data), width: canvas.width, height: canvas.height })
      } catch {
        reject(new Error('Could not read the imported image (CORS or decode error).'))
      } finally {
        URL.revokeObjectURL(url)
      }
    }
    img.onerror = () => {
      URL.revokeObjectURL(url)
      reject(new Error('Failed to load the imported image.'))
    }
    img.src = url
  })
}
