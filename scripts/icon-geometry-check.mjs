#!/usr/bin/env node
/**
 * The brand assets have the dimensions, format, alpha and geometry they claim.
 *
 *   node scripts/icon-geometry-check.mjs           # check against the contract
 *   node scripts/icon-geometry-check.mjs --json    # print the measurements
 *
 * WHY IT MEASURES INSTEAD OF HASHING. `scripts/derive-brand-assets.ps1`
 * regenerates these files from the two brand originals, so a byte hash changes
 * whenever the encoder does and says nothing about whether the mark moved. What
 * has to hold is geometric: the symbol keeps its size relative to the canvas
 * and stays centred, whatever resolution the file is written at. That is what
 * makes it safe to re-derive an asset at a different size - F8.A2 took the
 * Android foreground from 512 to 1024 - and it is what this proves.
 *
 * WHY IT DECODES THE PNG BY HAND. Reading a bounding box needs the alpha
 * channel, and an image library is a dependency this repository has not
 * approved for a check that runs a few times a phase. PNG's own container plus
 * `node:zlib` is enough: chunks, one inflate, and the five scanline filters.
 *
 * WHAT IT DOES NOT COVER. Everything a person has to look at: the mark on a
 * crowded launcher, the adaptive mask, the Android 13 themed icon and the
 * splash on a real device. That is F8.A3, and no amount of arithmetic replaces
 * it.
 */
import { readFileSync } from 'node:fs';
import { inflateSync } from 'node:zlib';

const COLOR_TYPES = { 0: 'grayscale', 2: 'RGB', 3: 'palette', 4: 'gray+alpha', 6: 'RGBA' };
const CHANNELS = { 0: 1, 2: 3, 3: 1, 4: 2, 6: 4 };

/** Alpha under this is treated as background; the marks are hard-edged. */
const ALPHA_FLOOR = 8;

function decode(file) {
  const bytes = readFileSync(file);
  const width = bytes.readUInt32BE(16);
  const height = bytes.readUInt32BE(20);
  const bitDepth = bytes[24];
  const colorType = bytes[25];

  const parts = [];
  let hasTrns = false;
  let offset = 8;
  while (offset < bytes.length - 8) {
    const length = bytes.readUInt32BE(offset);
    const type = bytes.toString('ascii', offset + 4, offset + 8);
    if (type === 'IDAT') parts.push(bytes.subarray(offset + 8, offset + 8 + length));
    if (type === 'tRNS') hasTrns = true;
    if (type === 'IEND') break;
    offset += 12 + length;
  }

  return { width, height, bitDepth, colorType, hasTrns, idat: Buffer.concat(parts) };
}

/** Un-filters the scanlines. PNG's five filters, nothing more exotic. */
function pixels(png) {
  if (png.bitDepth !== 8) throw new Error(`solo 8 bits por canal, no ${png.bitDepth}`);
  if (png.colorType === 3) throw new Error('las imagenes con paleta no se miden aqui');

  const bpp = CHANNELS[png.colorType];
  const stride = png.width * bpp;
  const raw = inflateSync(png.idat);
  const out = Buffer.alloc(png.height * stride);

  for (let y = 0; y < png.height; y += 1) {
    const filter = raw[y * (stride + 1)];
    const line = raw.subarray(y * (stride + 1) + 1, y * (stride + 1) + 1 + stride);
    const target = out.subarray(y * stride, (y + 1) * stride);
    const previous = y === 0 ? null : out.subarray((y - 1) * stride, y * stride);

    for (let x = 0; x < stride; x += 1) {
      const left = x >= bpp ? target[x - bpp] : 0;
      const up = previous === null ? 0 : previous[x];
      const upLeft = previous === null || x < bpp ? 0 : previous[x - bpp];
      const value = line[x];

      let restored;
      if (filter === 0) restored = value;
      else if (filter === 1) restored = value + left;
      else if (filter === 2) restored = value + up;
      else if (filter === 3) restored = value + ((left + up) >> 1);
      else if (filter === 4) {
        const p = left + up - upLeft;
        const dl = Math.abs(p - left);
        const du = Math.abs(p - up);
        const dul = Math.abs(p - upLeft);
        const predictor = dl <= du && dl <= dul ? left : du <= dul ? up : upLeft;
        restored = value + predictor;
      } else throw new Error(`filtro PNG desconocido: ${filter}`);

      target[x] = restored & 0xff;
    }
  }

  return { data: out, bpp, stride };
}

/** The mark's bounding box in alpha, as fractions of the canvas. */
function geometry(png) {
  if (CHANNELS[png.colorType] !== 4 && CHANNELS[png.colorType] !== 2) return null;

  const { data, bpp, stride } = pixels(png);
  let minX = png.width;
  let minY = png.height;
  let maxX = -1;
  let maxY = -1;

  for (let y = 0; y < png.height; y += 1) {
    for (let x = 0; x < png.width; x += 1) {
      if (data[y * stride + x * bpp + (bpp - 1)] <= ALPHA_FLOOR) continue;
      if (x < minX) minX = x;
      if (x > maxX) maxX = x;
      if (y < minY) minY = y;
      if (y > maxY) maxY = y;
    }
  }

  if (maxX < 0) return null;

  const boxWidth = maxX - minX + 1;
  const boxHeight = maxY - minY + 1;

  return {
    widthFraction: boxWidth / png.width,
    heightFraction: boxHeight / png.height,
    // 0.5 means perfectly centred. This is what catches a mark that kept its
    // size and drifted, which a fraction alone would not.
    centerX: (minX + maxX + 1) / 2 / png.width,
    centerY: (minY + maxY + 1) / 2 / png.height,
    aspect: boxWidth / boxHeight,
  };
}

