import { checkReportInput, rejectReport, type ReportResourceLimits } from './report-resource-policy';

const FREE = 0xffffffff, END = 0xfffffffe, FAT = 0xfffffffd, DIF = 0xfffffffc;
const invalid = (stage: string): never => rejectReport(`xls-${stage}`, 'REPORT_ARCHIVE_INVALID');
const unsupported = (stage: string): never => rejectReport(`xls-${stage}`, 'REPORT_FORMAT_UNSUPPORTED');
const budget = (stage: string): never => rejectReport(`xls-${stage}`);

interface DirectoryEntry { name: string; type: number; left: number; right: number; child: number; start: number; size: number }

function propertyBudget(bytes: Buffer, summary: boolean, limits: ReportResourceLimits): number {
  if (bytes.length < 48 || bytes.readUInt16LE(0) !== 0xfffe || bytes.readUInt16LE(2) > 1) invalid('property-header');
  // 自定义第二属性集含独立字典和代码页，未核实的组合必须重新导出。
  if (bytes.readUInt32LE(24) !== 1) unsupported('custom-property-set');
  const start = bytes.readUInt32LE(44);
  if (start !== 48 || start + 8 > bytes.length) invalid('property-offset');
  const size = bytes.readUInt32LE(start), count = bytes.readUInt32LE(start + 4);
  if (size < 8 || start + size > bytes.length || count > limits.maxZipEntries || 8 + count * 8 > size) invalid('property-count');
  const expected = (id: number): number[] => {
    if (id === 1) return [2];
    if (id === 0x80000000 || id === 0x80000003) return [0x13];
    if (summary) {
      if ((id >= 2 && id <= 9) || id === 0x12) return [0x1e, 0x1f];
      if (id >= 10 && id <= 13) return [0x40];
      if ((id >= 14 && id <= 16) || id === 19) return [3];
      if (id === 17) return [0x47];
    } else {
      if ([2, 3, 14, 15, 26, 27, 28, 29].includes(id)) return [0x1e, 0x1f];
      if ((id >= 4 && id <= 10) || [17, 23].includes(id)) return [3];
      if ([11, 16, 19, 22].includes(id)) return [0x0b];
      if (id === 12) return [0x100c];
      if (id === 13) return [0x101e, 0x101f];
      if (id === 24) return [0x41];
    }
    return unsupported('property-id');
  };
  let totalText = 0, previous = 8 + count * 8;
  const ids = new Set<number>();
  for (let index = 0; index < count; index++) {
    const id = bytes.readUInt32LE(start + 8 + index * 8), offset = bytes.readUInt32LE(start + 12 + index * 8);
    const next = index + 1 === count ? size : bytes.readUInt32LE(start + 20 + index * 8);
    if (ids.has(id) || offset < previous || offset >= next || next > size || offset % 4) invalid('property-table');
    ids.add(id); previous = next;
    const value = bytes.subarray(start + offset, start + next);
    let cursor = 0;
    const number = (width: number): number => {
      if (cursor + width > value.length) invalid('property-truncated');
      const result = value.readUIntLE(cursor, width); cursor += width; return result;
    };
    const skip = (length: number): void => { if (length > value.length - cursor) invalid('property-value-length'); cursor += length; };
    const string = (wide: boolean, aligned = false): void => {
      const countChars = number(4), width = wide ? 2 : 1;
      if (!countChars || countChars - 1 > limits.maxCellTextChars) budget('property-text');
      const length = countChars * width;
      if (length > value.length - cursor || value.readUIntLE(cursor + length - width, width) !== 0) invalid('property-string-length');
      totalText += (countChars - 1) * 3;
      if (totalText > limits.maxTextBytes) budget('property-text-total');
      skip(length);
      if (aligned) { if (cursor % 4) skip(4 - cursor % 4); }
    };
    const type = number(2);
    if (number(2) !== 0 || !expected(id).includes(type)) unsupported('property-type');
    if (type === 2 || type === 3 || type === 0x0b || type === 0x13) skip(4);
    else if (type === 0x40) skip(8);
    else if (type === 0x1e || type === 0x1f) string(type === 0x1f);
    else if (type === 0x41 || type === 0x47) {
      const length = number(4);
      if (length > limits.maxZipEntryBytes || (type === 0x47 && length < 4)) budget('property-blob');
      skip(length);
    } else if (type === 0x101e || type === 0x101f) {
      const elements = number(4);
      if (elements > limits.maxZipEntries) budget('property-vector');
      for (let item = 0; item < elements; item++) string(type === 0x101f, type === 0x101f);
    } else if (type === 0x100c) {
      const elements = number(4);
      if (elements % 2 || elements > limits.maxZipEntries * 2) budget('property-heading-vector');
      for (let item = 0; item < elements / 2; item++) {
        const stringType = number(4);
        if (stringType !== 0x1e && stringType !== 0x1f) unsupported('property-heading-type');
        string(stringType === 0x1f, true);
        if (number(4) !== 3 || number(4) > limits.maxZipEntries) budget('property-heading-count');
      }
    }
    if (value.subarray(cursor).some(byte => byte !== 0)) invalid('property-padding');
  }
  return totalText;
}

