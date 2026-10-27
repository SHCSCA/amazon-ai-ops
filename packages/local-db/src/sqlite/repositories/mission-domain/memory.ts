import Database from 'better-sqlite3';
import { createHash } from 'node:crypto';
import {
  CAUSAL_LEDGER_STAGES,
  createMissionWriteAuthoritySnapshot,
  missionWriteAuthorityMatches,
  type MissionWriteAuthoritySnapshot,
  normalizeDomainIdentifier,
  normalizeOpaqueEvidenceRef,
  normalizeDomainRevision,
  normalizeDomainStringList,
  normalizeDomainText,
  normalizeDomainTimestamp,
  normalizeStoreContextEnvelope,
  validateMissionGrant,
  type AppendCausalEventInput,
  type AppendMissionCheckpointInput,
  type CausalEvidenceRefRecord,
  type CausalEventRecord,
  type CausalLedgerStage,
  type CausalLinkRecord,
  type CreateDecisionInput,
  type CreateExperimentInput,
  type CreateMissionGrantInput,
  type CreateMissionInput,
  type CreatePolicyInput,
  type CreatePolicyVersionInput,
  type DecisionHistoryEventType,
  type DecisionHistoryRecord,
  type DecisionRecord,
  type DecisionStatus,
  type ExperimentMetricSnapshotRecord,
  type ExperimentObservationRecord,
  type ExperimentObservationType,
  type ExperimentRecord,
  type ExperimentStatus,
  type MissionGrantEventRecord,
  type MissionGrantEventType,
  type MissionGrantTerminalEventType,
  type MissionGrantRecord,
  type MissionLifecycleStatus,
  type MissionLinkRecord,
  type MissionLinkType,
  type MissionPhase,
  type MissionPriority,
  type MissionRecord,
  type MissionCheckpointRecord,
  type PolicyRecord,
  type PolicyRuntimeRecord,
  type PolicyStatus,
  type PolicyVersionRecord,
  type PolicyVersionRules,
  type ReviseDecisionInput,
  type StoreContextEnvelope,
  type UpdateExperimentInput,
  type UpdateMissionInput,
  type UpdatePolicyRuntimeInput,
  type UsCurrency,
  type UsMarketplace,
} from '@amazon-ai-ops/shared-types';
import {
  AnalysisCausalMemoryProof,
  AnalysisCausalMemoryItem,
  AppendCausalLinkInput,
  AppendEvidenceRefInput,
  AppendCausalEventWithEvidenceResult,
  CausalRow,
} from './contracts';
import {
  idOf,
  optionalId,
  textOf,
  confidenceOf,
  optionalText,
  optionalSha256,
  invalid,
  referenceConflict,
} from './values';
import {
  mapCausalEvent,
  mapCausalLink,
  mapEvidenceRef,
} from './rows';
import type { MissionDomainRepositoryContext } from './context';
import { createCausalTimelineExport, type CausalTimelineExport } from '@amazon-ai-ops/shared-types';

export function exportCausalTimeline(
  this: MissionDomainRepositoryContext,
  contextInput: StoreContextEnvelope,
  input: { missionId?: string; stages?: readonly CausalLedgerStage[] } = {},
): CausalTimelineExport {
  const context = this.assertContext(contextInput);
  const readSnapshot = this.db.transaction(() => {
    const records = this.listCausalEvents(context, input);
    // 事件与独立证据表在同一个只读快照内读取，不能用界面缓存补齐证据。
    const missionId = input.missionId ? idOf(input.missionId, 'missionId') : null;
    const stages = input.stages?.length ? input.stages : CAUSAL_LEDGER_STAGES;
    const proofs = (this.db.prepare(`
      SELECT proof.* FROM evidence_refs proof
      JOIN causal_events event ON event.store_id=proof.store_id AND event.id=proof.event_id
      WHERE proof.store_id = ? AND (? IS NULL OR event.mission_id = ?)
        AND event.stage IN (${stages.map(() => '?').join(', ')})
      ORDER BY proof.event_id, proof.id
    `).all(context.storeId, missionId, missionId, ...stages) as Record<string, unknown>[]).map(mapEvidenceRef);
    return createCausalTimelineExport(context, records, proofs);
  });
  return readSnapshot.deferred();
}

