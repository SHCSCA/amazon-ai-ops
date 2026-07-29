import fs from 'node:fs';
import crypto from 'node:crypto';
import os from 'node:os';
import path from 'node:path';
import zlib from 'node:zlib';
import { createRequire } from 'node:module';
import { describe, expect, it } from 'vitest';

const {
  PNG_EVIDENCE_MAX_CHUNKS,
  PNG_EVIDENCE_MAX_FILE_BYTES,
  PNG_EVIDENCE_MAX_IDAT_CHUNKS,
  PNG_EVIDENCE_MIN_HEIGHT,
  PNG_EVIDENCE_MIN_WIDTH,
  inspectPngEvidenceBytes,
  inspectPngEvidenceFile,
} = createRequire(import.meta.url)('./canary-png-evidence.js');

const PNG_SIGNATURE = Buffer.from('89504E470D0A1A0A', 'hex');
const CRC_TABLE = new Uint32Array(256);
for (let index = 0; index < CRC_TABLE.length; index += 1) {
  let value = index;
  for (let bit = 0; bit < 8; bit += 1) {
    value = (value & 1) !== 0 ? (0xEDB88320 ^ (value >>> 1)) : (value >>> 1);
  }
  CRC_TABLE[index] = value >>> 0;
}

function crc32(buffer) {
  let crc = 0xFFFFFFFF;
  for (const byte of buffer) crc = CRC_TABLE[(crc ^ byte) & 0xFF] ^ (crc >>> 8);
  return (crc ^ 0xFFFFFFFF) >>> 0;
}

function pngChunk(type, data = Buffer.alloc(0)) {
  const typeBytes = Buffer.from(type, 'ascii');
  const chunk = Buffer.alloc(12 + data.length);
  chunk.writeUInt32BE(data.length, 0);
  typeBytes.copy(chunk, 4);
  data.copy(chunk, 8);
  chunk.writeUInt32BE(crc32(Buffer.concat([typeBytes, data])), 8 + data.length);
  return chunk;
}

function pngBytes({
  width = PNG_EVIDENCE_MIN_WIDTH,
  height = PNG_EVIDENCE_MIN_HEIGHT,
  gray = 96,
  idatData = null,
  includeIdat = true,
  includeIend = true,
} = {}) {
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8;
  ihdr[9] = 0;
  const raw = Buffer.alloc((width + 1) * height);
  for (let row = 0; row < height; row += 1) {
    const offset = row * (width + 1);
    raw[offset] = 0;
    raw.fill(gray, offset + 1, offset + width + 1);
  }
  return Buffer.concat([
    PNG_SIGNATURE,
    pngChunk('IHDR', ihdr),
    ...(includeIdat ? [pngChunk('IDAT', idatData ?? zlib.deflateSync(raw))] : []),
    ...(includeIend ? [pngChunk('IEND')] : []),
  ]);
}

function pngWithChunks({
  width = PNG_EVIDENCE_MIN_WIDTH,
  height = PNG_EVIDENCE_MIN_HEIGHT,
  bitDepth = 8,
  colorType = 0,
  chunks = [],
  idatParts = [],
}) {
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = bitDepth;
  ihdr[9] = colorType;
  return Buffer.concat([
    PNG_SIGNATURE,
    pngChunk('IHDR', ihdr),
    ...chunks,
    ...idatParts.map((part) => pngChunk('IDAT', part)),
    pngChunk('IEND'),
  ]);
}