function compoundWorkbook(bytes: Buffer, limits: ReportResourceLimits): { workbook: Buffer; textBytes: number } {
  if (bytes.length < 512 || bytes.subarray(0, 8).toString('hex') !== 'd0cf11e0a1b11ae1') invalid('signature');
  const major = bytes.readUInt16LE(26), shift = bytes.readUInt16LE(30);
  if (!((major === 3 && shift === 9) || (major === 4 && shift === 12))) unsupported('cfb-version');
  const sectorSize = 2 ** shift, sectorCount = bytes.length / sectorSize - 1, entriesPerFat = sectorSize / 4;
  if (!Number.isInteger(sectorCount) || sectorCount < 1 || bytes.readUInt16LE(28) !== 0xfffe || bytes.readUInt16LE(32) !== 6
    || bytes.subarray(8, 24).some(value => value !== 0) || bytes.subarray(34, 40).some(value => value !== 0)
    || bytes.readUInt32LE(56) !== 4096 || bytes.subarray(512, sectorSize).some(value => value !== 0)) invalid('header');
  const dirCount = bytes.readUInt32LE(40), fatCount = bytes.readUInt32LE(44), miniCount = bytes.readUInt32LE(64), difCount = bytes.readUInt32LE(72);
  if ((major === 3 && dirCount !== 0) || !fatCount || fatCount > sectorCount || miniCount > sectorCount || difCount > sectorCount
    || dirCount > sectorCount || fatCount * entriesPerFat < sectorCount) invalid('header-count');
  if (difCount !== Math.ceil(Math.max(0, fatCount - 109) / (entriesPerFat - 1))) invalid('difat-count');
  const owners = new Int32Array(sectorCount), fatSectors: number[] = [], difSectors: number[] = [];
  const sector = (id: number): Buffer => {
    if (id >= sectorCount) invalid('sector-address');
    return bytes.subarray((id + 1) * sectorSize, (id + 2) * sectorSize);
  };
  const reserve = (id: number, owner: number): void => {
    sector(id);
    if (owners[id]) invalid('sector-crosslink');
    owners[id] = owner;
  };
  const addFat = (id: number): void => { reserve(id, -1); fatSectors.push(id); };
  for (let index = 0; index < 109; index++) {
    const id = bytes.readUInt32LE(76 + index * 4);
    if (index < fatCount) addFat(id);
    else if (id !== FREE) invalid('header-difat-padding');
  }
  let nextDif = bytes.readUInt32LE(68);
  for (let index = 0; index < difCount; index++) {
    reserve(nextDif, -2); difSectors.push(nextDif);
    const data = sector(nextDif);
    for (let offset = 0; offset < entriesPerFat - 1; offset++) {
      const id = data.readUInt32LE(offset * 4);
      if (fatSectors.length < fatCount) addFat(id);
      else if (id !== FREE) invalid('difat-padding');
    }
    nextDif = data.readUInt32LE(sectorSize - 4);
  }
  if (nextDif !== END || fatSectors.length !== fatCount) invalid('difat-chain');
  const allocation = new Uint32Array(sectorCount);
  for (let index = 0; index < fatCount * entriesPerFat; index++) {
    const value = sector(fatSectors[Math.floor(index / entriesPerFat)]).readUInt32LE((index % entriesPerFat) * 4);
    if (index < sectorCount) allocation[index] = value;
    // 锁定 SheetJS 写入器以 END 填充未使用表项；两种终止值均不能引入新链。
    else if (value !== FREE && value !== END) invalid('fat-padding');
  }
  for (const id of fatSectors) if (allocation[id] !== FAT) invalid('fat-marker');
  for (const id of difSectors) if (allocation[id] !== DIF) invalid('difat-marker');
  let owner = 0;
  const chain = (start: number, expected?: number, maximum = sectorCount): number[] => {
    const result: number[] = [], identity = ++owner;
    let id = start;
    while (id !== END) {
      if (result.length >= maximum || (expected !== undefined && result.length >= expected)) invalid('chain-length');
      reserve(id, identity); result.push(id); id = allocation[id];
    }
    if (expected !== undefined && result.length !== expected) invalid('chain-size');
    return result;
  };
  const join = (ids: number[], size = ids.length * sectorSize): Buffer => Buffer.concat(ids.map(sector), ids.length * sectorSize).subarray(0, size);
  const directoryIds = chain(bytes.readUInt32LE(48), major === 4 ? dirCount : undefined, Math.ceil(limits.maxZipEntries * 128 / sectorSize));
  if (!directoryIds.length || directoryIds.length * sectorSize > limits.maxZipEntries * 128) budget('directory-count');
  const directory = join(directoryIds), entries: DirectoryEntry[] = [];
  for (let offset = 0; offset < directory.length; offset += 128) {
    const data = directory.subarray(offset, offset + 128), type = data[66], nameBytes = data.readUInt16LE(64);
    const left = data.readUInt32LE(68), right = data.readUInt32LE(72), child = data.readUInt32LE(76);
    const start = data.readUInt32LE(116), sizeHigh = data.readUInt32LE(124), size = data.readUInt32LE(120);
    if (![0, 1, 2, 5].includes(type) || (type === 5) !== (offset === 0)) invalid('directory-type');
    if (type === 0) {
      if (nameBytes !== 0 || left !== FREE || right !== FREE || child !== FREE || size || sizeHigh) invalid('unused-directory');
      entries.push({ name: '', type, left, right, child, start, size }); continue;
    }
    if (nameBytes < 2 || nameBytes > 64 || nameBytes % 2 || data.readUInt16LE(nameBytes - 2) !== 0 || data[67] > 1) invalid('directory-name');
    const name = data.subarray(0, nameBytes - 2).toString('utf16le');
    if (!name || /[\x00\\/:!]/.test(name) || sizeHigh) unsupported('directory-name-or-size');
    // 根节点也参与无路径查找，不能以保留名切换到另一种消费器。
    if (type === 5 && (/[\u0001-\u0006]/.test(name) || name.toUpperCase() === 'ENCRYPTEDPACKAGE')) unsupported('root-consumer-alias');
    if (size > limits.maxZipEntryBytes) budget('stream-size');
    if ((type === 1 && size !== 0) || (type === 2 && child !== FREE)) invalid('directory-fields');
    entries.push({ name, type, left, right, child, start, size });
  }
  if (entries[0].left !== FREE || entries[0].right !== FREE) invalid('root-links');
  const reachable = new Set<number>([0]), names = new Set<string>();
  const queue: Array<{ id: number; parent: number; path: string; depth: number }> = [{ id: entries[0].child, parent: 0, path: '', depth: 1 }];
  let workbookId = -1;
  for (let index = 0; index < queue.length; index++) {
    const item = queue[index];
    if (item.id === FREE) continue;
    if (item.id >= entries.length || reachable.has(item.id) || entries[item.id].type === 0) invalid('directory-cycle-or-crosslink');
    if (item.depth > limits.maxXmlDepth) budget('directory-depth');
    reachable.add(item.id);
    const entry = entries[item.id], consumerName = entry.name.toLowerCase().replace(/[\u0001-\u0006]/g, '!'), path = `${item.path}/${consumerName}`;
    if (names.has(path)) invalid('directory-duplicate');
    names.add(path);
    // 这些旁流会被 SheetJS 另行解释，未审计其专用格式时不能透传。
    if (['!compobj', 'encryption', 'encryptedpackage'].includes(consumerName)) unsupported('side-stream');
    if (entry.type === 2) {
      if (['workbook', 'book'].includes(entry.name.toLowerCase())) {
        if (item.parent !== 0 || workbookId !== -1) invalid('workbook-location');
        workbookId = item.id;
      }
    }
    queue.push({ ...item, id: entry.left }, { ...item, id: entry.right });
    if (entry.type === 1) queue.push({ id: entry.child, parent: item.id, path, depth: item.depth + 1 });
  }
  if (workbookId === -1) invalid('missing-workbook');
  for (let index = 1; index < entries.length; index++) if (entries[index].type !== 0 && !reachable.has(index)) invalid('unreachable-directory');
  const miniIds = chain(bytes.readUInt32LE(60), miniCount), miniFat = join(miniIds);
  const root = entries[0];
  if (root.size % 64) invalid('mini-stream-size');
  const rootIds = chain(root.start, Math.ceil(root.size / sectorSize)), miniStream = join(rootIds, root.size);
  const miniSectors = root.size / 64, miniOwners = new Uint8Array(miniSectors);
  if (miniFat.length / 4 < miniSectors) invalid('minifat-capacity');
  let workbook: Buffer | undefined, total = 0, textBytes = 0;
  for (let index = 1; index < entries.length; index++) {
    const entry = entries[index];
    if (entry.type !== 2) continue;
    total += entry.size;
    if (total > limits.maxZipTotalBytes) budget('total-stream-size');
    const chunks: Buffer[] = [], consumerName = entry.name.toLowerCase().replace(/[\u0001-\u0006]/g, '!');
    const property = ['!summaryinformation', '!documentsummaryinformation'].includes(consumerName);
    let content: Buffer | undefined;
    if (entry.size >= 4096) {
      const ids = chain(entry.start, Math.ceil(entry.size / sectorSize));
      if (index === workbookId || property) content = join(ids, entry.size);
    } else {
      let id = entry.start;
      for (let count = 0; count < Math.ceil(entry.size / 64); count++) {
        if (id >= miniSectors || miniOwners[id]) invalid('mini-chain-crosslink-or-address');
        miniOwners[id] = 1;
        if (index === workbookId || property) chunks.push(miniStream.subarray(id * 64, (id + 1) * 64));
        id = miniFat.readUInt32LE(id * 4);
      }
      if (id !== END && !(entry.size === 0 && id === 0)) invalid('mini-chain-size');
      if (index === workbookId || property) content = Buffer.concat(chunks).subarray(0, entry.size);
    }
    if (index === workbookId) workbook = content;
    if (property && content?.length) textBytes += propertyBudget(content, consumerName === '!summaryinformation', limits);
    if (textBytes > limits.maxTextBytes) budget('property-text-total');
  }
  // SheetJS 会遍历未引用的 FAT 链，因此所有未归属扇区也必须明确为空闲。
  for (let index = 0; index < sectorCount; index++) if (!owners[index] && allocation[index] !== FREE && allocation[index] !== END) invalid('unowned-sector');
  for (let index = 0; index < miniFat.length / 4; index++) {
    if (!miniOwners[index] && ![FREE, END].includes(miniFat.readUInt32LE(index * 4))) invalid('unowned-mini-sector');
  }
  // make_sector_list 会从扫描途中遇到的节点复制整条后缀，即使该后缀已复制过。
  // 先以线性代价算出其真实累计复制量，拒绝合法但逆序排列导致的二次方展开。
  const tails = new Uint32Array(sectorCount), visited = new Uint8Array(sectorCount);
  for (let index = 0; index < sectorCount; index++) {
    const pending: number[] = [];
    let id = index;
    while (id < sectorCount && !tails[id]) { pending.push(id); id = allocation[id]; }
    let length = id < sectorCount ? tails[id] : 0;
    for (let cursor = pending.length - 1; cursor >= 0; cursor--) tails[pending[cursor]] = ++length;
  }
  let copied = 0;
  const directoryStart = bytes.readUInt32LE(48);
  for (let index = 0; index < sectorCount; index++) {
    let id = (index + directoryStart) % sectorCount;
    if (visited[id]) continue;
    copied += tails[id] * sectorSize;
    if (copied > limits.maxZipTotalBytes) budget('cfb-consumer-copy-total');
    while (id < sectorCount && !visited[id]) { visited[id] = 1; id = allocation[id]; }
  }
  if (!workbook?.length) invalid('empty-workbook');
  return { workbook: workbook!, textBytes };
}

