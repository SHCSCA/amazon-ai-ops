import { createHash } from 'crypto';
import type Database from 'better-sqlite3';
import {
  ANALYSIS_REQUIRED_REPORT_TYPES,
  normalizeStoreContextEnvelope,
  validateAnalysisEvidencePackage,
  validateAnalysisProposalSnapshot,
  validateVerifiedAdEntityAuthority,
  type AnalysisActionBatchRecord,
  type AnalysisAuthorizationEligibility,
  type AnalysisEvidencePackageRecord,
  type AnalysisEvidenceSourceRef,
  type AnalysisProposalBlockerCode,
  type AnalysisProposalDecisionLinkRecord,
  type AnalysisProposalSnapshotRecord,
  type AnalysisProposalSource,
  type CreateAnalysisProposalSnapshotInput,
  type RegisterVerifiedAdEntityAuthorityInput,
  type SealAnalysisEvidencePackageInput,
  type StoreContextEnvelope,
  type VerifiedAdEntityAuthorityRecord,
  type VerifiedAdEntityType,
} from '@amazon-ai-ops/shared-types';

export type AnalysisAuthorityErrorCode =
  | 'INVALID_CONTEXT'
  | 'STORE_NOT_ACTIVE'
  | 'STALE_CONTEXT'
  | 'NOT_FOUND'
  | 'REFERENCE_CONFLICT'
  | 'STATE_CONFLICT'
  | 'INVALID_INPUT'
  | 'UNSUPPORTED_ACTION';

export class AnalysisAuthorityRepositoryError extends Error {
  constructor(
    readonly code: AnalysisAuthorityErrorCode,
    message: string,
  ) {
    super(message);
    this.name = 'AnalysisAuthorityRepositoryError';
  }
}

export interface AnalysisAuthorityRepositoryOptions {
  now?: () => Date;
}

interface MissionRow {
  id: string;
  store_id: string;
  data_batch_id: string;
  policy_version_id: string;
  status: string;
  revision: number;
}

interface EvidenceRow {
  id: string;
  store_id: string;
  marketplace: 'US';
  currency: 'USD';
  mission_id: string;
  data_batch_id: string;
  import_run_id: string;
  date_from: string;
  date_to: string;
  asin: string | null;
  report_types_json: string;
  sources_json: string;
  metric_row_count: number;
  reconciliation_hash: string;
  rule_revision: string;
  model_revision: string;
  package_hash: string;
  imported_at: string;
  fresh_until: string;
  sealed_at: string;
  created_session_generation: number;
}

interface AuthorityRow {
  authority_id: string;
  store_id: string;
  ad_entity_id: string;
  entity_revision: number;
  entity_type: VerifiedAdEntityType;
  entity_name: string;
  campaign_name: string;
  ad_group_name: string;
  evidence_package_id: string;
  source_report_type: VerifiedAdEntityType;
  source_file_hash: string;
  source_row: number;
  identity_source: 'ads_ui' | 'ads_api';
  proof_sha256: string;
  verified_by: string;
  verified_at: string;
  created_at: string;
}

interface ProposalRow {
  id: string;
  store_id: string;
  marketplace: 'US';
  currency: 'USD';
  mission_id: string;
  mission_revision: number;
  evidence_package_id: string;
  evidence_package_hash: string;
  data_batch_id: string;
  policy_version_id: string;
  policy_revision: number;
  rule_revision: string;
  model_revision: string;
  action_batch_id: string;
  action_revision: number;
  legacy_recommendation_id: number;
  action_type: 'set_keyword_bid';
  entity_type: 'keyword';
  entity_name: string;
  campaign_name: string;
  ad_group_name: string;
  ad_entity_authority_id: string | null;
  ad_entity_id: string | null;
  ad_entity_revision: number | null;
  current_bid_cents: number;
  proposed_bid_cents: number;
  change_pct: number;
  confidence: number;
  source: AnalysisProposalSource;
  explanation: string;
  authorization_json: string;
  valid_until: string;
  created_at: string;
  created_session_generation: number;
}

interface ActionBatchRow {
  id: string;
  store_id: string;
  mission_id: string;
  mission_revision: number;
  evidence_package_id: string;
  rule_revision: string;
  model_revision: string;
  action_revision: number;
  created_at: string;
  created_session_generation: number;
}

export class AnalysisAuthorityRepository {
  private readonly now: () => Date;

  constructor(
    private readonly db: Database.Database,
    options: AnalysisAuthorityRepositoryOptions = {},
  ) {
    this.now = options.now ?? (() => new Date());
  }

