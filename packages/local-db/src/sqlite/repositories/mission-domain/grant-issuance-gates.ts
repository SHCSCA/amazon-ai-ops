import type  {
  CreateMissionGrantInput,
  DecisionRecord,
  MissionRecord,
  MissionWriteAuthoritySnapshot,
  PolicyVersionRecord,
  PolicyVersionRules,
  StoreContextEnvelope,
} from '@amazon-ai-ops/shared-types';
import type { MissionDomainRepositoryContext } from './context';
import { assertMissionAuthorityGates } from './authority-gates';
import  {
  invalid,
  referenceConflict,
  rulesOf,
  stateConflict,
} from './values';
export interface GrantIssuanceFacts {
  mission: MissionRecord;
  policyVersion: PolicyVersionRecord;
  rules: PolicyVersionRules;
  approvedDecisions: DecisionRecord[];
  authority: MissionWriteAuthoritySnapshot;
  issuedAt: string;
}

export function verifyGrantIssuanceGates(
  context: MissionDomainRepositoryContext,
  store: StoreContextEnvelope,
  input: CreateMissionGrantInput,
): GrantIssuanceFacts {
  const runtime = context.getPolicyRuntime(store);
  const authority = context.captureWriteAuthority(store);
  const issuedAt = context.timestamp();
  let mission: MissionRecord | undefined;
  let policyVersion: PolicyVersionRecord | undefined;
  let rules: PolicyVersionRules | undefined;
  let approvedDecisions: DecisionRecord[] | undefined;
  assertMissionAuthorityGates([
    { priority: 'P0', check: () => {
      const version = context.getPolicyVersion(store, input.policyVersionId);
      if (runtime.killSwitch || version?.rules.killSwitch) throw stateConflict('MissionGrant issuer is blocked by the kill switch.');
    } },
    { priority: 'P1', check: () => {
      if (runtime.circuitBreakerState !== 'closed') throw stateConflict('MissionGrant issuer is blocked by the circuit breaker.');
    } },
    { priority: 'P2', check: () => { context.assertContext(store); } },
    { priority: 'P3', check: () => {
      mission = context.requireMission(store, input.missionId);
      context.assertRevision(mission.revision, input.missionRevision, 'Mission');
      context.assertMissionMayCreateAuthority(store, mission.id);
      if (mission.status !== 'active') throw stateConflict('MissionGrant issuance requires an active Mission.');
      policyVersion = context.requirePolicyVersion(store, input.policyVersionId);
      if (mission.policyVersionId !== policyVersion.id) throw referenceConflict('MissionGrant policy version must exactly match the Mission policy snapshot.');
      context.assertRevision(policyVersion.revision, input.policyRevision, 'Policy version');
      if (policyVersion.status !== 'enabled') throw stateConflict('MissionGrant issuance requires the Mission policy version to remain enabled.');
      const policy = context.requirePolicy(store, policyVersion.policyId);
      if (policy.status !== 'active' || policy.activeVersionId !== policyVersion.id) throw stateConflict('MissionGrant issuance requires the policy version to remain the active policy authority.');
      if (!runtime.activePolicyVersionId || input.issuer.type !== authority.authorizationPath
        || input.issuer.actorId !== (authority.authorizationPath === 'human' ? 'operator' : 'policy-engine')) {
        throw stateConflict('当前授权模式或策略运行时与判断来源不匹配，禁止混合人工与策略授权。');
      }
    } },
    { priority: 'P4', check: () => {
      if (Date.parse(input.expiresAt) <= Date.parse(issuedAt)) throw invalid('MissionGrant expiresAt must be in the future.');
    } },
    { priority: 'P5', check: () => {
      const version = context.requirePolicyVersion(store, input.policyVersionId);
      const policy = context.requirePolicy(store, version.policyId);
      rules = rulesOf(version.rules);
      context.assertPolicyRules(store, policy, rules);
      const effective = context.resolveEffectivePolicyVersion(store, {
        allowedActionTypes: input.allowedActionTypes,
        allowedAdEntityIds: input.allowedAdEntityIds,
        at: issuedAt,
      });
      if (effective.id !== version.id) throw stateConflict('运营任务绑定的策略不是当前广告对象的最高优先级匹配；请重新运行分析并按数字较小的策略建立任务。');
      context.assertGrantWithinPolicy(input, version, rules, issuedAt);
      context.assertPolicyUsage(store, version.id, input.allowedAdEntityIds);
    } },
    { priority: 'P6', check: () => {
      approvedDecisions = context.requireApprovedDecisionsForGrant(store,
        context.requireMission(store, input.missionId), input, issuedAt);
    } },
  ]);
  if (!mission || !policyVersion || !rules || !approvedDecisions) throw referenceConflict('执行授权门禁未产生完整的当前权威事实。');
  return { mission, policyVersion, rules, approvedDecisions, authority, issuedAt };
}
