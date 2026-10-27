const { insist, same, readArtifact, timeWithin } = require('./v16-native-artifacts');
const { validateSearchObservation, elapsedFromTimer } = require('./v16-performance-memory-search-contract');

function verifySearchSample(sample, fixture, context, classification) {
  const outer = readArtifact(context.root, sample.receipt).json();
  insist(outer.kind === 'v16-nfr-operation-observation' && outer.metric === 'memory-search' && outer.fixture === fixture
    && outer.pid === sample.pid && outer.elapsedMs === sample.value
    && outer.metricDefinition === 'one-preselected-unique-hit-query' && outer.preparationExcluded === true
    && same(outer.comparisonCasesExcluded, ['zero-hit', 'restore-all'])
    && same(outer.packageIdentity, context.current.packageIdentity), 'NATIVE_MEMORY_SEARCH_OPERATION_RECEIPT_MISMATCH');
  const reference = outer.receipt?.memorySearch;
  insist(reference?.path && reference.sha256, 'NATIVE_MEMORY_SEARCH_OBSERVATION_REFERENCE_REQUIRED');
  const original = readArtifact(context.root, reference), observation = original.json();
  validateSearchObservation(observation);
  insist(observation.classification === classification
    && (classification === 'isolated-software-fixture' ? observation.formalAcceptanceEvidence === false : observation.formalAcceptanceEvidence !== false)
    && observation.sourceSha256 === context.identity.sourceSha256 && observation.fixture === fixture
    && same(observation.packageIdentity, context.current.packageIdentity)
    && observation.nativeBefore.pid === sample.pid && observation.nativeAfter.pid === sample.pid
    && same(outer.storeContext, observation.storeContext), 'NATIVE_MEMORY_SEARCH_IDENTITY_OR_CLASSIFICATION_MISMATCH');
  const hit = observation.cases.find(row => row.id === 'unique-hit');
  insist(elapsedFromTimer(hit) === sample.value && elapsedFromTimer(hit) === outer.elapsedMs && hit.startedAt === outer.startedAt && hit.finishedAt === outer.finishedAt,
    'NATIVE_MEMORY_SEARCH_MEASUREMENT_CHANGED');
  for (const test of observation.cases) {
    timeWithin(test.startedAt, context.execution, 'memory-search-start');
    timeWithin(test.finishedAt, context.execution, 'memory-search-end');
    const image = readArtifact(context.root, test.screenshot).bytes;
    insist(image.length > 32 && image.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))
      && image.readUInt32BE(16) > 0 && image.readUInt32BE(20) > 0, 'NATIVE_MEMORY_SEARCH_SCREENSHOT_INVALID');
  }
  readArtifact(context.root, reference); readArtifact(context.root, sample.receipt);
  return observation;
}
function verifyMemorySearchSample(sample, fixture, context) {
  verifySearchSample(sample, fixture, context, 'real-data-copy'); return true;
}
function verifySoftwareMemorySearchSample(sample, fixture, context) {
  verifySearchSample(sample, fixture, context, 'isolated-software-fixture'); return true;
}
function verifySearchSamples(samples, fixture, context, classification) {
  insist(Array.isArray(samples) && samples.length >= 3, 'NATIVE_MEMORY_SEARCH_THREE_SAMPLES_REQUIRED');
  const observations = samples.map(sample => verifySearchSample(sample, fixture, context, classification));
  insist(new Set(observations.map(value => value.nativeBefore.pid + '|' + value.nativeBefore.mainCreationTime)).size === samples.length
    && new Set(samples.map(sample => sample.receipt.sha256)).size === samples.length, 'NATIVE_MEMORY_SEARCH_INDEPENDENT_LAUNCHES_REQUIRED');
  return true;
}
function verifyMemorySearchSamples(samples, fixture, context) {
  return verifySearchSamples(samples, fixture, context, 'real-data-copy');
}
function verifySoftwareMemorySearchSamples(samples, fixture, context) {
  return verifySearchSamples(samples, fixture, context, 'isolated-software-fixture');
}
module.exports = { verifyMemorySearchSample, verifySoftwareMemorySearchSample, verifyMemorySearchSamples, verifySoftwareMemorySearchSamples };