  sealEvidencePackage(
    contextInput: StoreContextEnvelope,
    input: SealAnalysisEvidencePackageInput,
  ): AnalysisEvidencePackageRecord {
    const context = normalizeContextInput(contextInput);
    const operation = this.db.transaction(() => {
      this.assertContext(context);
      const mission = this.requireMission(context, input.missionId);
      const dateFrom = dateOf(input.dateFrom, 'dateFrom');
      const dateTo = dateOf(input.dateTo, 'dateTo');
      if (dateFrom > dateTo) throw invalid('Analysis evidence date range is inverted.');
      const asin = optionalText(input.asin)?.toUpperCase();
      const freshnessWindowHours = finite(input.freshnessWindowHours, 'freshnessWindowHours');
      if (freshnessWindowHours <= 0 || freshnessWindowHours > 24 * 30) {
        throw invalid('Analysis freshness window must be within 0..720 hours.');
      }
      const ruleRevision = sha256Of(input.ruleRevision, 'ruleRevision');
      const modelRevision = textOf(input.modelRevision, 'modelRevision', 240);
      const batch = this.db.prepare(`
        SELECT date_start AS dateFrom, date_end AS dateTo, status
        FROM lingxing_report_batches WHERE store_id = ? AND id = ?
      `).get(context.storeId, mission.data_batch_id) as {
        dateFrom: string;
        dateTo: string;
        status: string;
      } | undefined;
      if (!batch || batch.status !== 'completed') {
        throw stateConflict('Mission analysis requires its completed Lingxing data batch.');
      }
      if (dateFrom !== batch.dateFrom || dateTo !== batch.dateTo) {
        throw referenceConflict('Analysis evidence must cover the exact Mission data-batch date range.');
      }
      const importRun = this.db.prepare(`
        SELECT run_id AS runId, completed_at AS completedAt, metric_row_count AS metricRowCount
        FROM report_import_runs
        WHERE store_id = ? AND batch_id = ? AND status = 'completed'
        ORDER BY completed_at DESC, run_id DESC
        LIMIT 1
      `).get(context.storeId, mission.data_batch_id) as {
        runId: string;
        completedAt: string;
        metricRowCount: number;
      } | undefined;
      if (!importRun) throw referenceConflict('Mission data batch has no completed immutable import run.');

      const fileRows = this.db.prepare(`
        SELECT report_type AS reportType, file_hash AS fileHash,
               file_size_bytes AS fileSizeBytes, imported_rows AS importedRows,
               file_path AS filePath
        FROM report_import_file_snapshots
        WHERE store_id = ? AND run_id = ? AND batch_id = ?
        ORDER BY report_type, file_hash, snapshot_id
      `).all(context.storeId, importRun.runId, mission.data_batch_id) as Array<{
        reportType: string;
        fileHash: string;
        fileSizeBytes: number;
        importedRows: number;
        filePath: string;
      }>;
      const filePaths = new Set(fileRows.map((row) => row.filePath));
      if (filePaths.size === 0) throw referenceConflict('Import run has no immutable file snapshots.');

      const metricParams: unknown[] = [context.storeId, mission.data_batch_id, dateFrom, dateTo];
      let asinSql = '';
      if (asin) {
        asinSql = ' AND upper(COALESCE(metrics.asin, \'\')) = upper(?)';
        metricParams.push(asin);
      }
      const metricRows = this.db.prepare(`
        SELECT metrics.report_type AS reportType,
               COUNT(*) AS metricRows,
               MIN(metrics.source_row) AS firstSourceRow,
               MAX(metrics.source_row) AS lastSourceRow
        FROM ad_daily_metrics AS metrics
        WHERE metrics.store_id = ?
          AND metrics.batch_id = ?
          AND metrics.date >= ? AND metrics.date <= ?
          AND metrics.store_authority_quarantined = 0
          ${asinSql}
          AND EXISTS (
            SELECT 1 FROM report_import_file_snapshots AS snapshots
            WHERE snapshots.store_id = metrics.store_id
              AND snapshots.run_id = '${sqlLiteral(importRun.runId)}'
              AND snapshots.batch_id = metrics.batch_id
              AND snapshots.report_type = metrics.report_type
              AND snapshots.file_path = metrics.source_file
          )
        GROUP BY metrics.report_type
        ORDER BY metrics.report_type
      `).all(...metricParams) as Array<{
        reportType: string;
        metricRows: number;
        firstSourceRow: number | null;
        lastSourceRow: number | null;
      }>;
      const metricsByReport = new Map(metricRows.map((row) => [row.reportType, row]));
      const filesByReport = groupBy(fileRows, (row) => row.reportType);
      const sources: AnalysisEvidenceSourceRef[] = ANALYSIS_REQUIRED_REPORT_TYPES.map((reportType) => {
        const files = filesByReport.get(reportType) ?? [];
        if (files.length === 0) {
          throw referenceConflict(`Analysis evidence is missing required report type: ${reportType}.`);
        }
        const metrics = metricsByReport.get(reportType);
        return {
          reportType,
          fileHash: aggregateHashes(files.map((file) => file.fileHash)),
          fileSizeBytes: files.reduce((sum, file) => sum + nonNegative(file.fileSizeBytes), 0),
          importedRows: files.reduce((sum, file) => sum + nonNegative(file.importedRows), 0),
          metricRows: nonNegative(metrics?.metricRows ?? 0),
          firstSourceRow: positiveOrUndefined(metrics?.firstSourceRow),
          lastSourceRow: positiveOrUndefined(metrics?.lastSourceRow),
        };
      });
      const metricRowCount = sources.reduce((sum, source) => sum + source.metricRows, 0);
      if (metricRowCount <= 0 || metricRowCount > nonNegative(importRun.metricRowCount)) {
        throw stateConflict('Analysis evidence has no authoritative imported metric rows or exceeds its import run.');
      }

      const reconciliations = this.db.prepare(`
        SELECT metric_date AS metricDate, report_type AS reportType,
               expected_rows AS expectedRows, actual_rows AS actualRows,
               expected_cost_1e4 AS expectedCost1e4,
               actual_cost_1e4 AS actualCost1e4,
               absolute_cost_delta_1e4 AS absoluteCostDelta1e4,
               tolerance_1e4 AS tolerance1e4, within_tolerance AS withinTolerance,
               status
        FROM report_import_reconciliations
        WHERE store_id = ? AND run_id = ? AND batch_id = ?
        ORDER BY metric_date, report_type, reconciliation_id
      `).all(context.storeId, importRun.runId, mission.data_batch_id) as Array<Record<string, unknown>>;
      if (reconciliations.length === 0
        || reconciliations.some((row) => row.status !== 'matched' || Number(row.withinTolerance) !== 1)) {
        throw stateConflict('Analysis evidence reconciliation is missing or contains mismatches.');
      }
      const reconciliationHash = hashObject(reconciliations);
      const importedAt = timestampOf(importRun.completedAt, 'importRun.completedAt');
      const freshUntil = new Date(Date.parse(importedAt) + freshnessWindowHours * 60 * 60 * 1000).toISOString();
      const sealedAt = this.timestamp();
      const packagePayload = {
        storeId: context.storeId,
        missionId: mission.id,
        dataBatchId: mission.data_batch_id,
        importRunId: importRun.runId,
        dateFrom,
        dateTo,
        asin,
        reportTypes: ANALYSIS_REQUIRED_REPORT_TYPES,
        sources,
        metricRowCount,
        reconciliationHash,
        ruleRevision,
        modelRevision,
        importedAt,
        freshUntil,
        createdSessionGeneration: context.sessionGeneration,
      };
      const packageHash = hashObject(packagePayload);
      const existingByHash = this.db.prepare(`
        SELECT * FROM analysis_evidence_packages WHERE store_id = ? AND package_hash = ?
      `).get(context.storeId, packageHash) as EvidenceRow | undefined;
      if (existingByHash) return mapEvidence(existingByHash);

      const record: AnalysisEvidencePackageRecord = {
        // The immutable package content owns its identity. Corrected re-imports
        // therefore create a new id instead of colliding with an older run.
        id: `analysis-evidence:${packageHash.slice(0, 32)}`,
        storeId: context.storeId,
        marketplace: 'US',
        currency: 'USD',
        missionId: mission.id,
        dataBatchId: mission.data_batch_id,
        importRunId: importRun.runId,
        dateFrom,
        dateTo,
        asin,
        reportTypes: ANALYSIS_REQUIRED_REPORT_TYPES,
        sources,
        metricRowCount,
        reconciliationHash,
        ruleRevision,
        modelRevision,
        packageHash,
        importedAt,
        freshUntil,
        sealedAt,
        createdSessionGeneration: context.sessionGeneration,
      };
      validateAnalysisEvidencePackage(record);
      try {
        this.db.prepare(`
          INSERT INTO analysis_evidence_packages (
            id, store_id, marketplace, currency, mission_id, data_batch_id,
            import_run_id, date_from, date_to, asin, report_types_json, sources_json,
            metric_row_count, reconciliation_hash, rule_revision, model_revision,
            package_hash, imported_at, fresh_until, sealed_at, created_session_generation
          ) VALUES (
            @id, @storeId, 'US', 'USD', @missionId, @dataBatchId,
            @importRunId, @dateFrom, @dateTo, @asin, @reportTypesJson, @sourcesJson,
            @metricRowCount, @reconciliationHash, @ruleRevision, @modelRevision,
            @packageHash, @importedAt, @freshUntil, @sealedAt, @createdSessionGeneration
          )
        `).run({
          ...record,
          asin: record.asin ?? null,
          reportTypesJson: JSON.stringify(record.reportTypes),
          sourcesJson: JSON.stringify(record.sources),
        });
      } catch (error) {
        throw referenceConflict(`Analysis evidence identity already exists: ${errorMessage(error)}`);
      }
      return this.requireEvidence(context, record.id);
    });
    return operation.immediate();
  }

  getEvidencePackage(
    contextInput: StoreContextEnvelope,
    idInput: string,
  ): AnalysisEvidencePackageRecord | undefined {
    const context = this.assertContext(contextInput);
    const row = this.db.prepare(`
      SELECT * FROM analysis_evidence_packages WHERE store_id = ? AND id = ?
    `).get(context.storeId, idOf(idInput, 'evidencePackageId')) as EvidenceRow | undefined;
    return row ? mapEvidence(row) : undefined;
  }