function measure(file) {
  const png = decode(file);
  return {
    file,
    width: png.width,
    height: png.height,
    bitDepth: png.bitDepth,
    format: COLOR_TYPES[png.colorType] ?? String(png.colorType),
    alpha: CHANNELS[png.colorType] === 4 || CHANNELS[png.colorType] === 2 || png.hasTrns,
    geometry: geometry(png),
  };
}

/**
 * The contract. `widthFraction` is the mark's share of the canvas, and it is
 * the number that must survive a change of resolution.
 *
 * The tolerance is a pixel's worth at the smallest canvas here (432), which is
 * what rounding the same geometry onto a different grid can move it by.
 */
const TOLERANCE = 1 / 432;

const EXPECTED = [
  {
    file: 'assets/icons/icon.png',
    width: 1024,
    height: 1024,
    format: 'RGB',
    alpha: false,
    why: 'el icono de iOS no puede llevar canal alfa',
  },
  {
    file: 'assets/icons/android-icon-foreground.png',
    width: 1024,
    height: 1024,
    format: 'RGBA',
    alpha: true,
    // 0.54, no 0.60: la zona segura permite 0.60, pero visto en el lanzador de
    // un aparato real el simbolo leia grande dentro de su circulo. Un decimo
    // menos, decidido mirando, no calculando. F8.A3.
    widthFraction: 0.54,
    centered: true,
    why: 'primer plano del icono adaptativo, un 10% por dentro de la zona segura',
  },
  {
    file: 'assets/icons/android-icon-monochrome.png',
    width: 432,
    height: 432,
    format: 'RGBA',
    alpha: true,
    // La MISMA fraccion que el primer plano, y no por casualidad: el icono
    // tematico es este icono en otro modo. Si difirieran, un lanzador que
    // alterna entre los dos mostraria la marca cambiando de tamano.
    widthFraction: 0.54,
    centered: true,
    why: 'icono tematico de Android 13+, misma silueta y la misma fraccion',
  },
  {
    file: 'assets/splash/splash-icon.png',
    width: 512,
    height: 512,
    format: 'RGBA',
    alpha: true,
    widthFraction: 0.92,
    centered: true,
    why: 'marca del splash, sobre el negro del tema',
  },
];

const measurements = EXPECTED.map((expected) => measure(expected.file));

if (process.argv.includes('--json')) {
  console.log(JSON.stringify(measurements, null, 2));
  process.exit(0);
}

let failures = 0;
const fail = (message) => {
  failures += 1;
  console.log(`  FALLO: ${message}`);
};
const ok = (message) => console.log(`  ok: ${message}`);

console.log('\n=== Dimensiones, formato y alfa ===');
for (const [index, expected] of EXPECTED.entries()) {
  const actual = measurements[index];
  const wrong = [];
  if (actual.width !== expected.width || actual.height !== expected.height) {
    wrong.push(`${actual.width}x${actual.height}`);
  }
  if (actual.format !== expected.format) wrong.push(`formato ${actual.format}`);
  if (actual.alpha !== expected.alpha) wrong.push(`alfa ${actual.alpha}`);
  if (actual.bitDepth !== 8) wrong.push(`${actual.bitDepth} bits`);

  if (wrong.length > 0) fail(`${expected.file}: ${wrong.join(' · ')}`);
  else ok(`${expected.file} — ${actual.width}x${actual.height} ${actual.format} — ${expected.why}`);
}

console.log('\n=== Geometria relativa: el simbolo ocupa lo mismo y sigue centrado ===');
for (const [index, expected] of EXPECTED.entries()) {
  if (expected.widthFraction === undefined) {
    ok(`${expected.file}: sin alfa, no hay caja que medir`);
    continue;
  }

  const actual = measurements[index].geometry;
  if (actual === null) {
    fail(`${expected.file}: no hay ningun pixel opaco`);
    continue;
  }

  const wrong = [];
  const larger = Math.max(actual.widthFraction, actual.heightFraction);
  if (Math.abs(larger - expected.widthFraction) > TOLERANCE) {
    wrong.push(
      `ocupa ${(larger * 100).toFixed(2)}% y deberia ocupar ${expected.widthFraction * 100}%`,
    );
  }
  if (expected.centered) {
    if (Math.abs(actual.centerX - 0.5) > TOLERANCE)
      wrong.push(`centro X ${actual.centerX.toFixed(4)}`);
    if (Math.abs(actual.centerY - 0.5) > TOLERANCE)
      wrong.push(`centro Y ${actual.centerY.toFixed(4)}`);
  }

  if (wrong.length > 0) fail(`${expected.file}: ${wrong.join(' · ')}`);
  else {
    ok(
      `${expected.file} — ocupa ${(larger * 100).toFixed(2)}% del lienzo, centro ` +
        `(${actual.centerX.toFixed(4)}, ${actual.centerY.toFixed(4)}), aspecto ${actual.aspect.toFixed(4)}`,
    );
  }
}

console.log('');
if (failures === 0) {
  console.log('OK - los cuatro assets tienen su forma, su alfa y su geometria.');
  process.exit(0);
}
console.log(`${failures} comprobacion/es fallidas.`);
process.exit(1);
