const { insist } = require('./v16-performance-artifacts');

const CONTEXT_FIELDS = Object.freeze(['storeId', 'browserProfileId', 'marketplace', 'currency', 'businessTimezone', 'businessDate', 'sessionGeneration']);
const INDEX_FIELDS = Object.freeze(['id', 'title', 'eventType', 'entityType', 'entityId', 'missionId', 'signal', 'intervention', 'expectedEffect', 'observedEffect', 'status']);
const PAGE_SIZE = 10;
const same = (left, right) => JSON.stringify(left) === JSON.stringify(right);

function contextIdentity(context) {
  insist(context && CONTEXT_FIELDS.every(field => field in context), 'NFR_MEMORY_SEARCH_CONTEXT_INCOMPLETE');
  insist(CONTEXT_FIELDS.filter(field => field !== 'sessionGeneration').every(field => typeof context[field] === 'string' && context[field].trim())
    && Number.isSafeInteger(context.sessionGeneration) && context.sessionGeneration >= 0, 'NFR_MEMORY_SEARCH_CONTEXT_INVALID');
  return CONTEXT_FIELDS.map(field => context[field]);
}
function assertEvents(events, context) {
  contextIdentity(context);
  insist(Array.isArray(events) && events.length > 0 && events.length <= 50000, 'NFR_MEMORY_SEARCH_NONEMPTY_LEDGER_REQUIRED');
  insist(new Set(events.map(event => event.id)).size === events.length
    && new Set(events.map(event => event.sequence)).size === events.length, 'NFR_MEMORY_SEARCH_DUPLICATE_EVENT');
  for (const event of events) insist(event.storeId === context.storeId && typeof event.id === 'string' && event.id
    && typeof event.title === 'string' && event.title.trim() && typeof event.stage === 'string'
    && Number.isSafeInteger(event.sequence) && typeof event.createdAt === 'string' && Number.isFinite(Date.parse(event.createdAt)),
  'NFR_MEMORY_SEARCH_LEDGER_IDENTITY_INVALID');
  return events;
}
function searchReference(events, query) {
  const needle = query.trim().toLowerCase();
  return events.filter(event => !needle || INDEX_FIELDS.map(field => event[field]).filter(Boolean).join('\n').toLowerCase().includes(needle));
}
function validateVisibleProjection(events, projection, context) {
  insist(Array.isArray(projection) && projection.length === Math.min(PAGE_SIZE, events.length),
    'NFR_MEMORY_SEARCH_FIRST_PAGE_PROJECTION_REQUIRED');
  projection.forEach((row, index) => {
    const event = events[index];
    insist(row.id === event.id && row.sequence === event.sequence && row.stage === event.stage
      && row.createdAt === event.createdAt && row.displayCreatedAt === event.createdAt.slice(0, 16).replace('T', ' ')
      && typeof row.title === 'string' && row.title.trim() === row.title && row.title
      && row.selectionProof?.sequence === event.sequence && row.selectionProof.title === row.title
      && row.selectionProof.selectedIndex === index && row.selectionProof.selected === true
      && row.selectionProof.authorityKey === contextIdentity(context).join('|')
      && row.selectionProof.diagnosticOpen === true && row.selectionProof.sequenceVisible === true
      && typeof row.selectionProof.diagnosticWasOpen === 'boolean'
      && row.selectionProof.diagnosticOpenedByObserver === !row.selectionProof.diagnosticWasOpen,
    'NFR_MEMORY_SEARCH_VISIBLE_ROW_ORDER_OR_IDENTITY_CHANGED');
  });
  return projection;
}
function projectedRows(events, projection) {
  const byId = new Map(projection.map(row => [row.id, row]));
  return events.map(event => ({ id: event.id, sequence: event.sequence, stage: event.stage, createdAt: event.createdAt,
    title: byId.get(event.id)?.title ?? null, displayCreatedAt: event.createdAt.slice(0, 16).replace('T', ' ') }));
}
const projectionKey = row => JSON.stringify([row.title, row.stage, row.displayCreatedAt]);
function createSearchCases(events, context, nonce, projection) {
  assertEvents(events, context); validateVisibleProjection(events, projection, context);
  insist(typeof nonce === 'string' && /^[a-zA-Z0-9-]{8,80}$/.test(nonce), 'NFR_MEMORY_SEARCH_NONCE_INVALID');
  const selected = projection.find(row => searchReference(events, row.id).length === 1
    && projection.filter(other => projectionKey(other) === projectionKey(row)).length === 1);
  insist(selected && events.length > 1, 'NFR_MEMORY_SEARCH_UNIQUE_VISIBLE_ORACLE_UNAVAILABLE:当前第一页没有可唯一核对的可见记录，请选择有区分度的真实数据后重试。');
  const absent = '__v16_absent_' + nonce + '__';
  insist(searchReference(events, absent).length === 0, 'NFR_MEMORY_SEARCH_ABSENT_QUERY_COLLISION');
  return [{ id: 'unique-hit', query: selected.id }, { id: 'zero-hit', query: absent }, { id: 'restore-all', query: '' }]
    .map(test => ({ ...test, expected: projectedRows(searchReference(events, test.query), projection) }));
}
function expectedDom(test) {
  return { query: test.query, total: test.expected.length, page: '1 / ' + Math.max(1, Math.ceil(test.expected.length / PAGE_SIZE)),
    titles: test.expected.slice(0, PAGE_SIZE).map(event => event.title), stages: test.expected.slice(0, PAGE_SIZE).map(event => event.stage),
    displayedTimes: test.expected.slice(0, PAGE_SIZE).map(event => event.displayCreatedAt) };
}
function assertSearchDom(snapshot, test, context) {
  const expected = expectedDom(test);
  insist(snapshot && snapshot.ready === true && snapshot.authorityKey === contextIdentity(context).join('|')
    && snapshot.query === expected.query && snapshot.total === expected.total && snapshot.page === expected.page
    && same(snapshot.titles, expected.titles) && same(snapshot.stages, expected.stages)
    && same(snapshot.displayedTimes, expected.displayedTimes)
    && snapshot.emptyVisible === (expected.total === 0), 'NFR_MEMORY_SEARCH_RESULT_NOT_SETTLED');
  return snapshot;
}
function assertNativeSearchIdentity(identity, initial) {
  insist(identity && identity.packaged === true && Number.isSafeInteger(identity.pid) && identity.pid > 0
    && Number.isSafeInteger(identity.rendererPid) && identity.rendererPid > 0
    && Number.isFinite(identity.mainCreationTime) && identity.mainCreationTime > 0
    && Number.isFinite(identity.rendererCreationTime) && identity.rendererCreationTime > 0
    && typeof identity.userDataDir === 'string' && identity.userDataDir
    && typeof identity.executablePath === 'string' && identity.executablePath
    && identity.visible === true && identity.windowCount === 1, 'NFR_MEMORY_SEARCH_NATIVE_IDENTITY_INVALID');
  if (initial) insist(same(identity, initial), 'NFR_MEMORY_SEARCH_NATIVE_IDENTITY_CHANGED');
  return identity;
}
function elapsedFromTimer(test) {
  const timer = test?.timer;
  insist(timer?.source === 'node:perf_hooks.performance' && timer.unit === 'ms'
    && Number.isSafeInteger(timer.processId) && timer.processId > 0 && Number.isFinite(timer.timeOriginMs) && timer.timeOriginMs > 0
    && Number.isFinite(timer.startedAtMs) && timer.startedAtMs >= 0
    && Number.isFinite(timer.finishedAtMs) && timer.finishedAtMs > timer.startedAtMs,
  'NFR_MEMORY_SEARCH_MONOTONIC_TIMER_REQUIRED');
  const elapsedMs = timer.finishedAtMs - timer.startedAtMs;
  insist(test.elapsedMs === elapsedMs, 'NFR_MEMORY_SEARCH_ELAPSED_NOT_DERIVED_FROM_TIMER');
  return elapsedMs;
}
function validateSearchObservation(value) {
  insist(value?.kind === 'v16-nfr-memory-search-observation' && value.schemaVersion === 1
    && ['isolated-software-fixture', 'real-data-copy'].includes(value.classification)
    && value.formalAcceptanceEvidence !== true && value.appReady === false
    && /^[a-f0-9]{64}$/i.test(value.sourceSha256 ?? '') && value.packageIdentity,
  'NFR_MEMORY_SEARCH_OBSERVATION_INVALID');
  insist(value.classification !== 'isolated-software-fixture' || value.formalAcceptanceEvidence === false,
    'NFR_MEMORY_SEARCH_SOFTWARE_CREDIT_BOUNDARY_INVALID');
  for (const key of ['executableSha256', 'appContentSha256', 'mainBundleSha256']) {
    insist(/^[a-f0-9]{64}$/i.test(value.packageIdentity[key] ?? ''), 'NFR_MEMORY_SEARCH_PACKAGE_INVALID');
  }
  assertNativeSearchIdentity(value.nativeBefore);
  assertNativeSearchIdentity(value.nativeAfter, value.nativeBefore);
  insist(same(contextIdentity(value.storeContext), contextIdentity(value.finalStoreContext))
    && /^[a-f0-9]{64}$/i.test(value.ledgerBeforeSha256 ?? '') && value.ledgerBeforeSha256 === value.ledgerAfterSha256,
  'NFR_MEMORY_SEARCH_AUTHORITY_OR_LEDGER_CHANGED');
  const reference = assertEvents(value.reference?.events, value.storeContext);
  insist(require('./v16-performance-artifacts').digest(Buffer.from(JSON.stringify(reference))) === value.ledgerBeforeSha256,
    'NFR_MEMORY_SEARCH_REFERENCE_HASH_CHANGED');
  insist(Array.isArray(value.cases) && same(value.cases.map(row => row.id), ['unique-hit', 'zero-hit', 'restore-all']),
    'NFR_MEMORY_SEARCH_CASE_INVENTORY_INVALID');
  const projection = validateVisibleProjection(reference, value.visibleProjection, value.storeContext);
  let previous = { id: 'baseline', query: '', expected: projectedRows(reference, projection) };
  assertSearchDom(value.baselineDom, previous, value.storeContext);
  let previousFinishedAt = -Infinity, previousMonotonicEnd = -Infinity;
  let timerIdentity;
  for (const test of value.cases) {
    elapsedFromTimer(test);
    const currentTimerIdentity = [test.timer.source, test.timer.processId, test.timer.timeOriginMs, test.timer.unit];
    insist(!timerIdentity || same(timerIdentity, currentTimerIdentity), 'NFR_MEMORY_SEARCH_TIMER_IDENTITY_CHANGED');
    insist(test.timer.startedAtMs >= previousMonotonicEnd, 'NFR_MEMORY_SEARCH_TIMER_ORDER_CHANGED');
    timerIdentity = currentTimerIdentity; previousMonotonicEnd = test.timer.finishedAtMs;
    const matching = searchReference(reference, test.query);
    const expected = projectedRows(matching, projection);
    insist(test.id === 'unique-hit' ? matching.length === 1 && test.query === matching[0].id
      && projection.some(row => row.id === matching[0].id)
      && projection.filter(row => projectionKey(row) === projectionKey(expected[0])).length === 1
      : test.id === 'zero-hit' ? matching.length === 0 && test.query.trim() : test.query === '',
    'NFR_MEMORY_SEARCH_QUERY_CASE_CHANGED');
    if (test.id === 'unique-hit') insist(test.selectedResult?.sequence === expected[0].sequence
      && test.selectedResult.title === expected[0].title && test.selectedResult.selectedIndex === 0
      && test.selectedResult.selected === true && test.selectedResult.authorityKey === contextIdentity(value.storeContext).join('|')
      && test.selectedResult.diagnosticOpen === true && test.selectedResult.sequenceVisible === true
      && typeof test.selectedResult.diagnosticWasOpen === 'boolean'
      && test.selectedResult.diagnosticOpenedByObserver === !test.selectedResult.diagnosticWasOpen,
    'NFR_MEMORY_SEARCH_HIT_RESULT_IDENTITY_CHANGED');
    insist(same(test.expected, expected), 'NFR_MEMORY_SEARCH_EXPECTED_ROWS_CHANGED');
    insist(Number.isFinite(test.elapsedMs) && test.elapsedMs > 0 && test.unit === 'ms'
    && test.window === 'input-to-filtered-render-two-frames'
      && Date.parse(test.startedAt) >= previousFinishedAt
      && Date.parse(test.startedAt) <= Date.parse(test.finishedAt) && test.query !== test.before.query,
    'NFR_MEMORY_SEARCH_NOOP_OR_TIMING_INVALID');
    assertSearchDom(test.before, previous, value.storeContext);
    assertSearchDom(test.after, test, value.storeContext);
    previous = test; previousFinishedAt = Date.parse(test.finishedAt);
  }
  return { softwareObserved: true, formalAcceptanceEvidence: false, cases: 3 };
}
function summarizeSearchObservations(records, sampleCount) {
  insist(Number.isSafeInteger(sampleCount) && sampleCount >= 3, 'NFR_MEMORY_SEARCH_THREE_NATIVE_SAMPLES_REQUIRED');
  const result = [];
  for (const fixture of ['typical', 'maximum']) {
    const rows = records.filter(row => row.fixture === fixture);
    insist(rows.length >= sampleCount && new Set(rows.map(row => row.sampleIndex)).size === rows.length,
      'NFR_MEMORY_SEARCH_NATIVE_SAMPLE_INVENTORY_INVALID');
    insist(new Set(rows.map(row => row.observation.nativeBefore.pid + '|' + row.observation.nativeBefore.mainCreationTime)).size === rows.length,
      'NFR_MEMORY_SEARCH_INDEPENDENT_NATIVE_LAUNCHES_REQUIRED');
    for (const row of rows) validateSearchObservation(row.observation);
    result.push({ fixture, sampleCount: rows.length, casesPerSample: 3,
      unit: 'ms', window: 'input-to-filtered-render-two-frames', status: 'MEASURED',
      observations: rows.map(row => row.receipt) });
  }
  return { kind: 'v16-memory-search-software-summary', schemaVersion: 1, status: 'MEASURED',
    formalAcceptanceEvidence: false, appReady: false, fixtures: result };
}
module.exports = { CONTEXT_FIELDS, INDEX_FIELDS, PAGE_SIZE, same, contextIdentity, assertEvents, searchReference,
  validateVisibleProjection, projectedRows, createSearchCases, expectedDom, elapsedFromTimer, assertSearchDom, assertNativeSearchIdentity, validateSearchObservation, summarizeSearchObservations };

