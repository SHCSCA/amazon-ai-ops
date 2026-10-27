// 按证据职责拆分夹具与验收断言，测试仍归属原有入口。

import crypto from 'node:crypto';

import fs from 'node:fs';

import path from 'node:path';

import os from 'node:os';

import zlib from 'node:zlib';

import { createRequire } from 'node:module';

import { fileURLToPath } from 'node:url';

import { afterEach, describe, expect, it } from 'vitest';

import { addCurrentCanaryLineage } from './execution-canary-current.test-fixture.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const root = path.resolve(__dirname, '..');

const requireFromLocalDb = createRequire(path.join(root, 'packages', 'local-db', 'package.json'));

const Database = requireFromLocalDb('better-sqlite3');

const exporter = createRequire(import.meta.url)('./export-mission-control-execution-canary-evidence.js');

const readiness = createRequire(import.meta.url)('./verify-mission-control-production-readiness.js');

const { runReadonlySqliteOnlineBackupSync, } = createRequire(import.meta.url)('./sqlite-authority-currentness.js');

const tempRoot = path.join(os.tmpdir(), 'amazon-ai-ops-canary-export-tests');

const ownedTempDirs = [];

const PNG_SIGNATURE = Buffer.from('89504E470D0A1A0A', 'hex');

const CRC_TABLE = new Uint32Array(256);

for (let index = 0; index < CRC_TABLE.length; index += 1) {
    let value = index;
    for (let bit = 0; bit < 8; bit += 1) {
        value = (value & 1) !== 0 ? (0xEDB88320 ^ (value >>> 1)) : (value >>> 1);
    }
    CRC_TABLE[index] = value >>> 0;
}

const MINIMAL_PNGS = [
    productionPngBytes(64),
    productionPngBytes(128),
    productionPngBytes(192),
];

fs.mkdirSync(tempRoot, { recursive: true });

afterEach(() => {
    while (ownedTempDirs.length > 0) {
        const candidate = ownedTempDirs.pop();
        const resolved = path.resolve(candidate);
        if (path.dirname(resolved) === path.resolve(tempRoot) && fs.existsSync(resolved)) {
            fs.rmSync(resolved, { recursive: true, force: false });
        }
    }
});

function crc32(buffer) {
    let crc = 0xFFFFFFFF;
    for (const byte of buffer)
        crc = CRC_TABLE[(crc ^ byte) & 0xFF] ^ (crc >>> 8);
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

function productionPngBytes(gray, { width = 1200, height = 700 } = {}) {
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
        pngChunk('IDAT', zlib.deflateSync(raw)),
        pngChunk('IEND'),
    ]);
}
export { crypto, fs, path, zlib, createRequire, fileURLToPath, afterEach, describe, expect, it, addCurrentCanaryLineage, __dirname, root, requireFromLocalDb, Database, exporter, readiness, runReadonlySqliteOnlineBackupSync, tempRoot, ownedTempDirs, PNG_SIGNATURE, CRC_TABLE, MINIMAL_PNGS, crc32, pngChunk, productionPngBytes };
