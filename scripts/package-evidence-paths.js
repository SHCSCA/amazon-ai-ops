const fs = require('node:fs');
const path = require('node:path');
const {
  normalizeWindowsPath,
  resolveEvidenceUserDataRoot,
  validateEvidenceUserDataPath,
} = require('./evidence-user-data');

function resolvePackageEvidencePaths(workspaceRoot, runId) {
  if (!/^[0-9]+$/.test(String(runId))) throw new Error('Evidence run id must contain digits only.');
  const driveRoot = path.win32.parse(path.win32.normalize(workspaceRoot)).root;
  const temporaryRoot = resolveEvidenceUserDataRoot(driveRoot);
  const scopedPath = (...segments) => validateEvidenceUserDataPath(
    path.win32.join(temporaryRoot, ...segments), { requireExisting: false },
  );
  return {
    packageLaunchUserDataRoot: scopedPath('amazon-ai-ops-package-launch-smoke', String(runId)),
    folderZipExtractRoot: scopedPath(`amazon-ai-ops-folder-zip-smoke-${runId}`),
    folderZipUserDataRoot: scopedPath(`amazon-ai-ops-folder-zip-user-${runId}`),
  };
}

function assertExactEvidencePath(candidate, expected) {
  const expectedPath = validateEvidenceUserDataPath(expected, { requireExisting: false });
  // 已创建的目录再次检查真实路径，避免清理时穿过链接或挂载点。
  const actualPath = validateEvidenceUserDataPath(candidate, { requireExisting: fs.existsSync(candidate) });
  if (normalizeWindowsPath(actualPath) !== normalizeWindowsPath(expectedPath)) {
    throw new Error('Evidence path must match the exact directory assigned to this run.');
  }
  return actualPath;
}

function main(argv = process.argv.slice(2)) {
  if (argv.length !== 3) throw new Error('Expected resolve <workspace> <run-id> or assert <candidate> <expected>.');
  const [operation, first, second] = argv;
  if (operation === 'resolve') return resolvePackageEvidencePaths(first, second);
  if (operation === 'assert') return assertExactEvidencePath(first, second);
  throw new Error('Unsupported evidence path operation.');
}

if (require.main === module) {
  try {
    process.stdout.write(`${JSON.stringify(main())}\n`);
  } catch (error) {
    process.stderr.write(`${JSON.stringify({ timestamp: new Date().toISOString(), level: 'error',
      event: 'evidence.path_failed', context: { error: { name: error.name, message: error.message } } })}\n`);
    process.exitCode = 1;
  }
}

module.exports = { assertExactEvidencePath, main, resolvePackageEvidencePaths };
