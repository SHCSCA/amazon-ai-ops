import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import contract from './v16-performance-contract.js';
import artifacts from './v16-performance-artifacts.js';
import business from './v16-performance-business.js';
import cli from './collect-v16-native-performance.js';
import { createRequire } from 'node:module';
const sampler = createRequire(import.meta.url)('./v16-performance-sampler.js');
import runtime from './v16-performance-runtime.js';

const roots=[];
function temporary() { const root=fs.mkdtempSync(path.join(os.tmpdir(),'nfr-contract-')); roots.push(root); return root; }
afterEach(() => { for(const root of roots.splice(0)) fs.rmSync(root,{recursive:true,force:true}); });
function plan() { return {kind:'v16-nfr-capture-plan',schemaVersion:1,runId:'fixture-only-run',identity:{sourceRevision:'a'.repeat(40),sourceSha256:'b'.repeat(64),packageVersion:'1.6.0',packageHashes:{}},operationTimeoutMs:1000,metrics:contract.defaultMetricTargets(),fixtures:[{fixture:'typical'},{fixture:'maximum'}]}; }

describe('NFR collector strict input and measured artifact contracts',()=>{
  it('requires all twenty metrics in both volume fixtures with P50/P95 navigation contracts',()=>{
    const value=plan(); expect(contract.validatePlan(value)).toBe(value);
    expect(value.metrics).toHaveLength(48);
    expect(value.metrics.filter(row=>row.metric==='store-switch').map(row=>row.percentile)).toEqual([50,95,50,95]);
  });
  it('rejects incomplete inventory, duplicate rows, fake units, and fewer than three samples',()=>{
    for(const change of [value=>value.metrics.pop(),value=>value.metrics[1]={...value.metrics[0]},
      value=>value.metrics[0].unit='fake-unit',value=>value.metrics[0].sampleCount=2]) {
      const value=plan(); change(value); expect(()=>contract.validatePlan(value)).toThrow();
    }
  });
  it('rejects caller-supplied observations instead of accepting numeric measurement callbacks',()=>{
    for(const field of ['measurements','samples','observed']) expect(()=>contract.validatePlan({...plan(),[field]:[1,2,3]})).toThrow('NFR_EXTERNAL_NUMERIC_SAMPLES_FORBIDDEN');
    expect(()=>cli.argumentsFor(['--plan','p','--out','o','--executable','old.exe'])).toThrow('NFR_UNKNOWN_OR_DUPLICATE_ARGUMENT');
    expect(()=>cli.argumentsFor(['--plan','p','--out','o','--phase','READY'])).toThrow('NFR_PLAN_OUTPUT_PHASE_REQUIRED');
  });
  it('writes immutable originals, rejects same-path tampering and output traversal',()=>{
    const root=temporary(), writer=artifacts.createArtifactWriter(path.join(root,'new-run'));
    const record=writer.json('raw/value.json',{actual:'observation'});
    expect(artifacts.readBound(record).json()).toEqual({actual:'observation'});
    expect(()=>writer.json('raw/value.json',{overwritten:true})).toThrow();
    expect(()=>writer.write('../escape','x')).toThrow('NFR_OUTPUT_ESCAPES_RUN');
    fs.writeFileSync(record.path,'tampered'); expect(()=>artifacts.readBound(record)).toThrow('NFR_ARTIFACT_CHANGED');
  });
  it('measures actual database, WAL, SHM and directory bytes without inventing missing samples',()=>{
    const root=temporary(), db=path.join(root,'data.db');
    fs.writeFileSync(db,Buffer.alloc(11)); fs.writeFileSync(db+'-wal',Buffer.alloc(7)); fs.writeFileSync(db+'-shm',Buffer.alloc(3));
    expect(artifacts.databaseBytes(db)).toBe(21);
    expect(artifacts.treeBytes(root)).toMatchObject({bytes:21,files:3,exists:true});
    expect(artifacts.treeBytes(path.join(root,'absent'))).toEqual({bytes:0,files:0,exists:false});
    expect(()=>artifacts.databaseBytes(path.join(root,'missing.db'))).toThrow();
  });
  it('rejects hard-linked originals so a different path cannot hide byte replacement',()=>{
    const root=temporary(), original=path.join(root,'original.json'), linked=path.join(root,'linked.json');
    fs.writeFileSync(original,'{}'); fs.linkSync(original,linked);
    expect(()=>artifacts.fileRecord(linked)).toThrow('NFR_PATH_MUST_BE_DIRECT');
  });
  it('rejects a hard-linked SQLite WAL anywhere in a profile tree before native startup can write through it',()=>{
    const root=temporary(), profile=path.join(root,'profile'); fs.mkdirSync(profile);
    fs.writeFileSync(path.join(profile,'amazon-ai-ops.db'),'owned-database');
    const external=path.join(root,'outside-wal'); fs.writeFileSync(external,'preserved-wal');
    fs.linkSync(external,path.join(profile,'amazon-ai-ops.db-wal'));
    expect(()=>artifacts.treeBytes(profile)).toThrow('NFR_TREE_SPECIAL_FILE_REJECTED');
    expect(()=>sampler.captureProfileLogical(profile,'linked-wal-order')).toThrow('NFR_TREE_SPECIAL_FILE_REJECTED');
    expect(fs.readFileSync(external,'utf8')).toBe('preserved-wal');
  });
  it('uses nearest-rank measured percentiles with no threshold-derived sample values',()=>{
    const rows=[1,100,3,2].map(value=>({value}));
    expect(sampler.percentile(rows,50)).toBe(2); expect(sampler.percentile(rows,95)).toBe(100);
    expect(sampler.percentile([],95)).toBeUndefined();
  });
  it('rejects nonzero, signalled, still-running, failed-close and renderer-error native cleanup',()=>{
    const clean={exited:true,exitCode:0,signalCode:null,rendererErrors:[]};
    expect(()=>runtime.assertNativeCleanup(clean)).not.toThrow();
    for(const patch of [{exitCode:7},{exitCode:null,signalCode:'SIGTERM'},{exited:false},{closeError:new Error('original-close')}])
      expect(()=>runtime.assertNativeCleanup({...clean,...patch})).toThrow('NFR_RUNTIME_CLEANUP_NOT_CONFIRMED');
    expect(()=>runtime.assertNativeCleanup({...clean,rendererErrors:['original-renderer-failure']})).toThrow('NFR_RENDERER_RUNTIME_ERRORS');
  });
});

