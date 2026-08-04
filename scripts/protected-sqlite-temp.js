const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const DEFAULT_CLEANUP_MAX_DEPTH = 32;
const DEFAULT_CLEANUP_MAX_ENTRIES = 2_048;
const DEFAULT_CLEANUP_MAX_PATH_CHARACTERS = 512_000;
const DEFAULT_CLEANUP_TIMEOUT_MS = 10_000;
const DEFAULT_CLEANUP_RETRIES = 3;
const MAX_ACL_OUTPUT_BYTES = 1024 * 1024;
const WINDOWS_ADMINISTRATORS_SID = 'S-1-5-32-544';
const WINDOWS_SYSTEM_SID = 'S-1-5-18';

function fail(message) {
  throw new Error(message);
}

function normalizedPath(filePath) {
  return path.resolve(filePath).replace(/[\\/]+$/, '').toLowerCase();
}

function samePath(left, right) {
  return normalizedPath(left) === normalizedPath(right);
}

function isPathContained(rootPath, candidatePath) {
  const relative = path.relative(path.resolve(rootPath), path.resolve(candidatePath));
  return relative === ''
    || (
      !path.isAbsolute(relative)
      && relative !== '..'
      && !relative.startsWith(`..${path.sep}`)
    );
}

function assertOwnedTempRoot(tempParent, tempRoot, expectedPrefix) {
  const parent = path.resolve(tempParent);
  const root = path.resolve(tempRoot);
  if (
    typeof expectedPrefix !== 'string'
    || !/^[A-Za-z0-9][A-Za-z0-9._-]{15,120}$/.test(expectedPrefix)
    || !samePath(path.dirname(root), parent)
    || !path.basename(root).startsWith(expectedPrefix)
  ) {
    fail('Refusing to operate on an unowned SQLite temporary directory.');
  }
  if (!fs.existsSync(root)) return { parent, root };
  const stat = fs.lstatSync(root);
  const real = fs.realpathSync.native(root);
  if (
    stat.isSymbolicLink()
    || !stat.isDirectory()
    || !samePath(real, root)
  ) {
    fail('SQLite temporary root identity is linked, indirect, or no longer a directory.');
  }
  return { parent, root };
}

function windowsAclScript(applyFreshAcl) {
  const apply = applyFreshAcl ? '$true' : '$false';
  return [
    "$ErrorActionPreference = 'Stop'",
    "$target = [Environment]::GetEnvironmentVariable('PACKAGE_UI_SQLITE_TEMP_ROOT')",
    "if ([string]::IsNullOrWhiteSpace($target)) { throw 'Missing protected temp root.' }",
    '$directory = [System.IO.DirectoryInfo]::new($target)',
    'if (-not $directory.Exists) { throw "Protected temp root is missing." }',
    '$currentSid = [Security.Principal.WindowsIdentity]::GetCurrent().User',
    '$systemSid = [Security.Principal.SecurityIdentifier]::new([Security.Principal.WellKnownSidType]::LocalSystemSid, $null)',
    '$administratorsSid = [Security.Principal.SecurityIdentifier]::new([Security.Principal.WellKnownSidType]::BuiltinAdministratorsSid, $null)',
    '$expectedSids = @($currentSid.Value, $systemSid.Value, $administratorsSid.Value) | Sort-Object -Unique',
    `if (${apply}) {`,
    '  $fresh = [Security.AccessControl.DirectorySecurity]::new()',
    '  $fresh.SetOwner($currentSid)',
    '  $fresh.SetAccessRuleProtection($true, $false)',
    '  $inheritance = [Security.AccessControl.InheritanceFlags]::ContainerInherit -bor [Security.AccessControl.InheritanceFlags]::ObjectInherit',
    '  foreach ($sid in @($currentSid, $systemSid, $administratorsSid)) {',
    "    $rule = [Security.AccessControl.FileSystemAccessRule]::new($sid, 'FullControl', $inheritance, 'None', 'Allow')",
    '    $fresh.AddAccessRule($rule)',
    '  }',
    '  $directory.SetAccessControl($fresh)',
    '}',
    '$sections = [Security.AccessControl.AccessControlSections]::Access -bor [Security.AccessControl.AccessControlSections]::Owner',
    '$readback = $directory.GetAccessControl($sections)',
    '$owner = $readback.GetOwner([Security.Principal.SecurityIdentifier])',
    '$rules = @($readback.GetAccessRules($true, $true, [Security.Principal.SecurityIdentifier]))',
    '$actualSids = @($rules | ForEach-Object { $_.IdentityReference.Value } | Sort-Object -Unique)',
    '$expectedInheritance = [Security.AccessControl.InheritanceFlags]::ContainerInherit -bor [Security.AccessControl.InheritanceFlags]::ObjectInherit',
    '$exactRules = @($rules | Where-Object {',
    '  (-not $_.IsInherited) -and',
    "  ($_.AccessControlType -eq [Security.AccessControl.AccessControlType]::Allow) -and",
    "  ($_.FileSystemRights -eq [Security.AccessControl.FileSystemRights]::FullControl) -and",
    '  ($_.InheritanceFlags -eq $expectedInheritance) -and',
    "  ($_.PropagationFlags -eq [Security.AccessControl.PropagationFlags]::None) -and",
    '  ($expectedSids -contains $_.IdentityReference.Value)',
    '})',
    '$inheritedRules = @($rules | Where-Object { $_.IsInherited })',
    "$deniedRules = @($rules | Where-Object { $_.AccessControlType -ne [Security.AccessControl.AccessControlType]::Allow })",
    'if (-not $readback.AreAccessRulesProtected) { throw "Protected temp ACL still inherits permissions." }',
    'if ($owner.Value -ne $currentSid.Value) { throw "Protected temp ACL owner does not match the current user." }',
    'if ($rules.Count -ne 3 -or $exactRules.Count -ne 3 -or $inheritedRules.Count -ne 0 -or $deniedRules.Count -ne 0) { throw "Protected temp ACL has non-exact or high-risk rules." }',
    'if (($actualSids -join "|") -ne ($expectedSids -join "|")) { throw "Protected temp ACL principals are not exact." }',
    '[pscustomobject]@{',
    '  allowedSids = @($actualSids)',
    '  areAccessRulesProtected = [bool]$readback.AreAccessRulesProtected',
    '  deniedRuleCount = [int]$deniedRules.Count',
    '  exactRuleCount = [int]$exactRules.Count',
    '  inheritedRuleCount = [int]$inheritedRules.Count',
    '  ownerSid = $owner.Value',
    '  ruleCount = [int]$rules.Count',
    "} | ConvertTo-Json -Compress",
  ].join('\n');
}

