const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');

const ROOT = path.resolve(__dirname, '..');
const PROGRESS_TEMPLATE = path.join(ROOT, 'build', 'nsis', 'portable-progress.nsi');

function withPortableTemplateOverride(options, callback) {
  const installedTemplate = path.resolve(options.installedTemplate);
  const replacementTemplate = path.resolve(options.replacementTemplate);
  const original = fs.readFileSync(installedTemplate);
  const replacement = fs.readFileSync(replacementTemplate);
  const originalText = original.toString('utf8');
  const replacementText = replacement.toString('utf8');

  if (!/SetSilent silent/.test(originalText)
    || !/templates[\\/]nsis[\\/]portable\.nsi$/i.test(installedTemplate)) {
    throw new Error(`Installed electron-builder portable template is unsupported: ${installedTemplate}`);
  }
  assertProgressTemplateContract(replacementText);

  let callbackError;
  let restoreError;
  let result;
  try {
    fs.writeFileSync(installedTemplate, replacement);
    result = callback();
  } catch (error) {
    callbackError = error;
  } finally {
    try {
      fs.writeFileSync(installedTemplate, original);
      if (!fs.readFileSync(installedTemplate).equals(original)) {
        throw new Error('electron-builder portable template restoration was not byte-exact.');
      }
    } catch (error) {
      restoreError = error;
    }
  }

  if (callbackError && restoreError) {
    throw new AggregateError(
      [callbackError, restoreError],
      `Electron builder failed and portable template restoration also failed: ${callbackError.message}`,
    );
  }
  if (callbackError) throw callbackError;
  if (restoreError) throw restoreError;
  return result;
}

function assertProgressTemplateContract(contents) {
  const required = [
    'MUI_PAGE_INSTFILES',
    'AmazonAIOpsAgentPortableLauncher-v1',
    '正在解压运行文件',
    '请勿重复点击',
    'HideWindow',
    'ExecWait',
    '$0 = 78',
    '安全校验错误 78',
  ];
  for (const marker of required) {
    if (!contents.includes(marker)) {
      throw new Error(`Portable progress template is missing contract marker: ${marker}`);
    }
  }
  if (/SetSilent\s+silent/i.test(contents)) {
    throw new Error('Portable progress template must not enable silent extraction.');
  }
  const cleanupContract = [
    /ExecWait[^\n]+\$0[\s\S]+SetOutPath \$EXEDIR\s+(?:#[^\n]*\s+)?StrCpy \$R5 \$0\s+StrCpy \$1 0\s+portable_cleanup_retry:/,
    /portable_cleanup_retry:\s+IntOp \$1 \$1 \+ 1\s+ClearErrors\s+RMDir \/r "\$INSTDIR"/,
    /GetFileAttributesW\(w "\$INSTDIR"\) i \.r2 \?e'\s+Pop \$3/,
    /\$\{If\} \$2 = -1\s+\$\{If\} \$3 = 2\s+\$\{OrIf\} \$3 = 3\s+Goto portable_cleanup_done/,
    /\$\{If\} \$1 < 40\s+Sleep 500\s+Goto portable_cleanup_retry\s+\$\{EndIf\}/,
    /!include "FileFunc\.nsh"/,
    /\$\{GetTime\} "" "LS" \$4 \$5 \$7 \$8 \$9 \$R0 \$R1/,
    /IntFmt \$9 "%02d" \$9\s+StrCpy \$R2 "\$7-\$5-\$4T\$9:\$R0:\$R1Z"/,
    /"timestamp":"\$R2","level":"error","event":"portable\.cleanup_failed","context":\{"launcherPid":\$6,"attempts":\$1,"childExitCode":\$R5,"win32Error":\$3\}\}/,
    /\$\{If\} \$R5 = 0\s+SetErrorLevel 79\s+\$\{Else\}\s+SetErrorLevel \$R5\s+\$\{EndIf\}\s+Goto portable_cleanup_end/,
    /portable_cleanup_done:\s+SetErrorLevel \$R5\s+portable_cleanup_end:/,
  ];
  if (cleanupContract.some((contract) => !contract.test(contents))) {
    throw new Error('Portable progress template must preserve bounded cleanup, diagnostics, and child exit status.');
  }
}

function runElectronBuilderWindows(argv = process.argv.slice(2), injected = {}) {
  const electronBuilderCli = path.resolve(argv[0] || '');
  const builderArgs = argv.slice(1);
  if (!fs.existsSync(electronBuilderCli) || !fs.statSync(electronBuilderCli).isFile()) {
    throw new Error(`electron-builder CLI is missing: ${electronBuilderCli}`);
  }
  if (builderArgs.length === 0) {
    throw new Error('electron-builder arguments are required.');
  }

  const appBuilderRoot = path.dirname(require.resolve('app-builder-lib/package.json', {
    paths: [path.dirname(electronBuilderCli)],
  }));
  const installedTemplate = path.join(appBuilderRoot, 'templates', 'nsis', 'portable.nsi');
  const run = injected.run || (() => spawnSync(process.execPath, [electronBuilderCli, ...builderArgs], {
    cwd: path.join(ROOT, 'apps', 'desktop'),
    env: process.env,
    encoding: 'utf8',
    maxBuffer: 16 * 1024 * 1024,
    shell: false,
    windowsHide: true,
    stdio: 'inherit',
  }));

  return withPortableTemplateOverride({
    installedTemplate,
    replacementTemplate: injected.replacementTemplate || PROGRESS_TEMPLATE,
  }, () => {
    const result = run();
    if (result?.error) {
      throw new Error(`electron-builder failed to start: ${result.error.message}`);
    }
    if (result?.status !== 0 || result?.signal) {
      throw new Error(
        `electron-builder failed${result?.signal ? ` (${result.signal})` : ` (${result?.status})`}.`,
      );
    }
    return result;
  });
}

function main() {
  try {
    runElectronBuilderWindows();
  } catch (error) {
    console.error(`[ELECTRON BUILDER BLOCKED] ${error.message}`);
    if (error instanceof AggregateError) {
      for (const nested of error.errors) console.error(`- ${nested.message}`);
    }
    process.exitCode = 1;
  }
}

module.exports = {
  PROGRESS_TEMPLATE,
  assertProgressTemplateContract,
  runElectronBuilderWindows,
  withPortableTemplateOverride,
};

if (require.main === module) main();
