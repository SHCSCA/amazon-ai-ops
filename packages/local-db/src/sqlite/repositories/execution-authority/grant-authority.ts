import { AD_EXECUTION_ACTION_TYPE, MAX_AD_EXECUTION_ACTIONS_PER_BATCH, type StoreContextEnvelope } from '@amazon-ai-ops/shared-types';
import { GrantRow, ProposalDecisionRow } from './contracts';
import { ExecutionAuthorityRepositoryError } from './errors';
import  {
  normalizeContext, timestampOf,
  idOf,
  parseJson,
  objectOf,
  uniqueStringArray,
  notFound,
  referenceConflict,
  stateConflict,
  assertExecutionAuthorityGates,
} from './values';
import type { ExecutionAuthorityRepositoryContext } from './context';
export function requireGrant(this: ExecutionAuthorityRepositoryContext, context: StoreContextEnvelope, grantId: string): GrantRow {
    const row = this.db.prepare('SELECT * FROM mission_grants WHERE store_id = ? AND id = ?').get(context.storeId, grantId) as GrantRow | undefined;
    if (!row)
        throw notFound('Mission grant was not found.');
    const runtime = this.missionRepository.getPolicyRuntime(context);
    const policy = this.missionRepository.getPolicyVersion(context, row.policy_version_id);
    assertExecutionAuthorityGates([
        { priority: 'P0', check: () => {
                if (runtime.killSwitch || policy?.rules.killSwitch)
                    throw stateConflict('Execution policy kill switch is enabled.');
            } },
        { priority: 'P1', check: () => {
                if (runtime.circuitBreakerState !== 'closed')
                    throw stateConflict('Execution policy circuit breaker is not closed.');
            } },
        { priority: 'P2', check: () => {
                this.assertContext(context);
                if (row.marketplace !== 'US' || row.currency !== 'USD')
                    throw stateConflict('Execution grant must use US/USD.');
                if (row.created_session_generation !== context.sessionGeneration)
                    throw new ExecutionAuthorityRepositoryError('STALE_CONTEXT', 'Execution grant belongs to a stale session generation.');
            } },
        { priority: 'P3', check: () => {
                this.missionRepository.assertMissionMayCreateAuthority(context, row.mission_id);
                this.missionRepository.assertWriteAuthority(context, this.missionRepository.getMissionGrant(context, grantId)?.authority);
                const mission = this.missionRepository.getMission(context, row.mission_id);
                if (!mission || mission.status !== 'active' || mission.revision !== row.mission_revision || mission.policyVersionId !== row.policy_version_id)
                    throw stateConflict('Execution grant no longer matches an active Mission revision.');
                if (!policy || policy.status !== 'enabled' || policy.revision !== row.policy_revision)
                    throw stateConflict('Execution grant policy revision is not the enabled authority.');
                if (!runtime.activePolicyVersionId || (row.issuer_type === 'policy' && runtime.autonomyMode !== 'policy_auto'))
                    throw stateConflict('Execution policy runtime is not safe for this grant.');
            } },
        { priority: 'P4', check: () => {
                if (Date.parse(timestampOf(row.expires_at, 'grant expiresAt')) <= this.now().getTime())
                    throw stateConflict('Execution grant has expired.');
                const events = this.db.prepare(`SELECT SUM(CASE WHEN event_type='issued' THEN 1 ELSE 0 END) AS issuedCount,
          SUM(CASE WHEN event_type IN ('revoked','consumed','expired','invalidated') THEN 1 ELSE 0 END) AS terminalCount
          FROM mission_grant_events WHERE store_id=? AND grant_id=?`).get(context.storeId, grantId) as {
                    issuedCount: number;
                    terminalCount: number;
                };
                if (Number(events.issuedCount) < 1 || Number(events.terminalCount) > 0)
                    throw stateConflict('Execution grant is missing issuance or is already terminal.');
            } },
        { priority: 'P5', check: () => {
                const actionTypes = uniqueStringArray(parseJson(row.allowed_action_types_json, 'grant action types'));
                const entityIds = uniqueStringArray(parseJson(row.allowed_ad_entity_ids_json, 'grant entity ids'));
                if (actionTypes.length !== 1 || actionTypes[0] !== AD_EXECUTION_ACTION_TYPE)
                    throw stateConflict('Execution V1 grant must allow only set_keyword_bid.');
                if (entityIds.length > MAX_AD_EXECUTION_ACTIONS_PER_BATCH)
                    throw stateConflict('Execution V1 allows at most 10 actions per batch.');
                const effective = this.missionRepository.resolveEffectivePolicyVersion(context, { allowedActionTypes: [AD_EXECUTION_ACTION_TYPE], allowedAdEntityIds: entityIds, at: this.timestamp() });
                if (effective.id !== row.policy_version_id)
                    throw stateConflict('授权绑定的策略不再是当前广告对象的最高优先级唯一匹配；请重新运行分析并签发新授权。');
            } },
        { priority: 'P6', check: () => {
                const decisions = uniqueStringArray(parseJson(row.decision_ids_json, 'grant decision ids'));
                if (!decisions.length)
                    throw stateConflict('Execution grant has no approved decisions.');
                for (const decisionId of decisions)
                    this.validateProposalDecision(context, row, this.requireProposalDecision(context, decisionId));
            } },
    ]);
    return row;
}
export function assertExecutionGrantAuthority(this: ExecutionAuthorityRepositoryContext, contextInput: StoreContextEnvelope, grantIdInput: string): void {
    const context = normalizeContext(contextInput);
    this.immediate(() => { this.requireGrant(context, idOf(grantIdInput, 'grantId')); });
}
export function requireProposalDecision(this: ExecutionAuthorityRepositoryContext, context: StoreContextEnvelope, decisionId: string): ProposalDecisionRow {
    const row = this.db.prepare(`
      SELECT
        proposal.id AS proposal_id, proposal.marketplace, proposal.currency,
        proposal.mission_id, proposal.mission_revision, proposal.policy_version_id,
        proposal.policy_revision, proposal.action_revision, proposal.action_type,
        proposal.entity_type, proposal.ad_entity_id, proposal.ad_entity_revision,
        proposal.current_bid_cents, proposal.proposed_bid_cents, proposal.change_pct,
        proposal.authorization_json, proposal.valid_until, proposal.created_session_generation,
        decision.id AS decision_id, decision.revision AS decision_revision,
        decision.status AS decision_status, decision.action_type AS decision_action_type,
        decision.ad_entity_id AS decision_ad_entity_id,
        decision.action_revision AS decision_action_revision,
        decision.policy_version_id AS decision_policy_version_id,
        decision.policy_revision AS decision_policy_revision,
        decision.valid_until AS decision_valid_until
      FROM analysis_proposal_decision_links link
      JOIN analysis_proposal_snapshots proposal
        ON proposal.store_id = link.store_id AND proposal.id = link.proposal_id
      JOIN decisions decision
        ON decision.store_id = link.store_id AND decision.id = link.decision_id
      WHERE link.store_id = ? AND link.decision_id = ?
    `).get(context.storeId, idOf(decisionId, 'decisionId')) as ProposalDecisionRow | undefined;
    if (!row)
        throw notFound(`Approved decision ${decisionId} has no immutable Stage 5 proposal link.`);
    return row;
}
export function validateProposalDecision(this: ExecutionAuthorityRepositoryContext, context: StoreContextEnvelope, grant: GrantRow, row: ProposalDecisionRow): void {
    const exact = row.marketplace === 'US' && row.currency === 'USD'
        && row.mission_id === grant.mission_id
        && row.mission_revision === grant.mission_revision
        && row.policy_version_id === grant.policy_version_id
        && row.policy_revision === grant.policy_revision
        && row.action_revision === grant.action_revision
        && row.action_type === AD_EXECUTION_ACTION_TYPE
        && row.entity_type === 'keyword'
        && row.decision_status === 'approved'
        && row.decision_action_type === AD_EXECUTION_ACTION_TYPE
        && row.decision_ad_entity_id === row.ad_entity_id
        && row.decision_action_revision === grant.action_revision
        && row.decision_policy_version_id === grant.policy_version_id
        && row.decision_policy_revision === grant.policy_revision
        && row.created_session_generation === context.sessionGeneration;
    if (!exact)
        throw referenceConflict('Grant, proposal, decision, policy, Mission, or action revision does not match exactly.');
    if (Date.parse(row.valid_until) <= this.now().getTime()
        || (row.decision_valid_until && Date.parse(row.decision_valid_until) <= this.now().getTime())) {
        throw stateConflict('Linked proposal or decision has expired.');
    }
    const authorization = objectOf(parseJson(row.authorization_json, 'proposal authorization'));
    const lane = objectOf(authorization[grant.issuer_type]);
    if (lane.eligible !== true || (Array.isArray(lane.blockers) && lane.blockers.length > 0)) {
        throw stateConflict(`Proposal is not eligible for ${grant.issuer_type} authorization.`);
    }
}