function parseWindowsAclProof(result) {
  if (result?.error || result?.status !== 0 || result?.signal) {
    fail('SQLite temporary root ACL application/readback failed before any DB copy.');
  }
  const output = String(result?.stdout || '').trim();
  if (!output || Buffer.byteLength(output, 'utf8') > MAX_ACL_OUTPUT_BYTES) {
    fail('SQLite temporary root ACL readback returned no bounded proof.');
  }
  let proof;
  try {
    proof = JSON.parse(output);
  } catch {
    fail('SQLite temporary root ACL readback returned malformed proof.');
  }
  const keys = Object.keys(proof || {}).sort();
  const expectedKeys = [
    'allowedSids',
    'areAccessRulesProtected',
    'deniedRuleCount',
    'exactRuleCount',
    'inheritedRuleCount',
    'ownerSid',
    'ruleCount',
  ].sort();
  const expectedSids = [
    proof?.ownerSid,
    WINDOWS_ADMINISTRATORS_SID,
    WINDOWS_SYSTEM_SID,
  ].sort();
  if (
    JSON.stringify(keys) !== JSON.stringify(expectedKeys)
    || !/^S-\d(?:-\d+)+$/.test(String(proof?.ownerSid || ''))
    || proof.areAccessRulesProtected !== true
    || proof.ruleCount !== 3
    || proof.exactRuleCount !== 3
    || proof.inheritedRuleCount !== 0
    || proof.deniedRuleCount !== 0
    || !Array.isArray(proof.allowedSids)
    || JSON.stringify([...proof.allowedSids].sort()) !== JSON.stringify(expectedSids)
  ) {
    fail('SQLite temporary root ACL readback was not exact or contained a high-risk principal.');
  }
  return Object.freeze({
    ...proof,
    allowedSids: Object.freeze([...proof.allowedSids]),
    method: 'windows-fresh-protected-acl-readback',
    passed: true,
  });
}

function executeWindowsAclProof(tempRoot, applyFreshAcl, run = spawnSync) {
  let result;
  try {
    result = run(
      'powershell.exe',
      ['-NoProfile', '-NonInteractive', '-Command', windowsAclScript(applyFreshAcl)],
      {
        encoding: 'utf8',
        env: {
          ...process.env,
          PACKAGE_UI_SQLITE_TEMP_ROOT: path.resolve(tempRoot),
        },
        maxBuffer: MAX_ACL_OUTPUT_BYTES,
        shell: false,
        timeout: 20_000,
        windowsHide: true,
      },
    );
  } catch {
    fail('SQLite temporary root ACL application/readback threw before any DB copy.');
  }
  return parseWindowsAclProof(result);
}

