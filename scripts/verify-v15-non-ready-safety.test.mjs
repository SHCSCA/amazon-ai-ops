// 按证据职责拆分共享夹具与断言，保留原有完整测试名称。
import { describe, expect, fs, it, os, packageUiBindingFixture, packageUiReferencedArtifactsAreBundled, path } from './v15-non-ready-test-environment.mjs';
import { artifactRecord, runNode, sha256File, sha256Text, writeJson } from './v15-non-ready-test-artifacts.mjs';
import { mutatePackageSecurityFixture, mutatePackageUiFixture, runStrictNonReadySafetyFixture, writeStrictNonReadyFixture } from './v15-non-ready-test-fixture.mjs';
describe('verify v15 non-ready safety', () => {
it('binds every schema v9 scheduler screenshot and runtime attestation to its bundle copy', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'v15-package-ui-bundle-binding-'));
    try {
        const bundleDir = path.join(dir, 'bundle');
        const sourceDir = path.join(dir, 'source');
        const bundledEvidenceDir = path.join(bundleDir, 'evidence');
        const bundledScreenshotDir = path.join(bundleDir, 'screenshots');
        fs.mkdirSync(sourceDir, { recursive: true });
        fs.mkdirSync(bundledEvidenceDir, { recursive: true });
        fs.mkdirSync(bundledScreenshotDir, { recursive: true });
        const sourceScreenshot = path.join(sourceDir, 'settings-scheduler.png');
        const sourceRuntime = path.join(sourceDir, 'scheduler-runtime.json');
        const bundledScreenshot = path.join(bundledScreenshotDir, 'settings-scheduler.png');
        const bundledRuntime = path.join(bundledEvidenceDir, 'scheduler-runtime.json');
        fs.writeFileSync(sourceScreenshot, 'current scheduler screenshot bytes', 'utf8');
        fs.writeFileSync(sourceRuntime, '{"kind":"scheduler-read-only-runtime"}\n', 'utf8');
        fs.copyFileSync(sourceScreenshot, bundledScreenshot);
        fs.copyFileSync(sourceRuntime, bundledRuntime);
        const screenshot = artifactRecord(sourceScreenshot);
        const runtime = artifactRecord(sourceRuntime);
        const manifestPath = path.join(bundleDir, 'delivery-bundle-manifest.json');
        const manifest = {
            files: [
                {
                    sourcePath: sourceScreenshot,
                    bundlePath: path.relative(bundleDir, bundledScreenshot),
                    sizeBytes: screenshot.sizeBytes,
                    sha256: screenshot.sha256,
                },
                {
                    sourcePath: sourceRuntime,
                    bundlePath: path.relative(bundleDir, bundledRuntime),
                    sizeBytes: runtime.sizeBytes,
                    sha256: runtime.sha256,
                },
            ],
        };
        const packageUi = {
            schemaVersion: 9,
            runs: [{
                    screenshots: [],
                    overlayChecks: [],
                    workspaceChecks: [],
                    subviewChecks: [{ screenshot }],
                    schedulerReadOnlyRuntime: { artifact: runtime },
                }],
            wideProfile: {
                screenshots: [],
                workspaceChecks: [],
            },
        };
        expect(packageUiReferencedArtifactsAreBundled(packageUi, manifest, manifestPath)).toBe(true);
        fs.rmSync(bundledScreenshot);
        expect(packageUiReferencedArtifactsAreBundled(packageUi, manifest, manifestPath)).toBe(false);
        fs.copyFileSync(sourceScreenshot, bundledScreenshot);
        fs.appendFileSync(bundledRuntime, 'tampered', 'utf8');
        expect(packageUiReferencedArtifactsAreBundled(packageUi, manifest, manifestPath)).toBe(false);
    }
    finally {
        fs.rmSync(dir, { recursive: true, force: true });
    }
});

