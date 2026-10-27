import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { afterEach, describe, expect, it } from 'vitest';
import contract from './v16-performance-contract.js';
import artifacts from './v16-performance-artifacts.js';
import business from './v16-performance-business.js';
import status from './v16-performance-status.js';
import { createRequire } from 'node:module';
const nativeArtifacts = createRequire(import.meta.url)('./v16-native-artifacts.js');
import protocol from './v16-performance-protocol.test-support.cjs';

const roots=[];
afterEach(()=>{ for(const root of roots.splice(0)) fs.rmSync(root,{recursive:true,force:true}); });
function writerFor() { const root=fs.mkdtempSync(path.join(os.tmpdir(),'nfr-approval-')); roots.push(root); return artifacts.createArtifactWriter(path.join(root,'run')); }
const context={storeId:'A',browserProfileId:'profile-A',marketplace:'US',currency:'USD',businessTimezone:'America/Los_Angeles',businessDate:'2026-10-16',sessionGeneration:0};
const current={packageIdentity:{executableSha256:'a'.repeat(64),appContentSha256:'b'.repeat(64),mainBundleSha256:'c'.repeat(64)}};
const identity={sourceSha256:'d'.repeat(64)};
const fixture={fixture:'typical',sourceSha256:identity.sourceSha256,storeIds:['A','B']};
function approved(writer,patch={}) {
  return writer.json('approval-'+Math.random()+'.json',{kind:'v16-nfr-operation-authorization',schemaVersion:1,status:'approved',
    approver:'fixture-operator-only',approvedAt:new Date(Date.now()-60000).toISOString(),expiresAt:new Date(Date.now()+60000).toISOString(),
    sourceSha256:identity.sourceSha256,packageIdentity:current.packageIdentity,fixture:'typical',storeIds:['A','B'],
    actions:['paid-ai'],prohibitsAdsWrites:true,prohibitsAuthorityIssuance:true,aiStoreId:'A',policyRevision:2,maximumCostMicrousd:100,...patch});
}
function spend(patch={}) { return {unknownCount:0,remainingMicrousd:100,policy:{enabled:true,revision:2,storeId:'A',
  windowStartsAt:new Date(Date.now()-60000).toISOString(),windowEndsAt:new Date(Date.now()+60000).toISOString(),
  contextTokenLimit:1000,outputTokenLimit:1000,inputMicrousdPerMillion:1000,outputMicrousdPerMillion:1000},...patch}; }

describe('NFR producer approval and external dependency separation',()=>{
  it('separates fourteen actual software metrics from six external AI metrics without fake zeros',()=>{
    const targets=contract.defaultMetricTargets(), measurements=targets.filter(row=>status.SOFTWARE_METRICS.includes(row.metric)).map(row=>({...row,observed:12}));
    const result=status.captureStatus(targets,measurements,[{metric:'ai-cost',code:'MISSING_BUDGET'}]);
    expect(result.software).toMatchObject({status:'MEASURED',requiredTargets:36,measuredTargets:36});
    expect(result.externalAi).toMatchObject({status:'INCOMPLETE',requiredTargets:12,measuredTargets:0});
    expect(result.externalAi.missing).toHaveLength(12); expect(result.formalAcceptanceEvidence).toBe(false); expect(result.appReady).toBe(false);
  });
  it('does not let an unscoped launch failure disappear into the external-only group',()=>{
    const targets=contract.defaultMetricTargets(), result=status.captureStatus(targets,targets,[{code:'EXE_FAILED'}]);
    expect(result.software.status).toBe('INCOMPLETE'); expect(result.externalAi.status).toBe('INCOMPLETE');
  });
  it('accepts only an existing bound approval and reserves the conservative current policy maximum',()=>{
    const writer=writerFor(), value={...fixture,aiAuthorization:approved(writer)};
    expect(business.approveAi(value,current,spend(),{calls:0,costMicrousd:0},context).policyRevision).toBe(2);
    for(const counters of [{calls:Infinity,costMicrousd:0},{calls:0,costMicrousd:99},{calls:0,costMicrousd:Infinity}])
      expect(()=>business.approveAi(value,current,spend(),counters,context)).toThrow();
  });
  it('rejects expired, cross-store, old-package, old-policy and unknown billing approval paths',()=>{
    const writer=writerFor();
    for(const patch of [{expiresAt:'2020-01-01T00:00:00Z'},{storeIds:['A']},{packageIdentity:{}},{policyRevision:1},{aiStoreId:'B'},{maximumCalls:2}])
      expect(()=>business.approveAi({...fixture,aiAuthorization:approved(writer,patch)},current,spend(),{calls:0,costMicrousd:0},context)).toThrow();
    const value={...fixture,aiAuthorization:approved(writer)};
    for(const projection of [spend({unknownCount:1}),spend({remainingMicrousd:1}),spend({policy:{...spend().policy,enabled:false}})])
      expect(()=>business.approveAi(value,current,projection,{calls:0,costMicrousd:0},context)).toThrow();
  });
  it('hash-binds every measured baseline sample and rejects percentile, PID, timing and package substitution',()=>{
    const writer=writerFor(), environment={platform:'fixture-software-only'}, metrics=contract.defaultMetricTargets();
    const startedAt=new Date(Date.now()-60000).toISOString(), finishedAt=new Date(Date.now()-30000).toISOString();
    const baseline={kind:'v16-nfr-baseline',status:'measured',runId:'measured-fixture-only',sourceSha256:identity.sourceSha256,
      packageIdentity:current.packageIdentity,environment,execution:{startedAt,finishedAt},measurements:[]};
    for(const target of metrics) baseline.measurements.push({...target,observed:3,samples:writer.json('samples/'+target.metric+'-'+target.fixture+'-'+target.percentile+'.json',{
      kind:'v16-nfr-samples',runId:baseline.runId,metric:target.metric,fixture:target.fixture,environment,packageIdentity:current.packageIdentity,
      samples:[1,2,3].map(value=>({value,pid:123,observedAt:finishedAt}))})});
    const reference=writer.json('baseline.json',baseline), budget={kind:'v16-nfr-budget',schemaVersion:1,status:'approved',revision:1,owner:'fixture-only',
      approval:{approver:'fixture-only',approvedAt:new Date(Date.now()-10000).toISOString(),artifact:writer.json('review.json',{testOnly:true})},
      baselineSha256:reference.sha256,environment,metrics:metrics.map(target=>({...target,threshold:10}))};
    protocol.completeLegacyPerformanceFixture({ root: writer.root, baseline, budget,
      context: { execution: baseline.execution }, baselineOnly: true });
    // P50 三个值的最近秩为二，与 P95 分别重算。
    for(const row of baseline.measurements) row.observed=row.percentile===50?2:3;
    const bound=writer.json('baseline-final.json',baseline); budget.baselineSha256=bound.sha256;
    nativeArtifacts.withArtifactLedger(new Map(), () => {
    expect(contract.validateBudget(budget,bound,baseline,environment,identity,current)).toBe(budget);
    for(const mutate of [value=>value.measurements[0].observed=999,value=>value.packageIdentity={},value=>value.execution.finishedAt=new Date(Date.now()+10000).toISOString()]) {
      const changed=structuredClone(baseline); mutate(changed); expect(()=>contract.validateBudget(budget,bound,changed,environment,identity,current)).toThrow();
    }
    const sample=baseline.measurements[0].samples; fs.appendFileSync(sample.path,' ');
    expect(()=>contract.validateBudget(budget,bound,baseline,environment,identity,current)).toThrow('NFR_ARTIFACT_CHANGED');
    }, [writer.root]);
  });
});
