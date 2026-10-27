import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { spawnSync } from 'node:child_process';
import { describe, expect, it } from 'vitest';
const systemPowerShell = path.join(process.env.SystemRoot || process.env.WINDIR || 'C:\\Windows', 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe');

function verifyUtf8JsonReaders(source, name, host) {
  const expressions = source.split(/\r?\n/).flatMap(line => line.match(/Get-Content\b[^|\r\n]*\|\s*ConvertFrom-Json/) ?? []);
  expect(expressions).toHaveLength(name.includes('installed') ? 1 : 4);
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'amazon-ai-ops-json-encoding-'));
  const good = path.join(root, 'utf8.json'), bad = path.join(root, 'invalid.json');
  const payload = { version: '1.6.0', message: '中文报告：“请重试”与"引号"', path: 'C:\\中文\\报告.json', nested: { value: '恢复 😀' } };
  fs.writeFileSync(good, JSON.stringify(payload), 'utf8');
  fs.writeFileSync(bad, '{"message":"中文未闭合', 'utf8');
  expect(fs.readFileSync(good).subarray(0, 3)).not.toEqual(Buffer.from([0xef, 0xbb, 0xbf]));
  const quoted = value => value.replaceAll("'", "''");
  const at = (expression, file) => expression.replace(/\$finished\[0\]\.reportPath|\$desktopPackagePath|\$windowMarkerPath|\$runtimeMarkerPath/, `'${quoted(file)}'`);
  let passed = false;
  try {
    const checks = expressions.map(expression => {
      expect(expression).toContain('-Encoding UTF8');
      return `$values += ,(${at(expression, good)})\n$rejected = $false\ntry { $null = ${at(expression, bad)} } catch { $rejected = $_.FullyQualifiedErrorId -match 'ConvertFromJson' }\n$rejections += $rejected`;
    }).join('\n');
    const command = `[Console]::OutputEncoding = [Text.UTF8Encoding]::new($false)\n$ErrorActionPreference = 'Stop'\n$values = @(); $rejections = @()\n${checks}\n[ordered]@{ values=@($values); rejected=@($rejections) } | ConvertTo-Json -Depth 8 -Compress`;
    const result = spawnSync(host, ['-NoProfile', '-NonInteractive', '-EncodedCommand', Buffer.from(command, 'utf16le').toString('base64')], { encoding: 'utf8', timeout: 20000 });
    expect(result.status, result.stdout + result.stderr).toBe(0);
    const values = JSON.parse(result.stdout.trim());
    expect(values.values).toEqual(expressions.map(() => payload));
    expect(values.rejected).toEqual(expressions.map(() => true));
    passed = true;
  } finally {
    // 仅清理成功的自有夹具，失败保留原始中文 JSON。
    if (passed) { fs.unlinkSync(good); fs.unlinkSync(bad); fs.rmdirSync(root); }
  }
}

function verifyNativeStderrBoundary(source, name, host) {
  const lines = source.split(/\r?\n/);
  const start = lines.findIndex(line => line.trim() === '$nativeCliErrorActionPreference = $ErrorActionPreference');
  const restore = lines.findIndex(line => line.trim() === '$ErrorActionPreference = $nativeCliErrorActionPreference');
  expect(start).toBeGreaterThan(-1);
  expect(restore).toBeGreaterThan(start);
  expect(lines[restore + 1].trim()).toBe('}');
  const boundary = lines.slice(start, restore + 2).join('\n');
  const nativeLine = boundary.split('\n').filter(line => line.includes('& node ') && line.includes("'verify-isolated-desktop-runtime.mjs'"));
  expect(nativeLine).toHaveLength(1);
  const exitVariable = name.includes('installed') ? '$runtimeExitCode' : '$configurationExitCode';
  expect(boundary).toContain(`${exitVariable} = $LASTEXITCODE`);
  const probeRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'amazon-ai-ops-native-stderr-'));
  const probePath = path.join(probeRoot, 'controlled.cjs');
  const quoted = value => value.replaceAll("'", "''");
  const outputLines = stream => Array.from({ length: 32 }, (_, i) => `native-${stream}-${i}-complete-payload`);
  fs.writeFileSync(probePath, `process.stdout.write(${JSON.stringify(outputLines('stdout').join('\n') + '\n')});\n` +
    `process.stderr.write(${JSON.stringify(outputLines('stderr').join('\n') + '\n')});\nprocess.exitCode = Number(process.argv[2]);\n`);
  const controlled = boundary.replace(nativeLine[0], `  & node '${quoted(probePath)}' $probeExit 1> $stdoutPath 2> $stderrPath`);
  let probePassed = false;
  try {
    const command = `[Console]::OutputEncoding = [Text.UTF8Encoding]::new($false)
      $ErrorActionPreference = 'Stop'
      $observed = @()
      foreach ($probeExit in @(0, 17)) {
        $stdoutPath = Join-Path '${quoted(probeRoot)}' ('stdout-' + $probeExit + '.log')
        $stderrPath = Join-Path '${quoted(probeRoot)}' ('stderr-' + $probeExit + '.log')
        ${controlled}
        $restoredThrows = $false
        try { Write-Error 'controlled-stop-restored' } catch { $restoredThrows = $_.Exception.Message -eq 'controlled-stop-restored' }
        $nonzeroRejected = $false
        try { if (${exitVariable} -ne 0) { throw 'controlled-native-nonzero' } } catch { $nonzeroRejected = $_.Exception.Message -eq 'controlled-native-nonzero' }
        $observed += [ordered]@{ requestedExit=$probeExit; actualExit=${exitVariable}; errorAction=[string]$ErrorActionPreference;
          restoredThrows=$restoredThrows; nonzeroRejected=$nonzeroRejected;
          stdout=[string](Get-Content -LiteralPath $stdoutPath -Raw); stderr=[string](Get-Content -LiteralPath $stderrPath -Raw) }
      }
      $observed | ConvertTo-Json -Depth 4 -Compress`;
    const result = spawnSync(host, ['-NoProfile', '-NonInteractive', '-EncodedCommand', Buffer.from(command, 'utf16le').toString('base64')], { encoding: 'utf8', timeout: 20000 });
    expect(result.status, result.stdout + result.stderr).toBe(0);
    const values = JSON.parse(result.stdout.trim());
    expect(values).toHaveLength(2);
    for (const value of values) {
      expect(value.actualExit).toBe(value.requestedExit);
      expect(value.errorAction).toBe('Stop');
      expect(value.restoredThrows).toBe(true);
      expect(value.nonzeroRejected).toBe(value.requestedExit !== 0);
      for (const stream of ['stdout', 'stderr']) for (const line of outputLines(stream)) expect(value[stream]).toContain(line);
    }
    probePassed = true;
  } finally {
    // 失败保留自有日志，成功只删除本次明确创建的文件。
    if (probePassed) {
      fs.unlinkSync(probePath);
      for (const code of [0, 17]) for (const stream of ['stdout', 'stderr']) fs.unlinkSync(path.join(probeRoot, `${stream}-${code}.log`));
      fs.rmdirSync(probeRoot);
    }
  }
}