it('accepts the current IN_PROGRESS README delivery state as non-ready', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'v15-non-ready-safety-'));
    const evidenceManifest = path.join(dir, 'evidence-manifest.json');
    const finalReadiness = path.join(dir, 'final-readiness.json');
    const packageSmoke = path.join(dir, 'package-launch-smoke.json');
    const packageUiManifest = path.join(dir, 'package-ui-manifest.json');
    const packageSecurityEvidence = path.join(dir, 'package-security-boundaries.json');
    const bundleManifest = path.join(dir, 'delivery-bundle-manifest.json');
    const readme = path.join(dir, 'README.md');
    const fixture = writeStrictNonReadyFixture({
        artifactDir: dir,
        evidenceManifest,
        finalReadiness,
        packageSmoke,
        packageUiManifest,
        packageSecurityEvidence,
        bundleManifest,
        readme,
    });
    const result = runNode('scripts/verify-v15-non-ready-safety.js', [
        '--final-readiness', finalReadiness,
        '--bundle-manifest', bundleManifest,
        '--package-launch-smoke', packageSmoke,
        '--package-ui-manifest', packageUiManifest,
        '--package-security-evidence', packageSecurityEvidence,
        '--package-adversarial-node-env-evidence', fixture.packageAdversarialNodeEnvEvidence,
        '--readme', readme,
    ]);
    expect(result.status).toBe(0);
    expect(result.stdout).toContain('final readiness has exactly 8 gates, 7 passed, and only real-ad-execution-readback needs work');
    expect(result.stdout).toContain('README top-level delivery line is non-ready');
    expect(result.stdout).toContain('NON_READY_SAFETY verified');
});

it('accepts a 125% package UI viewport within the recorded two-pixel tolerance', () => {
    const result = runStrictNonReadySafetyFixture({
        mutateAfterWrite(context) {
            mutatePackageUiFixture(context, (packageUi) => {
                const run125 = packageUi.runs.find((run) => run.scalePercent === 125);
                run125.viewport.height = 770;
                run125.viewportContract = {
                    actual: { width: 1366, height: 770, deviceScaleFactor: 1.25 },
                    delta: { width: 0, height: 2, deviceScaleFactor: 0 },
                    passed: true,
                    requested: { width: 1366, height: 768, deviceScaleFactor: 1.25 },
                    tolerance: { width: 2, height: 2, deviceScaleFactor: 0.02 },
                    violations: [],
                };
                const binding = packageUiBindingFixture(path.dirname(context.paths.packageUiManifest), packageUi.requested.userDataDir);
                packageUi.checkpointComposition = binding.validCheckpointComposition(packageUi.runGroup.runGroupId, packageUi.runGroup.runnerContractSha256, [...packageUi.runs, packageUi.wideProfile], packageUi.checkpointComposition);
            });
        },
    });
    expect(result.status).toBe(0);
    expect(result.stdout).toContain('NON_READY_SAFETY verified');
});

it('rejects strict APP_NEEDS_WORK when the adversarial NODE_ENV contract is deleted', () => {
    const result = runStrictNonReadySafetyFixture({
        mutateFinalReadiness(finalReadiness) {
            delete finalReadiness.packageAdversarialNodeEnv;
        },
    });
    expect(result.status).not.toBe(0);
    expect(`${result.stdout}${result.stderr}`)
        .toContain('current NON_READY safety requires package-adversarial-node-env/v1');
});

it('rejects strict APP_NEEDS_WORK when the adversarial NODE_ENV contract version is changed', () => {
    const result = runStrictNonReadySafetyFixture({
        mutateFinalReadiness(finalReadiness) {
            finalReadiness.packageAdversarialNodeEnv.contractVersion = 'package-adversarial-node-env/v0';
        },
    });
    expect(result.status).not.toBe(0);
    expect(`${result.stdout}${result.stderr}`)
        .toContain('current NON_READY safety requires package-adversarial-node-env/v1');
});

it('rejects a package UI viewport outside the recorded two-pixel tolerance', () => {
    const result = runStrictNonReadySafetyFixture({
        mutateAfterWrite(context) {
            mutatePackageUiFixture(context, (packageUi) => {
                const run125 = packageUi.runs.find((run) => run.scalePercent === 125);
                run125.viewport.height = 771;
                run125.viewportContract = {
                    actual: { width: 1366, height: 771, deviceScaleFactor: 1.25 },
                    delta: { width: 0, height: 3, deviceScaleFactor: 0 },
                    passed: true,
                    requested: { width: 1366, height: 768, deviceScaleFactor: 1.25 },
                    tolerance: { width: 2, height: 2, deviceScaleFactor: 0.02 },
                    violations: [],
                };
            });
        },
    });
    expect(result.status).not.toBe(0);
    expect(`${result.stdout}${result.stderr}`).toContain('explicit package UI evidence is fresh, complete, hash-bound, DB-safe, process-isolated, and bundled');
});

