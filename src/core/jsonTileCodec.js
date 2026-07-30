export function normalizeHexColor(color) {
  if (typeof color !== 'string') return null;
  const hex = color.trim().toUpperCase();
  if (!/^#(?:[0-9A-F]{3}|[0-9A-F]{4}|[0-9A-F]{6}|[0-9A-F]{8})$/.test(hex)) {
    return null;
  }
  
  if (hex.length === 4) {
    return `#${hex[1]}${hex[1]}${hex[2]}${hex[2]}${hex[3]}${hex[3]}FF`;
  } else if (hex.length === 5) {
    return `#${hex[1]}${hex[1]}${hex[2]}${hex[2]}${hex[3]}${hex[3]}${hex[4]}${hex[4]}`;
  } else if (hex.length === 7) {
    return `${hex}FF`;
  }
  return hex;
}

export function hexToRgba(hex) {
  const normalized = normalizeHexColor(hex);
  if (!normalized) return [0, 0, 0, 255];
  const r = parseInt(normalized.slice(1, 3), 16);
  const g = parseInt(normalized.slice(3, 5), 16);
  const b = parseInt(normalized.slice(5, 7), 16);
  const a = parseInt(normalized.slice(7, 9), 16);
  return [r, g, b, a];
}

export function rgbaToHex(r, g, b, a = 255) {
  const toHex = (n) => n.toString(16).padStart(2, '0').toUpperCase();
  if (a === 255) {
    return `#${toHex(r)}${toHex(g)}${toHex(b)}`;
  }
  return `#${toHex(r)}${toHex(g)}${toHex(b)}${toHex(a)}`;
}

export function validatePalette(palette) {
  const errors = [];
  if (!Array.isArray(palette)) {
    return { valid: false, errors: ['palette debe ser un arreglo.'] };
  }
  if (palette.length === 0) {
    return { valid: false, errors: ['palette no puede estar vacío.'] };
  }
  
  const seen = new Set();
  const normalizedPalette = [];
  
  for (let i = 0; i < palette.length; i++) {
    const color = palette[i];
    const normalized = normalizeHexColor(color);
    if (!normalized) {
      errors.push(`El color "${color}" en el índice ${i} no es válido.`);
      normalizedPalette.push(null);
      continue;
    }
    
    const baseColor = normalized.endsWith('FF') ? normalized.slice(0, 7) : normalized;
    if (seen.has(baseColor)) {
      errors.push(`Color duplicado en la paleta: ${color}`);
    }
    seen.add(baseColor);
    normalizedPalette.push(normalized);
  }
  
  return {
    valid: errors.length === 0,
    errors,
    normalizedPalette
  };
}

export function validateTileMatrix(data, size, paletteLength) {
  const errors = [];
  if (!Array.isArray(data)) {
    return { valid: false, errors: ['data debe ser un arreglo bidimensional.'] };
  }
  
  if (data.length !== size) {
    errors.push(`La matriz contiene ${data.length} filas, pero se esperaban ${size}.`);
  }
  
  for (let y = 0; y < data.length; y++) {
    const row = data[y];
    if (!Array.isArray(row)) {
      errors.push(`La fila ${y} no es un arreglo.`);
      continue;
    }
    if (row.length !== size) {
      errors.push(`La fila ${y} contiene ${row.length} pixeles, pero se esperaban ${size}.`);
    }
    
    for (let x = 0; x < row.length; x++) {
      const val = row[x];
      if (!Number.isInteger(val) || val < 0) {
        errors.push(`Valor inválido en data[${y}][${x}]: debe ser entero no negativo.`);
      } else if (val >= paletteLength) {
        errors.push(`El índice ${val} en data[${y}][${x}] no existe en la paleta.`);
      }
    }
  }
  
  return {
    valid: errors.length === 0,
    errors
  };
}

export function validatePixelCoordinates(pixels, size) {
  const errors = [];
  if (!Array.isArray(pixels)) {
    return { valid: false, errors: ['pixels debe ser un arreglo.'] };
  }
  
  const seen = new Set();
  
  for (let i = 0; i < pixels.length; i++) {
    const p = pixels[i];
    if (!p || typeof p !== 'object') {
      errors.push(`El pixel en el índice ${i} es inválido.`);
      continue;
    }
    if (!Number.isInteger(p.x) || !Number.isInteger(p.y)) {
      errors.push(`El pixel en el índice ${i} tiene coordenadas x o y no enteras.`);
      continue;
    }
    if (p.x < 0 || p.x >= size || p.y < 0 || p.y >= size) {
      errors.push(`La coordenada x=${p.x}, y=${p.y} está fuera de un tile de ${size}x${size}.`);
      continue;
    }
    
    if (!normalizeHexColor(p.color)) {
      errors.push(`El color "${p.color}" en x=${p.x}, y=${p.y} no es válido.`);
    }
    
    const key = `${p.x},${p.y}`;
    if (seen.has(key)) {
      errors.push(`Coordenadas duplicadas en x=${p.x}, y=${p.y}.`);
    }
    seen.add(key);
  }
  
  if (seen.size !== size * size) {
    errors.push(`Se definieron ${seen.size} pixeles, pero se necesitan ${size * size}.`);
  }
  
  return {
    valid: errors.length === 0,
    errors
  };
}

export function pixelsToMatrix(pixels, size) {
  const uniqueColors = new Set();
  pixels.forEach(p => {
    const norm = normalizeHexColor(p.color);
    if (norm) {
      const base = norm.endsWith('FF') ? norm.slice(0, 7) : norm;
      uniqueColors.add(base);
    }
  });
  
  const palette = Array.from(uniqueColors);
  const colorToIndex = new Map(palette.map((c, i) => [c, i]));
  
  const data = Array.from({ length: size }, () => new Array(size).fill(0));
  
  pixels.forEach(p => {
    const norm = normalizeHexColor(p.color);
    if (norm) {
      const base = norm.endsWith('FF') ? norm.slice(0, 7) : norm;
      data[p.y][p.x] = colorToIndex.get(base);
    }
  });
  
  return { palette, data };
}