export function appendCausalEvent(this: MissionDomainRepositoryContext, contextInput: StoreContextEnvelope, input: AppendCausalEventInput): CausalEventRecord{
    const context = this.assertContext(contextInput);
    if (input.missionId) this.requireMission(context, input.missionId);
    const append = this.db.transaction(() => {
      const createdAt = this.timestamp();
      try {
        this.appendCausalInternal(context, input, createdAt);
      } catch (error) {
        this.rethrowConstraint(error, `Causal event ${input.id} already exists or has invalid lineage.`);
      }
      return this.requireCausalEvent(context, input.id);
    });
    return append.immediate();
  }

export function appendCausalEventWithEvidence(this: MissionDomainRepositoryContext, 
    contextInput: StoreContextEnvelope,
    input: AppendCausalEventInput,
    evidenceInputs: readonly AppendEvidenceRefInput[],
  ): AppendCausalEventWithEvidenceResult{
    const context = this.assertContext(contextInput);
    if (input.missionId) this.requireMission(context, input.missionId);
    if (evidenceInputs.length === 0) {
      throw invalid('A causal event evidence set cannot be empty.');
    }
    if (evidenceInputs.some((evidence) => evidence.eventId !== input.id)) {
      throw invalid('Every evidence reference must target the causal event appended in the same transaction.');
    }
    const append = this.db.transaction(() => {
      const createdAt = this.timestamp();
      try {
        this.appendCausalInternal(context, input, createdAt);
      } catch (error) {
        this.rethrowConstraint(error, `Causal event ${input.id} already exists or has invalid lineage.`);
      }
      const event = this.requireCausalEvent(context, input.id);
      const evidence = evidenceInputs.map((evidenceInput) => (
        this.appendEvidenceRefInternal(context, evidenceInput, createdAt)
      ));
      return { event, evidence };
    });
    return append.immediate();
  }

export function listCausalEvents(this: MissionDomainRepositoryContext, 
    contextInput: StoreContextEnvelope,
    input: { missionId?: string; stages?: readonly CausalLedgerStage[] } = {},
  ): CausalEventRecord[]{
    const context = this.assertContext(contextInput);
    const missionId = input.missionId ? idOf(input.missionId, 'missionId') : null;
    const stages = input.stages?.length ? input.stages : CAUSAL_LEDGER_STAGES;
    if (stages.some((stage) => !CAUSAL_LEDGER_STAGES.includes(stage))) throw invalid('Unknown causal stage.');
    const placeholders = stages.map(() => '?').join(', ');
    return (this.db.prepare(`
      SELECT * FROM causal_events
      WHERE store_id = ? AND (? IS NULL OR mission_id = ?)
        AND stage IN (${placeholders})
      ORDER BY sequence DESC, id
    `).all(context.storeId, missionId, missionId, ...stages) as CausalRow[]).map(mapCausalEvent);
  }

