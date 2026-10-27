module.exports = function createInspectorModule(dependencies) {
  const {
    DEFAULT_APP_CONTENT,
    DEFAULT_EXE,
    path,
    validateEvidenceUserDataPath,
  } = dependencies;
  const canonicalAuthorityPaths = (...args) => dependencies.canonicalAuthorityPaths(...args);
  const samePath = (...args) => dependencies.samePath(...args);

function parseArgs(argv) {
  const values = {};
  const names = new Set([
    'authority-selection',
    'output',
    'resume-run-group',
    'expected-exe-sha256',
    'expected-app-content-sha256',
    'user-data-dir',
    'protected-db',
  ]);
  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];
    if (token === '--help' || token === '-h') {
      if (argv.length !== 1) throw new Error('--help cannot be combined with inspection arguments.');
      return { help: true };
    }
    if (!token.startsWith('--') || !names.has(token.slice(2))) throw new Error(`Unknown argument: ${token}`);
    const key = token.slice(2);
    const value = argv[index + 1];
    if (!value || value.startsWith('--') || Object.hasOwn(values, key)) throw new Error(`${token} requires exactly one value`);
    values[key] = value;
    index += 1;
  }
  for (const key of names) if (!values[key]) throw new Error(`--${key} is required`);
  if (!/^[A-Za-z0-9][A-Za-z0-9._-]{5,80}$/.test(values['resume-run-group'])) throw new Error('--resume-run-group is not path-safe');
  for (const key of ['expected-exe-sha256', 'expected-app-content-sha256']) {
    values[key] = String(values[key]).toUpperCase();
    if (!/^[A-F0-9]{64}$/.test(values[key])) throw new Error(`--${key} must be SHA-256`);
  }
  values.output = path.resolve(values.output);
  values['user-data-dir'] = validateEvidenceUserDataPath(values['user-data-dir'], { requireExisting: false });
  values['protected-db'] = path.resolve(values['protected-db']);
  values['authority-selection'] = path.resolve(values['authority-selection']);
  const canonical = canonicalAuthorityPaths();
  if (!samePath(values['protected-db'], canonical.databasePath)) {
    throw new Error('--protected-db must be the canonical Amazon AI Ops authority database.');
  }
  values.executable = DEFAULT_EXE;
  values.appContent = DEFAULT_APP_CONTENT;
  return values;
}

function violation(code, message) {
  return { code, message };
}

function classify(violations) {
  if (violations.length === 0) return 'RESUME_SAFE';
  if (violations.some((item) => item.code === 'RUNNER_LEASE_UNSUPPORTED')) return 'RUNNER_REPAIR_REQUIRED';
  if (violations.some((item) => (
    item.code.startsWith('PROFILE_')
    || item.code.startsWith('ATTEMPT_')
    || item.code.startsWith('CHECKPOINT_')
    || item.code === 'CLEANUP_UNPROVEN'
    || item.code === 'CLEANUP_BINDING_UNPROVEN'
  ))) return 'FRESH_PROFILE_REQUIRED';
  if (violations.some((item) => (
    item.code.startsWith('AUTHORITY_')
    || item.code.startsWith('PACKAGE_')
    || item.code.startsWith('RUNNER_')
    || item.code.startsWith('CHROMIUM_')
    || item.code.startsWith('PROTECTED_DB_')
  ))) return 'LINEAGE_CHANGED';
  if (violations.some((item) => item.code.startsWith('PROCESS_'))) return 'PROCESS_STOP_REQUIRED';
  if (violations.every((item) => item.code === 'RUN_GROUP_COMPLETE')) return 'RUN_GROUP_COMPLETE';
  return 'RECORD_ROOT_REQUIRED';
}

function powershellQuote(value) {
  return `'${String(value).replace(/'/g, "''")}'`;
}

function profileCursorBinding(state) {
  return {
    logicalDatabaseSha256: state?.logicalDatabase?.sha256 || null,
    logicalDatabaseSizeBytes: state?.logicalDatabase?.sizeBytes ?? null,
    logicalDatabaseTotalPages: state?.logicalDatabase?.totalPages ?? null,
    profileContentFileCount: state?.profileContent?.fileCount ?? null,
    profileContentSha256: state?.profileContent?.sha256 || null,
    profileContentSizeBytes: state?.profileContent?.sizeBytes ?? null,
  };
}

function resumeInspectionCore(payload) {
  return {
    authorityBinding: payload?.authorityBinding,
    createdAt: payload?.createdAt,
    cursor: payload?.cursor,
    expiresAt: payload?.expiresAt,
    invocationId: payload?.invocationId,
    kind: payload?.kind,
    nextProfileId: payload?.nextProfileId,
    runGroupId: payload?.runGroupId,
    runnerContractSha256: payload?.runnerContractSha256,
    schemaVersion: payload?.schemaVersion,
  };
}

  return {
    parseArgs,
    violation,
    classify,
    powershellQuote,
    profileCursorBinding,
    resumeInspectionCore,
  };
};
