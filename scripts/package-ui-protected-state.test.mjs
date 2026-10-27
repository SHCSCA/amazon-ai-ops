import {
  EventEmitter,
  HASH_A,
  HASH_B,
  PROTECTED_DB_PATH,
  USER_DATA_DIR,
  appendRendererDiagnostic,
  attachElectronLifecycleDiagnostics,
  buildProtectedFileEvidence,
  chromiumLineageEvidencePassed,
  collectActiveBundledChromiumLineage,
  collectMatchingPackageProcesses,
  collectMatchingProfileBrowserProcesses,
  collectPackageUiProfileLockEvidence,
  createRunDiagnostics,
  describe,
  executeEvidenceRunWithIsolation,
  expect,
  extractProfileUserDataDirectories,
  it,
  linkSync,
  markRunnerElectronCloseRequested,
  mkdirSync,
  mkdtempSync,
  once,
  path,
  readFileSync,
  readdirSync,
  rmSync,
  sanitizeDiagnosticText,
  spawn,
  tmpdir,
  validProfileLockIsolation,
  validRunDiagnostics,
  waitForActiveBundledChromiumLineage,
  waitForPackageProcessCleanup,
  waitForProfileBrowserProcessCleanup,
  writeFileSync,
} from './package-ui-test-context.mjs';
import {
  validChromiumLineage,
  validProcessSnapshot,
} from './package-ui-test-fixtures.mjs';