export function listAnalysisCausalMemory(this: MissionDomainRepositoryContext, 
    contextInput: StoreContextEnvelope,
    input: { productId: string; limit?: number },
  ): AnalysisCausalMemoryItem[]{
    const context = this.assertContext(contextInput);
    const productId = String(input.productId ?? '').trim();
    if (!productId) return [];
    const limit = input.limit ?? 40;
    if (!Number.isSafeInteger(limit) || limit < 1 || limit > 100) {
      throw invalid('Analysis causal-memory limit must be an integer from 1 to 100.');
    }
    const rows = this.db.prepare(`
      SELECT event.id AS eventId,
             event.mission_id AS missionId,
             event.stage AS stage,
             event.event_type AS eventType,
             event.entity_type AS entityType,
             event.entity_id AS entityId,
             event.session_generation AS sessionGeneration,
             event.title AS title,
             event.observed_effect AS observedEffect,
             event.status AS status,
             event.source AS source,
             event.business_date AS businessDate
      FROM causal_events event
      JOIN missions mission
        ON mission.store_id = event.store_id
       AND mission.id = event.mission_id
      WHERE event.store_id = ?
        AND upper(trim(mission.product_id)) = upper(trim(?))
        AND event.stage IN ('READBACK', 'EFFECT')
        AND event.observed_effect IS NOT NULL
        AND trim(event.observed_effect) <> ''
        AND lower(trim(event.status)) NOT IN ('unknown', 'still_unknown')
        AND lower(trim(event.event_type)) NOT LIKE '%unknown%'
        AND NOT EXISTS (
          SELECT 1 FROM legacy_record_classifications legacy
          WHERE legacy.store_id=event.store_id AND legacy.source_table='causal_events'
            AND legacy.record_id=event.id AND legacy.classification<>'validated-compatible'
        )
        AND NOT EXISTS (
          SELECT 1
          FROM causal_events correction
          WHERE correction.store_id = event.store_id
            AND correction.corrects_event_id = event.id
        )
        AND EXISTS (
          SELECT 1
          FROM evidence_refs proof
          WHERE proof.store_id = event.store_id
            AND proof.event_id = event.id
            AND proof.sha256 IS NOT NULL
            AND length(proof.sha256) = 64
            AND lower(proof.sha256) NOT GLOB '*[^0-9a-f]*'
            AND NOT EXISTS (
              SELECT 1 FROM legacy_record_classifications legacy
              WHERE legacy.store_id=proof.store_id AND legacy.source_table='evidence_refs'
                AND legacy.record_id=proof.id AND legacy.classification<>'validated-compatible'
            )
        )
      ORDER BY event.business_date DESC, event.sequence DESC, event.id DESC
      LIMIT ?
    `).all(context.storeId, productId, limit) as Array<{
      eventId: string;
      missionId: string;
      stage: 'READBACK' | 'EFFECT';
      eventType: string;
      entityType: string;
      entityId: string;
      sessionGeneration: number;
      title: string;
      observedEffect: string;
      status: string;
      source: string;
      businessDate: string;
    }>;
    return rows.map((row) => {
      const proofs = (this.db.prepare(`
        SELECT evidence_type AS evidenceType,
               evidence_ref AS evidenceRef,
               lower(sha256) AS sha256
        FROM evidence_refs
        WHERE store_id = ? AND event_id = ?
          AND sha256 IS NOT NULL
          AND length(sha256) = 64
          AND lower(sha256) NOT GLOB '*[^0-9a-f]*'
        ORDER BY evidence_type, evidence_ref, sha256, id
      `).all(context.storeId, row.eventId) as AnalysisCausalMemoryProof[]);
      return { ...row, proofs };
    });
  }

export function appendCausalLink(this: MissionDomainRepositoryContext, contextInput: StoreContextEnvelope, input: AppendCausalLinkInput): CausalLinkRecord{
    const context = this.assertContext(contextInput);
    this.requireCausalEvent(context, input.sourceEventId);
    this.assertCausalTarget(context, input.targetType, input.targetId);
    const id = idOf(input.id, 'causalLinkId');
    const createdAt = this.timestamp();
    try {
      this.db.prepare(`
        INSERT INTO causal_links (
          id, store_id, source_event_id, target_type, target_id, relation, created_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?)
      `).run(
        id, context.storeId, input.sourceEventId, input.targetType,
        idOf(input.targetId, 'targetId'), textOf(input.relation, 'relation', 160), createdAt,
      );
    } catch (error) {
      this.rethrowConstraint(error, `Causal link ${id} already exists or has invalid lineage.`);
    }
    const row = this.db.prepare(`SELECT * FROM causal_links WHERE store_id = ? AND id = ?`)
      .get(context.storeId, id) as Record<string, unknown>;
    return mapCausalLink(row);
  }

export function appendEvidenceRef(this: MissionDomainRepositoryContext, contextInput: StoreContextEnvelope, input: AppendEvidenceRefInput): CausalEvidenceRefRecord{
    const context = this.assertContext(contextInput);
    return this.appendEvidenceRefInternal(context, input, this.timestamp());
  }

