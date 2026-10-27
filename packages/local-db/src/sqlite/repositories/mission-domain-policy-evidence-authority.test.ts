import Database from 'better-sqlite3';
import { describe, expect, it } from 'vitest';
import { MissionDomainRepository, MissionDomainRepositoryError } from './mission-domain-repo';
import { NOW, policyRules } from './mission-domain-repo.test-data';
import { seedProductScopeAuthorityWithOnlyUnrelatedMetric, seedExactPolicyAuthorityMetric } from './mission-domain-repo.test-authority';
import { databases, createHarness, expectRepositoryError } from './mission-domain-repo.test-harness';
describe("MissionDomainRepository policy and context authority", () => {
it('requires backend-proven keyword authority even for a store-wide V1 policy', () => {
    const { database, contextOne } = createHarness();
    const repository = new MissionDomainRepository(database, {
      now: () => new Date(NOW),
      references: {
        productBelongsToStore: () => true,
        adEntityBelongsToStore: () => true,
        adEntitySupportsKeywordBid: () => false,
      },
    });
    const policy = repository.createPolicy(contextOne, {
      id: 'policy-keyword-backend-proof',
      name: 'Keyword proof required',
      scope: 'store',
      priority: 5,
      actorId: 'operator',
    });

    expectRepositoryError(() => repository.createPolicyVersion(contextOne, {
      id: 'policy-keyword-backend-proof-v1',
      policyId: policy.id,
      version: 1,
      rules: policyRules(contextOne.storeId),
      actorId: 'operator',
    }), 'REFERENCE_CONFLICT');
  });

it('revalidates the policy scope allowlist at version create, update and enable boundaries', () => {
    const { database, repository, contextOne } = createHarness();
    const inScopeId = `${contextOne.storeId}-keyword-1`;
    const outOfScopeId = `${contextOne.storeId}-keyword-2`;
    const policy = repository.createPolicy(contextOne, {
      id: 'policy-keyword-scope',
      name: 'One keyword only',
      scope: `keyword:${inScopeId}`,
      priority: 5,
      actorId: 'operator',
    });

    expectRepositoryError(() => repository.createPolicyVersion(contextOne, {
      id: 'policy-keyword-scope-v1-invalid',
      policyId: policy.id,
      version: 1,
      rules: { ...policyRules(contextOne.storeId), allowedAdEntityIds: [outOfScopeId] },
      actorId: 'operator',
    }), 'REFERENCE_CONFLICT');
    const draft = repository.createPolicyVersion(contextOne, {
      id: 'policy-keyword-scope-v1',
      policyId: policy.id,
      version: 1,
      rules: { ...policyRules(contextOne.storeId), allowedAdEntityIds: [inScopeId] },
      actorId: 'operator',
    });
    expectRepositoryError(() => repository.updateDraftPolicyVersion(contextOne, {
      id: draft.id,
      expectedRevision: draft.revision,
      actorId: 'operator',
      rules: { ...policyRules(contextOne.storeId), allowedAdEntityIds: [outOfScopeId] },
    }), 'REFERENCE_CONFLICT');

    database.prepare('UPDATE policy_versions SET rules_json = ? WHERE store_id = ? AND id = ?')
      .run(JSON.stringify({ ...policyRules(contextOne.storeId), allowedAdEntityIds: [outOfScopeId] }), contextOne.storeId, draft.id);
    expectRepositoryError(() => repository.enablePolicyVersion(contextOne, {
      policyId: policy.id,
      versionId: draft.id,
      expectedPolicyRevision: policy.revision,
      expectedVersionRevision: draft.revision,
      actorId: 'operator',
    }), 'REFERENCE_CONFLICT');
    expect(repository.getPolicyVersion(contextOne, draft.id)?.status).toBe('draft');
  });

it('holds an IMMEDIATE lock while validating create and update policy authority', () => {
    const { database, databasePath, contextOne } = createHarness();
    const competing = new Database(databasePath);
    databases.push(competing);
    competing.pragma('busy_timeout = 0');
    let lockProbeCount = 0;
    const repository = new MissionDomainRepository(database, {
      now: () => new Date(NOW),
      references: {
        productBelongsToStore: () => true,
        adEntityBelongsToStore: () => true,
        adEntitySupportsKeywordBid: () => {
          lockProbeCount += 1;
          expect(() => competing.prepare(`
            UPDATE policies SET priority = priority + 1
            WHERE store_id = ? AND id = ?
          `).run(contextOne.storeId, 'policy-version-lock')).toThrow(/locked/i);
          return true;
        },
      },
    });
    const policy = repository.createPolicy(contextOne, {
      id: 'policy-version-lock',
      name: 'Version validation lock',
      scope: 'store',
      priority: 5,
      actorId: 'operator',
    });
    const draft = repository.createPolicyVersion(contextOne, {
      id: 'policy-version-lock-v1',
      policyId: policy.id,
      version: 1,
      rules: policyRules(contextOne.storeId),
      actorId: 'operator',
    });
    repository.updateDraftPolicyVersion(contextOne, {
      id: draft.id,
      expectedRevision: draft.revision,
      rules: { ...draft.rules, cooldownMinutes: 30 },
      actorId: 'operator',
    });
    expect(lockProbeCount).toBe(2);
  });

it('does not expose store or advertising object IDs in attribution failures', () => {
    const { database, repository, contextOne, contextTwo } = createHarness();
    const policy = repository.createPolicy(contextOne, {
      id: 'policy-no-id-leak',
      name: 'No internal ID leak',
      scope: 'store',
      priority: 5,
      actorId: 'operator',
    });
    try {
      repository.createPolicyVersion(contextOne, {
        id: 'policy-no-id-leak-v1',
        policyId: policy.id,
        version: 1,
        rules: {
          ...policyRules(contextOne.storeId),
          allowedAdEntityIds: [`${contextTwo.storeId}-keyword-secret`],
        },
        actorId: 'operator',
      });
      throw new Error('Expected attribution failure.');
    } catch (error) {
      expect(error).toBeInstanceOf(MissionDomainRepositoryError);
      const message = (error as Error).message;
      expect(message).toContain('请重新核验当前店铺广告对象');
      expect(message).not.toContain(contextOne.storeId);
      expect(message).not.toContain(contextTwo.storeId);
      expect(message).not.toContain('keyword-secret');
    }
  });

it('requires product scope to match the authority exact evidence row, not any historical metric with the same names', () => {
    const { database, repository, contextOne } = createHarness();
    const authority = seedProductScopeAuthorityWithOnlyUnrelatedMetric(database, contextOne);
    const policy = repository.createPolicy(contextOne, {
      id: 'policy-product-exact-evidence',
      name: 'Exact product evidence only',
      scope: 'product:B0WRONGROW',
      priority: 5,
      actorId: 'operator',
    });

    expectRepositoryError(() => repository.createPolicyVersion(contextOne, {
      id: 'policy-product-exact-evidence-v1-invalid',
      policyId: policy.id,
      version: 1,
      rules: { ...policyRules(contextOne.storeId), allowedAdEntityIds: [authority.entityId] },
      actorId: 'operator',
    }), 'REFERENCE_CONFLICT');

    const exactMetric = database.prepare(`
      INSERT INTO ad_daily_metrics (
        batch_id, report_type, date, store_name, marketplace_code, asin,
        campaign_name, ad_group_name, targeting, source_file, source_row,
        store_id, store_authority_quarantined
      ) VALUES (?, 'keyword', '2026-07-21', 'US Store One', 'US', 'B0WRONGROW',
        'Exact Campaign', 'Exact Ad Group', 'exact keyword', ?, ?, ?, 0)
    `).run(`batch-${contextOne.storeId}`, authority.exactFile, authority.exactRow, contextOne.storeId);
    database.prepare(`
      INSERT INTO store_migration_quarantine (
        migration_version, source_table, source_row_id, reason,
        candidate_store_ids_json, source_identity_json, status,
        created_at, updated_at
      ) VALUES (999, 'ad_daily_metrics', ?, 'duplicate_identity', '[]', '{}', 'pending', ?, ?)
    `).run(String(exactMetric.lastInsertRowid), NOW, NOW);
    expectRepositoryError(() => repository.createPolicyVersion(contextOne, {
      id: 'policy-product-exact-evidence-v1-quarantined',
      policyId: policy.id,
      version: 1,
      rules: { ...policyRules(contextOne.storeId), allowedAdEntityIds: [authority.entityId] },
      actorId: 'operator',
    }), 'REFERENCE_CONFLICT');
    database.prepare(`
      UPDATE store_migration_quarantine
      SET status = 'resolved', resolved_store_id = ?, resolution_note = 'unit proof',
          resolved_at = ?, updated_at = ?
      WHERE migration_version = 999
        AND source_table = 'ad_daily_metrics'
        AND source_row_id = ?
    `).run(contextOne.storeId, NOW, NOW, String(exactMetric.lastInsertRowid));
    const valid = repository.createPolicyVersion(contextOne, {
      id: 'policy-product-exact-evidence-v1',
      policyId: policy.id,
      version: 1,
      rules: { ...policyRules(contextOne.storeId), allowedAdEntityIds: [authority.entityId] },
      actorId: 'operator',
    });
    expect(valid.rules.allowedAdEntityIds).toEqual([authority.entityId]);
  });

it('revalidates exact current evidence for store scope on create, update and enable', () => {
    const { database, repository, contextOne } = createHarness();
    const rules = policyRules(contextOne.storeId);
    const policy = repository.createPolicy(contextOne, {
      id: 'policy-store-exact-evidence',
      name: 'Store exact evidence',
      scope: 'store',
      priority: 5,
      actorId: 'operator',
    });
    const draft = repository.createPolicyVersion(contextOne, {
      id: 'policy-store-exact-evidence-v1',
      policyId: policy.id,
      version: 1,
      rules,
      actorId: 'operator',
    });
    database.prepare(`
      UPDATE ad_daily_metrics
      SET source_file = 'C:/reports/path-drift/keyword.xlsx'
      WHERE store_id = ? AND source_file = ?
    `).run(contextOne.storeId, `C:/reports/${contextOne.storeId}/baseline/keyword.xlsx`);

    const createPolicy = repository.createPolicy(contextOne, {
      id: 'policy-store-path-drift-create',
      name: 'Store path drift create',
      scope: 'store',
      priority: 6,
      actorId: 'operator',
    });
    expectRepositoryError(() => repository.createPolicyVersion(contextOne, {
      id: 'policy-store-path-drift-create-v1',
      policyId: createPolicy.id,
      version: 1,
      rules,
      actorId: 'operator',
    }), 'REFERENCE_CONFLICT');
    expectRepositoryError(() => repository.updateDraftPolicyVersion(contextOne, {
      id: draft.id,
      expectedRevision: draft.revision,
      rules: { ...rules, cooldownMinutes: 30 },
      actorId: 'operator',
    }), 'REFERENCE_CONFLICT');
    expectRepositoryError(() => repository.enablePolicyVersion(contextOne, {
      policyId: policy.id,
      versionId: draft.id,
      expectedPolicyRevision: policy.revision,
      expectedVersionRevision: draft.revision,
      actorId: 'operator',
    }), 'REFERENCE_CONFLICT');
    expect(repository.getPolicyVersion(contextOne, draft.id)?.status).toBe('draft');
  });

it('rejects store scope when the current import snapshot is not bound to a report file', () => {
    const { database, repository, contextOne } = createHarness();
    const authority = seedProductScopeAuthorityWithOnlyUnrelatedMetric(database, contextOne, {
      lineageKey: 'unbound',
      bindReportFile: false,
      entityName: 'unbound keyword',
      campaignName: 'Unbound Campaign',
      adGroupName: 'Unbound Ad Group',
    });
    seedExactPolicyAuthorityMetric(database, contextOne, {
      sourceFile: authority.exactFile,
      sourceRow: authority.sourceRow,
      entityName: 'unbound keyword',
      campaignName: 'Unbound Campaign',
      adGroupName: 'Unbound Ad Group',
    });
    const policy = repository.createPolicy(contextOne, {
      id: 'policy-unbound-report-file',
      name: 'Unbound report file must fail closed',
      scope: 'store',
      priority: 5,
      actorId: 'operator',
    });

    expectRepositoryError(() => repository.createPolicyVersion(contextOne, {
      id: 'policy-unbound-report-file-v1',
      policyId: policy.id,
      version: 1,
      rules: { ...policyRules(contextOne.storeId), allowedAdEntityIds: [authority.entityId] },
      actorId: 'operator',
    }), 'REFERENCE_CONFLICT');
  });

it('revalidates the latest completed import for keyword scope on create, update and enable', () => {
    const { database, repository, contextOne } = createHarness();
    const entityId = `${contextOne.storeId}-keyword-1`;
    const rules = policyRules(contextOne.storeId);
    const policy = repository.createPolicy(contextOne, {
      id: 'policy-keyword-current-import',
      name: 'Keyword current import',
      scope: `keyword:${entityId}`,
      priority: 5,
      actorId: 'operator',
    });
    const draft = repository.createPolicyVersion(contextOne, {
      id: 'policy-keyword-current-import-v1',
      policyId: policy.id,
      version: 1,
      rules,
      actorId: 'operator',
    });
    const newerRunId = `scope-run-newer-${contextOne.storeId}`;
    const newerAt = '2026-07-22T12:01:00.000Z';
    database.prepare(`
      INSERT INTO report_import_runs (
        store_id, run_id, idempotency_key, input_fingerprint, batch_id, status,
        source_file_count, metric_row_count, reconciliation_count,
        started_at, completed_at, created_at
      ) VALUES (?, ?, ?, ?, ?, 'completed', 1, 1, 1, ?, ?, ?)
    `).run(
      contextOne.storeId,
      newerRunId,
      `scope-idempotency-newer-${contextOne.storeId}`,
      '7'.repeat(64),
      `batch-${contextOne.storeId}`,
      newerAt,
      newerAt,
      newerAt,
    );
    database.prepare(`
      INSERT INTO report_import_file_snapshots (
        store_id, snapshot_id, run_id, batch_id, report_type, file_path,
        file_name, file_size_bytes, file_hash, imported_rows, captured_at
      ) VALUES (?, ?, ?, ?, 'keyword', ?, 'keyword-newer.xlsx', 1024, ?, 1, ?)
    `).run(
      contextOne.storeId,
      `scope-snapshot-newer-${contextOne.storeId}`,
      newerRunId,
      `batch-${contextOne.storeId}`,
      `C:/reports/${contextOne.storeId}/newer/keyword.xlsx`,
      '8'.repeat(64),
      newerAt,
    );

    const createPolicy = repository.createPolicy(contextOne, {
      id: 'policy-keyword-stale-create',
      name: 'Keyword stale create',
      scope: `keyword:${entityId}`,
      priority: 6,
      actorId: 'operator',
    });
    expectRepositoryError(() => repository.createPolicyVersion(contextOne, {
      id: 'policy-keyword-stale-create-v1',
      policyId: createPolicy.id,
      version: 1,
      rules,
      actorId: 'operator',
    }), 'REFERENCE_CONFLICT');
    expectRepositoryError(() => repository.updateDraftPolicyVersion(contextOne, {
      id: draft.id,
      expectedRevision: draft.revision,
      rules: { ...rules, cooldownMinutes: 30 },
      actorId: 'operator',
    }), 'REFERENCE_CONFLICT');
    expectRepositoryError(() => repository.enablePolicyVersion(contextOne, {
      policyId: policy.id,
      versionId: draft.id,
      expectedPolicyRevision: policy.revision,
      expectedVersionRevision: draft.revision,
      actorId: 'operator',
    }), 'REFERENCE_CONFLICT');
    expect(repository.getPolicyVersion(contextOne, draft.id)?.status).toBe('draft');
  });
});
