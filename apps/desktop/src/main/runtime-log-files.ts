import * as fs from 'node:fs';
import * as path from 'node:path';
import { captureRuntimeLogRetention, type RuntimeLogRetentionPolicy } from './runtime-log-policy';

const LOG_NAME = /^runtime-(\d{4}-\d{2}-\d{2})(?:\.(\d{6}))?\.jsonl$/;
const DAY_MS = 86_400_000;

interface OwnedLogFile {
  name: string;
  date: string;
  sequence: number;
  bytes: number;
}

function dateStart(date: string): number {
  const start = Date.parse(`${date}T00:00:00.000Z`);
  if (!Number.isFinite(start) || new Date(start).toISOString().slice(0, 10) !== date) {
    throw new TypeError('日志日期必须为有效的 UTC 日期。');
  }
  return start;
}

function ownedLogs(directory: string): OwnedLogFile[] {
  const result: OwnedLogFile[] = [];
  for (const name of fs.readdirSync(directory)) {
    const match = LOG_NAME.exec(name);
    if (!match) continue;
    const stat = fs.lstatSync(path.join(directory, name));
    if (stat.isSymbolicLink() || !stat.isFile()) throw new Error('日志保留边界内存在非普通文件。');
    dateStart(match[1]);
    result.push({ name, date: match[1], sequence: Number(match[2] ?? 0), bytes: stat.size });
  }
  return result.sort((a, b) => a.date.localeCompare(b.date) || a.sequence - b.sequence);
}

function removeOwnedLog(directory: string, file: OwnedLogFile): void {
  const target = path.join(directory, file.name);
  const stat = fs.lstatSync(target);
  if (stat.isSymbolicLink() || !stat.isFile()) throw new Error('日志清理目标已变化，拒绝删除。');
  fs.unlinkSync(target);
}

export function appendRetainedRuntimeLog(
  directory: string, date: string, line: string, inputPolicy: RuntimeLogRetentionPolicy,
): void {
  const policy = captureRuntimeLogRetention(inputPolicy);
  const today = dateStart(date);
  const incomingBytes = Buffer.byteLength(line, 'utf8');
  if (incomingBytes > policy.maxFileBytes) throw new RangeError('日志记录超过单文件上限。');
  fs.mkdirSync(directory, { recursive: true });
  const directoryStat = fs.lstatSync(directory);
  if (directoryStat.isSymbolicLink() || !directoryStat.isDirectory()) throw new Error('日志目录必须为普通目录。');
  const files = ownedLogs(directory);
  const sameDay = files.filter(file => file.date === date);
  const latest = sameDay[sameDay.length - 1];
  const reuse = latest && latest.bytes + incomingBytes <= policy.maxFileBytes ? latest : undefined;
  const sequence = latest ? latest.sequence + 1 : 0;
  if (!reuse && sequence > 999999) throw new RangeError('单日日志分片数已达上限。');
  const targetName = reuse?.name ?? `runtime-${date}${sequence ? `.${String(sequence).padStart(6, '0')}` : ''}.jsonl`;
  const cutoff = today - (policy.retainDays - 1) * DAY_MS;
  let totalBytes = files.reduce((total, file) => total + file.bytes, 0);
  let totalFiles = files.length + (reuse ? 0 : 1);
  // 仅清理本日志出口拥有的普通文件；证据、业务文件和陌生命名文件不进入保留策略。
  for (const file of files) {
    if (file.name === targetName) continue;
    if (dateStart(file.date) >= cutoff && totalBytes + incomingBytes <= policy.maxTotalBytes && totalFiles <= policy.maxFiles) continue;
    removeOwnedLog(directory, file);
    totalBytes -= file.bytes;
    totalFiles--;
  }
  if (totalBytes + incomingBytes > policy.maxTotalBytes || totalFiles > policy.maxFiles) throw new RangeError('日志保留额度不足。');
  const target = path.join(directory, targetName);
  if (fs.existsSync(target)) {
    const stat = fs.lstatSync(target);
    if (stat.isSymbolicLink() || !stat.isFile()) throw new Error('日志写入目标不是普通文件。');
  }
  const descriptor = fs.openSync(target, fs.constants.O_CREAT | fs.constants.O_APPEND | fs.constants.O_WRONLY, 0o600);
  try {
    const opened = fs.fstatSync(descriptor);
    const visible = fs.lstatSync(target);
    if (!opened.isFile() || visible.isSymbolicLink() || !visible.isFile()
      || opened.ino !== visible.ino || opened.dev !== visible.dev) throw new Error('日志写入目标在打开时发生变化。');
    fs.writeFileSync(descriptor, line, 'utf8');
  } finally {
    fs.closeSync(descriptor);
  }
}