export function appendEvidenceRefInternal(this: MissionDomainRepositoryContext, 
    context: StoreContextEnvelope,
    input: AppendEvidenceRefInput,
    createdAt: string,
  ): CausalEvidenceRefRecord{
    this.requireCausalEvent(context, input.eventId);
    const id = idOf(input.id, 'evidenceRefId');
    let evidenceRef: string;
    try {
      evidenceRef = normalizeOpaqueEvidenceRef(input.evidenceRef);
    } catch (error) {
      throw invalid(error instanceof Error ? error.message : 'evidenceRef must be opaque.');
    }
    const sha256 = optionalSha256(input.sha256);
    try {
      this.db.prepare(`
        INSERT INTO evidence_refs (
          id, store_id, event_id, evidence_type, evidence_ref, sha256, created_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?)
      `).run(
        id, context.storeId, input.eventId,
        textOf(input.evidenceType, 'evidenceType', 160), evidenceRef, sha256, createdAt,
      );
    } catch (error) {
      this.rethrowConstraint(error, `Evidence reference ${id} already exists or has invalid lineage.`);
    }
    const row = this.db.prepare(`SELECT * FROM evidence_refs WHERE store_id = ? AND id = ?`)
      .get(context.storeId, id) as Record<string, unknown>;
    return mapEvidenceRef(row);
  }

export function appendCausalInternal(this: MissionDomainRepositoryContext, 
    context: StoreContextEnvelope,
    input: AppendCausalEventInput,
    createdAt: string,
  ): void{
    const stage = input.stage;
    if (!CAUSAL_LEDGER_STAGES.includes(stage)) throw invalid('Unknown causal stage.');
    if (input.correctsEventId) {
      const corrected = this.requireCausalEvent(context, input.correctsEventId);
      const missionId = input.missionId ? idOf(input.missionId, 'missionId') : undefined;
      const entityType = textOf(input.entityType, 'entityType', 160);
      const entityId = idOf(input.entityId, 'entityId');
      if (corrected.stage !== stage
        || (corrected.missionId ?? undefined) !== missionId
        || corrected.entityType !== entityType
        || corrected.entityId !== entityId) {
        throw referenceConflict(
          'Causal correction must preserve the corrected event mission, entity, and ledger stage.',
        );
      }
    }
    const sequence = Number((this.db.prepare(`
      SELECT COALESCE(MAX(sequence), 0) + 1 AS nextSequence
      FROM causal_events WHERE store_id = ?
    `).get(context.storeId) as { nextSequence: number }).nextSequence);
    this.db.prepare(`
      INSERT INTO causal_events (
        id, store_id, stage, event_type, entity_type, entity_id,
        mission_id, title, signal, intervention, expected_effect, observed_effect,
        confidence, status, source, actor_id, business_date,
        session_generation, corrects_event_id, sequence, created_at
      ) VALUES (
        @id, @storeId, @stage, @eventType, @entityType, @entityId,
        @missionId, @title, @signal, @intervention, @expectedEffect, @observedEffect,
        @confidence, @status, @source, @actorId, @businessDate,
        @sessionGeneration, @correctsEventId, @sequence, @createdAt
      )
    `).run({
      id: idOf(input.id, 'causalEventId'),
      storeId: context.storeId,
      stage,
      eventType: textOf(input.eventType, 'eventType', 160),
      entityType: textOf(input.entityType, 'entityType', 160),
      entityId: idOf(input.entityId, 'entityId'),
      missionId: optionalId(input.missionId, 'missionId'),
      title: textOf(input.title, 'title', 500),
      signal: optionalText(input.signal),
      intervention: optionalText(input.intervention),
      expectedEffect: optionalText(input.expectedEffect),
      observedEffect: optionalText(input.observedEffect),
      confidence: input.confidence === undefined ? null : confidenceOf(input.confidence),
      status: textOf(input.status, 'status', 120),
      source: textOf(input.source, 'source', 160),
      actorId: idOf(input.actorId, 'actorId'),
      businessDate: context.businessDate,
      sessionGeneration: context.sessionGeneration,
      correctsEventId: optionalId(input.correctsEventId, 'correctsEventId'),
      sequence,
      createdAt,
    });
  }

export function assertCausalTarget(this: MissionDomainRepositoryContext, 
    context: StoreContextEnvelope,
    type: AppendCausalLinkInput['targetType'],
    targetId: string,
  ): void{
    if (type === 'mission') { this.requireMission(context, targetId); return; }
    if (type === 'decision') { this.requireDecision(context, targetId); return; }
    if (type === 'experiment') { this.requireExperiment(context, targetId); return; }
    if (type === 'policy_version') { this.requirePolicyVersion(context, targetId); return; }
    if (type === 'mission_grant') { this.requireMissionGrant(context, targetId); return; }
    if (type === 'data_batch') { this.requireCompletedDataBatch(context, targetId); return; }
    this.requireCausalEvent(context, targetId);
  }