it('rejects strict APP_NEEDS_WORK verification without an explicit package UI manifest', () => {
    const result = runStrictNonReadySafetyFixture({ omitPackageUiManifest: true });
    expect(result.status).not.toBe(0);
    expect(`${result.stdout}${result.stderr}`).toContain('strict APP_NEEDS_WORK requires an explicit package UI manifest');
});

it('rejects strict APP_NEEDS_WORK verification without explicit package security evidence', () => {
    const result = runStrictNonReadySafetyFixture({ omitPackageSecurityEvidence: true });
    expect(result.status).not.toBe(0);
    expect(`${result.stdout}${result.stderr}`).toContain('strict APP_NEEDS_WORK requires explicit passing package security evidence');
});

it('rejects strict APP_NEEDS_WORK verification when a package security boundary check failed', () => {
    const result = runStrictNonReadySafetyFixture({
        mutateAfterWrite(context) {
            mutatePackageSecurityFixture(context, (evidence) => {
                evidence.checks.find((check) => check.code === 'NAVIGATION_SECURITY_MARKER_PRESENT').passed = false;
                evidence.summary.passed -= 1;
                evidence.summary.failed += 1;
                evidence.passed = false;
            });
        },
    });
    expect(result.status).not.toBe(0);
    expect(`${result.stdout}${result.stderr}`).toContain('explicit package security evidence is schema-valid, fully passing, package-hash-bound, and bundled byte-for-byte');
});

it('rejects strict APP_NEEDS_WORK verification when the security main-bundle hash is detached from package UI evidence', () => {
    const result = runStrictNonReadySafetyFixture({
        mutateAfterWrite(context) {
            mutatePackageSecurityFixture(context, (evidence) => {
                evidence.package.mainBundleSha256 = 'D'.repeat(64);
            });
        },
    });
    expect(result.status).not.toBe(0);
    expect(`${result.stdout}${result.stderr}`).toContain('explicit package security evidence is schema-valid, fully passing, package-hash-bound, and bundled byte-for-byte');
});

it('rejects APP_NEEDS_WORK when release package hash evidence is stale', () => {
    const result = runStrictNonReadySafetyFixture({
        mutateFinalReadiness(finalReadiness) {
            const portable = finalReadiness.packageIndex.packages.find((item) => item.kind === 'portable');
            portable.sha256 = '0'.repeat(64);
        },
    });
    expect(result.status).not.toBe(0);
    expect(`${result.stdout}${result.stderr}`).toContain('release-package-hash gate is passed with current package index evidence');
    expect(`${result.stdout}${result.stderr}`).toContain('NEEDS_WORK');
});

it('rejects APP_NEEDS_WORK when the bundled release package index differs from final readiness', () => {
    const result = runStrictNonReadySafetyFixture({
        mutateAfterWrite({ paths, fixture }) {
            const bundleIndex = JSON.parse(fs.readFileSync(fixture.bundlePackageIndexPath, 'utf8'));
            bundleIndex.packages.find((item) => item.kind === 'portable').modifiedAt = '2000-01-01T00:00:00.000Z';
            writeJson(fixture.bundlePackageIndexPath, bundleIndex);
            const bundle = JSON.parse(fs.readFileSync(paths.bundleManifest, 'utf8'));
            const indexFile = bundle.files.find((file) => file.label === 'release-package-index');
            indexFile.sizeBytes = fs.statSync(fixture.bundlePackageIndexPath).size;
            indexFile.sha256 = sha256File(fixture.bundlePackageIndexPath);
            writeJson(paths.bundleManifest, bundle);
        },
    });
    expect(result.status).not.toBe(0);
    expect(`${result.stdout}${result.stderr}`).toContain('bundle release-package-index exactly matches final readiness and current package files');
});

