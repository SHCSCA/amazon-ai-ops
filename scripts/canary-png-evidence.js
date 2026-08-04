const fs = require('node:fs');
const crypto = require('node:crypto');
const zlib = require('node:zlib');

const PNG_SIGNATURE = Buffer.from('89504E470D0A1A0A', 'hex');
// A real execution canary is captured from the visible desktop browser. The
// application and formal package evidence both support a 1200x700 minimum
// viewport, so thumbnails and cropped fragments are not production evidence.
// This is deliberately fail-closed for historical v1 manifests: weak legacy
// screenshots must be recaptured, not grandfathered or silently upgraded.
const PNG_EVIDENCE_MIN_WIDTH = 1200;
const PNG_EVIDENCE_MIN_HEIGHT = 700;
const PNG_EVIDENCE_MAX_FILE_BYTES = 64 * 1024 * 1024;
const PNG_EVIDENCE_MAX_PIXELS = 50_000_000;
const PNG_EVIDENCE_MAX_INFLATED_BYTES = 256 * 1024 * 1024;
const PNG_EVIDENCE_MAX_CHUNKS = 2_048;
const PNG_EVIDENCE_MAX_IDAT_CHUNKS = 512;
const KNOWN_CRITICAL_CHUNKS = new Set(['IHDR', 'PLTE', 'IDAT', 'IEND']);
const VALID_BIT_DEPTHS = new Map([
  [0, new Set([1, 2, 4, 8, 16])],
  [2, new Set([8, 16])],
  [3, new Set([1, 2, 4, 8])],
  [4, new Set([8, 16])],
  [6, new Set([8, 16])],
]);
const CHANNELS_BY_COLOR_TYPE = new Map([
  [0, 1],
  [2, 3],
  [3, 1],
  [4, 2],
  [6, 4],
]);

const CRC_TABLE = new Uint32Array(256);
for (let index = 0; index < CRC_TABLE.length; index += 1) {
  let value = index;
  for (let bit = 0; bit < 8; bit += 1) {
    value = (value & 1) !== 0
      ? (0xEDB88320 ^ (value >>> 1))
      : (value >>> 1);
  }
  CRC_TABLE[index] = value >>> 0;
}

class PngEvidenceValidationError extends Error {
  constructor(message) {
    super(message);
    this.name = 'PngEvidenceValidationError';
  }
}

function fail(message) {
  throw new PngEvidenceValidationError(message);
}

function crc32(buffers) {
  let crc = 0xFFFFFFFF;
  for (const buffer of buffers) {
    for (const byte of buffer) {
      crc = CRC_TABLE[(crc ^ byte) & 0xFF] ^ (crc >>> 8);
    }
  }
  return (crc ^ 0xFFFFFFFF) >>> 0;
}

function paethPredictor(left, above, upperLeft) {
  const estimate = left + above - upperLeft;
  const leftDistance = Math.abs(estimate - left);
  const aboveDistance = Math.abs(estimate - above);
  const upperLeftDistance = Math.abs(estimate - upperLeft);
  if (leftDistance <= aboveDistance && leftDistance <= upperLeftDistance) return left;
  if (aboveDistance <= upperLeftDistance) return above;
  return upperLeft;
}

function calculateScanlineLayout(width, height, bitsPerPixel) {
  const rowBits = width * bitsPerPixel;
  if (!Number.isSafeInteger(rowBits)) fail('decoded image row size is not a safe integer');
  const scanlineBytes = Math.ceil(rowBits / 8);
  const expectedBytes = height * (scanlineBytes + 1);
  if (!Number.isSafeInteger(expectedBytes)
    || expectedBytes > PNG_EVIDENCE_MAX_INFLATED_BYTES) {
    fail(`decoded image data exceeds the ${PNG_EVIDENCE_MAX_INFLATED_BYTES}-byte safety limit`);
  }
  return { expectedBytes, scanlineBytes };
}

function validateIndexedSamples(decoded, width, bitDepth, paletteEntries, rowIndex) {
  const mask = (1 << bitDepth) - 1;
  for (let pixelIndex = 0; pixelIndex < width; pixelIndex += 1) {
    const bitOffset = pixelIndex * bitDepth;
    const byteIndex = Math.floor(bitOffset / 8);
    const shift = 8 - bitDepth - (bitOffset % 8);
    const paletteIndex = (decoded[byteIndex] >>> shift) & mask;
    if (paletteIndex >= paletteEntries) {
      fail(
        `indexed scanline ${rowIndex} references palette entry ${paletteIndex}; `
        + `PLTE only defines ${paletteEntries} entries`,
      );
    }
  }
}