// 仅放行已核对消费方式的 BIFF8 数据报表记录；公式、宏、加密和外部对象必须重新导出。
const fixedRecords = new Map<number, number>([
  [0x000a, 0], [0x000c, 2], [0x000d, 2], [0x000e, 2], [0x000f, 2], [0x0010, 8], [0x0011, 2], [0x0012, 2], [0x0013, 2],
  [0x0019, 2], [0x0022, 2], [0x002a, 2], [0x002b, 2], [0x0040, 2], [0x0042, 2], [0x0055, 2], [0x005c, 112], [0x005f, 2],
  [0x0080, 8], [0x0081, 2], [0x0082, 2], [0x0083, 2], [0x0084, 2], [0x0086, 0], [0x008c, 4], [0x008d, 2], [0x009c, 2],
  [0x00c1, 2], [0x00da, 2], [0x00e0, 20], [0x00e1, 2], [0x00e2, 0], [0x0160, 2], [0x0161, 2], [0x01af, 2], [0x01b7, 2],
  [0x01bc, 2], [0x01c0, 0], [0x0200, 14], [0x0201, 6], [0x0203, 14], [0x0205, 8], [0x0208, 16], [0x023e, 18], [0x027e, 10],
]);
const ignoredRecords = new Set([0x00eb, 0x00ec, 0x0868, 0x0867, 0x004d, 0x0050, 0x009b]);