it('rejects APP_NEEDS_WORK when explicit package UI freshness failed', () => {
    const result = runStrictNonReadySafetyFixture({
        mutateAfterWrite(context) {
            mutatePackageUiFixture(context, (packageUi) => {
                packageUi.freshness = { passed: false, violations: [{ code: 'STALE_BUILD' }] };
            });
        },
    });
    expect(result.status).not.toBe(0);
    expect(`${result.stdout}${result.stderr}`).toContain('explicit package UI evidence is fresh, complete, hash-bound, DB-safe, process-isolated, and bundled');
});

it('rejects APP_NEEDS_WORK when explicit package UI completeness failed', () => {
    const result = runStrictNonReadySafetyFixture({
        mutateAfterWrite(context) {
            mutatePackageUiFixture(context, (packageUi) => {
                packageUi.completeness = { passed: false, violations: [{ code: 'SCALE_RUN_MISSING' }] };
            });
        },
    });
    expect(result.status).not.toBe(0);
    expect(`${result.stdout}${result.stderr}`).toContain('explicit package UI evidence is fresh, complete, hash-bound, DB-safe, process-isolated, and bundled');
});

it.each([
    ['historical schema v5 cannot satisfy the current production safety gate', (context) => {
            mutatePackageUiFixture(context, (packageUi) => {
                packageUi.schemaVersion = 5;
            });
        }],
    ['historical schema v6 cannot satisfy the current production safety gate', (context) => {
            mutatePackageUiFixture(context, (packageUi) => {
                packageUi.schemaVersion = 6;
            });
        }],
    ['interactive operator login request is downgraded to saved-login automation', (context) => {
            mutatePackageUiFixture(context, (packageUi) => {
                packageUi.requested.allowInteractiveLogin = false;
                packageUi.requested.allowSavedLogin = true;
                packageUi.requested.loginMode = 'app-owned-saved-login';
            });
        }],
    ['first 100% handoff lacks typed-and-saved fresh identity proof', (context) => {
            mutatePackageUiFixture(context, (packageUi) => {
                packageUi.runs.find((run) => run.scalePercent === 100).session.loginSessionAttestation = {
                    adsSessionReady: true,
                    credentialPersistence: 'main_managed',
                    credentialSource: 'saved',
                    erpSessionReady: true,
                    erpSessionReused: true,
                    ok: true,
                    sessionIdentityVerified: false,
                };
            });
        }],
    ['125% run omits its interactive operator handoff mode', (context) => {
            mutatePackageUiFixture(context, (packageUi) => {
                packageUi.runs.find((run) => run.scalePercent === 125).session.mode = 'existing-authenticated-session';
            });
        }],
    ['wide run omits its interactive operator handoff mode', (context) => {
            mutatePackageUiFixture(context, (packageUi) => {
                packageUi.wideProfile.session.mode = 'existing-authenticated-session';
            });
        }],
    ['operator handoff claims automation read secrets', (context) => {
            mutatePackageUiFixture(context, (packageUi) => {
                packageUi.runs[0].session.operatorHandoff.automationReadSecrets = true;
            });
        }],
    ['EXE hash is not bound to package smoke', (context) => {
            const alternateExe = path.join(context.dir, 'alternate-unpacked.exe');
            const content = 'alternate unpacked executable\n';
            fs.writeFileSync(alternateExe, content, 'utf8');
            const artifact = {
                path: alternateExe,
                sizeBytes: Buffer.byteLength(content, 'utf8'),
                sha256: sha256Text(content),
            };
            mutatePackageUiFixture(context, (packageUi) => {
                packageUi.requested.executablePath = alternateExe;
                packageUi.requested.expectedExeSha256 = artifact.sha256;
                packageUi.artifactsBefore.exe = artifact;
                packageUi.artifactsAfter.exe = artifact;
            });
        }],
    ['authority DB isolation is not preserved', (context) => {
            mutatePackageUiFixture(context, (packageUi) => {
                packageUi.protectedDatabase.unchanged = false;
            });
        }],
    ['package process isolation is not preserved', (context) => {
            mutatePackageUiFixture(context, (packageUi) => {
                packageUi.packageProcessIsolation.after.matchingCount = 1;
            });
        }],
    ['package process isolation omits strict current snapshot fields', (context) => {
            mutatePackageUiFixture(context, (packageUi) => {
                packageUi.packageProcessIsolation.before = {
                    error: null,
                    matchingCount: 0,
                    passed: true,
                    unresolvedCount: 0,
                };
            });
        }],
    ['package process isolation reports inconsistent snapshot counts', (context) => {
            mutatePackageUiFixture(context, (packageUi) => {
                packageUi.runs[0].packageProcessIsolation.after.matching = [{ processId: 42 }];
            });
        }],
    ['top-level profile browser isolation is not preserved', (context) => {
            mutatePackageUiFixture(context, (packageUi) => {
                packageUi.profileProcessIsolation.after.matchingCount = 1;
            });
        }],
    ['per-scale profile browser isolation is not preserved', (context) => {
            mutatePackageUiFixture(context, (packageUi) => {
                packageUi.runs[0].profileProcessIsolation.before.unresolvedCount = 1;
            });
        }],
    ['wide product process isolation is not preserved', (context) => {
            mutatePackageUiFixture(context, (packageUi) => {
                packageUi.wideProfile.packageProcessIsolation.after.passed = false;
            });
        }],
    ['per-run structured diagnostics are missing', (context) => {
            mutatePackageUiFixture(context, (packageUi) => {
                delete packageUi.runs[1].diagnostics;
            });
        }],
    ['Electron lifecycle diagnostics are missing', (context) => {
            mutatePackageUiFixture(context, (packageUi) => {
                delete packageUi.runs[0].diagnostics.lifecycle;
            });
        }],
    ['Electron lifecycle observed an unrequested close', (context) => {
            mutatePackageUiFixture(context, (packageUi) => {
                packageUi.wideProfile.diagnostics.lifecycle.unexpectedCloseObserved = true;
            });
        }],
    ['Electron exited non-zero', (context) => {
            mutatePackageUiFixture(context, (packageUi) => {
                packageUi.runs[1].diagnostics.lifecycle.processExit.code = 1;
                packageUi.runs[1].diagnostics.lifecycle.events.find((event) => event.kind === 'electron-process-exit').code = 1;
            });
        }],
    ['Electron lifecycle markers are duplicated', (context) => {
            mutatePackageUiFixture(context, (packageUi) => {
                const lifecycle = packageUi.runs[0].diagnostics.lifecycle;
                const marker = lifecycle.events.find((event) => event.kind === 'runner-close-requested');
                lifecycle.events.splice(2, 0, { ...marker });
            });
        }],
    ['Electron lifecycle exit receipt is detached', (context) => {
            mutatePackageUiFixture(context, (packageUi) => {
                packageUi.wideProfile.diagnostics.lifecycle.processExit.at =
                    '2026-07-16T08:08:19.901Z';
            });
        }],
    ['Electron window is attached only after close was requested', (context) => {
            mutatePackageUiFixture(context, (packageUi) => {
                const events = packageUi.runs[0].diagnostics.lifecycle.events;
                const attached = events.shift();
                attached.at = '2026-07-16T08:08:19.650Z';
                attached.runnerCloseRequested = true;
                events.splice(1, 0, attached);
            });
        }],
    ['Electron lifecycle records an event after process exit', (context) => {
            mutatePackageUiFixture(context, (packageUi) => {
                packageUi.runs[1].diagnostics.lifecycle.events.push({
                    at: '2026-07-16T08:08:19.950Z',
                    kind: 'main-frame-navigated',
                    phase: 'electron-close',
                    runnerCloseRequested: true,
                    windowId: 1,
                });
            });
        }],
    ['diagnostics retain a raw credential', (context) => {
            mutatePackageUiFixture(context, (packageUi) => {
                packageUi.wideProfile.diagnostics.login.failureMessage = 'password=hunter2';
            });
        }],
    ['diagnostics retain raw CLI credentials', (context) => {
            mutatePackageUiFixture(context, (packageUi) => {
                packageUi.runs[0].diagnostics.login.failureMessage = '--username operator@example.com --password hunter2';
            });
        }],
    ['diagnostics retain a raw account email', (context) => {
            mutatePackageUiFixture(context, (packageUi) => {
                packageUi.runs[0].diagnostics.login.failureMessage = 'operator@example.com';
            });
        }],
    ['diagnostics retain a user-name field', (context) => {
            mutatePackageUiFixture(context, (packageUi) => {
                packageUi.runs[0].diagnostics['user-name'] = '[REDACTED_ACCOUNT]';
            });
        }],
    ['diagnostics retain raw authorization, cookie, or session tokens', (context) => {
            mutatePackageUiFixture(context, (packageUi) => {
                packageUi.runs[1].diagnostics.login.failureMessage = [
                    'Authorization: Bearer abcdef123456',
                    'Cookie: sid=cookie-secret',
                    'session_token=session-secret',
                ].join('\n');
            });
        }],
    ['renderer diagnostics report dropped errors', (context) => {
            mutatePackageUiFixture(context, (packageUi) => {
                packageUi.wideProfile.diagnostics.renderer.droppedCount.consoleErrors = 1;
            });
        }],
    ['profile browser path is not bound to the isolated user data directory', (context) => {
            mutatePackageUiFixture(context, (packageUi) => {
                packageUi.requested.profileBrowserUserDataDir = path.join(context.dir, 'other-browser-profile');
            });
        }],
    ['profile browser isolation persists a command line', (context) => {
            mutatePackageUiFixture(context, (packageUi) => {
                packageUi.profileProcessIsolation.after.CommandLine = '--user-data-dir=D:\\secret-profile';
            });
        }],
    ['profile database provenance is not preserved', (context) => {
            mutatePackageUiFixture(context, (packageUi) => {
                packageUi.profileDatabaseProvenance.passed = false;
                packageUi.profileDatabaseProvenance.hashMatches = false;
            });
        }],
    ['wide canonical Decisions/Objects profile is incomplete', (context) => {
            mutatePackageUiFixture(context, (packageUi) => {
                packageUi.wideProfile.workspaceChecks.find((item) => item.workspace === 'objects').passed = false;
            });
        }],
])('rejects APP_NEEDS_WORK when package UI %s', (_label, mutate) => {
    const result = runStrictNonReadySafetyFixture({ mutateAfterWrite: mutate });
    expect(result.status).not.toBe(0);
    expect(`${result.stdout}${result.stderr}`).toContain('explicit package UI evidence is fresh, complete, hash-bound, DB-safe, process-isolated, and bundled');
});

