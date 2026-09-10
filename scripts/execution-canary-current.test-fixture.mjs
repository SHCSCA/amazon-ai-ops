// Synthetic verifier fixtures only. Production evidence is read from the frozen authority snapshot.
export function addCurrentCanaryLineage(database) {
  const add = (table, name, type = 'TEXT') => {
    if (!database.prepare(`PRAGMA table_info(${table})`).all().some(column => column.name === name)) {
      database.exec(`ALTER TABLE ${table} ADD COLUMN ${name} ${type}`);
    }
  };
  for (const table of ['mission_grants', 'decisions']) add(table, 'authority_json');
  add('mission_grants', 'issuer_actor_id');
  add('stores', 'business_timezone');
  add('missions', 'phase');
  for (const name of ['actor_id', 'reason', 'snapshot_json']) add('decision_history', name);
  for (const name of ['submit_intent_id', 'command_fingerprint', 'intent_written_at']) add('ad_execution_jobs', name);
  for (const name of ['actor_id', 'reason', 'job_id', 'submit_intent_id']) add('mission_grant_events', name);
  add('mission_grant_events', 'impact_cents', 'INTEGER');
  add('analysis_proposal_snapshots', 'action_batch_id');
  database.exec(`CREATE TABLE analysis_action_batches (
    id TEXT, store_id TEXT, mission_id TEXT, mission_revision INTEGER, action_revision INTEGER,
    created_session_generation INTEGER, authority_json TEXT);
    CREATE TABLE mission_events (id TEXT,store_id TEXT,mission_id TEXT,mission_revision INTEGER,
      event_type TEXT,actor_id TEXT,reason TEXT,snapshot_json TEXT,created_at TEXT);
    CREATE TABLE ad_execution_events (id TEXT,store_id TEXT,batch_id TEXT,job_id TEXT,sequence INTEGER,
      event_type TEXT,from_status TEXT,to_status TEXT,session_generation INTEGER,created_at TEXT);`);
  for (const job of database.prepare('SELECT * FROM ad_execution_jobs').all()) {
    const grant = database.prepare('SELECT * FROM mission_grants WHERE id=?').get(job.grant_id);
    const store = database.prepare('SELECT * FROM stores WHERE store_id=?').get(job.store_id);
    const decision = database.prepare('SELECT * FROM decisions WHERE id=?').get(job.decision_id);
    const approval = database.prepare("SELECT * FROM decision_history WHERE decision_id=? AND event_type='approved'").get(job.decision_id);
    const before = database.prepare("SELECT * FROM ad_execution_evidence WHERE job_id=? AND slot='before'").get(job.id);
    const human = grant.issuer_type === 'human';
    const actor = human ? 'operator' : 'policy-engine';
    const context = { storeId: store.store_id, browserProfileId: store.browser_profile_id, marketplace: 'US', currency: 'USD',
      businessTimezone: store.business_timezone || 'America/Los_Angeles', businessDate: job.created_at.slice(0, 10), sessionGeneration: job.created_session_generation };
    const authority = { context, authorityMode: human ? 'manual_approval' : 'policy_auto', authorityModeRevision: 1,
      authorizationPath: grant.issuer_type, issuerType: human ? 'human_operator' : 'policy_runtime',
      issuerRef: human ? 'operator' : `policy-runtime:${job.store_id}:1` };
    const json = JSON.stringify(authority);
    database.prepare('UPDATE stores SET business_timezone=? WHERE store_id=?').run(context.businessTimezone, job.store_id);
    database.prepare('UPDATE mission_grants SET authority_json=?,issuer_actor_id=? WHERE id=?').run(json, actor, grant.id);
    database.prepare('UPDATE decisions SET authority_json=?,status=\'verified\',revision=?,updated_at=? WHERE id=?')
      .run(json, job.decision_revision + 2, new Date(Date.parse(job.terminal_at) + 2).toISOString(), job.decision_id);
    const actionBatchId = `action-batch:${job.id}`;
    database.prepare('INSERT INTO analysis_action_batches VALUES(?,?,?,?,?,?,?)')
      .run(actionBatchId, job.store_id, job.mission_id, grant.mission_revision, job.action_revision, job.created_session_generation, json);
    database.prepare('UPDATE analysis_proposal_snapshots SET action_batch_id=? WHERE id=?').run(actionBatchId, job.proposal_id);
    const snapshot = { id: decision.id, storeId: job.store_id, missionId: job.mission_id, policyVersionId: grant.policy_version_id,
      policyRevision: grant.policy_revision, actionRevision: job.action_revision, actionType: job.action_type, adEntityId: job.ad_entity_id,
      currentValue: job.expected_bid_cents / 100, recommendedValue: job.target_bid_cents / 100, validUntil: decision.valid_until, authority };
    database.prepare('UPDATE decision_history SET actor_id=?,reason=?,snapshot_json=? WHERE id=?')
      .run(actor, 'Synthetic canary approval reason', JSON.stringify({ ...snapshot, status: 'approved', revision: job.decision_revision }), approval.id);
    for (const [i, status] of ['executed', 'verified'].entries()) {
      database.prepare('INSERT INTO decision_history(id,store_id,decision_id,decision_revision,event_type,actor_id,reason,snapshot_json,created_at) VALUES(?,?,?,?,?,?,?,?,?)')
        .run(`${job.id}:${status}`, job.store_id, job.decision_id, job.decision_revision + i + 1, status, 'execution-authority', 'Synthetic canary readback',
          JSON.stringify({ ...snapshot, status, revision: job.decision_revision + i + 1 }), new Date(Date.parse(job.terminal_at) + i + 1).toISOString());
    }
    database.prepare("UPDATE missions SET revision=?,phase='readback' WHERE id=?").run(grant.mission_revision + 1, job.mission_id);
    for (const [i, phase] of ['execution', 'readback'].entries()) {
      database.prepare('INSERT INTO mission_events VALUES(?,?,?,?,?,?,?,?,?)').run(`${job.id}:mission:${i}`, job.store_id, job.mission_id,
        grant.mission_revision + i, 'status_active', i ? 'execution-authority' : 'operator', 'Synthetic canary mission',
        JSON.stringify({ id: job.mission_id, storeId: job.store_id, marketplace: 'US', currency: 'USD', policyVersionId: grant.policy_version_id,
          revision: grant.mission_revision + i, status: 'active', phase }), i ? new Date(Date.parse(job.terminal_at) + 3).toISOString() : grant.issued_at);
    }
    const intent = `intent:${job.id}`;
    database.prepare('UPDATE ad_execution_jobs SET submit_intent_id=?,command_fingerprint=?,intent_written_at=? WHERE id=?')
      .run(intent, 'F'.repeat(64), before.created_at, job.id);
    database.prepare("UPDATE mission_grant_events SET actor_id=? WHERE grant_id=? AND event_type='issued'").run(actor, grant.id);
    database.prepare("UPDATE mission_grant_events SET created_at=?,actor_id='execution-ledger' WHERE grant_id=? AND event_type='consumed'")
      .run(job.submitted_at, grant.id);
    for (const [i, type] of ['reserved', 'spent'].entries()) {
      const time = i ? job.submitted_at : before.created_at;
      database.prepare('INSERT INTO mission_grant_events(id,store_id,grant_id,event_type,actor_id,reason,created_at,job_id,submit_intent_id,impact_cents) VALUES(?,?,?,?,?,?,?,?,?,?)')
        .run(`${job.id}:${type}`, job.store_id, grant.id, type, 'execution-ledger', 'Synthetic canary slot', time, job.id, intent, job.expected_bid_cents - job.target_bid_cents);
      database.prepare('INSERT INTO ad_execution_events VALUES(?,?,?,?,?,?,?,?,?,?)').run(`${job.id}:event:${i}`, job.store_id, job.batch_id, job.id, i + 1,
        i ? 'submitted' : 'submit_intent_recorded', i ? 'intent_written' : 'preflight', i ? 'submitted' : 'intent_written', job.created_session_generation, time);
    }
  }
}