interface BiffRecord { id: number; offset: number; data: Buffer }
class StringCursor {
  private part = 0;
  private offset = 0;
  constructor(private readonly parts: Buffer[]) {}
  private advance(): void {
    while (this.offset === this.parts[this.part]?.length) { this.part++; this.offset = 0; }
    if (this.part >= this.parts.length) invalid('string-truncated');
  }
  number(width: number): number {
    this.advance();
    if (this.offset + width > this.parts[this.part].length) invalid('string-header-continuation');
    const result = this.parts[this.part].readUIntLE(this.offset, width); this.offset += width; return result;
  }
  skip(size: number): void {
    while (size > 0) {
      this.advance();
      const count = Math.min(size, this.parts[this.part].length - this.offset); this.offset += count; size -= count;
    }
  }
  characters(count: number, width: number): void {
    while (count > 0) {
      if (this.offset === this.parts[this.part]?.length) {
        this.part++; this.offset = 0;
        if (this.part >= this.parts.length || !this.parts[this.part].length) invalid('string-continuation');
        const flags = this.number(1);
        if (flags > 1) invalid('string-continuation-flags');
        width = flags + 1;
      }
      const available = this.parts[this.part].length - this.offset;
      if (available < width) invalid('string-split-character');
      const consumed = Math.min(count, Math.floor(available / width));
      this.offset += consumed * width; count -= consumed;
    }
  }
  done(): boolean {
    while (this.offset === this.parts[this.part]?.length) { this.part++; this.offset = 0; }
    return this.part === this.parts.length;
  }
}