function decodeScanlines(
  inflated,
  width,
  height,
  bitsPerPixel,
  { colorType, bitDepth, paletteEntries },
) {
  const { expectedBytes, scanlineBytes } = calculateScanlineLayout(
    width,
    height,
    bitsPerPixel,
  );
  if (inflated.length !== expectedBytes) {
    fail(`decoded IDAT length is ${inflated.length} bytes; expected exactly ${expectedBytes}`);
  }

  const bytesPerPixel = Math.max(1, Math.ceil(bitsPerPixel / 8));
  let previous = Buffer.alloc(scanlineBytes);
  let cursor = 0;
  for (let rowIndex = 0; rowIndex < height; rowIndex += 1) {
    const filter = inflated[cursor];
    cursor += 1;
    if (filter > 4) fail(`scanline ${rowIndex} uses unsupported PNG filter ${filter}`);
    const encoded = inflated.subarray(cursor, cursor + scanlineBytes);
    cursor += scanlineBytes;
    const decoded = Buffer.allocUnsafe(scanlineBytes);
    for (let column = 0; column < scanlineBytes; column += 1) {
      const left = column >= bytesPerPixel ? decoded[column - bytesPerPixel] : 0;
      const above = previous[column] || 0;
      const upperLeft = column >= bytesPerPixel ? previous[column - bytesPerPixel] : 0;
      let predictor = 0;
      if (filter === 1) predictor = left;
      if (filter === 2) predictor = above;
      if (filter === 3) predictor = Math.floor((left + above) / 2);
      if (filter === 4) predictor = paethPredictor(left, above, upperLeft);
      decoded[column] = (encoded[column] + predictor) & 0xFF;
    }
    if (colorType === 3) {
      validateIndexedSamples(decoded, width, bitDepth, paletteEntries, rowIndex);
    }
    previous = decoded;
  }
}

