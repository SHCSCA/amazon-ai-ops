// 按证据职责拆分夹具与验收断言，测试仍归属原有入口。
import { Database, describe, expect, exporter, fs, it, path, productionPngBytes, runReadonlySqliteOnlineBackupSync } from './execution-canary-export-test-environment.mjs';
import { bindArtifactBytes, createFixture, expectFormalCanaryPass, mutateSnapshot, refreshSnapshotManifest } from './execution-canary-export-test-authority.mjs';
import { fileArtifact, sha256File, temporaryOutputFiles } from './execution-canary-export-test-artifacts.mjs';
describe('Mission Control execution canary evidence exporter', () => {
it.each([
    ['legacy missing authority', 'UPDATE mission_grants SET authority_json=NULL'],
    ['replayed mode revision', "UPDATE decisions SET authority_json=json_set(authority_json,'$.authorityModeRevision',2)"],
    ['foreign Profile', "UPDATE mission_grants SET authority_json=json_set(authority_json,'$.context.browserProfileId','foreign-profile')"],
    ['mixed issuer', "UPDATE mission_grants SET issuer_actor_id='policy-engine'"],
    ['missing Mission history', 'DELETE FROM mission_events WHERE mission_revision=1'],
    ['missing Decision history', "DELETE FROM decision_history WHERE event_type='executed'"],
    ['altered approved value', "UPDATE decision_history SET snapshot_json=json_set(snapshot_json,'$.recommendedValue',0.96) WHERE event_type='approved'"],
    ['wrong approval actor', "UPDATE decision_history SET actor_id='policy-engine' WHERE event_type='approved'"],
    ['missing reservation', "DELETE FROM mission_grant_events WHERE event_type='reserved'"],
    ['missing spent slot', "DELETE FROM mission_grant_events WHERE event_type='spent'"],
    ['different submit intent', "UPDATE mission_grant_events SET submit_intent_id='another-intent' WHERE event_type='spent'"],
    ['duplicate submitted event', "INSERT INTO ad_execution_events SELECT id||'-duplicate',store_id,batch_id,job_id,sequence+1,event_type,from_status,to_status,session_generation,created_at FROM ad_execution_events WHERE event_type='submitted'"],
    ['cropped action batch', "INSERT INTO analysis_proposal_snapshots SELECT id||'-second',store_id,marketplace,currency,mission_id,mission_revision,policy_version_id,policy_revision,action_revision,action_type,entity_type,ad_entity_authority_id,ad_entity_id,ad_entity_revision,current_bid_cents,proposed_bid_cents,change_pct,authorization_json,valid_until,created_session_generation,created_at,action_batch_id FROM analysis_proposal_snapshots"],
])('rejects current canary %s', (_name, sql) => {
    const fixture = createFixture('manual_approval');
    mutateSnapshot(fixture, database => database.exec(sql));
    expect(() => exporter.exportExecutionCanaryEvidence(fixture.options, fixture.context)).toThrow(/Current execution lineage/);
    expect(fs.existsSync(fixture.outputPath)).toBe(false);
});

it('accepts expiry after submit during readback without creating new write authority', () => {
    const fixture = createFixture('manual_approval');
    mutateSnapshot(fixture, database => {
        const expiry = '2026-07-27T11:40:31.000Z';
        database.prepare('UPDATE mission_grants SET expires_at=?').run(expiry);
        database.prepare('UPDATE decisions SET valid_until=?').run(expiry);
        database.prepare('UPDATE analysis_proposal_snapshots SET valid_until=?').run(expiry);
        database.prepare("UPDATE decision_history SET snapshot_json=json_set(snapshot_json,'$.validUntil',?)").run(expiry);
    });
    const { evidence } = exporter.exportExecutionCanaryEvidence(fixture.options, fixture.context);
    expectFormalCanaryPass(fixture, evidence);
});

it('exports manual-approval authority facts directly accepted by the formal verifier', () => {
    const fixture = createFixture('manual_approval');
    const databaseSha256Before = sha256File(fixture.databasePath);
    const result = exporter.exportExecutionCanaryEvidence(fixture.options, fixture.context);
    const evidence = JSON.parse(fs.readFileSync(result.outputPath, 'utf8'));
    expect(evidence).toMatchObject({
        kind: 'mission-control-execution-canary-evidence',
        schemaVersion: 'mission-control-execution-canary-evidence/v2',
        status: 'PASSED',
        passed: true,
        mode: 'manual_approval',
        packageIdentity: fixture.packageIdentity,
        scope: {
            storeId: fixture.ids.storeId,
            marketplace: 'US',
            currency: 'USD',
        },
        authority: {
            issuerType: 'human',
            missionGrantId: fixture.ids.missionGrantId,
            batchId: fixture.ids.batchId,
            jobId: fixture.ids.jobId,
        },
        database: {
            openedReadOnly: true,
            packageIdentity: fixture.packageIdentity,
            snapshotManifestSha256: sha256File(fixture.manifestPath),
            authorityProof: {
                queryContract: 'mission-control-execution-canary-authority/v2',
                passed: true,
            },
        },
    });
    expect(evidence.execution.evidence.map((record) => record.slot)).toEqual([
        'before',
        'after',
        'reload',
    ]);
    expect(path.dirname(fixture.storesRoot)).toBe(fixture.userDataDir);
    for (const record of evidence.execution.evidence) {
        expect(fs.readFileSync(record.artifactPath).subarray(0, 8).toString('hex'))
            .toBe('89504e470d0a1a0a');
    }
    expect(sha256File(fixture.databasePath)).toBe(databaseSha256Before);
    expectFormalCanaryPass(fixture, evidence);
});

it('exports policy-auto authority facts directly accepted by the formal verifier', () => {
    const fixture = createFixture('policy_auto');
    const { evidence } = exporter.exportExecutionCanaryEvidence(fixture.options, fixture.context);
    expect(evidence.mode).toBe('policy_auto');
    expect(evidence.authority.issuerType).toBe('policy');
    expect(evidence.object.expectedBidCents).toBe(95);
    expect(evidence.object.targetBidCents).toBe(90);
    expectFormalCanaryPass(fixture, evidence);
});

it('returns the durable submit intent from the verified database instead of a manifest supplied value', () => {
    const fixture = createFixture('manual_approval');
    const { evidence } = exporter.exportExecutionCanaryEvidence(fixture.options, fixture.context);
    evidence.authority.submitIntentId = 'forged-manifest-intent';
    const validation = expectFormalCanaryPass(fixture, evidence);
    const database = new Database(fixture.databasePath, { readonly: true, fileMustExist: true });
    try {
        expect(validation.canaryBinding.submitIntentId).toBe(database.prepare('SELECT submit_intent_id FROM ad_execution_jobs WHERE id=?').get(fixture.ids.jobId).submit_intent_id);
        expect(validation.canaryBinding.submitIntentId).not.toBe(evidence.authority.submitIntentId);
    } finally { database.close(); }
});

it('fails closed when the selected authority job row is missing', () => {
    const fixture = createFixture('manual_approval');
    mutateSnapshot(fixture, (database) => {
        database.prepare('DELETE FROM ad_execution_jobs WHERE id = ?').run(fixture.ids.jobId);
    });
    expect(() => exporter.exportExecutionCanaryEvidence(fixture.options, fixture.context))
        .toThrow(/execution job.*missing/i);
    expect(fs.existsSync(fixture.outputPath)).toBe(false);
});

it('rejects a mode that does not match the MissionGrant issuer and policy runtime', () => {
    const fixture = createFixture('manual_approval');
    const options = { ...fixture.options, mode: 'policy_auto' };
    expect(() => exporter.exportExecutionCanaryEvidence(options, fixture.context))
        .toThrow(/MissionGrant does not belong to policy_auto authority/i);
    expect(fs.existsSync(fixture.outputPath)).toBe(false);
});

it('rejects a missing before artifact', () => {
    const fixture = createFixture('manual_approval');
    fs.unlinkSync(fixture.artifactPaths.before);
    expect(() => exporter.exportExecutionCanaryEvidence(fixture.options, fixture.context))
        .toThrow(/before Store Capsule artifact does not exist/i);
});

it('rejects an artifact tampered after the authority snapshot', () => {
    const fixture = createFixture('policy_auto');
    fs.appendFileSync(fixture.artifactPaths.after, Buffer.from('tampered'));
    expect(() => exporter.exportExecutionCanaryEvidence(fixture.options, fixture.context))
        .toThrow(/after Store Capsule artifact.*(?:trailing bytes after IEND|SHA-256 does not match)/i);
});

it('rejects an artifact path redirected to another store capsule', () => {
    const fixture = createFixture('manual_approval');
    const crossStorePath = path.join(fixture.storesRoot, 'store-foreign', 'evidence', 'ad-execution', 'reload.png');
    fs.mkdirSync(path.dirname(crossStorePath), { recursive: true });
    fs.copyFileSync(fixture.artifactPaths.reload, crossStorePath);
    const options = {
        ...fixture.options,
        artifactPaths: { ...fixture.artifactPaths, reload: crossStorePath },
    };
    expect(() => exporter.exportExecutionCanaryEvidence(options, fixture.context))
        .toThrow(/reload artifact is not the deterministic Store Capsule path/i);
});

it('rejects a stale authority snapshot replay', () => {
    const fixture = createFixture('manual_approval');
    const manifest = JSON.parse(fs.readFileSync(fixture.manifestPath, 'utf8'));
    manifest.exportedAt = '2026-07-23T11:50:00.000Z';
    manifest.backup.startedAt = '2026-07-23T11:49:00.000Z';
    manifest.backup.completedAt = '2026-07-23T11:50:00.000Z';
    fs.writeFileSync(fixture.manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);
    expect(() => exporter.exportExecutionCanaryEvidence(fixture.options, fixture.context))
        .toThrow(/future-dated or stale.*replayed/i);
});

it('rejects a snapshot bound to a different canonical package', () => {
    const fixture = createFixture('policy_auto');
    const replayContext = {
        ...fixture.context,
        inspectCanonicalPackage: () => ({
            packageIdentity: {
                ...fixture.packageIdentity,
                mainBundleSha256: 'F'.repeat(64),
            },
            builtAtMs: Date.parse('2026-07-27T11:00:00.000Z'),
        }),
    };
    expect(() => exporter.exportExecutionCanaryEvidence(fixture.options, replayContext))
        .toThrow(/packageIdentity does not match.*package replay/i);
});

it('refuses to overwrite an existing evidence output', () => {
    const fixture = createFixture('manual_approval');
    fs.mkdirSync(path.dirname(fixture.outputPath), { recursive: false });
    fs.writeFileSync(fixture.outputPath, 'operator-owned');
    expect(() => exporter.exportExecutionCanaryEvidence(fixture.options, fixture.context))
        .toThrow(/already exists and will not be overwritten/i);
    expect(fs.readFileSync(fixture.outputPath, 'utf8')).toBe('operator-owned');
});

it('leaves no final or temporary output when validation fails', () => {
    const fixture = createFixture('policy_auto');
    fs.unlinkSync(fixture.artifactPaths.reload);
    expect(() => exporter.exportExecutionCanaryEvidence(fixture.options, fixture.context))
        .toThrow(/reload Store Capsule artifact does not exist/i);
    expect(fs.existsSync(fixture.outputPath)).toBe(false);
    expect(temporaryOutputFiles(fixture)).toEqual([]);
});

it('rejects a stale true execution-job terminal time even when snapshot and generatedAt are current', () => {
    const fixture = createFixture('manual_approval');
    mutateSnapshot(fixture, (database) => {
        database.prepare(`
        UPDATE ad_execution_jobs
        SET terminal_at = '2026-07-23T11:43:10.000Z',
            updated_at = '2026-07-23T11:43:10.000Z'
        WHERE id = ?
      `).run(fixture.ids.jobId);
    });
    expect(() => exporter.exportExecutionCanaryEvidence(fixture.options, fixture.context))
        .toThrow(/job terminalAt.*older than the 72-hour/i);
    expect(fs.existsSync(fixture.outputPath)).toBe(false);
});

it('rejects a stale screenshot capturedAt even when its database row and snapshot are current', () => {
    const fixture = createFixture('policy_auto');
    mutateSnapshot(fixture, (database) => {
        database.prepare(`
        UPDATE ad_execution_evidence
        SET captured_at = '2026-07-23T11:40:00.000Z',
            created_at = '2026-07-23T11:40:01.000Z'
        WHERE store_id = ? AND job_id = ? AND slot = 'before'
      `).run(fixture.ids.storeId, fixture.ids.jobId);
    });
    expect(() => exporter.exportExecutionCanaryEvidence(fixture.options, fixture.context))
        .toThrow(/before evidence capturedAt.*older than the 72-hour/i);
});

it('rejects fresh authority timestamps that are not causally ordered', () => {
    const fixture = createFixture('manual_approval');
    mutateSnapshot(fixture, (database) => {
        database.prepare(`
        UPDATE analysis_proposal_snapshots
        SET created_at = '2026-07-27T11:29:00.000Z'
        WHERE id = ?
      `).run(fixture.ids.proposalId);
    });
    expect(() => exporter.exportExecutionCanaryEvidence(fixture.options, fixture.context))
        .toThrow(/timestamps are stale or not causally closed/i);
});

it('rejects a CLI stores root outside the USER_DATA_DIR sibling derived from the live DB', () => {
    const fixture = createFixture('manual_approval');
    const foreignStoresRoot = path.join(fixture.tempDir, 'foreign-stores');
    fs.mkdirSync(foreignStoresRoot);
    const options = { ...fixture.options, storesRoot: foreignStoresRoot };
    expect(() => exporter.exportExecutionCanaryEvidence(options, fixture.context))
        .toThrow(/CLI storesRoot must equal the canonical stores directory/i);
});

it('rejects a junction or symlink substituted for the canonical USER_DATA_DIR stores root', () => {
    const fixture = createFixture('policy_auto');
    const junctionTarget = path.join(fixture.tempDir, 'junction-target-stores');
    fs.renameSync(fixture.storesRoot, junctionTarget);
    fs.symlinkSync(junctionTarget, fixture.storesRoot, 'junction');
    expect(() => exporter.exportExecutionCanaryEvidence(fixture.options, fixture.context))
        .toThrow(/stores root must be a direct real directory without symlink, junction, or reparse/i);
});

it('rejects evidence captured under a different session generation from authority records', () => {
    const fixture = createFixture('manual_approval');
    mutateSnapshot(fixture, (database) => {
        database.prepare(`
        UPDATE ad_execution_evidence
        SET captured_session_generation = captured_session_generation + 1
        WHERE store_id = ? AND job_id = ? AND slot = 'reload'
      `).run(fixture.ids.storeId, fixture.ids.jobId);
    });
    expect(() => exporter.exportExecutionCanaryEvidence(fixture.options, fixture.context))
        .toThrow(/reload authority evidence is not an exact job\/object\/session record/i);
});

it('rejects mismatched job, batch, grant, proposal, and identity session generations', () => {
    const fixture = createFixture('policy_auto');
    mutateSnapshot(fixture, (database) => {
        database.prepare(`
        UPDATE ad_keyword_identity_versions
        SET resolved_session_generation = resolved_session_generation + 1
        WHERE identity_version_id = ?
      `).run(fixture.ids.identityVersionId);
    });
    expect(() => exporter.exportExecutionCanaryEvidence(fixture.options, fixture.context))
        .toThrow(/session generations do not match exactly/i);
});

it('rejects bytes that match the authority DB hash but are not a PNG', () => {
    const fixture = createFixture('manual_approval');
    bindArtifactBytes(fixture, 'after', Buffer.from('not-a-png-authority-bound-artifact-with-more-than-thirty-three-bytes'));
    expect(() => exporter.exportExecutionCanaryEvidence(fixture.options, fixture.context))
        .toThrow(/after Store Capsule artifact.*PNG signature is missing or invalid/i);
});

it('rejects an authority-bound 1x1 PNG thumbnail', () => {
    const fixture = createFixture('manual_approval');
    bindArtifactBytes(fixture, 'after', productionPngBytes(90, { width: 1, height: 1 }));
    expect(() => exporter.exportExecutionCanaryEvidence(fixture.options, fixture.context))
        .toThrow(/after Store Capsule artifact.*1x1.*below the 1200x700 evidence minimum/i);
});

it('rejects output outside the canonical execution-canaries directory', () => {
    const fixture = createFixture('policy_auto');
    const options = {
        ...fixture.options,
        outputPath: path.join(fixture.tempDir, 'outside-canary.json'),
    };
    expect(() => exporter.exportExecutionCanaryEvidence(options, fixture.context))
        .toThrow(/must be a direct file under output\/codex-evidence\/execution-canaries/i);
});

it.each([
    ['release', (fixture) => fixture.context.releaseRoot],
    ['snapshot', (fixture) => fixture.snapshotRoot],
    ['live AppData', (fixture) => fixture.userDataDir],
    ['Store Capsule', (fixture) => fixture.storesRoot],
])('explicitly rejects a canonical output root nested under %s paths', (_label, selectRoot) => {
    const fixture = createFixture('manual_approval');
    const forbiddenRoot = selectRoot(fixture);
    fs.mkdirSync(forbiddenRoot, { recursive: true });
    const executionCanaryOutputRoot = path.join(forbiddenRoot, 'execution-canaries');
    const options = {
        ...fixture.options,
        outputPath: path.join(executionCanaryOutputRoot, 'forbidden-canary.json'),
    };
    const context = {
        ...fixture.context,
        canonicalEvidenceRoot: forbiddenRoot,
        executionCanaryOutputRoot,
    };
    expect(() => exporter.exportExecutionCanaryEvidence(options, context))
        .toThrow(/may not be written under release, snapshot, live AppData, or Store Capsule paths/i);
    expect(fs.existsSync(options.outputPath)).toBe(false);
});

it('removes the final output if the canonical package hashes drift after writing', () => {
    const fixture = createFixture('policy_auto');
    let packageDrifted = false;
    const context = {
        ...fixture.context,
        afterOutputWritten: () => {
            packageDrifted = true;
        },
        inspectCanonicalPackage: () => ({
            packageIdentity: {
                ...fixture.packageIdentity,
                ...(packageDrifted ? { mainBundleSha256: 'F'.repeat(64) } : {}),
            },
            builtAtMs: Date.parse('2026-07-27T11:00:00.000Z'),
        }),
    };
    expect(() => exporter.exportExecutionCanaryEvidence(fixture.options, context))
        .toThrow(/package hashes changed after the canary evidence write/i);
    expect(fs.existsSync(fixture.outputPath)).toBe(false);
    expect(temporaryOutputFiles(fixture)).toEqual([]);
});

it('removes the final output if the authority snapshot manifest hash drifts after writing', () => {
    const fixture = createFixture('manual_approval');
    const context = {
        ...fixture.context,
        afterOutputWritten: () => {
            fs.appendFileSync(fixture.manifestPath, '\n');
        },
    };
    expect(() => exporter.exportExecutionCanaryEvidence(fixture.options, context))
        .toThrow(/snapshot manifest hash changed after the canary evidence write/i);
    expect(fs.existsSync(fixture.outputPath)).toBe(false);
    expect(temporaryOutputFiles(fixture)).toEqual([]);
});

it('removes the final output if the authority snapshot database hash drifts after writing', () => {
    const fixture = createFixture('policy_auto');
    const context = {
        ...fixture.context,
        afterOutputWritten: () => {
            fs.appendFileSync(fixture.databasePath, Buffer.from('post-write-drift'));
        },
    };
    expect(() => exporter.exportExecutionCanaryEvidence(fixture.options, context))
        .toThrow(/snapshot bytes do not match the manifest/i);
    expect(fs.existsSync(fixture.outputPath)).toBe(false);
    expect(temporaryOutputFiles(fixture)).toEqual([]);
});

it('rejects a committed WAL-only live authority change after the selected snapshot', () => {
    const fixture = createFixture('manual_approval');
    const database = new Database(fixture.sourcePath);
    try {
        database.pragma('journal_mode = WAL');
        database.pragma('wal_autocheckpoint = 0');
        database.pragma('wal_checkpoint(TRUNCATE)');
        fs.rmSync(fixture.databasePath);
        const onlineBackup = runReadonlySqliteOnlineBackupSync({
            sourceDatabasePath: fixture.sourcePath,
            destinationPath: fixture.databasePath,
            ownedTempRoot: path.dirname(fixture.databasePath),
        });
        const manifest = refreshSnapshotManifest(fixture);
        manifest.backup.totalPages = onlineBackup.observedBackup.totalPages;
        manifest.backup.remainingPages = onlineBackup.observedBackup.remainingPages;
        fs.writeFileSync(fixture.manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);
        const mainBefore = fileArtifact(fixture.sourcePath);
        database.exec(`
        CREATE TABLE authority_currentness_drift (
          id TEXT PRIMARY KEY,
          revoked INTEGER NOT NULL
        );
        INSERT INTO authority_currentness_drift VALUES ('grant-1', 1);
      `);
        expect(fs.statSync(`${fixture.sourcePath}-wal`).size).toBeGreaterThan(0);
        expect(fileArtifact(fixture.sourcePath)).toEqual(mainBefore);
        expect(() => exporter.exportExecutionCanaryEvidence(fixture.options, fixture.context)).toThrow(/online backup does not match the selected authority snapshot/i);
        expect(fs.existsSync(fixture.outputPath)).toBe(false);
        expect(temporaryOutputFiles(fixture)).toEqual([]);
    }
    finally {
        database.close();
    }
});
});