it('rejects APP_NEEDS_WORK when bundle package UI sourcePath does not match the explicit manifest', () => {
    const result = runStrictNonReadySafetyFixture({
        mutateAfterWrite({ paths }) {
            const bundle = JSON.parse(fs.readFileSync(paths.bundleManifest, 'utf8'));
            bundle.uiEvidence.packageUiManifest.sourcePath = path.join(path.dirname(paths.packageUiManifest), 'other-package-ui.json');
            writeJson(paths.bundleManifest, bundle);
        },
    });
    expect(result.status).not.toBe(0);
    expect(`${result.stdout}${result.stderr}`).toContain('explicit package UI evidence is fresh, complete, hash-bound, DB-safe, process-isolated, and bundled');
});

it('does not allow explicit strict verification to substitute historical APP_READY records', () => {
    const result = runStrictNonReadySafetyFixture({
        mutateFinalReadiness(finalReadiness) {
            finalReadiness.status = 'APP_READY';
            finalReadiness.appReady = true;
        },
        mutateAfterWrite({ paths }) {
            const bundle = JSON.parse(fs.readFileSync(paths.bundleManifest, 'utf8'));
            bundle.status = 'APP_READY';
            bundle.appReady = true;
            bundle.warning = 'APP_READY evidence bundle.';
            writeJson(paths.bundleManifest, bundle);
        },
    });
    expect(result.status).not.toBe(0);
    expect(`${result.stdout}${result.stderr}`).toContain('final readiness remains APP_NEEDS_WORK with appReady=false');
    expect(result.stdout).not.toContain('historical APP_READY final readiness is baseline only');
});