function restrictWindowsTempAcl(tempRoot, options = {}) {
  try {
    fs.chmodSync(tempRoot, 0o700);
  } catch (error) {
    if (process.platform !== 'win32') {
      fail('SQLite temporary root permissions could not be restricted.');
    }
  }
  if (process.platform !== 'win32') {
    return Object.freeze({ method: 'chmod-0700', passed: true });
  }
  return executeWindowsAclProof(
    tempRoot,
    true,
    options.spawnSync || spawnSync,
  );
}

function verifyWindowsTempAcl(tempRoot, options = {}) {
  if (process.platform !== 'win32') {
    return Object.freeze({ method: 'chmod-0700', passed: true });
  }
  return executeWindowsAclProof(
    tempRoot,
    false,
    options.spawnSync || spawnSync,
  );
}

function boundedRemoveDirectory(root, options = {}) {
  const deadline = Date.now()
    + (options.cleanupTimeoutMs || DEFAULT_CLEANUP_TIMEOUT_MS);
  const maxDepth = options.cleanupMaxDepth || DEFAULT_CLEANUP_MAX_DEPTH;
  const maxEntries = options.cleanupMaxEntries || DEFAULT_CLEANUP_MAX_ENTRIES;
  const maxPathCharacters = options.cleanupMaxPathCharacters
    || DEFAULT_CLEANUP_MAX_PATH_CHARACTERS;
  let entryCount = 0;
  let totalPathCharacters = 0;

  const remove = (candidate, depth) => {
    if (Date.now() > deadline) {
      fail('SQLite temporary root cleanup deadline was exceeded.');
    }
    if (depth > maxDepth) {
      fail('SQLite temporary root cleanup depth limit was exceeded.');
    }
    const resolved = path.resolve(candidate);
    if (!isPathContained(root, resolved)) {
      fail('SQLite temporary root cleanup encountered a path escape.');
    }
    entryCount += 1;
    totalPathCharacters += resolved.length;
    if (entryCount > maxEntries) {
      fail('SQLite temporary root cleanup entry limit was exceeded.');
    }
    if (totalPathCharacters > maxPathCharacters) {
      fail('SQLite temporary root cleanup path-character limit was exceeded.');
    }
    let stat;
    try {
      stat = fs.lstatSync(resolved);
    } catch (error) {
      if (error?.code === 'ENOENT') return;
      throw error;
    }
    if (stat.isSymbolicLink() || !stat.isDirectory()) {
      fs.unlinkSync(resolved);
      return;
    }
    const real = fs.realpathSync.native(resolved);
    if (!samePath(real, resolved) || !isPathContained(root, real)) {
      fail('SQLite temporary root cleanup encountered an indirect directory.');
    }
    const directory = fs.opendirSync(resolved);
    try {
      for (;;) {
        if (Date.now() > deadline) {
          fail('SQLite temporary root cleanup deadline was exceeded.');
        }
        const entry = directory.readSync();
        if (!entry) break;
        if (
          !entry.name
          || entry.name === '.'
          || entry.name === '..'
          || path.basename(entry.name) !== entry.name
        ) {
          fail('SQLite temporary root cleanup encountered an unsafe entry name.');
        }
        remove(path.join(resolved, entry.name), depth + 1);
      }
    } finally {
      directory.closeSync();
    }
    fs.rmdirSync(resolved);
  };

  remove(root, 0);
}

function cleanupOwnedSqliteTempRoot(
  tempParent,
  tempRoot,
  expectedPrefix,
  options = {},
) {
  const { root } = assertOwnedTempRoot(
    tempParent,
    tempRoot,
    expectedPrefix,
  );
  if (!fs.existsSync(root)) return;
  const retries = Number.isInteger(options.cleanupRetries)
    ? options.cleanupRetries
    : DEFAULT_CLEANUP_RETRIES;
  let lastError = null;
  for (let attempt = 0; attempt < retries && fs.existsSync(root); attempt += 1) {
    try {
      boundedRemoveDirectory(root, options);
      lastError = null;
    } catch (error) {
      lastError = error;
    }
  }
  if (fs.existsSync(root) || lastError) {
    fail(
      'SQLite temporary DB copies could not be completely removed after bounded retries.',
    );
  }
}

module.exports = {
  cleanupOwnedSqliteTempRoot,
  restrictWindowsTempAcl,
  verifyWindowsTempAcl,
};