describe('durable protected-state evidence', () => {
  it('requires the protected database path, hash, size, and mtime to remain identical', () => {
    const before = {
      path: PROTECTED_DB_PATH,
      sha256: HASH_A,
      sizeBytes: 42,
      mtimeMs: 1234,
    };
    expect(buildProtectedFileEvidence(before, { ...before })).toEqual({
      before,
      after: before,
      passed: true,
      unchanged: true,
    });
    expect(buildProtectedFileEvidence(before, { ...before, sha256: HASH_B })).toEqual(expect.objectContaining({
      passed: false,
      unchanged: false,
    }));
  });

  it('records matching package processes and waits until every matching executable exits', async () => {
    const executablePath = path.resolve('apps/desktop/release/win-unpacked/AmazonAIOpsAgent.exe');
    const running = collectMatchingPackageProcesses(executablePath, () => ({
      status: 0,
      stdout: JSON.stringify([{
        ExecutablePath: executablePath,
        Name: 'AmazonAIOpsAgent.exe',
        ParentProcessId: 10,
        ProcessId: 11,
      }]),
      stderr: '',
    }));
    expect(running).toEqual(expect.objectContaining({ matchingCount: 1, observedCount: 1, passed: true }));
    expect(running.unresolved).toEqual([]);

    const unresolved = collectMatchingPackageProcesses(executablePath, () => ({
      status: 0,
      stdout: JSON.stringify([{
        ExecutablePath: null,
        Name: 'AmazonAIOpsAgent.exe',
        ParentProcessId: 12,
        ProcessId: 13,
      }]),
      stderr: '',
    }));
    expect(unresolved).toEqual(expect.objectContaining({
      matching: [],
      matchingCount: 0,
      observedCount: 1,
      passed: false,
      unresolvedCount: 1,
    }));
    expect(unresolved.unresolved[0]).toEqual({
      executablePath: null,
      name: 'AmazonAIOpsAgent.exe',
      parentProcessId: 12,
      processId: 13,
    });

    let calls = 0;
    const cleanup = await waitForPackageProcessCleanup(executablePath, {
      attempts: 2,
      intervalMs: 0,
      collect: () => {
        calls += 1;
        return calls === 1
          ? { matchingCount: 1, passed: true }
          : { error: null, matching: [], matchingCount: 0, observedCount: 0, passed: true, unresolved: [], unresolvedCount: 0 };
      },
    });
    expect(cleanup).toEqual(expect.objectContaining({ attempts: 2, matchingCount: 0, passed: true }));
  });

  it('falls back from a failed package CIM query to an exact-name Get-Process snapshot with no matches', () => {
    const executablePath = path.resolve('apps/desktop/release/win-unpacked/AmazonAIOpsAgent.exe');
    const commands = [];
    const snapshot = collectMatchingPackageProcesses(executablePath, (_file, args) => {
      commands.push(String(args.at(-1)));
      return commands.length === 1
        ? { status: 1, stdout: '', stderr: 'HRESULT 0x80041006 WBEM resource limit' }
        : { status: 0, stdout: '[]', stderr: '' };
    });

    expect(snapshot).toEqual(expect.objectContaining({
      collectionMethod: 'get-process-fallback',
      error: null,
      matching: [],
      matchingCount: 0,
      observedCount: 0,
      passed: true,
      primaryError: expect.stringContaining('0x80041006'),
      unresolved: [],
      unresolvedCount: 0,
    }));
    expect(commands).toHaveLength(2);
    expect(commands[0]).toContain('Get-CimInstance Win32_Process');
    expect(commands[1]).toContain('Get-Process -ErrorAction Stop');
    expect(commands[1]).toContain('$expectedName');
  });

  it('detects the exact packaged executable through the Get-Process fallback and permits a null parent PID', () => {
    const executablePath = path.resolve('apps/desktop/release/win-unpacked/AmazonAIOpsAgent.exe');
    let calls = 0;
    const snapshot = collectMatchingPackageProcesses(executablePath, () => {
      calls += 1;
      return calls === 1
        ? { status: 1, stdout: '', stderr: 'CIM unavailable' }
        : {
            status: 0,
            stdout: JSON.stringify([{
              ExecutablePath: executablePath,
              Name: 'AmazonAIOpsAgent.exe',
              ParentProcessId: null,
              ProcessId: 4321,
            }]),
            stderr: '',
          };
    });

    expect(snapshot).toEqual(expect.objectContaining({
      collectionMethod: 'get-process-fallback',
      matchingCount: 1,
      observedCount: 1,
      passed: true,
      unresolvedCount: 0,
    }));
    expect(snapshot.matching[0]).toEqual({
      executablePath,
      name: 'AmazonAIOpsAgent.exe',
      parentProcessId: null,
      processId: 4321,
    });
  });

  it('keeps Get-Process fallback failures and unresolved executable paths fail-closed', () => {
    const executablePath = path.resolve('apps/desktop/release/win-unpacked/AmazonAIOpsAgent.exe');
    let calls = 0;
    const fallbackFailure = collectMatchingPackageProcesses(executablePath, () => {
      calls += 1;
      return calls === 1
        ? { status: 1, stdout: '', stderr: 'CIM unavailable' }
        : { status: 1, stdout: '', stderr: 'Get-Process denied' };
    });
    expect(fallbackFailure).toEqual(expect.objectContaining({
      collectionMethod: 'get-process-fallback',
      matchingCount: null,
      observedCount: null,
      passed: false,
      unresolvedCount: null,
    }));
    expect(fallbackFailure.error).toContain('fallback: Get-Process denied');

    calls = 0;
    const unresolved = collectMatchingPackageProcesses(executablePath, () => {
      calls += 1;
      return calls === 1
        ? { status: 1, stdout: '', stderr: 'CIM unavailable' }
        : {
            status: 0,
            stdout: JSON.stringify([{
              ExecutablePath: null,
              Name: 'AmazonAIOpsAgent.exe',
              ParentProcessId: null,
              ProcessId: 9876,
            }]),
            stderr: '',
          };
    });
    expect(unresolved).toEqual(expect.objectContaining({
      collectionMethod: 'get-process-fallback',
      matchingCount: 0,
      observedCount: 1,
      passed: false,
      unresolvedCount: 1,
    }));
    expect(unresolved.unresolved[0].parentProcessId).toBeNull();
  });

  it('matches only Chrome, Chromium, or Edge processes bound to the exact isolated profile without persisting command lines', async () => {
    const profilePath = path.join(USER_DATA_DIR, 'storage', 'browser-data');
    expect(extractProfileUserDataDirectories(
      `"C:\\browser\\chrome.exe" --user-data-dir="${profilePath}" --type=browser`,
    )).toContain(profilePath);
    expect(extractProfileUserDataDirectories(
      `"C:\\browser\\chromium.exe" "--user-data-dir=${profilePath}" --type=renderer`,
    )).toContain(profilePath);

    const snapshot = collectMatchingProfileBrowserProcesses(profilePath, () => ({
      status: 0,
      stdout: JSON.stringify([
        {
          CommandLine: `"C:\\browser\\chrome.exe" --user-data-dir="${profilePath}" --type=browser`,
          ExecutablePath: 'C:\\browser\\chrome.exe',
          Name: 'chrome.exe',
          ParentProcessId: 10,
          ProcessId: 11,
        },
        {
          CommandLine: '"C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe" --user-data-dir="D:\\Other\\edge-profile"',
          ExecutablePath: 'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe',
          Name: 'msedge.exe',
          ParentProcessId: 20,
          ProcessId: 21,
        },
      ]),
      stderr: '',
    }));

    expect(snapshot).toEqual(expect.objectContaining({ matchingCount: 1, observedCount: 2, passed: true }));
    expect(snapshot.matching[0]).toEqual({
      executablePath: 'C:\\browser\\chrome.exe',
      name: 'chrome.exe',
      parentProcessId: 10,
      processId: 11,
      profileMatched: true,
      profilePathBindingSha256: expect.stringMatching(/^[A-F0-9]{64}$/),
    });
    expect(JSON.stringify(snapshot)).not.toContain('CommandLine');
    expect(JSON.stringify(snapshot)).not.toContain('--user-data-dir');

    let calls = 0;
    const cleanup = await waitForProfileBrowserProcessCleanup(profilePath, {
      attempts: 2,
      intervalMs: 0,
      collect: () => {
        calls += 1;
        return calls === 1
          ? { matchingCount: 1, passed: true }
          : validProcessSnapshot();
      },
    });
    expect(cleanup).toEqual(expect.objectContaining({ attempts: 2, matchingCount: 0, passed: true }));
  });

  it('matches store-bound browser profiles nested under the isolated stores root', () => {
    const profileRoot = path.join(USER_DATA_DIR, 'stores');
    const storeProfilePath = path.join(
      profileRoot,
      'store-one',
      'browser',
      'profile-one',
      'lingxing',
    );
    const snapshot = collectMatchingProfileBrowserProcesses(profileRoot, () => ({
      status: 0,
      stdout: JSON.stringify([
        {
          CommandLine: `"C:\\browser\\chrome.exe" --user-data-dir="${storeProfilePath}" --type=browser`,
          ExecutablePath: 'C:\\browser\\chrome.exe',
          Name: 'chrome.exe',
          ParentProcessId: 30,
          ProcessId: 31,
        },
        {
          CommandLine: `"C:\\browser\\chrome.exe" --user-data-dir="${path.join(USER_DATA_DIR, 'storage', 'browser-data')}"`,
          ExecutablePath: 'C:\\browser\\chrome.exe',
          Name: 'chrome.exe',
          ParentProcessId: 40,
          ProcessId: 41,
        },
      ]),
      stderr: '',
    }));

    expect(snapshot).toEqual(expect.objectContaining({
      matchingCount: 1,
      observedCount: 2,
      passed: true,
      profilePath: path.resolve(profileRoot),
    }));
    expect(snapshot.matching[0]).toEqual(expect.objectContaining({ processId: 31, profileMatched: true }));
  });

  it('uses Get-Process plus targeted CIM as the profile fallback and still matches only the exact user-data-dir', () => {
    const profilePath = path.join(USER_DATA_DIR, 'storage', 'browser-data');
    const commands = [];
    const snapshot = collectMatchingProfileBrowserProcesses(profilePath, (_file, args) => {
      commands.push(String(args.at(-1)));
      return commands.length === 1
        ? { status: 1, stdout: '', stderr: 'HRESULT 0x800706be CIM unavailable' }
        : {
            status: 0,
            stdout: JSON.stringify([{
              CommandLine: `"C:\\browser\\chrome.exe" --user-data-dir="${profilePath}" --type=browser`,
              ExecutablePath: 'C:\\browser\\chrome.exe',
              Name: 'chrome.exe',
              ParentProcessId: 42,
              ProcessId: 43,
            }]),
            stderr: '',
          };
    });

    expect(snapshot).toEqual(expect.objectContaining({
      collectionMethod: 'get-process-targeted-cim-fallback',
      matchingCount: 1,
      observedCount: 1,
      passed: true,
      primaryError: expect.stringContaining('0x800706be'),
      unresolvedCount: 0,
    }));
    expect(commands[1]).toContain('Get-Process -ErrorAction Stop');
    expect(commands[1]).toContain('Get-CimInstance Win32_Process -Filter "ProcessId=$($process.Id)"');
    expect(JSON.stringify(snapshot)).not.toContain('--user-data-dir');
  });

  it('fails closed for every unreadable browser row, including unrelated daily browsers', () => {
    const profilePath = path.join(USER_DATA_DIR, 'storage', 'browser-data');
    const snapshot = collectMatchingProfileBrowserProcesses(profilePath, () => ({
      status: 0,
      stdout: JSON.stringify([{
        CommandLine: null,
        ExecutablePath: 'C:\\browser\\chrome.exe',
        Name: 'chrome.exe',
        ParentProcessId: 10,
        ProcessId: 11,
      }]),
      stderr: '',
    }));
    expect(snapshot).toEqual(expect.objectContaining({
      matchingCount: 0,
      ignoredUnresolvedCount: 0,
      passed: false,
      unresolvedCount: 1,
    }));

    const newlyUnreadable = collectMatchingProfileBrowserProcesses(
      profilePath,
      { baselineProcessIds: [11] },
      () => ({
        status: 0,
        stdout: JSON.stringify([
          {
            CommandLine: null,
            ExecutablePath: 'C:\\browser\\chrome.exe',
            Name: 'chrome.exe',
            ParentProcessId: 10,
            ProcessId: 11,
          },
          {
            CommandLine: null,
            ExecutablePath: null,
            Name: 'chrome.exe',
            ParentProcessId: null,
            ProcessId: 14,
          },
        ]),
        stderr: '',
      }),
    );
    expect(newlyUnreadable).toEqual(expect.objectContaining({
      matchingCount: 0,
      passed: false,
      unresolvedCount: 2,
    }));
    expect(newlyUnreadable.unresolved.map((item) => item.processId)).toEqual([11, 14]);

    const missingPath = collectMatchingProfileBrowserProcesses(profilePath, () => ({
      status: 0,
      stdout: JSON.stringify([{
        CommandLine: `"chrome.exe" --user-data-dir="${profilePath}"`,
        ExecutablePath: null,
        Name: 'chrome.exe',
        ParentProcessId: null,
        ProcessId: 12,
      }]),
      stderr: '',
    }));
    expect(missingPath).toEqual(expect.objectContaining({
      matchingCount: 0,
      passed: false,
      unresolvedCount: 1,
    }));

    const bundledPath = 'D:\\App\\resources\\app\\playwright-browsers\\chrome-win64\\chrome.exe';
    const unreadableBundled = collectMatchingProfileBrowserProcesses(
      profilePath,
      { expectedExecutablePath: bundledPath },
      () => ({
        status: 0,
        stdout: JSON.stringify([{
          CommandLine: null,
          ExecutablePath: bundledPath,
          Name: 'chrome.exe',
          ParentProcessId: 10,
          ProcessId: 13,
        }]),
        stderr: '',
      }),
    );
    expect(unreadableBundled).toEqual(expect.objectContaining({
      matchingCount: 0,
      mismatchedCount: 1,
      passed: false,
      unresolvedCount: 1,
    }));
  });

  it('classifies an unreadable unrelated daily browser only in explicit isolated baseline mode', () => {
    const profilePath = path.join(USER_DATA_DIR, 'stores');
    const bundledPath = 'D:\\App\\resources\\app\\playwright-browsers\\chrome-win64\\chrome.exe';
    const snapshot = collectMatchingProfileBrowserProcesses(
      profilePath,
      {
        allowUnreadableBaseline: true,
        expectedExecutablePath: bundledPath,
      },
      () => ({
        status: 0,
        stdout: JSON.stringify([{
          CommandLine: null,
          ExecutablePath: null,
          Name: 'chrome.exe',
          ParentProcessId: 10,
          ProcessId: 11,
        }]),
        stderr: '',
      }),
    );

    expect(snapshot).toEqual(expect.objectContaining({
      baselineUnrelatedCount: 1,
      matchingCount: 0,
      passed: true,
      unresolvedCount: 0,
    }));
    expect(snapshot.baselineUnrelated).toEqual([
      expect.objectContaining({ processId: 11, profileMatched: false }),
    ]);
  });

  it('binds the packaged Chromium hash, target root and descendants without retaining command lines', () => {
    const appContentPath = 'D:\\App\\resources\\app';
    const chromiumPath = path.join(
      appContentPath,
      'playwright-browsers',
      'chrome-win64',
      'chrome.exe',
    );
    const profilePath = path.join(USER_DATA_DIR, 'stores', 'store-one', 'browser', 'lingxing');
    const evidence = collectActiveBundledChromiumLineage({
      appContentPath,
      chromiumArtifact: { sha256: HASH_A, sizeBytes: 1234 },
      userDataDir: USER_DATA_DIR,
    }, () => ({
      status: 0,
      stdout: JSON.stringify([
        {
          CommandLine: `"${chromiumPath}" --user-data-dir="${profilePath}"`,
          ExecutablePath: chromiumPath,
          Name: 'chrome.exe',
          ParentProcessId: 900,
          ProcessId: 901,
        },
        {
          CommandLine: `"${chromiumPath}" --type=renderer`,
          ExecutablePath: chromiumPath,
          Name: 'chrome.exe',
          ParentProcessId: 901,
          ProcessId: 902,
        },
      ]),
      stderr: '',
    }));

    expect(evidence).toEqual(expect.objectContaining({
      descendantProcessIds: [902],
      expectedProfileRootSha256: expect.stringMatching(/^[A-F0-9]{64}$/),
      passed: true,
      profileBindingSha256: expect.stringMatching(/^[A-F0-9]{64}$/),
      profileBindingTokenCount: 1,
      rootProcessIds: [901],
    }));
    expect(evidence.chromium).toEqual(expect.objectContaining({
      sha256: HASH_A,
      sizeBytes: 1234,
    }));
    expect(chromiumLineageEvidencePassed(evidence)).toBe(true);
    expect(chromiumLineageEvidencePassed({
      ...evidence,
      profileBindingSha256: HASH_B,
      snapshot: {
        ...evidence.snapshot,
        profileBindingSha256: HASH_B,
      },
    })).toBe(false);
    expect(JSON.stringify(evidence)).not.toContain('--user-data-dir');
  });

  it('waits through a transitional Chromium lineage snapshot without weakening the final verifier', async () => {
    const valid = validChromiumLineage();
    let calls = 0;
    const evidence = await waitForActiveBundledChromiumLineage({}, {
      attempts: 2,
      collect: () => {
        calls += 1;
        return calls === 1 ? { ...valid, passed: false } : valid;
      },
      intervalMs: 0,
    });

    expect(calls).toBe(2);
    expect(evidence).toEqual(expect.objectContaining({ attempts: 2, passed: true }));
    expect(chromiumLineageEvidencePassed(evidence)).toBe(true);
  });

  it.runIf(process.platform === 'win32')(
    'proves a bounded full-tree exclusive-open window and fails closed for an existing locked or hardlinked profile file',
    async () => {
      const root = mkdtempSync(path.join(
        tmpdir(),
        'amazon-ai-ops-profile-lock-proof-',
      ));
      const profileRoot = path.join(root, 'stores', 'store-one', 'Default');
      const cookiePath = path.join(profileRoot, 'Cookies');
      const databasePath = path.join(root, 'amazon-ai-ops.db');
      let holder = null;
      try {
        mkdirSync(profileRoot, { recursive: true });
        writeFileSync(cookiePath, 'synthetic-cookie-db', 'utf8');
        writeFileSync(databasePath, 'synthetic-local-db', 'utf8');
        writeFileSync(`${databasePath}-wal`, 'synthetic-wal', 'utf8');
        writeFileSync(`${databasePath}-shm`, 'synthetic-shm', 'utf8');

        const valid = collectPackageUiProfileLockEvidence(root, {
          invocationId: 'profile-lock-test-invocation',
          profileId: '100-compact',
        });
        expect(valid).toEqual(expect.objectContaining({
          claim: 'bounded-quiescent-exclusive-open-attestation',
          passed: true,
          unresolvedCount: 0,
        }));
        expect(valid.exclusiveOpen).toEqual(expect.objectContaining({
          allEntriesHeld: true,
          closeFailureCount: 0,
          heldHandleCount: valid.exclusiveOpen.entryCount,
        }));
        expect(valid.tree).toEqual(expect.objectContaining({
          criticalEntryCount: expect.any(Number),
          treeStable: true,
        }));
        expect(valid.tree.criticalEntryCount).toBeGreaterThanOrEqual(4);

        const encodedPath = Buffer.from(cookiePath, 'utf8').toString('base64');
        holder = spawn('powershell.exe', [
          '-NoProfile',
          '-Command',
          [
            `$path=[Text.Encoding]::UTF8.GetString([Convert]::FromBase64String('${encodedPath}'))`,
            '$stream=[IO.File]::Open($path,[IO.FileMode]::Open,[IO.FileAccess]::Read,[IO.FileShare]::ReadWrite)',
            "[Console]::Out.WriteLine('READY')",
            '[Console]::Out.Flush()',
            '[Console]::In.ReadLine() | Out-Null',
            '$stream.Dispose()',
          ].join('; '),
        ], {
          stdio: ['pipe', 'pipe', 'pipe'],
          windowsHide: true,
        });
        let ready = '';
        while (!ready.includes('READY')) {
          const [chunk] = await once(holder.stdout, 'data');
          ready += chunk.toString('utf8');
        }
        const blocked = collectPackageUiProfileLockEvidence(root, {
          invocationId: 'profile-lock-test-invocation',
          profileId: '100-compact',
        });
        expect(blocked.passed).toBe(false);
        expect(blocked.unresolved).toEqual(expect.arrayContaining([
          expect.objectContaining({
            pathSha256: expect.stringMatching(/^[A-F0-9]{64}$/),
            reason: expect.stringMatching(/OPEN_FAILED/),
          }),
        ]));
        const holderExit = once(holder, 'exit');
        holder.stdin.write('\n');
        holder.stdin.end();
        await holderExit;
        holder = null;

        linkSync(cookiePath, path.join(profileRoot, 'Cookies-hardlink'));
        const hardlinked = collectPackageUiProfileLockEvidence(root, {
          invocationId: 'profile-lock-test-invocation',
          profileId: '100-compact',
        });
        expect(hardlinked.passed).toBe(false);
        expect(hardlinked.unresolved).toEqual(expect.arrayContaining([
          expect.objectContaining({ reason: 'HARDLINKED_FILE' }),
        ]));
        expect(
          readdirSync(root).some((name) =>
            name.startsWith('.package-ui-exclusive-lock-probe-')),
        ).toBe(false);
      } finally {
        if (holder) {
          const holderExit = once(holder, 'exit');
          holder.stdin.write('\n');
          holder.stdin.end();
          await holderExit.catch(() => undefined);
        }
        rmSync(root, { force: true, recursive: true });
      }
    },
    120_000,
  );

  it.runIf(process.platform === 'win32')(
    'streams a single directory and rejects a child before storing beyond the injected lower entry limit',
    () => {
      const root = mkdtempSync(path.join(
        tmpdir(),
        'amazon-ai-ops-profile-lock-stream-limit-',
      ));
      try {
        for (let index = 0; index < 8; index += 1) {
          writeFileSync(
            path.join(root, `synthetic-${String(index).padStart(2, '0')}.db`),
            '',
          );
        }
        const evidence = collectPackageUiProfileLockEvidence(root, {
          invocationId: 'profile-lock-stream-limit-invocation',
          probeLimits: {
            maxCriticalEntries: 1_024,
            maxEntries: 4,
            maxPathCharacters: 2_000_000,
          },
          profileId: '100-compact',
          testOnlyAllowLowerLimits: true,
        });
        expect(evidence.passed).toBe(false);
        expect(evidence.tree.limits.maxEntries).toBe(4);
        expect(evidence.unresolved).toEqual(expect.arrayContaining([
          expect.objectContaining({ reason: 'ENTRY_LIMIT_EXCEEDED' }),
        ]));
        expect(
          readdirSync(root).some((name) =>
            name.startsWith('.package-ui-exclusive-lock-probe-')),
        ).toBe(false);
        const source = readFileSync('scripts/package-ui-profile-lock-probe.js', 'utf8');
        expect(source).toContain(
          'Directory.EnumerateFileSystemEntries(current)',
        );
        expect(source).not.toContain(
          'Directory.GetFileSystemEntries(current)',
        );
      } finally {
        rmSync(root, { force: true, recursive: true });
      }
    },
    60_000,
  );

  it('returns a bounded structured failed run with sanitized diagnostics and both isolation attestations', async () => {
    const zero = validProcessSnapshot();
    const result = await executeEvidenceRunWithIsolation({
      baseEvidence: { scalePercent: 100, screenshots: [], workspaceChecks: [] },
      options: { executablePath: 'D:\\App\\AmazonAIOpsAgent.exe', userDataDir: USER_DATA_DIR },
      processApi: {
        collectPackage: () => zero,
        collectProfile: () => zero,
        collectProfileLocks: () => validProfileLockIsolation().before,
        waitPackage: async () => ({ ...zero, attempts: 1 }),
        waitProfile: async () => ({ ...zero, attempts: 1 }),
      },
      profileId: '100-compact',
      run: async (diagnostics) => {
        diagnostics.phase = 'viewport';
        diagnostics.timeline.push({ at: new Date().toISOString(), phase: 'viewport' });
        try {
          throw new Error([
            '--username operator@example.com --password hunter2',
            'Authorization: Bearer abcdef123456',
            'Cookie: sid=cookie-secret; session_token=session-secret',
            'api_key=sk-secretvalue',
            'x'.repeat(5_000),
          ].join('\n'));
        } finally {
          diagnostics.phase = 'electron-close';
          diagnostics.timeline.push({ at: new Date().toISOString(), phase: 'electron-close' });
        }
      },
    });

    expect(result.passed).toBe(false);
    expect(result.packageProcessIsolation.passed).toBe(true);
    expect(result.profileProcessIsolation.passed).toBe(true);
    expect(result.diagnostics).toEqual(expect.objectContaining({
      completedAt: expect.any(String),
      failure: expect.objectContaining({ phase: 'viewport' }),
      login: expect.objectContaining({ attempts: [], outcome: 'not-reached' }),
      phase: 'failed',
      startedAt: expect.any(String),
    }));
    const serialized = JSON.stringify(result);
    expect(serialized).not.toContain('operator@example.com');
    expect(serialized).not.toContain('hunter2');
    expect(serialized).not.toContain('abcdef123456');
    expect(serialized).not.toContain('cookie-secret');
    expect(serialized).not.toContain('session-secret');
    expect(serialized).not.toContain('sk-secretvalue');
    expect(result.failure.message.length).toBeLessThanOrEqual(2_000);
    expect(sanitizeDiagnosticText('password=hunter2 token=abc123')).toBe('password=[REDACTED] token=[REDACTED]');
    expect(sanitizeDiagnosticText('--password hunter2 --username operator@example.com')).toBe('--password [REDACTED] --username [REDACTED]');
    expect(sanitizeDiagnosticText('Authorization: Bearer abcdef123456')).toBe('Authorization: [REDACTED]');
    expect(sanitizeDiagnosticText('Cookie: sid=cookie-secret; session_token=session-secret')).toBe('Cookie: [REDACTED]');
    expect(sanitizeDiagnosticText('session_token=session-secret')).toBe('session_token=[REDACTED]');
    expect(sanitizeDiagnosticText('登录 operator@example.com 失败')).toBe('登录 [REDACTED_ACCOUNT] 失败');
    expect(validRunDiagnostics(result.diagnostics, result)).toBe(false);
  });

  it('enables the unreadable daily-browser baseline only after package absence and profile-lock proof', async () => {
    const zero = validProcessSnapshot();
    const profileLocks = validProfileLockIsolation();
    let observedCollectOptions = null;
    let lockCall = 0;
    const result = await executeEvidenceRunWithIsolation({
      baseEvidence: { scalePercent: 100 },
      options: {
        appContentPath: 'D:\\App\\resources\\app',
        executablePath: 'D:\\App\\AmazonAIOpsAgent.exe',
        userDataDir: USER_DATA_DIR,
      },
      processApi: {
        collectPackage: () => zero,
        collectProfile: (_profilePath, collectOptions) => {
          observedCollectOptions = collectOptions;
          return zero;
        },
        collectProfileLocks: () => {
          lockCall += 1;
          return lockCall === 1 ? profileLocks.before : profileLocks.after;
        },
        waitPackage: async () => ({ ...zero, attempts: 1 }),
        waitProfile: async () => ({ ...zero, attempts: 1 }),
      },
      profileId: '100-compact',
      run: async () => ({ passed: true }),
    });

    expect(observedCollectOptions).toEqual(expect.objectContaining({
      allowUnreadableBaseline: true,
      expectedExecutablePath: expect.stringContaining('playwright-browsers'),
    }));
    expect(result.profileProcessIsolation.passed).toBe(true);
  });

  it('records whether Electron closed before or after the evidence runner requested shutdown', () => {
    const diagnostics = createRunDiagnostics('100-compact', new Date('2026-07-28T08:00:00.000Z'));
    const electronApp = new EventEmitter();
    const electronContext = new EventEmitter();
    const electronProcess = new EventEmitter();
    electronApp.context = () => electronContext;
    electronApp.process = () => electronProcess;
    const observer = attachElectronLifecycleDiagnostics(electronApp, diagnostics);
    const mainPage = new EventEmitter();
    const mainFrame = {};
    mainPage.mainFrame = () => mainFrame;

    observer.attachPage(mainPage);
    mainPage.emit('framenavigated', mainFrame);
    mainPage.emit('close');
    markRunnerElectronCloseRequested(diagnostics);
    electronContext.emit('close');
    electronApp.emit('close');
    electronProcess.emit('exit', 0, null);

    expect(diagnostics.lifecycle).toEqual(expect.objectContaining({
      droppedCount: 0,
      runnerCloseRequestedAt: expect.any(String),
      unexpectedCloseObserved: true,
    }));
    expect(diagnostics.lifecycle.events.map((event) => event.kind)).toEqual([
      'window-attached',
      'main-frame-navigated',
      'window-closed',
      'runner-close-requested',
      'electron-context-closed',
      'electron-app-closed',
      'electron-process-exit',
    ]);
    expect(diagnostics.lifecycle.events[2]).toEqual(expect.objectContaining({
      runnerCloseRequested: false,
      windowId: 1,
    }));
    expect(diagnostics.lifecycle.processExit).toEqual({
      at: expect.any(String),
      code: 0,
      runnerCloseRequested: true,
      signal: null,
    });
    expect(JSON.stringify(diagnostics.lifecycle)).not.toMatch(/url|title|username|password|cookie/i);

    const expectedDiagnostics = createRunDiagnostics(
      '125-compact',
      new Date('2026-07-28T08:01:00.000Z'),
    );
    const expectedApp = new EventEmitter();
    const expectedContext = new EventEmitter();
    const expectedProcess = new EventEmitter();
    expectedApp.context = () => expectedContext;
    expectedApp.process = () => expectedProcess;
    const expectedObserver = attachElectronLifecycleDiagnostics(expectedApp, expectedDiagnostics);
    const expectedPage = new EventEmitter();
    expectedObserver.attachPage(expectedPage);
    markRunnerElectronCloseRequested(expectedDiagnostics);
    expectedPage.emit('close');
    expectedContext.emit('close');
    expectedApp.emit('close');
    expectedProcess.emit('exit', 0, null);

    expect(expectedDiagnostics.lifecycle.unexpectedCloseObserved).toBe(false);
    expect(expectedDiagnostics.lifecycle.events.find((event) => event.kind === 'window-closed'))
      .toEqual(expect.objectContaining({ runnerCloseRequested: true, windowId: 1 }));
  });

  it('caps renderer diagnostics and records dropped entries without growing the manifest arrays', async () => {
    const zero = validProcessSnapshot();
    const result = await executeEvidenceRunWithIsolation({
      baseEvidence: { scalePercent: 100 },
      options: { executablePath: 'D:\\App\\AmazonAIOpsAgent.exe', userDataDir: USER_DATA_DIR },
      processApi: {
        collectPackage: () => zero,
        collectProfile: () => zero,
        collectProfileLocks: () => validProfileLockIsolation().before,
        waitPackage: async () => ({ ...zero, attempts: 1 }),
        waitProfile: async () => ({ ...zero, attempts: 1 }),
      },
      profileId: '100-compact',
      run: async (diagnostics) => {
        for (let index = 0; index < 105; index += 1) {
          appendRendererDiagnostic(diagnostics, 'consoleErrors', { message: `error-${index}` });
        }
        return { passed: true };
      },
    });

    expect(result.diagnostics.renderer.consoleErrors).toHaveLength(100);
    expect(result.diagnostics.renderer.droppedCount).toEqual({ consoleErrors: 5, pageErrors: 0 });
    expect(result.diagnostics.renderer.limits).toEqual({ consoleErrors: 100, pageErrors: 100 });
    expect(validRunDiagnostics(result.diagnostics, result)).toBe(false);
  });
});