it('rejects APP_NEEDS_WORK when explicit package launch smoke is invalid', () => {
    const result = runStrictNonReadySafetyFixture({
        mutateAfterWrite({ paths }) {
            const smoke = JSON.parse(fs.readFileSync(paths.packageSmoke, 'utf8'));
            delete smoke.checks.find((check) => check.kind === 'portable').runtimeProcess;
            writeJson(paths.packageSmoke, smoke);
        },
    });
    expect(result.status).not.toBe(0);
    expect(`${result.stdout}${result.stderr}`).toContain('package-launch-smoke gate is passed with explicit current evidence matching final readiness and package index');
    expect(`${result.stdout}${result.stderr}`).toContain('NEEDS_WORK');
});

it('rejects APP_NEEDS_WORK when explicit package launch smoke does not match its final readiness record', () => {
    let alternateSmokePath = '';
    const result = runStrictNonReadySafetyFixture({
        mutateFinalReadiness(finalReadiness) {
            alternateSmokePath = path.join(path.dirname(finalReadiness.evidenceSelection.manifestPath), 'other-package-launch-smoke.json');
            finalReadiness.packageLaunchSmoke.evidencePath = alternateSmokePath;
            finalReadiness.gates.find((gate) => gate.id === 'package-launch-smoke').evidencePath = alternateSmokePath;
        },
        mutateAfterWrite({ paths }) {
            fs.copyFileSync(paths.packageSmoke, alternateSmokePath);
        },
    });
    expect(result.status).not.toBe(0);
    expect(`${result.stdout}${result.stderr}`).toContain('package-launch-smoke gate is passed with explicit current evidence matching final readiness and package index');
});