describe('optional packaged Worker work package forwarding', () => {
  it.each(['smoke-installed-package.ps1', 'smoke-folder-zip-launch.ps1'])('preserves %s defaults and forwards only the explicit optional work package', name => {
    const file = path.resolve('scripts', name); const source = fs.readFileSync(file, 'utf8');
    expect(source).toContain("[string]$AcceptanceWorkPackagePath = ''");
    expect(source).toContain('$runtimeWorkPackageArgs = @()');
    expect(source).toContain("$runtimeWorkPackageArgs = @('--acceptance-work-package', $AcceptanceWorkPackagePath)");
    expect(source).toContain('@runtimeWorkPackageArgs 1>');
    expect(source).toContain('checks.packagedWorkerViewRefreshFaithfulNonReadyExport');
    expect(source).toContain('checks.originalWorkPackageUnchanged');
    expect(source).not.toMatch(/Copy-Item[^\r\n]*AcceptanceWorkPackagePath|Remove-Item[^\r\n]*AcceptanceWorkPackagePath/);
    const result = spawnSync('pwsh', ['-NoProfile', '-NonInteractive', '-Command', `$errors=$null; $tokens=$null; $ast=[Management.Automation.Language.Parser]::ParseFile('${file.replaceAll("'", "''")}',[ref]$tokens,[ref]$errors); if($errors.Count){$errors|ConvertTo-Json; exit 1}; $parameter=$ast.ParamBlock.Parameters|Where-Object {$_.Name.VariablePath.UserPath -eq 'AcceptanceWorkPackagePath'}; if(@($parameter).Count -ne 1){throw '参数未公开'}`], { encoding: 'utf8', timeout: 20000 });
    expect(result.status, result.stdout + result.stderr).toBe(0);
    expect(fs.readFileSync(file).subarray(0, 3)).toEqual(Buffer.from([0xef, 0xbb, 0xbf]));
    const systemParse = spawnSync(systemPowerShell, ['-NoProfile', '-NonInteractive', '-Command', `$errors=$null; $tokens=$null; $ast=[Management.Automation.Language.Parser]::ParseFile('${file.replaceAll("'", "''")}',[ref]$tokens,[ref]$errors); if($errors.Count){$errors|ConvertTo-Json; exit 1}; $parameter=$ast.ParamBlock.Parameters|Where-Object {$_.Name.VariablePath.UserPath -eq 'AcceptanceWorkPackagePath'}; if(@($parameter).Count -ne 1){throw '参数未公开'}`], { encoding: 'utf8', timeout: 20000 });
    expect(systemParse.status, systemParse.stdout + systemParse.stderr).toBe(0);
    if (name.includes('folder-zip')) expect(source).toContain('$VerifyConfiguration = $true');
    for (const host of [systemPowerShell, 'pwsh']) verifyNativeStderrBoundary(source, name, host);
  });

  it.each(['smoke-installed-package.ps1', 'smoke-folder-zip-launch.ps1'])('reads %s UTF8 JSON without BOM and rejects malformed JSON on both PowerShell hosts', name => {
    const source = fs.readFileSync(path.resolve('scripts', name), 'utf8');
    for (const host of [systemPowerShell, 'pwsh']) verifyUtf8JsonReaders(source, name, host);
  });
});