function inspectPngEvidenceBytes(bytes) {
  if (!Buffer.isBuffer(bytes)) fail('artifact bytes must be a Buffer');
  if (bytes.length > PNG_EVIDENCE_MAX_FILE_BYTES) {
    fail(`PNG artifact exceeds the ${PNG_EVIDENCE_MAX_FILE_BYTES}-byte file safety limit`);
  }
  if (bytes.length < PNG_SIGNATURE.length || !bytes.subarray(0, 8).equals(PNG_SIGNATURE)) {
    fail('PNG signature is missing or invalid');
  }

  let cursor = PNG_SIGNATURE.length;
  let chunkCount = 0;
  let ihdr = null;
  let paletteEntries = null;
  let idatStarted = false;
  let idatEnded = false;
  let iendSeen = false;
  const idatParts = [];
  let totalIdatBytes = 0;

  while (cursor < bytes.length) {
    chunkCount += 1;
    if (chunkCount > PNG_EVIDENCE_MAX_CHUNKS) {
      fail(`PNG contains more than ${PNG_EVIDENCE_MAX_CHUNKS} chunks`);
    }
    if (bytes.length - cursor < 12) fail('PNG is truncated before a complete chunk header and CRC');
    const length = bytes.readUInt32BE(cursor);
    const chunkEnd = cursor + 12 + length;
    if (!Number.isSafeInteger(chunkEnd) || chunkEnd > bytes.length) {
      fail('PNG chunk length extends beyond the artifact bytes');
    }
    const typeBytes = bytes.subarray(cursor + 4, cursor + 8);
    const type = typeBytes.toString('ascii');
    if (!/^[A-Za-z]{4}$/.test(type)) fail('PNG chunk type is invalid');
    const data = bytes.subarray(cursor + 8, cursor + 8 + length);
    const expectedCrc = bytes.readUInt32BE(cursor + 8 + length);
    const actualCrc = crc32([typeBytes, data]);
    if (actualCrc !== expectedCrc) fail(`${type} chunk CRC is invalid`);

    if (chunkCount === 1 && type !== 'IHDR') fail('IHDR must be the first PNG chunk');
    if ((type.charCodeAt(0) & 0x20) === 0 && !KNOWN_CRITICAL_CHUNKS.has(type)) {
      fail(`unknown critical PNG chunk ${type} is not decodable`);
    }

    if (type === 'IHDR') {
      if (ihdr) fail('PNG contains more than one IHDR chunk');
      if (length !== 13) fail('IHDR chunk must contain exactly 13 bytes');
      const width = data.readUInt32BE(0);
      const height = data.readUInt32BE(4);
      const bitDepth = data[8];
      const colorType = data[9];
      const compressionMethod = data[10];
      const filterMethod = data[11];
      const interlaceMethod = data[12];
      if (width < PNG_EVIDENCE_MIN_WIDTH || height < PNG_EVIDENCE_MIN_HEIGHT) {
        fail(`image dimensions ${width}x${height} are below the ${PNG_EVIDENCE_MIN_WIDTH}x${PNG_EVIDENCE_MIN_HEIGHT} evidence minimum`);
      }
      if (width * height > PNG_EVIDENCE_MAX_PIXELS) {
        fail(`image dimensions ${width}x${height} exceed the ${PNG_EVIDENCE_MAX_PIXELS}-pixel safety limit`);
      }
      if (!VALID_BIT_DEPTHS.get(colorType)?.has(bitDepth)) {
        fail(`IHDR bit depth ${bitDepth} is invalid for color type ${colorType}`);
      }
      if (compressionMethod !== 0 || filterMethod !== 0) {
        fail('IHDR uses an unsupported compression or filter method');
      }
      if (interlaceMethod !== 0) {
        fail('interlaced PNG evidence is not supported; capture a standard non-interlaced screenshot');
      }
      ihdr = { width, height, bitDepth, colorType };
    } else if (type === 'PLTE') {
      if (!ihdr || idatStarted) fail('PLTE must appear after IHDR and before IDAT');
      if (paletteEntries !== null) fail('PNG contains more than one PLTE chunk');
      if (length === 0 || length % 3 !== 0 || length > 768) fail('PLTE length is invalid');
      if (ihdr.colorType === 0 || ihdr.colorType === 4) fail('PLTE is not valid for this PNG color type');
      paletteEntries = length / 3;
      if (ihdr.colorType === 3 && paletteEntries > 2 ** ihdr.bitDepth) {
        fail('PLTE contains more entries than the indexed bit depth permits');
      }
    } else if (type === 'IDAT') {
      if (!ihdr) fail('IDAT appears before IHDR');
      if (idatEnded) fail('IDAT chunks must be consecutive');
      if (idatParts.length >= PNG_EVIDENCE_MAX_IDAT_CHUNKS) {
        fail(`PNG contains more than ${PNG_EVIDENCE_MAX_IDAT_CHUNKS} IDAT chunks`);
      }
      totalIdatBytes += data.length;
      if (!Number.isSafeInteger(totalIdatBytes)
        || totalIdatBytes > PNG_EVIDENCE_MAX_FILE_BYTES) {
        fail('PNG IDAT byte count exceeds the bounded artifact size');
      }
      idatStarted = true;
      idatParts.push(data);
    } else if (type === 'IEND') {
      if (!ihdr) fail('IEND appears before IHDR');
      if (length !== 0) fail('IEND chunk must be empty');
      if (iendSeen) fail('PNG contains more than one IEND chunk');
      iendSeen = true;
      cursor = chunkEnd;
      if (cursor !== bytes.length) fail('PNG contains trailing bytes after IEND');
      break;
    } else if (idatStarted) {
      idatEnded = true;
    }

    cursor = chunkEnd;
  }

  if (!ihdr) fail('PNG has no IHDR chunk');
  if (idatParts.length === 0) fail('PNG has no IDAT image-data chunk');
  if (!iendSeen) fail('PNG has no complete IEND chunk');
  if (ihdr.colorType === 3 && paletteEntries === null) fail('indexed PNG has no PLTE chunk');

  const channels = CHANNELS_BY_COLOR_TYPE.get(ihdr.colorType);
  const bitsPerPixel = channels * ihdr.bitDepth;
  const { expectedBytes } = calculateScanlineLayout(
    ihdr.width,
    ihdr.height,
    bitsPerPixel,
  );
  const compressed = Buffer.concat(idatParts, totalIdatBytes);
  let inflateResult;
  try {
    inflateResult = zlib.inflateSync(compressed, {
      info: true,
      maxOutputLength: Math.min(
        PNG_EVIDENCE_MAX_INFLATED_BYTES,
        expectedBytes + 1,
      ),
    });
  } catch (error) {
    fail(`IDAT image data cannot be decoded: ${error instanceof Error ? error.message : String(error)}`);
  }
  const inflated = Buffer.isBuffer(inflateResult) ? inflateResult : inflateResult?.buffer;
  const consumedInputBytes = Number(inflateResult?.engine?.bytesWritten);
  if (!Buffer.isBuffer(inflated) || !Number.isSafeInteger(consumedInputBytes)) {
    fail('IDAT decoder did not expose a complete bounded zlib consumption proof');
  }
  if (consumedInputBytes !== compressed.length) {
    fail(
      `IDAT zlib stream consumed ${consumedInputBytes} of ${compressed.length} bytes; `
      + 'trailing data or a second compressed stream is not allowed',
    );
  }
  decodeScanlines(inflated, ihdr.width, ihdr.height, bitsPerPixel, {
    colorType: ihdr.colorType,
    bitDepth: ihdr.bitDepth,
    paletteEntries,
  });
  return Object.freeze({
    width: ihdr.width,
    height: ihdr.height,
    bitDepth: ihdr.bitDepth,
    colorType: ihdr.colorType,
    chunkCount,
    idatChunks: idatParts.length,
    sizeBytes: bytes.length,
  });
}