it('rejects APP_NEEDS_WORK when any gate besides real ad readback also fails', () => {
    const result = runStrictNonReadySafetyFixture({
        mutateFinalReadiness(finalReadiness) {
            const aiGate = finalReadiness.gates.find((gate) => gate.id === 'ai-live-provider');
            aiGate.ok = false;
            aiGate.status = 'needs_work';
        },
    });
    expect(result.status).not.toBe(0);
    expect(`${result.stdout}${result.stderr}`).toContain('final readiness has exactly 8 gates, 7 passed, and only real-ad-execution-readback needs work');
});

it('rejects APP_NEEDS_WORK when the recorded authority database path no longer exists', () => {
    const result = runStrictNonReadySafetyFixture({
        mutateAfterWrite({ fixture }) {
            fs.rmSync(fixture.authorityDbPath, { force: true });
        },
    });
    expect(result.status).not.toBe(0);
    expect(`${result.stdout}${result.stderr}`).toContain('bind the same existing SQLite authority database identity');
});

it('rejects APP_NEEDS_WORK when explicit --db selects another existing database without leaking its path', () => {
    let otherDbPath = '';
    const result = runStrictNonReadySafetyFixture({
        mutateAfterWrite({ dir }) {
            otherDbPath = path.join(dir, 'other-authority.db');
            fs.writeFileSync(otherDbPath, 'other authority database identity fixture\n', 'utf8');
        },
        extraArgs() {
            return ['--db', otherDbPath];
        },
    });
    const output = `${result.stdout}${result.stderr}`;
    expect(result.status).not.toBe(0);
    expect(output).toContain('bind the same existing SQLite authority database identity');
    expect(output).not.toContain(otherDbPath);
});

it('rejects APP_NEEDS_WORK when the delivery bundle records another authority database', () => {
    const result = runStrictNonReadySafetyFixture({
        mutateAfterWrite({ dir, paths }) {
            const otherDbPath = path.join(dir, 'bundle-authority.db');
            fs.writeFileSync(otherDbPath, 'bundle authority database identity fixture\n', 'utf8');
            const bundle = JSON.parse(fs.readFileSync(paths.bundleManifest, 'utf8'));
            bundle.authorityDatabase.sourcePath = otherDbPath;
            writeJson(paths.bundleManifest, bundle);
        },
    });
    expect(result.status).not.toBe(0);
    expect(`${result.stdout}${result.stderr}`).toContain('bind the same existing SQLite authority database identity');
});
});