describe('NFR actual AI ledger boundary',()=>{
  const context={storeId:'store-a',browserProfileId:'profile-a',marketplace:'US',currency:'USD',businessTimezone:'America/Los_Angeles',businessDate:'2026-10-16',sessionGeneration:1};
  const row={storeContext:context,status:'succeeded',startedAt:'2026-10-16T00:00:00Z',endedAt:'2026-10-16T00:00:00.027Z',usage:{promptTokens:4,completionTokens:6,totalTokens:10},costStatus:'estimated',costMicrousd:125};
  it('derives latency, request count, tokens, and cost from actual ledger fields',()=>{
    expect(business.aiValues([row],context)).toEqual({latencyMs:27,calls:1,tokens:10,costMicrousd:125,costUsd:0.000125});
  });
  it('keeps missing usage and unknown billing absent rather than manufacturing zero',()=>{
    const value=business.aiValues([{...row,usage:undefined,costStatus:'unknown',costMicrousd:undefined}],context);
    expect(value).toEqual({latencyMs:27,calls:1}); expect(value.tokens).toBeUndefined(); expect(value.costUsd).toBeUndefined();
  });
  it('rejects cross-store, nonterminal, blocked and reversed-time AI records',()=>{
    for(const change of [{storeContext:{...context,storeId:'store-b'}},{status:'blocked'},{endedAt:undefined},{endedAt:'2026-10-15T00:00:00Z'}]) {
      expect(()=>business.aiValues([{...row,...change}],context)).toThrow('NFR_REAL_AI_COST_RECORDS_REQUIRED');
    }
    expect(()=>business.aiValues([],context)).toThrow('NFR_REAL_AI_COST_RECORDS_REQUIRED');
  });
  it('requires original human approval and current policy before a paid call can start',()=>{
    expect(()=>business.approveAi({storeIds:['store-a']},{packageIdentity:{}},{policy:{enabled:true}},{calls:0,costMicrousd:0},context)).toThrow('NFR_ARTIFACT_DIGEST_REQUIRED');
  });
});
