import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { afterEach, describe, expect, it } from 'vitest';

const roots = [];
afterEach(() => {
  for (const root of roots.splice(0)) fs.rmSync(root, { recursive: true, force: true });
});
function fixture(nodeBody, migrationScriptPath = path.resolve('scripts/migrate-current-user-db.js')) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 's7-metadata-admission-'));
  roots.push(root);
  const stub = path.join(root, 'metadata-node.ps1');
  fs.writeFileSync(stub, '$global:LASTEXITCODE = 0\n' + nodeBody, 'utf8');
  const requestPath = path.join(root, 'request.json');
  fs.writeFileSync(requestPath, JSON.stringify({ kind: 's7-offline-migration-lease-request', schemaVersion: 1,
    nodeExecutable: stub, migrationScriptPath, plan: { targetVersion: 22 } }));
  return { root, requestPath, stub };
}
function inspect(requestPath) {
  const powershell = path.join(process.env.SystemRoot, 'System32/WindowsPowerShell/v1.0/powershell.exe');
  return spawnSync(powershell, ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File',
    path.resolve('scripts/run-s7-offline-migration-lease.ps1'), '-RequestPath', requestPath],
  { encoding: 'utf8', windowsHide: true, timeout: 30_000 });
}

describe('离线租约的同源元数据准入', () => {
  it('元数据CLI拒绝额外参数并保留统一错误日志', () => {
    const result = spawnSync(process.execPath, [path.resolve('scripts/migration-contract-source.js'), '--target-version', '22'],
      { encoding: 'utf8', windowsHide: true, timeout: 30_000 });
    expect(result.status).toBe(1);
    expect(result.stdout).toBe('');
    expect(JSON.parse(result.stderr)).toMatchObject({ level: 'error', event: 'migration.metadata_failed' });
  });
  it.each(['Write-Output "22suffix"', 'Write-Output "22`n22"', 'Write-Output "22"; exit 1'])
    ('拒绝非完整单整数或失败的元数据输出 %s', (body) => {
      if (process.platform !== 'win32') return;
      const f = fixture(body);
      const result = inspect(f.requestPath);
      expect(result.status).not.toBe(0);
      expect(result.stderr).toContain('migration metadata target is invalid');
      expect(fs.readdirSync(f.root).sort()).toEqual(['metadata-node.ps1', 'request.json']);
    });
  it('迁移脚本不是固定生产入口时不运行元数据程序', () => {
    if (process.platform !== 'win32') return;
    const f = fixture("throw 'NODE_MUST_NOT_RUN'");
    const other = path.join(f.root, 'other.js');
    fs.writeFileSync(other, '');
    const request = JSON.parse(fs.readFileSync(f.requestPath));
    request.migrationScriptPath = other;
    fs.writeFileSync(f.requestPath, JSON.stringify(request));
    const result = inspect(f.requestPath);
    expect(result.status).not.toBe(0);
    expect(result.stderr).toContain('fixed production entry');
    expect(result.stderr).not.toContain('NODE_MUST_NOT_RUN');
  });
});