describe('canary PNG evidence contract', () => {
  it('accepts a complete decodable screenshot at the 1200x700 desktop evidence minimum', () => {
    const bytes = pngBytes();

    expect(inspectPngEvidenceBytes(bytes)).toMatchObject({
      width: 1200,
      height: 700,
      bitDepth: 8,
      colorType: 0,
      idatChunks: 1,
      sizeBytes: bytes.length,
    });
  });

  it('rejects a 1x1 thumbnail even when every PNG chunk is otherwise valid', () => {
    expect(() => inspectPngEvidenceBytes(pngBytes({ width: 1, height: 1 })))
      .toThrow(/1x1.*below the 1200x700 evidence minimum/i);
  });

  it('rejects truncated PNG bytes', () => {
    const valid = pngBytes();
    expect(() => inspectPngEvidenceBytes(valid.subarray(0, valid.length - 5)))
      .toThrow(/truncated|extends beyond/i);
  });

  it('rejects a bad chunk CRC before crediting image bytes', () => {
    const corrupted = Buffer.from(pngBytes());
    const idatTypeOffset = corrupted.indexOf(Buffer.from('IDAT', 'ascii'));
    corrupted[idatTypeOffset + 4] ^= 0x01;

    expect(() => inspectPngEvidenceBytes(corrupted)).toThrow(/IDAT chunk CRC is invalid/i);
  });

  it('rejects PNG structures with no IDAT or no complete IEND', () => {
    expect(() => inspectPngEvidenceBytes(pngBytes({ includeIdat: false })))
      .toThrow(/no IDAT/i);
    expect(() => inspectPngEvidenceBytes(pngBytes({ includeIend: false })))
      .toThrow(/no complete IEND/i);
  });

  it('rejects CRC-valid IDAT bytes that cannot be decoded', () => {
    expect(() => inspectPngEvidenceBytes(pngBytes({ idatData: Buffer.from('not-zlib') })))
      .toThrow(/IDAT image data cannot be decoded/i);
  });

  it('rejects bytes appended after a valid IEND', () => {
    expect(() => inspectPngEvidenceBytes(Buffer.concat([pngBytes(), Buffer.from('trailing')])))
      .toThrow(/trailing bytes after IEND/i);
  });

  it('accepts a Chromium-equivalent 8-bit truecolor PNG with multiple IDAT chunks and filters 1/2/4', () => {
    const width = PNG_EVIDENCE_MIN_WIDTH;
    const height = PNG_EVIDENCE_MIN_HEIGHT;
    const scanlineBytes = width * 3;
    const raw = Buffer.alloc((scanlineBytes + 1) * height);
    const filters = [1, 2, 4];
    for (let row = 0; row < height; row += 1) {
      raw[row * (scanlineBytes + 1)] = filters[row % filters.length];
    }
    const compressed = zlib.deflateSync(raw);
    const splitA = Math.floor(compressed.length / 3);
    const splitB = Math.floor((compressed.length * 2) / 3);
    const bytes = pngWithChunks({
      width,
      height,
      colorType: 2,
      idatParts: [
        compressed.subarray(0, splitA),
        compressed.subarray(splitA, splitB),
        compressed.subarray(splitB),
      ],
    });

    expect(inspectPngEvidenceBytes(bytes)).toMatchObject({
      width,
      height,
      bitDepth: 8,
      colorType: 2,
      idatChunks: 3,
    });
  });

  it.each([
    ['trailing bytes', (stream) => Buffer.concat([stream, Buffer.from('tail')])],
    ['a second zlib stream', (stream) => Buffer.concat([stream, stream])],
  ])('rejects IDAT containing %s after the first complete zlib stream', (_label, mutate) => {
    const width = PNG_EVIDENCE_MIN_WIDTH;
    const height = PNG_EVIDENCE_MIN_HEIGHT;
    const raw = Buffer.alloc((width + 1) * height);
    const stream = zlib.deflateSync(raw);

    expect(() => inspectPngEvidenceBytes(pngBytes({ idatData: mutate(stream) })))
      .toThrow(/trailing data|second compressed stream|consumed .* of .* bytes/i);
  });

  it('rejects an indexed pixel whose sample exceeds the declared PLTE entries', () => {
    const width = PNG_EVIDENCE_MIN_WIDTH;
    const height = PNG_EVIDENCE_MIN_HEIGHT;
    const raw = Buffer.alloc((Math.ceil(width / 8) + 1) * height);
    // One palette entry means only sample 0 is valid. Set the first pixel to 1.
    raw[1] = 0x80;
    const bytes = pngWithChunks({
      width,
      height,
      bitDepth: 1,
      colorType: 3,
      chunks: [pngChunk('PLTE', Buffer.from([0, 0, 0]))],
      idatParts: [zlib.deflateSync(raw)],
    });

    expect(() => inspectPngEvidenceBytes(bytes))
      .toThrow(/references palette entry 1.*only defines 1 entries/i);
  });

  it('rejects a chunk bomb before collecting an unbounded chunk list', () => {
    const width = PNG_EVIDENCE_MIN_WIDTH;
    const height = PNG_EVIDENCE_MIN_HEIGHT;
    const raw = Buffer.alloc((width + 1) * height);
    const chunks = Array.from(
      { length: PNG_EVIDENCE_MAX_CHUNKS },
      () => pngChunk('tEXt'),
    );
    const bytes = pngWithChunks({
      width,
      height,
      chunks,
      idatParts: [zlib.deflateSync(raw)],
    });

    expect(() => inspectPngEvidenceBytes(bytes))
      .toThrow(new RegExp(`more than ${PNG_EVIDENCE_MAX_CHUNKS} chunks`, 'i'));
  });

  it('rejects an IDAT chunk bomb even below the total chunk cap', () => {
    const width = PNG_EVIDENCE_MIN_WIDTH;
    const height = PNG_EVIDENCE_MIN_HEIGHT;
    const raw = Buffer.alloc((width + 1) * height);
    const stream = zlib.deflateSync(raw);
    const parts = [
      ...Array.from({ length: PNG_EVIDENCE_MAX_IDAT_CHUNKS }, () => Buffer.alloc(0)),
      stream,
    ];
    const bytes = pngWithChunks({ width, height, idatParts: parts });

    expect(() => inspectPngEvidenceBytes(bytes))
      .toThrow(new RegExp(`more than ${PNG_EVIDENCE_MAX_IDAT_CHUNKS} IDAT chunks`, 'i'));
  });

  it('bounds inflation to the exact IHDR scanline contract plus one byte', () => {
    const width = PNG_EVIDENCE_MIN_WIDTH;
    const height = PNG_EVIDENCE_MIN_HEIGHT;
    const expectedBytes = (width + 1) * height;
    const inflationBomb = zlib.deflateSync(Buffer.alloc(expectedBytes + 64 * 1024));

    expect(() => inspectPngEvidenceBytes(pngBytes({ idatData: inflationBomb })))
      .toThrow(/cannot be decoded|decoded IDAT length/i);
  });

  it('rejects an oversized artifact from file metadata before reading its bytes', () => {
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'canary-png-size-limit-'));
    const artifactPath = path.join(directory, 'oversized.png');
    try {
      fs.writeFileSync(artifactPath, PNG_SIGNATURE);
      fs.truncateSync(artifactPath, PNG_EVIDENCE_MAX_FILE_BYTES + 1);

      expect(() => inspectPngEvidenceFile(artifactPath))
        .toThrow(/exceeds the 67108864-byte file safety limit/i);
    } finally {
      fs.rmSync(directory, { recursive: true, force: false });
    }
  });

  it('rejects a file changed after the bounded descriptor read instead of mixing path reads', () => {
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'canary-png-toctou-'));
    const artifactPath = path.join(directory, 'artifact.png');
    try {
      fs.writeFileSync(artifactPath, pngBytes());

      expect(() => inspectPngEvidenceFile(artifactPath, {
        afterBoundedRead: () => {
          fs.appendFileSync(artifactPath, Buffer.from([0]));
        },
      })).toThrow(/identity, size, or modification time changed during its bounded read/i);
    } finally {
      fs.rmSync(directory, { recursive: true, force: false });
    }
  });

  it('returns hash, identity, dimensions, and size from the same stable file Buffer', () => {
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'canary-png-proof-'));
    const artifactPath = path.join(directory, 'artifact.png');
    try {
      const bytes = pngBytes();
      fs.writeFileSync(artifactPath, bytes);

      expect(inspectPngEvidenceFile(artifactPath)).toMatchObject({
        width: PNG_EVIDENCE_MIN_WIDTH,
        height: PNG_EVIDENCE_MIN_HEIGHT,
        sizeBytes: bytes.length,
        sha256: crypto.createHash('sha256').update(bytes).digest('hex').toUpperCase(),
        fileIdentity: {
          dev: expect.any(String),
          ino: expect.any(String),
        },
        mtimeNs: expect.any(String),
        ctimeNs: expect.any(String),
      });
    } finally {
      fs.rmSync(directory, { recursive: true, force: false });
    }
  });
});
