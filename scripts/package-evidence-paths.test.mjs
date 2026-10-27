import fs from 'node:fs';
import { readFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { describe, afterEach, expect, it, vi } from 'vitest';
import pathModule from './package-evidence-paths.js';
import uiRunner from './run-package-ui-evidence.js';

const { assertExactEvidencePath, main, resolvePackageEvidencePaths } = pathModule;
afterEach(() => vi.restoreAllMocks());

describe('shared package evidence paths', () => {
  it('logs invalid CLI input with the shared UTC error envelope', () => {
    const result = spawnSync(process.execPath, [fileURLToPath(new URL('./package-evidence-paths.js', import.meta.url)),
      'resolve', 'G:\\AI\\amazon-ai-ops', 'invalid-run'], { encoding: 'utf8', timeout: 10000 });
    expect(result.status).toBe(1);
    const record = JSON.parse(result.stderr.trim());
    expect(Number.isFinite(Date.parse(record.timestamp))).toBe(true);
    expect(record.level).toBe('error');
    expect(record.event).toBe('evidence.path_failed');
    expect(record.context.error.message).toContain('digits only');
  });

  it.each(['C', 'F', 'G'])('uses the workspace %s drive with disjoint, scoped runtime paths', (drive) => {
    const paths = resolvePackageEvidencePaths(`${drive}:\\AI\\amazon-ai-ops`, 123);
    expect(paths).toEqual({
      packageLaunchUserDataRoot: `${drive}:\\Temp\\amazon-ai-ops-package-launch-smoke\\123`,
      folderZipExtractRoot: `${drive}:\\Temp\\amazon-ai-ops-folder-zip-smoke-123`,
      folderZipUserDataRoot: `${drive}:\\Temp\\amazon-ai-ops-folder-zip-user-123`,
    });
    expect(new Set(Object.values(paths)).size).toBe(3);
  });

  it.each(['..\\escape', '', '123\\other', '123:stream'])('rejects unsafe run identifiers: %s', (runId) => {
    expect(() => resolvePackageEvidencePaths('G:\\AI\\amazon-ai-ops', runId)).toThrow(/digits only/);
  });

  it.each(['relative', '\\\\server\\share\\repo', '\\\\?\\G:\\repo', 'G:repo'])('rejects workspace roots without a local drive: %s', (workspace) => {
    expect(() => resolvePackageEvidencePaths(workspace, 123)).toThrow(/local Windows drive/);
  });

  it('requires the exact run path and rejects similarly prefixed siblings', () => {
    vi.spyOn(fs, 'existsSync').mockReturnValue(false);
    const expected = 'G:\\Temp\\amazon-ai-ops-folder-zip-smoke-123';
    expect(assertExactEvidencePath(expected.toLowerCase(), expected)).toBe(expected.toLowerCase());
    for (const candidate of [`${expected}-other`, `${expected}\\child`, 'G:\\Temp\\other']) {
      expect(() => assertExactEvidencePath(candidate, expected)).toThrow();
    }
  });

  it('rejects an existing directory that resolves through a junction', () => {
    vi.spyOn(fs, 'existsSync').mockReturnValue(true);
    vi.spyOn(fs, 'statSync').mockReturnValue({ isDirectory: () => true });
    vi.spyOn(fs.realpathSync, 'native').mockReturnValue('G:\\Temp\\amazon-ai-ops-another-run');
    const expected = 'G:\\Temp\\amazon-ai-ops-folder-zip-smoke-123';
    expect(() => assertExactEvidencePath(expected, expected)).toThrow(/symlink or junction/);
  });

  it('exposes the same resolver and path admission to PowerShell', () => {
    expect(main(['resolve', 'G:\\AI\\repo', '123'])).toEqual(resolvePackageEvidencePaths('G:\\AI\\repo', 123));
    expect(() => main(['resolve', 'G:\\AI\\repo'])).toThrow(/Expected resolve/);
    expect(() => main(['unknown', 'G:\\AI\\repo', '123'])).toThrow(/Unsupported/);
    const source = readFileSync('scripts/smoke-folder-zip-launch.ps1', 'utf8');
    expect(source).toContain('& node $evidencePathHelper resolve $repoRoot ([string]$runId)');
    expect(source).toContain('& node $evidencePathHelper assert $Path $ExpectedPath');
    expect(source).toContain('$verifiedCleanupPath = Assert-SafeTempPath -Path $temporaryPath -ExpectedPath $expectedPath');
    expect(source).toContain('Remove-Item -LiteralPath $verifiedCleanupPath -Recurse -Force');
    expect(source).not.toMatch(/D:\\Temp/);
    expect(source).not.toMatch(/cmd(?:\.exe)?\s+\/c/i);
    for (const gate of ['FindVisibleWindow', 'matchesWinUnpacked = $true', 'Window-ready and runtime markers identify different processes.', 'Stop-VerifiedRuntime']) {
      expect(source).toContain(gate);
    }
  });

  it('documents the shared local-drive admission for explicit UI profile copies', () => {
    let help = '';
    uiRunner.printHelp((value) => { help = value; });
    expect(help).toContain("local drive's");
    expect(help).toContain('--user-data-dir <absolute local path>');
    expect(help).not.toContain('absolute D path');
  });
});
