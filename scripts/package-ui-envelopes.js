// 跨职责调用通过组合入口注入，延迟转发保留单一实现和初始化顺序。
module.exports = function createPackageUiModule(dependencies) {
  const {
    crypto,
    fs,
    path,
  } = dependencies;
  const artifactInfo = (...args) => dependencies.artifactInfo(...args);
  const canonicalJson = (...args) => dependencies.canonicalJson(...args);
  const fail = (...args) => dependencies.fail(...args);
  const safeSegment = (...args) => dependencies.safeSegment(...args);
  const sanitizeDiagnosticText = (...args) => dependencies.sanitizeDiagnosticText(...args);
  const sha256Buffer = (...args) => dependencies.sha256Buffer(...args);

function packageUiCursorBinding(state) {
  return {
    logicalDatabaseSha256: state?.logicalDatabase?.sha256 || null,
    logicalDatabaseSizeBytes: state?.logicalDatabase?.sizeBytes ?? null,
    logicalDatabaseTotalPages: state?.logicalDatabase?.totalPages ?? null,
    profileContentFileCount: state?.profileContent?.fileCount ?? null,
    profileContentSha256: state?.profileContent?.sha256 || null,
    profileContentSizeBytes: state?.profileContent?.sizeBytes ?? null,
  };
}

function envelopePayloadSha256(payload) {
  return sha256Buffer(Buffer.from(canonicalJson(payload), 'utf8'));
}

function createImmutableEnvelope(payload) {
  let normalizedPayload;
  try {
    normalizedPayload = JSON.parse(JSON.stringify(payload));
  } catch (error) {
    fail(
      'Package UI immutable evidence payload is not JSON serializable',
      sanitizeDiagnosticText(error?.message || error),
    );
  }
  return {
    payload: normalizedPayload,
    payloadSha256: envelopePayloadSha256(normalizedPayload),
  };
}

function writeImmutableEnvelope(filePath, payload) {
  const resolved = path.resolve(filePath);
  fs.mkdirSync(path.dirname(resolved), { recursive: true });
  if (fs.existsSync(resolved)) fail('Refusing to replace an immutable package UI evidence record', resolved);
  const tempPath = `${resolved}.tmp-${process.pid}-${crypto.randomUUID()}`;
  try {
    fs.writeFileSync(tempPath, `${JSON.stringify(createImmutableEnvelope(payload), null, 2)}\n`, {
      encoding: 'utf8',
      flag: 'wx',
    });
    fs.linkSync(tempPath, resolved);
    fs.unlinkSync(tempPath);
  } finally {
    if (fs.existsSync(tempPath)) fs.unlinkSync(tempPath);
  }
  return {
    ...artifactInfo(resolved),
  };
}

function readImmutableEnvelope(filePath, expectedKind, expectedSchemaVersion) {
  const resolved = path.resolve(filePath);
  const envelope = JSON.parse(fs.readFileSync(resolved, 'utf8'));
  if (
    !envelope?.payload
    || envelope.payload?.kind !== expectedKind
    || envelope.payload?.schemaVersion !== expectedSchemaVersion
    || envelope.payloadSha256 !== envelopePayloadSha256(envelope.payload)
  ) {
    fail('Immutable package UI evidence envelope is malformed or has been changed', resolved);
  }
  return {
    file: {
      ...artifactInfo(resolved),
    },
    payload: envelope.payload,
    payloadSha256: envelope.payloadSha256,
  };
}

function packageUiLeasePath(outputDir, runGroupId) {
  return path.join(
    path.resolve(outputDir),
    'run-leases',
    `${safeSegment(runGroupId)}.lease.json`,
  );
}

function writeJson(filePath, value) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
}

function writeJsonExclusive(filePath, value) {
  const resolved = path.resolve(filePath);
  fs.mkdirSync(path.dirname(resolved), { recursive: true });
  if (fs.existsSync(resolved)) {
    fail('Refusing to replace an immutable Package UI JSON record', resolved);
  }
  const temporaryPath = `${resolved}.tmp-${process.pid}-${crypto.randomUUID()}`;
  let descriptor;
  try {
    descriptor = fs.openSync(temporaryPath, 'wx', 0o600);
    fs.writeFileSync(descriptor, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
    fs.fsyncSync(descriptor);
    fs.closeSync(descriptor);
    descriptor = undefined;
    fs.linkSync(temporaryPath, resolved);
    fs.unlinkSync(temporaryPath);
  } finally {
    if (descriptor !== undefined) fs.closeSync(descriptor);
    if (fs.existsSync(temporaryPath)) fs.unlinkSync(temporaryPath);
  }
  return artifactInfo(resolved);
}

  return {
    packageUiCursorBinding,
    envelopePayloadSha256,
    createImmutableEnvelope,
    writeImmutableEnvelope,
    readImmutableEnvelope,
    packageUiLeasePath,
    writeJson,
    writeJsonExclusive,
  };
};
