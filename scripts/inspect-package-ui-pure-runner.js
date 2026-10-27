module.exports = function createInspectorModule(dependencies) {
  const {
    ROOT,
    path,
    spawnSync,
  } = dependencies;
  const fail = (...args) => dependencies.fail(...args);

function invokePureRunnerChild(operation, input) {
  const childSource = [
    "const Module=require('node:module');",
    'const original=Module._load;',
    "Module._load=function(request,parent,isMain){if(request==='./playwright-loader'&&/package-ui-evidence\\.js$/i.test(String(parent?.filename||'')))return {_electron:null};return original.apply(this,arguments);};",
    "const fs=require('node:fs');",
    "const input=JSON.parse(fs.readFileSync(0,'utf8')||'{}');",
    'const runner=require(input.runnerPath);',
    'let result;',
    "if(input.operation==='facts'){",
    'const runnerContract=runner.buildPackageUiRunnerContract();',
    'result={',
    'runnerContract,',
    'packageProcess:runner.collectMatchingPackageProcesses(input.executablePath),',
    'profileProcess:runner.collectMatchingProfileBrowserProcesses(input.profileBrowserPath,{expectedExecutablePath:input.chromiumPath}),',
    'runnerLease:runner.inspectPackageUiRunGroupLease({outputDir:input.outputDir,runGroupId:input.runGroupId,runnerContractSha256:runnerContract.sha256})',
    '};',
    "}else if(input.operation==='profile-evidence'){",
    'result=runner.evaluatePackageUiProfileEvidence(input.profileId,input.runEvidence);',
    "}else if(input.operation==='manifest-evidence'){",
    'result=runner.evaluatePackageUiEvidenceCompleteness(input.manifest);',
    "}else if(input.operation==='provenance'){",
    'result={',
    'fileIsolation:runner.evaluateProfileDatabaseFileIsolation({profileDatabasePath:input.profileDatabasePath,protectedDatabasePath:input.protectedDatabasePath}),',
    'provenance:runner.evaluateProfileDatabaseProvenance({profileDatabase:input.profileDatabase,protectedDatabase:input.protectedDatabase})',
    '};',
    "}else{throw new Error('Unknown pure-runner operation');}",
    'process.stdout.write(JSON.stringify(result));',
  ].join('');
  const result = spawnSync(process.execPath, ['-e', childSource], {
    cwd: ROOT,
    encoding: 'utf8',
    input: JSON.stringify({ ...input, operation }),
    maxBuffer: 16 * 1024 * 1024,
    shell: false,
    timeout: 60_000,
    windowsHide: true,
  });
  if (result.error || result.status !== 0 || result.signal) {
    fail('RUNNER_PREFLIGHT_INVALID', 'The pure runner validation child could not be completed.');
  }
  try {
    return JSON.parse(String(result.stdout || ''));
  } catch {
    fail('RUNNER_PREFLIGHT_INVALID', 'The pure runner validation child returned malformed JSON.');
  }
}

function runnerFactsFromPureChild(input) {
  return invokePureRunnerChild('facts', input);
}

function validateProfileEvidenceFromPureChild({ profileId, runEvidence, runnerPath }) {
  return invokePureRunnerChild('profile-evidence', {
    profileId,
    runEvidence,
    runnerPath,
  });
}

function validateManifestEvidenceFromPureChild({ manifest, runnerPath }) {
  return invokePureRunnerChild('manifest-evidence', {
    manifest,
    runnerPath,
  });
}

function validateProfileDatabaseProvenanceFromPureChild(input) {
  return invokePureRunnerChild('provenance', input);
}

function validateAuthoritySelectionFromPureChild({
  canonicalPaths,
  protectedDatabasePath,
  receiptPath,
}) {
  const childSource = [
    "const crypto=require('node:crypto');",
    "const fs=require('node:fs');",
    "const path=require('node:path');",
    "const input=JSON.parse(fs.readFileSync(0,'utf8')||'{}');",
    "const verifier=require(input.verifierPath);",
    'const stable=(value)=>Array.isArray(value)?`[${value.map(stable).join(",")}]`:value&&typeof value==="object"?`{${Object.keys(value).sort().map((key)=>`${JSON.stringify(key)}:${stable(value[key])}`).join(",")}}`:JSON.stringify(value);',
    'const comparable=(selection)=>{const copy=JSON.parse(JSON.stringify(selection));const selected=copy?.selected;if(selected?.sidecarObservation?.shmMayChangeForReadonlyWalLocking===true&&selected?.sidecars?.shm?.exists===true&&selected?.sidecarsBefore?.shm?.exists===true){delete selected.sidecars.shm.mtimeMs;delete selected.sidecarsBefore.shm.mtimeMs;}return copy;};',
    'const samePath=(left,right)=>path.resolve(left).replace(/[\\\\/]+$/,"").toLowerCase()===path.resolve(right).replace(/[\\\\/]+$/,"").toLowerCase();',
    'const bytes=fs.readFileSync(input.receiptPath);',
    'const receipt=JSON.parse(bytes.toString("utf8"));',
    'const mainSha=String(receipt?.selection?.selected?.mainFileSha256||"").toUpperCase();',
    'const current=verifier.inspectProductionAuthoritySelection({dbPath:input.protectedDatabasePath,expectedUserDataDir:input.canonicalPaths.userDataDir,expectedMainSha256:mainSha},{env:{APPDATA:input.canonicalPaths.roamingAppData,USERPROFILE:input.canonicalPaths.userProfile},writeStdout:()=>{}});',
    'const logical=current?.selection?.selected?.logicalCapture;',
    'const passed=receipt?.kind===verifier.KIND&&receipt?.schemaVersion===verifier.SCHEMA_VERSION&&["SELECTED_SCHEMA_READY","SELECTED_MIGRATION_REQUIRED"].includes(receipt?.status)&&receipt.status===current.status&&receipt.formalEvidence===false&&receipt.authorityDatabaseMutated===false&&receipt.adsExecutionInvoked===false&&new Date(Date.parse(receipt.generatedAt)).toISOString()===receipt.generatedAt&&stable(comparable(receipt.selection))===stable(comparable(current.selection))&&samePath(current.selection?.expectedUserDataDir,input.canonicalPaths.userDataDir)&&samePath(current.selection?.expectedDatabasePath,input.protectedDatabasePath)&&samePath(current.selection?.selected?.absolutePath,input.protectedDatabasePath)&&samePath(current.selection?.selected?.realPath,input.protectedDatabasePath);',
    'process.stdout.write(JSON.stringify({logicalArtifact:logical?{method:logical.method,remainingPages:logical.remainingPages,schemaVersion:logical.schemaVersion,sha256:logical.logicalBackupSha256,sizeBytes:logical.logicalBackupSizeBytes,totalPages:logical.totalPages}:null,passed,receiptSha256:crypto.createHash("sha256").update(bytes).digest("hex").toUpperCase(),status:current?.status||null}));',
  ].join('');
  const result = spawnSync(process.execPath, ['-e', childSource], {
    cwd: ROOT,
    encoding: 'utf8',
    input: JSON.stringify({
      canonicalPaths,
      protectedDatabasePath,
      receiptPath,
      verifierPath: path.join(__dirname, 'verify-production-authority-selection.js'),
    }),
    maxBuffer: 4 * 1024 * 1024,
    shell: false,
    timeout: 120_000,
    windowsHide: true,
  });
  if (result.error || result.status !== 0 || result.signal) {
    fail('AUTHORITY_SELECTION_INVALID', 'The current production authority-selection receipt could not be revalidated.');
  }
  try {
    return JSON.parse(String(result.stdout || ''));
  } catch {
    fail('AUTHORITY_SELECTION_INVALID', 'Authority-selection validation returned malformed JSON.');
  }
}

  return {
    invokePureRunnerChild,
    runnerFactsFromPureChild,
    validateProfileEvidenceFromPureChild,
    validateManifestEvidenceFromPureChild,
    validateProfileDatabaseProvenanceFromPureChild,
    validateAuthoritySelectionFromPureChild,
  };
};