function normalizedStatTimeNs(stat, key) {
  const nanoseconds = stat?.[`${key}Ns`];
  if (typeof nanoseconds === 'bigint') return nanoseconds.toString();
  const milliseconds = Number(stat?.[`${key}Ms`]);
  return Number.isFinite(milliseconds)
    ? BigInt(Math.round(milliseconds * 1_000_000)).toString()
    : null;
}

function fileStatProof(stat) {
  return Object.freeze({
    dev: String(stat.dev),
    ino: String(stat.ino),
    mode: String(stat.mode),
    nlink: Number(stat.nlink),
    sizeBytes: Number(stat.size),
    mtimeNs: normalizedStatTimeNs(stat, 'mtime'),
    ctimeNs: normalizedStatTimeNs(stat, 'ctime'),
  });
}

function sameFileStatProof(left, right) {
  return left.dev === right.dev
    && left.ino === right.ino
    && left.mode === right.mode
    && left.nlink === right.nlink
    && left.sizeBytes === right.sizeBytes
    && left.mtimeNs === right.mtimeNs
    && left.ctimeNs === right.ctimeNs;
}

function inspectPngEvidenceFile(filePath, injectedContext = {}) {
  const fsImpl = injectedContext.fsImpl ?? fs;
  const afterBoundedRead = injectedContext.afterBoundedRead ?? null;
  if (afterBoundedRead !== null && typeof afterBoundedRead !== 'function') {
    fail('afterBoundedRead must be null or a function');
  }
  let descriptor;
  try {
    descriptor = fsImpl.openSync(filePath, 'r');
    const beforeStat = fsImpl.fstatSync(descriptor, { bigint: true });
    if (!beforeStat.isFile()) fail('PNG artifact is not a regular file');
    if (beforeStat.nlink !== 1n) fail('PNG artifact must have exactly one filesystem link');
    if (beforeStat.size < 1n || beforeStat.size > BigInt(PNG_EVIDENCE_MAX_FILE_BYTES)) {
      fail(`PNG artifact exceeds the ${PNG_EVIDENCE_MAX_FILE_BYTES}-byte file safety limit`);
    }
    const sizeBytes = Number(beforeStat.size);
    if (!Number.isSafeInteger(sizeBytes)) fail('PNG artifact size is not a safe integer');

    const bytes = Buffer.alloc(sizeBytes);
    let offset = 0;
    while (offset < sizeBytes) {
      const readBytes = fsImpl.readSync(
        descriptor,
        bytes,
        offset,
        sizeBytes - offset,
        offset,
      );
      if (readBytes === 0) fail('PNG artifact was truncated during its bounded read');
      offset += readBytes;
    }
    const growthProbe = Buffer.alloc(1);
    if (fsImpl.readSync(descriptor, growthProbe, 0, 1, sizeBytes) !== 0) {
      fail('PNG artifact grew during its bounded read');
    }
    if (afterBoundedRead) afterBoundedRead({ descriptor, filePath });

    const afterStat = fsImpl.fstatSync(descriptor, { bigint: true });
    const pathStat = fsImpl.statSync(filePath, { bigint: true });
    const beforeProof = fileStatProof(beforeStat);
    const afterProof = fileStatProof(afterStat);
    const pathProof = fileStatProof(pathStat);
    if (!sameFileStatProof(beforeProof, afterProof)
      || !sameFileStatProof(afterProof, pathProof)) {
      fail('PNG artifact identity, size, or modification time changed during its bounded read');
    }

    const inspection = inspectPngEvidenceBytes(bytes);
    return Object.freeze({
      ...inspection,
      sha256: crypto.createHash('sha256').update(bytes).digest('hex').toUpperCase(),
      fileIdentity: Object.freeze({
        dev: beforeProof.dev,
        ino: beforeProof.ino,
      }),
      mtimeNs: beforeProof.mtimeNs,
      ctimeNs: beforeProof.ctimeNs,
    });
  } finally {
    if (descriptor !== undefined) fsImpl.closeSync(descriptor);
  }
}

module.exports = {
  PNG_EVIDENCE_MAX_CHUNKS,
  PNG_EVIDENCE_MAX_FILE_BYTES,
  PNG_EVIDENCE_MAX_IDAT_CHUNKS,
  PNG_EVIDENCE_MAX_INFLATED_BYTES,
  PNG_EVIDENCE_MAX_PIXELS,
  PNG_EVIDENCE_MIN_HEIGHT,
  PNG_EVIDENCE_MIN_WIDTH,
  PngEvidenceValidationError,
  inspectPngEvidenceBytes,
  inspectPngEvidenceFile,
};