export function validateTileJson(jsonStr) {
  let parsed;
  try {
    parsed = JSON.parse(jsonStr);
  } catch (err) {
    return { valid: false, errors: ['El contenido no es un JSON válido.'] };
  }
  
  const errors = [];
  
  if (parsed.version !== 1) {
    errors.push(`version ${parsed.version} no soportada. Se esperaba 1.`);
  }
  if (parsed.type !== 'pixel-tile') {
    errors.push(`type debe ser "pixel-tile".`);
  }
  
  const allowedSizes = [8, 16, 32, 64];
  if (!allowedSizes.includes(parsed.size)) {
    errors.push(`Tamaño no permitido. size debe ser 8, 16, 32 o 64.`);
  }
  
  if (parsed.width !== parsed.size) {
    errors.push(`width (${parsed.width}) debe coincidir con size (${parsed.size}).`);
  }
  if (parsed.height !== parsed.size) {
    errors.push(`height (${parsed.height}) debe coincidir con size (${parsed.size}).`);
  }
  
  let palette = [];
  let data = [];
  
  if (parsed.data && parsed.palette) {
    const paletteValidation = validatePalette(parsed.palette);
    if (!paletteValidation.valid) {
      errors.push(...paletteValidation.errors);
    } else {
      palette = paletteValidation.normalizedPalette;
      const dataValidation = validateTileMatrix(parsed.data, parsed.size, palette.length);
      if (!dataValidation.valid) {
        errors.push(...dataValidation.errors);
      } else {
        data = parsed.data;
      }
    }
  } else if (parsed.pixels) {
    const pixelsValidation = validatePixelCoordinates(parsed.pixels, parsed.size);
    if (!pixelsValidation.valid) {
      errors.push(...pixelsValidation.errors);
    } else {
      const converted = pixelsToMatrix(parsed.pixels, parsed.size);
      palette = converted.palette;
      data = converted.data;
    }
  } else {
    errors.push(`El JSON debe contener 'data' y 'palette', o bien 'pixels'.`);
  }
  
  if (errors.length > 0) {
    return { valid: false, errors };
  }
  
  const tile = {
    ...parsed,
    palette,
    data
  };
  
  return { valid: true, tile };
}

export function validateSeamlessEdges(data) {
  const size = data.length;
  const errors = [];
  for (let y = 0; y < size; y++) {
    if (data[y][0] !== data[y][size - 1]) {
      errors.push({
        edge: "horizontal",
        position: y,
        message: `El borde izquierdo no coincide con el derecho en y=${y}.`
      });
    }
  }
  for (let x = 0; x < size; x++) {
    if (data[0][x] !== data[size - 1][x]) {
      errors.push({
        edge: "vertical",
        position: x,
        message: `El borde superior no coincide con el inferior en x=${x}.`
      });
    }
  }
  return {
    valid: errors.length === 0,
    errors
  };
}

export function enforceSeamlessEdges(data) {
  const result = data.map((row) => [...row]);
  const size = result.length;
  for (let y = 0; y < size; y++) {
    result[y][size - 1] = result[y][0];
  }
  for (let x = 0; x < size; x++) {
    result[size - 1][x] = result[0][x];
  }
  result[size - 1][size - 1] = result[0][0];
  return result;
}

export function matrixToPixels(data, palette) {
  const size = data.length;
  const pixels = new Uint8ClampedArray(size * size * 4);
  let idx = 0;
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const colorIndex = data[y][x];
      const hex = palette[colorIndex];
      const rgba = hexToRgba(hex);
      pixels[idx++] = rgba[0];
      pixels[idx++] = rgba[1];
      pixels[idx++] = rgba[2];
      pixels[idx++] = rgba[3];
    }
  }
  return pixels;
}

export function createPaletteFromPixels(pixels, size) {
  const uniqueColors = new Set();
  const colorMap = new Map();
  const palette = [];
  const data = Array.from({ length: size }, () => new Array(size).fill(0));
  
  let i = 0;
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const r = pixels[i++];
      const g = pixels[i++];
      const b = pixels[i++];
      const a = pixels[i++];
      
      const hex = rgbaToHex(r, g, b, a);
      let index = colorMap.get(hex);
      if (index === undefined) {
        index = palette.length;
        palette.push(hex);
        colorMap.set(hex, index);
      }
      data[y][x] = index;
    }
  }
  return { palette, data };
}

export function exportTileJson(name, pixels, size, description = "") {
  const { palette, data } = createPaletteFromPixels(pixels, size);
  const isSeamless = validateSeamlessEdges(data).valid;
  
  const tile = {
    version: 1,
    type: "pixel-tile",
    name: name || "untitled-tile",
    description,
    size: size,
    width: size,
    height: size,
    seamless: isSeamless,
    palette,
    data,
    metadata: {
      category: "custom",
      generator: "imported-or-manual"
    }
  };
  
  return JSON.stringify(tile, null, 2);
}

export function downloadTileJson(jsonStr, name, size) {
  const safeName = (name || "untitled").replace(/[^a-zA-Z0-9_-]/g, '-').toLowerCase();
  const filename = `tile-${safeName}-${size}x${size}.json`;
  
  const blob = new Blob([jsonStr], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

export async function copyTileJson(jsonStr) {
  try {
    await navigator.clipboard.writeText(jsonStr);
    return true;
  } catch (err) {
    return false;
  }
}
