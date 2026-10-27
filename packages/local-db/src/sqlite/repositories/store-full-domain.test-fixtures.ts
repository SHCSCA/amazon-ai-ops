import { AnalysisAuthorityRepository } from './analysis-authority-repo';
import { createAnalysisRunsRepository } from './analysis-runs-repo';
import { ExecutionAuthorityRepository } from './execution-authority-repo';
import { LingxingImportRepository } from './lingxing-import-repo';
import { ProductRepository } from './product-repo';
import { createHarness, createApprovedDecision, seedActiveMission } from './mission-domain-repo.test-harness';
import { NOW, policyRules } from './mission-domain-repo.test-data';

export function createFullDomainFixture() {
    const h = createHarness();
    const products = new ProductRepository(h.database);
    const reports = new LingxingImportRepository(h.database);
    const analysis = new AnalysisAuthorityRepository(h.database, { now: () => new Date(NOW) });
    const runs = createAnalysisRunsRepository(h.database);
    const execution = new ExecutionAuthorityRepository(h.database, { now: () => new Date(NOW) });
    const seeded = [h.contextOne, h.contextTwo].map((context, index) => {
      const { mission, version } = seedActiveMission(h.repository, context);
      const decision = createApprovedDecision(h.database, h.repository, context, mission, version, 1);
      const rules = policyRules(context.storeId);
      const grant = h.repository.issueMissionGrant(context, { id: `grant-${context.storeId}`, missionId: mission.id,
        missionRevision: mission.revision, decisionIds: [decision.id], actionRevision: 1,
        allowedActionTypes: ['set_keyword_bid'], allowedAdEntityIds: [decision.adEntityId!], maxChangePct: 10, totalImpactBudget: 10,
        expiresAt: '2026-07-22T13:00:00.000Z', policyVersionId: version.id, policyRevision: version.revision,
        requiredEvidence: rules.requiredEvidence, stopConditions: rules.stopConditions, issuer: { type: 'human', actorId: 'operator' } });
      const account = `ads-${context.storeId}`;
      h.database.prepare(`INSERT INTO store_connections(id,store_id,provider,status,external_account_id,normalized_external_account_id,created_at,updated_at)
        VALUES (?,?,'amazon_ads','ready',?,?,?,?)`).run(`conn-${context.storeId}`, context.storeId, account, account, NOW, NOW);
      h.database.prepare("UPDATE store_session_metadata SET external_account_id=? WHERE store_id=? AND provider='amazon_ads'").run(account, context.storeId);
      execution.registerCanonicalKeywordIdentity(context, { adEntityId: decision.adEntityId!, entityRevision: 1, adsAccountId: account,
        campaignId: `campaign-${context.storeId}`, adGroupId: `group-${context.storeId}`, keywordId: `keyword-${context.storeId}`,
        observedBidCents: 100, pageIdentityHash: 'a'.repeat(64), resolutionProofSha256: 'b'.repeat(64), resolvedAt: NOW, resolvedBy: 'operator' });
      const batch = execution.createExactExecutionBatch(context, grant.id).projection;
      const experiment = h.repository.createExperiment(context, { id: `experiment-${context.storeId}`, missionId: mission.id,
        productId: mission.productId, adEntityId: decision.adEntityId, name: '店铺独立观察', hypothesis: '核对有限降价结果。', primaryMetric: 'acos',
        guardrailMetrics: ['sales'], guardrailCriteria: ['sales >= 95%'], baseline: {}, variant: {},
        observationStartsAt: '2026-07-22T12:00:00.000Z', observationEndsAt: '2026-07-29T12:00:00.000Z' });
      const memory = h.repository.appendCausalEvent(context, { id: `memory-${context.storeId}`, missionId: mission.id, stage: 'FACT',
        eventType: 'operator_observation', entityType: 'mission', entityId: mission.id, title: '店铺独立事实', status: 'recorded', source: 'operator', actorId: 'operator' });
      const run = runs.create({ runId: `run-${context.storeId}`, storeId: context.storeId, marketplace: 'US', currency: 'USD',
        missionId: mission.id, reportSnapshotId: `snapshot-${context.storeId}`, status: 'completed', recommendationsCount: 1 });
      products.upsertForStore(context.storeId, { asin: index ? 'B000000002' : 'B000000001', store_name: index ? 'US Store Two' : 'US Store One', marketplace_code: 'US', title: `产品-${context.storeId}` });
      return { context, mission, decision, grant, batch, experiment, memory, run };
    });
    const project = (item: typeof seeded[number]) => ({
      products: products.findAllForStore(item.context.storeId), reports: reports.listBatchesForStore(item.context.storeId),
      runs: runs.findByStoreId(item.context.storeId), proposals: analysis.listProposalSnapshots(item.context, item.mission.id),
      approvals: h.repository.listDecisions(item.context), grants: h.repository.listMissionGrants(item.context, item.mission.id),
      execution: execution.listExecutionBatches(item.context), experiments: h.repository.listExperiments(item.context),
      memory: h.repository.listCausalEvents(item.context),
    });
  return { h, products, reports, analysis, runs, execution, seeded, project };
}