  listEvidencePackages(
    contextInput: StoreContextEnvelope,
    missionIdInput: string,
  ): AnalysisEvidencePackageRecord[] {
    const context = this.assertContext(contextInput);
    const mission = this.requireMission(context, missionIdInput);
    return (this.db.prepare(`
      SELECT * FROM analysis_evidence_packages
      WHERE store_id = ? AND mission_id = ?
      ORDER BY sealed_at DESC, id
    `).all(context.storeId, mission.id) as EvidenceRow[]).map(mapEvidence);
  }

  createActionBatch(
    contextInput: StoreContextEnvelope,
    input: {
      id: string;
      missionId: string;
      evidencePackageId: string;
      expectedMissionRevision: number;
    },
  ): AnalysisActionBatchRecord {
    const context = normalizeContextInput(contextInput);
    const operation = this.db.transaction(() => {
      this.assertContext(context);
      const mission = this.requireMission(context, input.missionId);
      if (!Number.isSafeInteger(input.expectedMissionRevision)
        || input.expectedMissionRevision <= 0
        || mission.revision !== input.expectedMissionRevision) {
        throw stateConflict('Mission changed while its analysis was running.');
      }
      const evidence = this.requireEvidence(context, input.evidencePackageId);
      if (evidence.missionId !== mission.id || evidence.dataBatchId !== mission.data_batch_id) {
        throw referenceConflict('Analysis action batch does not match Mission evidence lineage.');
      }
      const requestedId = idOf(input.id, 'analysisActionBatchId');
      const existing = this.db.prepare(`
        SELECT * FROM analysis_action_batches WHERE store_id = ? AND id = ?
      `).get(context.storeId, requestedId) as ActionBatchRow | undefined;
      if (existing) {
        if (existing.mission_id !== mission.id
          || existing.mission_revision !== mission.revision
          || existing.evidence_package_id !== evidence.id
          || existing.rule_revision !== evidence.ruleRevision
          || existing.model_revision !== evidence.modelRevision) {
          throw referenceConflict('Analysis action batch id belongs to another Mission or evidence package.');
        }
        return mapActionBatch(existing);
      }
      const maximum = this.maximumActionRevision(context.storeId, mission.id);
      const record: AnalysisActionBatchRecord = {
        id: requestedId,
        storeId: context.storeId,
        missionId: mission.id,
        missionRevision: mission.revision,
        evidencePackageId: evidence.id,
        ruleRevision: evidence.ruleRevision,
        modelRevision: evidence.modelRevision,
        actionRevision: maximum + 1,
        createdAt: this.timestamp(),
        createdSessionGeneration: context.sessionGeneration,
      };
      this.db.prepare(`
        INSERT INTO analysis_action_batches (
          id, store_id, mission_id, mission_revision, evidence_package_id,
          rule_revision, model_revision, action_revision,
          created_at, created_session_generation
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run(
        record.id, record.storeId, record.missionId, record.missionRevision,
        record.evidencePackageId, record.ruleRevision, record.modelRevision,
        record.actionRevision, record.createdAt, record.createdSessionGeneration,
      );
      return this.requireActionBatch(context, record.id);
    });
    return operation.immediate();
  }

  getLatestActionBatch(
    contextInput: StoreContextEnvelope,
    missionIdInput: string,
  ): AnalysisActionBatchRecord | undefined {
    const context = this.assertContext(contextInput);
    const mission = this.requireMission(context, missionIdInput);
    const row = this.db.prepare(`
      SELECT * FROM analysis_action_batches
      WHERE store_id = ? AND mission_id = ?
      ORDER BY action_revision DESC, created_at DESC, id DESC
      LIMIT 1
    `).get(context.storeId, mission.id) as ActionBatchRow | undefined;
    return row ? mapActionBatch(row) : undefined;
  }

  listActionBatches(
    contextInput: StoreContextEnvelope,
    missionIdInput: string,
  ): AnalysisActionBatchRecord[] {
    const context = this.assertContext(contextInput);
    const mission = this.requireMission(context, missionIdInput);
    return (this.db.prepare(`
      SELECT * FROM analysis_action_batches
      WHERE store_id = ? AND mission_id = ?
      ORDER BY action_revision DESC, created_at DESC, id DESC
    `).all(context.storeId, mission.id) as ActionBatchRow[]).map(mapActionBatch);
  }

  registerVerifiedAdEntity(
    contextInput: StoreContextEnvelope,
    input: RegisterVerifiedAdEntityAuthorityInput,
  ): VerifiedAdEntityAuthorityRecord {
    const context = normalizeContextInput(contextInput);
    const operation = this.db.transaction(() => {
      this.assertContext(context);
      const evidence = this.requireEvidence(context, input.evidencePackageId);
      const sourceReportType = entityTypeOf(input.sourceReportType);
      const entityType = entityTypeOf(input.entityType);
      if (sourceReportType !== entityType) {
        throw invalid('Verified Ads entity type must match the authoritative source report.');
      }
      const sourceFileHash = sha256Of(input.sourceFileHash, 'sourceFileHash');
      const sourceRow = positiveInteger(input.sourceRow, 'sourceRow');
      const rows = this.db.prepare(`
        SELECT DISTINCT metrics.campaign_name AS campaignName,
               metrics.ad_group_name AS adGroupName,
               COALESCE(NULLIF(metrics.targeting, ''), NULLIF(metrics.search_term, '')) AS entityName
        FROM ad_daily_metrics AS metrics
        INNER JOIN report_import_file_snapshots AS snapshots
          ON snapshots.store_id = metrics.store_id
          AND snapshots.batch_id = metrics.batch_id
          AND snapshots.run_id = ?
          AND snapshots.report_type = metrics.report_type
          AND snapshots.file_path = metrics.source_file
        WHERE metrics.store_id = ? AND metrics.batch_id = ?
          AND metrics.report_type = ? AND metrics.source_row = ?
          AND snapshots.file_hash = ?
          AND metrics.store_authority_quarantined = 0
      `).all(
        evidence.importRunId, context.storeId, evidence.dataBatchId,
        sourceReportType, sourceRow, sourceFileHash,
      ) as Array<{ campaignName?: string; adGroupName?: string; entityName?: string }>;
      if (rows.length !== 1) {
        throw referenceConflict('Verified Ads identity must uniquely match one imported metric source row.');
      }
      const row = rows[0];
      if (normalized(row.campaignName) !== normalized(input.campaignName)
        || normalized(row.adGroupName) !== normalized(input.adGroupName)
        || normalized(row.entityName) !== normalized(input.entityName)) {
        throw referenceConflict('Verified Ads identity does not match its imported campaign, ad group, or entity.');
      }
      const adEntityId = idOf(input.adEntityId, 'adEntityId');
      const proofSha256 = sha256Of(input.proofSha256, 'proofSha256');
      const existing = this.db.prepare(`
        SELECT * FROM verified_ad_entity_authority
        WHERE store_id = ? AND ad_entity_id = ? AND evidence_package_id = ?
          AND source_file_hash = ? AND source_row = ? AND proof_sha256 = ?
        ORDER BY entity_revision DESC LIMIT 1
      `).get(
        context.storeId, adEntityId, evidence.id,
        sourceFileHash, sourceRow, proofSha256,
      ) as AuthorityRow | undefined;
      if (existing) return mapAuthority(existing);
      const latest = this.getLatestAuthorityRaw(context.storeId, adEntityId);
      const record: VerifiedAdEntityAuthorityRecord = {
        authorityId: idOf(input.authorityId, 'authorityId'),
        storeId: context.storeId,
        adEntityId,
        entityRevision: (latest?.entity_revision ?? 0) + 1,
        entityType,
        entityName: textOf(input.entityName, 'entityName', 500),
        campaignName: textOf(input.campaignName, 'campaignName', 500),
        adGroupName: textOf(input.adGroupName, 'adGroupName', 500),
        evidencePackageId: evidence.id,
        sourceReportType,
        sourceFileHash,
        sourceRow,
        identitySource: identitySourceOf(input.identitySource),
        proofSha256,
        verifiedBy: textOf(input.verifiedBy, 'verifiedBy', 160),
        verifiedAt: timestampOf(input.verifiedAt, 'verifiedAt'),
        createdAt: this.timestamp(),
      };
      validateVerifiedAdEntityAuthority(record);
      this.db.prepare(`
        INSERT INTO verified_ad_entity_authority (
          authority_id, store_id, ad_entity_id, entity_revision, entity_type,
          entity_name, campaign_name, ad_group_name, evidence_package_id,
          source_report_type, source_file_hash, source_row, identity_source,
          proof_sha256, verified_by, verified_at, created_at
        ) VALUES (
          @authorityId, @storeId, @adEntityId, @entityRevision, @entityType,
          @entityName, @campaignName, @adGroupName, @evidencePackageId,
          @sourceReportType, @sourceFileHash, @sourceRow, @identitySource,
          @proofSha256, @verifiedBy, @verifiedAt, @createdAt
        )
      `).run(record);
      return this.requireAuthority(context, record.authorityId);
    });
    return operation.immediate();
  }

  getVerifiedAdEntity(
    contextInput: StoreContextEnvelope,
    authorityIdInput: string,
  ): VerifiedAdEntityAuthorityRecord | undefined {
    const context = this.assertContext(contextInput);
    const row = this.db.prepare(`
      SELECT * FROM verified_ad_entity_authority WHERE store_id = ? AND authority_id = ?
    `).get(context.storeId, idOf(authorityIdInput, 'authorityId')) as AuthorityRow | undefined;
    return row ? mapAuthority(row) : undefined;
  }

  getLatestVerifiedAdEntityById(
    contextInput: StoreContextEnvelope,
    adEntityIdInput: string,
  ): VerifiedAdEntityAuthorityRecord | undefined {
    const context = this.assertContext(contextInput);
    const row = this.getLatestAuthorityRaw(context.storeId, idOf(adEntityIdInput, 'adEntityId'));
    return row ? mapAuthority(row) : undefined;
  }

  adEntityBelongsToStore(
    contextInput: StoreContextEnvelope,
    adEntityIdInput: string,
  ): boolean {
    try {
      return Boolean(this.getLatestVerifiedAdEntityById(contextInput, adEntityIdInput));
    } catch {
      return false;
    }
  }

  createProposalSnapshot(
    contextInput: StoreContextEnvelope,
    input: CreateAnalysisProposalSnapshotInput,
  ): AnalysisProposalSnapshotRecord {
    const context = normalizeContextInput(contextInput);
    const operation = this.db.transaction(() => {
      this.assertContext(context);
      const mission = this.requireMission(context, input.missionId);
      const evidence = this.requireEvidence(context, input.evidencePackageId);
      const actionBatch = this.requireActionBatch(context, input.actionBatchId);
      if (evidence.missionId !== mission.id || actionBatch.missionId !== mission.id
        || actionBatch.missionRevision !== mission.revision
        || actionBatch.evidencePackageId !== evidence.id
        || actionBatch.ruleRevision !== evidence.ruleRevision
        || actionBatch.modelRevision !== evidence.modelRevision) {
        throw referenceConflict('Proposal does not match its Mission, evidence package, and action batch.');
      }
      const recommendationId = positiveInteger(input.legacyRecommendationId, 'legacyRecommendationId');
      const existing = this.db.prepare(`
        SELECT * FROM analysis_proposal_snapshots
        WHERE store_id = ? AND action_batch_id = ? AND legacy_recommendation_id = ?
      `).get(context.storeId, actionBatch.id, recommendationId) as ProposalRow | undefined;
      if (existing) return mapProposal(existing);
      const recommendation = this.db.prepare(`
        SELECT * FROM action_recommendations WHERE store_id = ? AND id = ?
      `).get(context.storeId, recommendationId) as Record<string, unknown> | undefined;
      if (!recommendation) {
        throw referenceConflict('Proposal recommendation is missing store-scoped authority.');
      }
      if (String(recommendation.action_type) !== 'lower_bid') {
        throw new AnalysisAuthorityRepositoryError(
          'UNSUPPORTED_ACTION',
          'Stage 5 proposal snapshots currently authorize lower_bid only.',
        );
      }
      const recommendationEvidence = parseJson<Record<string, unknown>>(
        String(recommendation.evidence_json ?? '{}'),
      );
      if (String(recommendationEvidence.batchId ?? '') !== evidence.dataBatchId
        || String(recommendation.marketplace_code ?? '') !== 'US') {
        throw referenceConflict('Proposal recommendation does not match its US evidence batch.');
      }
      const currentBidCents = usdCents(recommendation.current_value, 'currentValue');
      const proposedBidCents = usdCents(recommendation.recommended_value, 'recommendedValue');
      if (proposedBidCents >= currentBidCents) {
        throw invalid('A lower-bid proposal must reduce the current USD bid.');
      }
      const entityType = recommendationEntityType(recommendationEvidence, recommendation);
      if (entityType !== 'keyword') {
        throw new AnalysisAuthorityRepositoryError(
          'UNSUPPORTED_ACTION',
          'Stage 5 proposal snapshots authorize keyword entities only.',
        );
      }
      const entityName = textOf(recommendation.entity_name, 'entityName', 500);
      const campaignName = textOf(recommendationEvidence.campaignName, 'campaignName', 500);
      const adGroupName = textOf(recommendationEvidence.adGroupName, 'adGroupName', 500);
      const authority = input.adEntityAuthorityId
        ? this.requireAuthority(context, input.adEntityAuthorityId)
        : undefined;
      if (authority && (
        authority.entityType !== entityType
        || normalized(authority.entityName) !== normalized(entityName)
        || normalized(authority.campaignName) !== normalized(campaignName)
        || normalized(authority.adGroupName) !== normalized(adGroupName)
      )) {
        throw referenceConflict('Proposal Ads authority does not match its recommendation identity.');
      }
      const writableTarget = objectValue(recommendationEvidence.writableTarget);
      if (authority && String(writableTarget?.entityId ?? '') !== authority.adEntityId) {
        throw referenceConflict('Proposal Ads authority does not match the recommendation writable target.');
      }
      const policyVersion = this.db.prepare(`
        SELECT id, revision, status, rules_json AS rulesJson
        FROM policy_versions WHERE store_id = ? AND id = ?
      `).get(context.storeId, mission.policy_version_id) as {
        id: string;
        revision: number;
        status: string;
        rulesJson: string;
      } | undefined;
      if (!policyVersion || !['enabled', 'retired'].includes(policyVersion.status)) {
        throw stateConflict('Proposal requires an immutable enabled or retired Mission policy version.');
      }
      const policyRules = parseJson<Record<string, unknown>>(policyVersion.rulesJson);
      const source = proposalSource(recommendationEvidence);
      const changePct = round(((proposedBidCents - currentBidCents) / currentBidCents) * 100, 4);
      const validUntil = timestampOf(input.validUntil, 'validUntil');
      if (Date.parse(validUntil) <= Date.parse(this.timestamp())) {
        throw invalid('Proposal validUntil must be in the future.');
      }
      const authorization = this.buildAuthorization({
        context,
        evidence,
        authority,
        policyVersionId: policyVersion.id,
        policyVersionRevision: policyVersion.revision,
        policyRules,
        source,
        changePct,
        recommendationEvidence,
      });
      const record: AnalysisProposalSnapshotRecord = {
        id: idOf(input.id, 'proposalId'),
        storeId: context.storeId,
        marketplace: 'US',
        currency: 'USD',
        missionId: mission.id,
        missionRevision: mission.revision,
        evidencePackageId: evidence.id,
        evidencePackageHash: evidence.packageHash,
        dataBatchId: evidence.dataBatchId,
        policyVersionId: policyVersion.id,
        policyRevision: policyVersion.revision,
        ruleRevision: evidence.ruleRevision,
        modelRevision: evidence.modelRevision,
        actionBatchId: actionBatch.id,
        actionRevision: actionBatch.actionRevision,
        legacyRecommendationId: recommendationId,
        actionType: 'set_keyword_bid',
        entityType,
        entityName,
        campaignName,
        adGroupName,
        adEntityAuthorityId: authority?.authorityId,
        adEntityId: authority?.adEntityId,
        adEntityRevision: authority?.entityRevision,
        currentBidCents,
        proposedBidCents,
        changePct,
        confidence: bounded(Number(recommendation.confidence ?? 0), 0, 1),
        source,
        explanation: textOf(recommendation.reason, 'recommendation.reason', 4000),
        authorization,
        validUntil,
        createdAt: this.timestamp(),
        createdSessionGeneration: context.sessionGeneration,
      };
      validateAnalysisProposalSnapshot(record);
      this.db.prepare(`
        INSERT INTO analysis_proposal_snapshots (
          id, store_id, marketplace, currency, mission_id, mission_revision, evidence_package_id,
          evidence_package_hash, data_batch_id, policy_version_id, policy_revision,
          rule_revision, model_revision, action_batch_id, action_revision,
          legacy_recommendation_id, action_type, entity_type, entity_name,
          campaign_name, ad_group_name, ad_entity_authority_id, ad_entity_id,
          ad_entity_revision, current_bid_cents, proposed_bid_cents, change_pct,
          confidence, source, explanation, authorization_json, valid_until,
          created_at, created_session_generation
        ) VALUES (
          @id, @storeId, 'US', 'USD', @missionId, @missionRevision, @evidencePackageId,
          @evidencePackageHash, @dataBatchId, @policyVersionId, @policyRevision,
          @ruleRevision, @modelRevision, @actionBatchId, @actionRevision,
          @legacyRecommendationId, @actionType, @entityType, @entityName,
          @campaignName, @adGroupName, @adEntityAuthorityId, @adEntityId,
          @adEntityRevision, @currentBidCents, @proposedBidCents, @changePct,
          @confidence, @source, @explanation, @authorizationJson, @validUntil,
          @createdAt, @createdSessionGeneration
        )
      `).run({
        ...record,
        adEntityAuthorityId: record.adEntityAuthorityId ?? null,
        adEntityId: record.adEntityId ?? null,
        adEntityRevision: record.adEntityRevision ?? null,
        authorizationJson: JSON.stringify(record.authorization),
      });
      return this.requireProposal(context, record.id);
    });
    return operation.immediate();
  }

  getProposalSnapshot(
    contextInput: StoreContextEnvelope,
    proposalIdInput: string,
  ): AnalysisProposalSnapshotRecord | undefined {
    const context = this.assertContext(contextInput);
    const row = this.db.prepare(`
      SELECT * FROM analysis_proposal_snapshots WHERE store_id = ? AND id = ?
    `).get(context.storeId, idOf(proposalIdInput, 'proposalId')) as ProposalRow | undefined;
    return row ? mapProposal(row) : undefined;
  }

  listProposalSnapshots(
    contextInput: StoreContextEnvelope,
    missionIdInput: string,
  ): AnalysisProposalSnapshotRecord[] {
    const context = this.assertContext(contextInput);
    const mission = this.requireMission(context, missionIdInput);
    return (this.db.prepare(`
      SELECT * FROM analysis_proposal_snapshots
      WHERE store_id = ? AND mission_id = ?
      ORDER BY action_revision DESC, created_at DESC, id
    `).all(context.storeId, mission.id) as ProposalRow[]).map(mapProposal);
  }

  linkProposalDecision(
    contextInput: StoreContextEnvelope,
    input: { id: string; proposalId: string; decisionId: string },
  ): AnalysisProposalDecisionLinkRecord {
    const context = normalizeContextInput(contextInput);
    const operation = this.db.transaction(() => {
      this.assertContext(context);
      const proposal = this.requireProposal(context, input.proposalId);
      const decision = this.db.prepare(`
        SELECT id, mission_id AS missionId, data_batch_id AS dataBatchId,
               policy_version_id AS policyVersionId, policy_revision AS policyRevision,
               action_revision AS actionRevision, action_type AS actionType,
               ad_entity_id AS adEntityId, current_value_json AS currentValueJson,
               recommended_value_json AS recommendedValueJson
        FROM decisions WHERE store_id = ? AND id = ?
      `).get(context.storeId, idOf(input.decisionId, 'decisionId')) as Record<string, unknown> | undefined;
      if (!decision
        || decision.missionId !== proposal.missionId
        || decision.dataBatchId !== proposal.dataBatchId
        || decision.policyVersionId !== proposal.policyVersionId
        || Number(decision.policyRevision) !== proposal.policyRevision
        || Number(decision.actionRevision) !== proposal.actionRevision
        || decision.actionType !== proposal.actionType
        || String(decision.adEntityId ?? '') !== String(proposal.adEntityId ?? '')
        || Number(parseJson(decision.currentValueJson as string)) !== proposal.currentBidCents / 100
        || Number(parseJson(decision.recommendedValueJson as string)) !== proposal.proposedBidCents / 100) {
        throw referenceConflict('Decision does not exactly match its immutable proposal snapshot.');
      }
      const existing = this.db.prepare(`
        SELECT * FROM analysis_proposal_decision_links
        WHERE store_id = ? AND proposal_id = ?
      `).get(context.storeId, proposal.id) as Record<string, unknown> | undefined;
      if (existing) return mapDecisionLink(existing);
      const record: AnalysisProposalDecisionLinkRecord = {
        id: idOf(input.id, 'proposalDecisionLinkId'),
        storeId: context.storeId,
        proposalId: proposal.id,
        decisionId: String(decision.id),
        createdAt: this.timestamp(),
      };
      this.db.prepare(`
        INSERT INTO analysis_proposal_decision_links (
          id, store_id, proposal_id, decision_id, created_at
        ) VALUES (?, ?, ?, ?, ?)
      `).run(record.id, record.storeId, record.proposalId, record.decisionId, record.createdAt);
      return record;
    });
    return operation.immediate();
  }

  listProposalDecisionLinks(
    contextInput: StoreContextEnvelope,
    missionIdInput: string,
  ): AnalysisProposalDecisionLinkRecord[] {
    const context = this.assertContext(contextInput);
    const mission = this.requireMission(context, missionIdInput);
    return (this.db.prepare(`
      SELECT links.*
      FROM analysis_proposal_decision_links AS links
      INNER JOIN analysis_proposal_snapshots AS proposals
        ON proposals.store_id = links.store_id AND proposals.id = links.proposal_id
      WHERE links.store_id = ? AND proposals.mission_id = ?
      ORDER BY links.created_at, links.id
    `).all(context.storeId, mission.id) as Array<Record<string, unknown>>).map(mapDecisionLink);
  }

  private buildAuthorization(input: {
    context: StoreContextEnvelope;
    evidence: AnalysisEvidencePackageRecord;
    authority?: VerifiedAdEntityAuthorityRecord;
    policyVersionId: string;
    policyVersionRevision: number;
    policyRules: Record<string, unknown>;
    source: AnalysisProposalSource;
    changePct: number;
    recommendationEvidence: Record<string, unknown>;
  }): AnalysisProposalSnapshotRecord['authorization'] {
    const common: AnalysisProposalBlockerCode[] = [];
    const { authority, policyRules, recommendationEvidence, source } = input;
    if (!authority) {
      common.push('MISSING_STABLE_AD_ENTITY');
    } else {
      const latest = this.getLatestAuthorityRaw(input.context.storeId, authority.adEntityId);
      if (!latest || latest.entity_revision !== authority.entityRevision) {
        common.push('STALE_AD_ENTITY_REVISION');
      }
    }
    if (Date.parse(input.evidence.freshUntil) <= this.now().getTime()) common.push('EVIDENCE_STALE');
    if (String(recommendationEvidence.batchId ?? '') !== input.evidence.dataBatchId) {
      common.push('EVIDENCE_BATCH_MISMATCH');
    }
    if (source === 'rule_fallback') common.push('RULE_FALLBACK_NOT_AUTHORIZABLE');
    if (recommendationEvidence.decisionAgreement === 'conflict') common.push('AI_RULE_CONFLICT');
    if ((recommendationEvidence.quantReviewRequired === true
      || recommendationEvidence.decisionRequiresReview === true)
      && !objectValue(recommendationEvidence.reviewResolution)) {
      common.push('REVIEW_REQUIRED');
    }
    const allowedActions = stringArray(policyRules.allowedActionTypes);
    const allowedEntities = stringArray(policyRules.allowedAdEntityIds);
    if (!allowedActions.includes('set_keyword_bid')) common.push('POLICY_ACTION_NOT_ALLOWED');
    if (authority && !allowedEntities.includes(authority.adEntityId)) common.push('POLICY_ENTITY_NOT_ALLOWED');
    const maxChangePct = Number(policyRules.maxChangePct ?? 0);
    if (!Number.isFinite(maxChangePct) || Math.abs(input.changePct) > maxChangePct + 1e-8) {
      common.push('CHANGE_LIMIT_EXCEEDED');
    }
    const human = eligibility(common);
    const policyBlockers = [...common];
    if (source === 'ai') policyBlockers.push('AI_ONLY_NOT_POLICY_AUTHORIZABLE');
    if (source === 'rule') policyBlockers.push('POLICY_REQUIRES_RULE_AI_ALIGNMENT');
    const runtime = this.db.prepare(`
      SELECT autonomy_mode AS autonomyMode, kill_switch AS killSwitch,
             circuit_breaker_state AS circuitBreakerState,
             active_policy_version_id AS activePolicyVersionId
      FROM policy_runtime WHERE store_id = ?
    `).get(input.context.storeId) as {
      autonomyMode?: string;
      killSwitch?: number;
      circuitBreakerState?: string;
      activePolicyVersionId?: string | null;
    } | undefined;
    if (!runtime
      || runtime.autonomyMode !== 'policy_auto'
      || Number(runtime.killSwitch) !== 0
      || runtime.circuitBreakerState !== 'closed'
      || runtime.activePolicyVersionId !== input.policyVersionId) {
      policyBlockers.push('POLICY_RUNTIME_BLOCKED');
    }
    return { human, policy: eligibility(policyBlockers) };
  }

  private maximumActionRevision(storeId: string, missionId: string): number {
    const row = this.db.prepare(`
      SELECT MAX(value) AS maximum FROM (
        SELECT COALESCE(MAX(action_revision), 0) AS value
        FROM decisions WHERE store_id = ? AND mission_id = ?
        UNION ALL
        SELECT COALESCE(MAX(action_revision), 0) AS value
        FROM mission_grants WHERE store_id = ? AND mission_id = ?
        UNION ALL
        SELECT COALESCE(MAX(action_revision), 0) AS value
        FROM analysis_action_batches WHERE store_id = ? AND mission_id = ?
      )
    `).get(storeId, missionId, storeId, missionId, storeId, missionId) as { maximum?: number };
    return nonNegative(row.maximum ?? 0);
  }

  private getLatestAuthorityRaw(storeId: string, adEntityId: string): AuthorityRow | undefined {
    return this.db.prepare(`
      SELECT * FROM verified_ad_entity_authority
      WHERE store_id = ? AND ad_entity_id = ?
      ORDER BY entity_revision DESC, created_at DESC, authority_id DESC
      LIMIT 1
    `).get(storeId, adEntityId) as AuthorityRow | undefined;
  }

  private assertContext(contextInput: StoreContextEnvelope): StoreContextEnvelope {
    const context = normalizeContextInput(contextInput);
    const store = this.db.prepare(`
      SELECT store_id AS storeId, browser_profile_id AS browserProfileId,
             marketplace, currency, business_timezone AS businessTimezone, status
      FROM stores WHERE store_id = ?
    `).get(context.storeId) as Record<string, unknown> | undefined;
    if (!store
      || store.browserProfileId !== context.browserProfileId
      || store.marketplace !== context.marketplace
      || store.currency !== context.currency
      || store.businessTimezone !== context.businessTimezone) {
      throw new AnalysisAuthorityRepositoryError(
        'INVALID_CONTEXT',
        'StoreContextEnvelope does not match SQLite analysis authority.',
      );
    }
    if (store.status !== 'active') {
      throw new AnalysisAuthorityRepositoryError(
        'STORE_NOT_ACTIVE',
        `Store ${context.storeId} is ${String(store.status)}; analysis authority is blocked.`,
      );
    }
    const setting = this.db.prepare(`
      SELECT value FROM app_settings WHERE key = ?
    `).get(`store_session_generation:${context.storeId}`) as { value: string | null } | undefined;
    const durable = setting?.value === undefined || setting.value === null
      ? Number((this.db.prepare(`
          SELECT COALESCE(MAX(session_generation), 0) AS generation
          FROM store_session_metadata WHERE store_id = ?
        `).get(context.storeId) as { generation: number }).generation)
      : Number(setting.value);
    if (!Number.isSafeInteger(durable) || durable < 0 || durable !== context.sessionGeneration) {
      throw new AnalysisAuthorityRepositoryError(
        'STALE_CONTEXT',
        `Store session generation is stale; expected ${durable}, received ${context.sessionGeneration}.`,
      );
    }
    return context;
  }

  private requireMission(context: StoreContextEnvelope, idInput: string): MissionRow {
    const id = idOf(idInput, 'missionId');
    const row = this.db.prepare(`
      SELECT id, store_id, data_batch_id, policy_version_id, status, revision
      FROM missions WHERE store_id = ? AND id = ?
    `).get(context.storeId, id) as MissionRow | undefined;
    if (!row) throw notFound(`Mission ${id} was not found in store ${context.storeId}.`);
    if (row.status === 'archived') throw stateConflict('Archived Mission cannot produce analysis authority.');
    return row;
  }

  private requireEvidence(context: StoreContextEnvelope, idInput: string): AnalysisEvidencePackageRecord {
    const id = idOf(idInput, 'evidencePackageId');
    const row = this.db.prepare(`
      SELECT * FROM analysis_evidence_packages WHERE store_id = ? AND id = ?
    `).get(context.storeId, id) as EvidenceRow | undefined;
    if (!row) throw notFound(`Analysis evidence package ${id} was not found.`);
    return mapEvidence(row);
  }

  private requireActionBatch(context: StoreContextEnvelope, idInput: string): AnalysisActionBatchRecord {
    const id = idOf(idInput, 'analysisActionBatchId');
    const row = this.db.prepare(`
      SELECT * FROM analysis_action_batches WHERE store_id = ? AND id = ?
    `).get(context.storeId, id) as ActionBatchRow | undefined;
    if (!row) throw notFound(`Analysis action batch ${id} was not found.`);
    return mapActionBatch(row);
  }

  private requireAuthority(context: StoreContextEnvelope, idInput: string): VerifiedAdEntityAuthorityRecord {
    const id = idOf(idInput, 'authorityId');
    const row = this.db.prepare(`
      SELECT * FROM verified_ad_entity_authority WHERE store_id = ? AND authority_id = ?
    `).get(context.storeId, id) as AuthorityRow | undefined;
    if (!row) throw notFound(`Verified Ads entity authority ${id} was not found.`);
    return mapAuthority(row);
  }

  private requireProposal(context: StoreContextEnvelope, idInput: string): AnalysisProposalSnapshotRecord {
    const id = idOf(idInput, 'proposalId');
    const row = this.db.prepare(`
      SELECT * FROM analysis_proposal_snapshots WHERE store_id = ? AND id = ?
    `).get(context.storeId, id) as ProposalRow | undefined;
    if (!row) throw notFound(`Analysis proposal ${id} was not found.`);
    return mapProposal(row);
  }

  private timestamp(): string {
    return this.now().toISOString();
  }
}

function mapEvidence(row: EvidenceRow): AnalysisEvidencePackageRecord {
  const record: AnalysisEvidencePackageRecord = {
    id: row.id,
    storeId: row.store_id as AnalysisEvidencePackageRecord['storeId'],
    marketplace: row.marketplace,
    currency: row.currency,
    missionId: row.mission_id,
    dataBatchId: row.data_batch_id,
    importRunId: row.import_run_id,
    dateFrom: row.date_from,
    dateTo: row.date_to,
    asin: row.asin ?? undefined,
    reportTypes: parseJson(row.report_types_json),
    sources: parseJson(row.sources_json),
    metricRowCount: row.metric_row_count,
    reconciliationHash: row.reconciliation_hash,
    ruleRevision: row.rule_revision,
    modelRevision: row.model_revision,
    packageHash: row.package_hash,
    importedAt: row.imported_at,
    freshUntil: row.fresh_until,
    sealedAt: row.sealed_at,
    createdSessionGeneration: row.created_session_generation,
  };
  validateAnalysisEvidencePackage(record);
  return record;
}

function mapActionBatch(row: ActionBatchRow): AnalysisActionBatchRecord {
  return {
    id: row.id,
    storeId: row.store_id as AnalysisActionBatchRecord['storeId'],
    missionId: row.mission_id,
    missionRevision: row.mission_revision,
    evidencePackageId: row.evidence_package_id,
    ruleRevision: row.rule_revision,
    modelRevision: row.model_revision,
    actionRevision: row.action_revision,
    createdAt: row.created_at,
    createdSessionGeneration: row.created_session_generation,
  };
}

function mapAuthority(row: AuthorityRow): VerifiedAdEntityAuthorityRecord {
  const record: VerifiedAdEntityAuthorityRecord = {
    authorityId: row.authority_id,
    storeId: row.store_id as VerifiedAdEntityAuthorityRecord['storeId'],
    adEntityId: row.ad_entity_id,
    entityRevision: row.entity_revision,
    entityType: row.entity_type,
    entityName: row.entity_name,
    campaignName: row.campaign_name,
    adGroupName: row.ad_group_name,
    evidencePackageId: row.evidence_package_id,
    sourceReportType: row.source_report_type,
    sourceFileHash: row.source_file_hash,
    sourceRow: row.source_row,
    identitySource: row.identity_source,
    proofSha256: row.proof_sha256,
    verifiedBy: row.verified_by,
    verifiedAt: row.verified_at,
    createdAt: row.created_at,
  };
  validateVerifiedAdEntityAuthority(record);
  return record;
}

function mapProposal(row: ProposalRow): AnalysisProposalSnapshotRecord {
  const record: AnalysisProposalSnapshotRecord = {
    id: row.id,
    storeId: row.store_id as AnalysisProposalSnapshotRecord['storeId'],
    marketplace: row.marketplace,
    currency: row.currency,
    missionId: row.mission_id,
    missionRevision: row.mission_revision,
    evidencePackageId: row.evidence_package_id,
    evidencePackageHash: row.evidence_package_hash,
    dataBatchId: row.data_batch_id,
    policyVersionId: row.policy_version_id,
    policyRevision: row.policy_revision,
    ruleRevision: row.rule_revision,
    modelRevision: row.model_revision,
    actionBatchId: row.action_batch_id,
    actionRevision: row.action_revision,
    legacyRecommendationId: row.legacy_recommendation_id,
    actionType: row.action_type,
    entityType: row.entity_type,
    entityName: row.entity_name,
    campaignName: row.campaign_name,
    adGroupName: row.ad_group_name,
    adEntityAuthorityId: row.ad_entity_authority_id ?? undefined,
    adEntityId: row.ad_entity_id ?? undefined,
    adEntityRevision: row.ad_entity_revision ?? undefined,
    currentBidCents: row.current_bid_cents,
    proposedBidCents: row.proposed_bid_cents,
    changePct: row.change_pct,
    confidence: row.confidence,
    source: row.source,
    explanation: row.explanation,
    authorization: parseJson(row.authorization_json),
    validUntil: row.valid_until,
    createdAt: row.created_at,
    createdSessionGeneration: row.created_session_generation,
  };
  validateAnalysisProposalSnapshot(record);
  return record;
}

function mapDecisionLink(row: Record<string, unknown>): AnalysisProposalDecisionLinkRecord {
  return {
    id: String(row.id),
    storeId: String(row.store_id) as AnalysisProposalDecisionLinkRecord['storeId'],
    proposalId: String(row.proposal_id),
    decisionId: String(row.decision_id),
    createdAt: String(row.created_at),
  };
}

function eligibility(blockers: readonly AnalysisProposalBlockerCode[]): AnalysisAuthorizationEligibility {
  const unique = [...new Set(blockers)];
  return { eligible: unique.length === 0, blockers: unique };
}

function proposalSource(evidence: Record<string, unknown>): AnalysisProposalSource {
  if (evidence.aiFallbackReason || evidence.aiStrategyFallbackReason || evidence.aiActionFallbackReason) {
    return 'rule_fallback';
  }
  const decisionSource = String(evidence.decisionSource ?? '');
  if (decisionSource === 'rule_ai') return 'rule_ai';
  if (decisionSource === 'ai') return 'ai';
  if (evidence.aiStrategySource === 'ai' && evidence.explanationSource === 'ai') return 'rule_ai';
  return 'rule';
}

function recommendationEntityType(
  evidence: Record<string, unknown>,
  recommendation: Record<string, unknown>,
): VerifiedAdEntityType {
  const writable = objectValue(evidence.writableTarget);
  const candidate = String(writable?.entityType ?? evidence.reportType ?? '').trim();
  if (candidate === 'keyword' || candidate === 'auto_targeting' || candidate === 'product_targeting') {
    return candidate;
  }
  const entityType = String(recommendation.entity_type ?? '');
  if (entityType === 'target' && evidence.searchTerm) return 'keyword';
  throw new AnalysisAuthorityRepositoryError(
    'UNSUPPORTED_ACTION',
    `Recommendation entity type ${candidate || entityType || 'unknown'} is not a stable V1 writable target.`,
  );
}

function objectValue(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : undefined;
}

function stringArray(value: unknown): string[] {
  return Array.isArray(value) ? value.map((item) => String(item)).filter(Boolean) : [];
}

function normalizeContextInput(input: StoreContextEnvelope): StoreContextEnvelope {
  try {
    return normalizeStoreContextEnvelope(input);
  } catch (error) {
    throw new AnalysisAuthorityRepositoryError(
      'INVALID_CONTEXT',
      error instanceof Error ? error.message : 'StoreContextEnvelope is invalid.',
    );
  }
}

function groupBy<T>(values: readonly T[], keyOf: (value: T) => string): Map<string, T[]> {
  const groups = new Map<string, T[]>();
  for (const value of values) {
    const key = keyOf(value);
    const group = groups.get(key) ?? [];
    group.push(value);
    groups.set(key, group);
  }
  return groups;
}

function aggregateHashes(values: readonly string[]): string {
  const hashes = [...new Set(values.map((value) => sha256Of(value, 'fileHash').toLowerCase()))].sort();
  if (hashes.length === 1) return hashes[0];
  return hashObject(hashes);
}

function hashObject(value: unknown): string {
  return createHash('sha256').update(stableJson(value)).digest('hex');
}

function stableJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableJson).join(',')}]`;
  if (value && typeof value === 'object') {
    const record = value as Record<string, unknown>;
    return `{${Object.keys(record).sort().map((key) => `${JSON.stringify(key)}:${stableJson(record[key])}`).join(',')}}`;
  }
  return JSON.stringify(value) ?? 'null';
}

function parseJson<T = unknown>(value: string, fallback?: T): T {
  try {
    return JSON.parse(value) as T;
  } catch {
    if (fallback !== undefined) return fallback;
    throw invalid('Durable analysis JSON could not be parsed.');
  }
}

function sqlLiteral(value: string): string {
  return value.replace(/'/g, "''");
}

function idOf(value: unknown, field: string): string {
  return textOf(value, field, 180);
}

function textOf(value: unknown, field: string, maxLength: number): string {
  const normalizedValue = String(value ?? '').trim();
  if (!normalizedValue || normalizedValue.length > maxLength) {
    throw invalid(`${field} must contain 1..${maxLength} characters.`);
  }
  return normalizedValue;
}

function optionalText(value: unknown): string | undefined {
  const normalizedValue = String(value ?? '').trim();
  return normalizedValue || undefined;
}

function normalized(value: unknown): string {
  return String(value ?? '').trim().toLowerCase();
}

function dateOf(value: unknown, field: string): string {
  const normalizedValue = textOf(value, field, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(normalizedValue)
    || Number.isNaN(Date.parse(`${normalizedValue}T00:00:00.000Z`))) {
    throw invalid(`${field} must be YYYY-MM-DD.`);
  }
  return normalizedValue;
}

function timestampOf(value: unknown, field: string): string {
  const parsed = Date.parse(String(value ?? ''));
  if (!Number.isFinite(parsed)) throw invalid(`${field} must be an ISO timestamp.`);
  return new Date(parsed).toISOString();
}

function sha256Of(value: unknown, field: string): string {
  const normalizedValue = String(value ?? '').trim().toLowerCase();
  if (!/^[a-f0-9]{64}$/.test(normalizedValue)) throw invalid(`${field} must be a SHA-256 digest.`);
  return normalizedValue;
}

function entityTypeOf(value: unknown): VerifiedAdEntityType {
  const normalizedValue = String(value ?? '').trim();
  if (!['keyword', 'auto_targeting', 'product_targeting'].includes(normalizedValue)) {
    throw invalid('Unsupported verified Ads entity type.');
  }
  return normalizedValue as VerifiedAdEntityType;
}

function identitySourceOf(value: unknown): 'ads_ui' | 'ads_api' {
  const normalizedValue = String(value ?? '').trim();
  if (!['ads_ui', 'ads_api'].includes(normalizedValue)) throw invalid('Unsupported Ads identity source.');
  return normalizedValue as 'ads_ui' | 'ads_api';
}

function finite(value: unknown, field: string): number {
  const normalizedValue = Number(value);
  if (!Number.isFinite(normalizedValue)) throw invalid(`${field} must be finite.`);
  return normalizedValue;
}

function positiveInteger(value: unknown, field: string): number {
  const normalizedValue = finite(value, field);
  if (!Number.isSafeInteger(normalizedValue) || normalizedValue <= 0) {
    throw invalid(`${field} must be a positive integer.`);
  }
  return normalizedValue;
}

function nonNegative(value: unknown): number {
  const normalizedValue = Number(value);
  if (!Number.isSafeInteger(normalizedValue) || normalizedValue < 0) {
    throw invalid('Expected a non-negative integer from durable authority.');
  }
  return normalizedValue;
}

function positiveOrUndefined(value: unknown): number | undefined {
  if (value === undefined || value === null) return undefined;
  return positiveInteger(value, 'sourceRow');
}

function usdCents(value: unknown, field: string): number {
  const amount = finite(value, field);
  const cents = Math.round(amount * 100);
  if (cents <= 0 || Math.abs(cents / 100 - amount) > 0.000001) {
    throw invalid(`${field} must be a positive USD value with no more than two decimals.`);
  }
  return cents;
}

function bounded(value: number, minimum: number, maximum: number): number {
  return Math.min(maximum, Math.max(minimum, Number.isFinite(value) ? value : minimum));
}

function round(value: number, decimals: number): number {
  const factor = 10 ** decimals;
  return Math.round(value * factor) / factor;
}

function invalid(message: string): AnalysisAuthorityRepositoryError {
  return new AnalysisAuthorityRepositoryError('INVALID_INPUT', message);
}

function notFound(message: string): AnalysisAuthorityRepositoryError {
  return new AnalysisAuthorityRepositoryError('NOT_FOUND', message);
}

function referenceConflict(message: string): AnalysisAuthorityRepositoryError {
  return new AnalysisAuthorityRepositoryError('REFERENCE_CONFLICT', message);
}

function stateConflict(message: string): AnalysisAuthorityRepositoryError {
  return new AnalysisAuthorityRepositoryError('STATE_CONFLICT', message);
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
