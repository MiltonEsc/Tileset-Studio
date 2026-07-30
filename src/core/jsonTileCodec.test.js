import { test } from 'node:test'
import assert from 'node:assert'
import {
  validateTileJson,
  validateSeamlessEdges,
  enforceSeamlessEdges,
  createPaletteFromPixels,
  matrixToPixels
} from './jsonTileCodec.js'

test('Importar tiles 8x8 (valid)', () => {
  const json = {
    version: 1,
    type: "pixel-tile",
    name: "test",
    size: 8,
    width: 8,
    height: 8,
    seamless: true,
    palette: ["#111111", "#222222"],
    data: Array.from({length: 8}, () => Array(8).fill(0))
  };
  const res = validateTileJson(JSON.stringify(json));
  assert.strictEqual(res.valid, true);
});

test('Rechazar un tile 10x10', () => {
  const json = {
    version: 1,
    type: "pixel-tile",
    name: "test",
    size: 10,
    width: 10,
    height: 10,
    palette: ["#000000"],
    data: Array.from({length: 10}, () => Array(10).fill(0))
  };
  const res = validateTileJson(JSON.stringify(json));
  assert.strictEqual(res.valid, false);
  assert.ok(res.errors.some(e => e.includes('size debe ser 8, 16, 32 o 64')));
});

test('Rechazar una matriz incompleta', () => {
  const json = {
    version: 1,
    type: "pixel-tile",
    name: "test",
    size: 8,
    width: 8,
    height: 8,
    palette: ["#000000"],
    data: Array.from({length: 7}, () => Array(8).fill(0)) // Solo 7 filas
  };
  const res = validateTileJson(JSON.stringify(json));
  assert.strictEqual(res.valid, false);
  assert.ok(res.errors.some(e => e.includes('se esperaban 8')));
});

test('Rechazar un color inválido', () => {
  const json = {
    version: 1,
    type: "pixel-tile",
    name: "test",
    size: 8,
    width: 8,
    height: 8,
    palette: ["#ZZ4411"],
    data: Array.from({length: 8}, () => Array(8).fill(0))
  };
  const res = validateTileJson(JSON.stringify(json));
  assert.strictEqual(res.valid, false);
  assert.ok(res.errors.some(e => e.includes('no es válido')));
});

test('Rechazar índices inexistentes', () => {
  const json = {
    version: 1,
    type: "pixel-tile",
    name: "test",
    size: 8,
    width: 8,
    height: 8,
    palette: ["#000000"],
    data: Array.from({length: 8}, () => Array(8).fill(1)) // Indice 1 no existe
  };
  const res = validateTileJson(JSON.stringify(json));
  assert.strictEqual(res.valid, false);
  assert.ok(res.errors.some(e => e.includes('no existe en la paleta')));
});

test('Detectar coordenadas duplicadas en formato pixels', () => {
  const pixels = Array.from({length: 64}, (_, i) => ({ x: i % 8, y: Math.floor(i / 8), color: "#000000" }));
  pixels[1].x = 0; // Duplicado
  
  const json = {
    version: 1,
    type: "pixel-tile",
    name: "test",
    size: 8,
    width: 8,
    height: 8,
    pixels
  };
  const res = validateTileJson(JSON.stringify(json));
  assert.strictEqual(res.valid, false);
  assert.ok(res.errors.some(e => e.includes('Coordenadas duplicadas')));
});

test('Detectar bordes incompatibles (seamless)', () => {
  const data = Array.from({length: 8}, () => Array(8).fill(0));
  data[0][0] = 1; // Un color distinto
  
  const res = validateSeamlessEdges(data);
  assert.strictEqual(res.valid, false);
  assert.strictEqual(res.errors.length, 2);
});

test('Corregir los bordes', () => {
  let data = Array.from({length: 8}, () => Array(8).fill(0));
  data[4][0] = 1; // Falla en la fila 4
  
  let res = validateSeamlessEdges(data);
  assert.strictEqual(res.valid, false);
  
  const fixed = enforceSeamlessEdges(data);
  assert.strictEqual(fixed[4][7], 1); // Derecha copia a izquierda
  
  const check = validateSeamlessEdges(fixed);
  assert.strictEqual(check.valid, true);
});

test('Exportar e importar sin perder información', () => {
  const flatArray = new Uint8ClampedArray(8 * 8 * 4);
  flatArray[0] = 255; flatArray[3] = 255; // Red pixel at 0,0
  
  const { palette, data } = createPaletteFromPixels(flatArray, 8);
  assert.strictEqual(palette[0], '#FF0000'); // Assuming index 0 gets #FF0000
  
  const restored = matrixToPixels(data, palette);
  assert.deepStrictEqual(restored, flatArray);
});