function assertBiffWorkbook(bytes: Buffer, limits: ReportResourceLimits, priorTextBytes = 0): void {
  const records: BiffRecord[] = [];
  for (let offset = 0; offset < bytes.length;) {
    if (offset + 4 > bytes.length) invalid('record-header');
    const id = bytes.readUInt16LE(offset), length = bytes.readUInt16LE(offset + 2);
    if (id === 0) {
      if (bytes.subarray(offset).some(value => value !== 0)) invalid('trailing-padding');
      break;
    }
    if (length > 8224 || offset + 4 + length > bytes.length) invalid('record-length');
    records.push({ id, offset, data: bytes.subarray(offset + 4, offset + 4 + length) });
    if (records.length > limits.maxCells + limits.maxZipEntries * limits.maxSheets) budget('record-count');
    offset += 4 + length;
  }
  let totalText = priorTextBytes, cells = 0, metadata = 0, rowRecords = 0, sheets = 0, uniqueStrings = 0, depth = 0, currentType = 0;
  const stringLengths: number[] = [];
  let globalSeen = false, globalEnded = false, sstSeen = false;
  const declaredSheets = new Map<number, string>(), observedSheets = new Set<number>();
  let rowMin = Infinity, colMin = Infinity, rowMax = 0, colMax = 0;
  const text = (characters: number): void => {
    if (characters > limits.maxCellTextChars) budget('cell-text');
    totalText += characters * 3;
    if (totalText > limits.maxTextBytes) budget('text-total');
  };
  const range = (r0: number, r1: number, c0: number, c1: number): void => {
    if (r0 > r1 || c0 > c1) invalid('coordinate-order');
    if (r1 > limits.maxRows || c1 > limits.maxColumns || (r1 - r0) * (c1 - c0) > limits.maxRangeCells) budget('range');
    if (r0 !== r1 && c0 !== c1) {
      rowMin = Math.min(rowMin, r0); colMin = Math.min(colMin, c0); rowMax = Math.max(rowMax, r1); colMax = Math.max(colMax, c1);
      if ((rowMax - rowMin) * (colMax - colMin) > limits.maxRangeCells) budget('actual-rectangle');
    }
  };
  const cell = (data: Buffer, count = 1, lastColumn?: number): void => {
    if (currentType !== 0x0010 || data.length < 6) invalid('cell-context');
    const row = data.readUInt16LE(0), column = data.readUInt16LE(2), end = lastColumn ?? column;
    range(row, row + 1, column, end + 1); cells += count;
    if (cells > limits.maxCells) budget('cells');
  };
  const unicode = (data: Buffer, offset: number, short = false, padded = false): void => {
    if (offset + (short ? 2 : 3) > data.length) invalid('string-header');
    const count = short ? data[offset] : data.readUInt16LE(offset), flags = data[offset + (short ? 1 : 2)];
    const end = offset + (short ? 2 : 3) + count * (flags + 1);
    if (flags > 1 || (padded ? end > data.length : end !== data.length)) invalid('string-length');
    text(count);
  };
  for (let index = 0; index < records.length; index++) {
    const record = records[index], { id, data } = record;
    if (id === 0x0809) {
      if (depth || data.length !== 16 || data.readUInt16LE(0) !== 0x0600) unsupported('biff-version-or-depth');
      const type = data.readUInt16LE(2);
      if (!globalSeen) {
        if (index !== 0 || type !== 0x0005) invalid('global-bof');
        globalSeen = true;
      } else {
        if (!globalEnded || type !== 0x0010 || !declaredSheets.has(record.offset) || observedSheets.has(record.offset)) unsupported('substream');
        observedSheets.add(record.offset); sheets++;
        if (sheets > limits.maxSheets) budget('sheets');
      }
      currentType = type; depth = 1; rowMin = colMin = Infinity; rowMax = colMax = 0; continue;
    }
    if (!depth) invalid('outside-substream');
    if (id === 0x000a) {
      if (data.length) invalid('eof-length');
      if (currentType === 0x0005) globalEnded = true;
      depth = 0; continue;
    }
    if (id === 0x0085) {
      if (currentType !== 5 || data.length < 8 || data[4] > 2 || data[5] !== 0) unsupported('sheet-type');
      unicode(data, 6, true);
      const position = data.readUInt32LE(0), name = data.subarray(8).toString(data[7] ? 'utf16le' : 'latin1').toLowerCase();
      if (!data[6] || data[6] > 31 || position >= bytes.length || declaredSheets.has(position) || [...declaredSheets.values()].includes(name)) invalid('sheet-declaration');
      declaredSheets.set(position, name);
      if (declaredSheets.size > limits.maxSheets) budget('sheets');
    } else if (id === 0x00fc) {
      if (currentType !== 5 || sstSeen || data.length < 8) invalid('sst-context');
      sstSeen = true;
      const references = data.readUInt32LE(0); uniqueStrings = data.readUInt32LE(4);
      if (uniqueStrings > references || references > limits.maxCells || uniqueStrings > limits.maxCells) budget('sst-count');
      const parts = [data.subarray(8)];
      while (records[index + 1]?.id === 0x003c) parts.push(records[++index].data);
      const cursor = new StringCursor(parts);
      for (let item = 0; item < uniqueStrings; item++) {
        const count = cursor.number(2), flags = cursor.number(1);
        if (flags & ~0x0d) invalid('sst-flags');
        const runs = flags & 8 ? cursor.number(2) : 0, extension = flags & 4 ? cursor.number(4) : 0;
        text(count); stringLengths.push(count);
        if (runs > count || extension > limits.maxTextBytes) budget('sst-rich-data');
        cursor.characters(count, (flags & 1) + 1); cursor.skip(runs * 4 + extension);
      }
      if (!cursor.done()) invalid('sst-trailing');
    } else if (id === 0x0204) {
      cell(data); unicode(data, 6);
    } else if (id === 0x00fd) {
      if (data.length !== 10 || data.readUInt32LE(6) >= uniqueStrings) invalid('label-sst');
      cell(data); text(stringLengths[data.readUInt32LE(6)]);
    } else if ([0x0201, 0x0203, 0x0205, 0x027e].includes(id)) {
      if (data.length !== fixedRecords.get(id)) invalid('cell-length');
      cell(data);
    } else if (id === 0x00bd || id === 0x00be) {
      const stride = id === 0x00bd ? 6 : 2;
      if (data.length < 6 || (data.length - 6) % stride) invalid('multiple-cell-length');
      const count = (data.length - 6) / stride, first = data.readUInt16LE(2), last = data.readUInt16LE(data.length - 2);
      if (!count || last - first + 1 !== count) invalid('multiple-cell-count');
      cell(data, count, last);
    } else if (id === 0x0200) {
      if (data.length !== 14 || currentType !== 0x0010) invalid('dimensions');
      range(data.readUInt32LE(0), data.readUInt32LE(4), data.readUInt16LE(8), data.readUInt16LE(10));
    } else if (id === 0x0208) {
      if (data.length !== 16 || currentType !== 0x0010) invalid('row');
      range(data.readUInt16LE(0), data.readUInt16LE(0) + 1, data.readUInt16LE(2), data.readUInt16LE(4));
      if (++rowRecords > limits.maxCells) budget('row-records');
    } else if (id === 0x007d) {
      if (data.length !== 12) invalid('column-info');
      range(0, 1, data.readUInt16LE(0), data.readUInt16LE(2) + 1);
    } else if (id === 0x00e5) {
      if (data.length < 2 || data.length !== 2 + data.readUInt16LE(0) * 8) invalid('merge-count');
      metadata += data.readUInt16LE(0);
      for (let offset = 2; offset < data.length; offset += 8) range(data.readUInt16LE(offset), data.readUInt16LE(offset + 2) + 1, data.readUInt16LE(offset + 4), data.readUInt16LE(offset + 6) + 1);
    } else if (id === 0x0031) unicode(data, 14, true);
    else if (id === 0x041e) unicode(data, 2);
    else if (id === 0x005c) {
      if (data.length !== 112) invalid('write-access');
      unicode(data, 0, false, true);
    }
    else if (id === 0x01ba || id === 0x0014 || id === 0x0015) {
      if (data.length) unicode(data, 0);
    } else if (id === 0x013d) {
      if (data.length % 2 || data.length / 2 > limits.maxSheets) invalid('sheet-id-array');
    } else if (id === 0x0092) {
      if (data.length < 2 || data.readUInt16LE(0) > 56 || data.length !== 2 + 4 * data.readUInt16LE(0)) invalid('palette');
    } else if (id === 0x003d) {
      if (data.length !== 18) invalid('window');
    } else if (fixedRecords.has(id)) {
      if (data.length !== fixedRecords.get(id)) invalid('fixed-record-length');
    } else if (!ignoredRecords.has(id)) unsupported(`record-${id.toString(16)}`);
    if (![0x0201, 0x0203, 0x0204, 0x0205, 0x027e, 0x00fd, 0x00bd, 0x00be, 0x0208].includes(id)
      && ++metadata > limits.maxZipEntries * limits.maxSheets) budget('metadata-count');
  }
  if (!globalSeen || !globalEnded || depth || !sheets || sheets !== declaredSheets.size) invalid('substream-completion');
}

export function assertLegacyXlsBudget(bytes: Uint8Array, limits: ReportResourceLimits): void {
  checkReportInput(bytes, limits);
  const input = Buffer.from(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const result = input[0] === 0xd0 ? compoundWorkbook(input, limits) : { workbook: input, textBytes: 0 };
  assertBiffWorkbook(result.workbook, limits, result.textBytes);
}
