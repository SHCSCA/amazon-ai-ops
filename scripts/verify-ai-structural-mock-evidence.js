const fs = require('fs');
const path = require('path');

function pass(message) {
  console.log(`[PASS] ${message}`);
}

function fail(message) {
  console.error(`[FAIL] ${message}`);
  process.exitCode = 1;
}

function readEvidence(inputPath) {
  if (!inputPath) {
    throw new Error('Usage: node scripts/verify-ai-structural-mock-evidence.js <evidence-json>');
  }
  const resolved = path.resolve(inputPath);
  return { path: resolved, data: JSON.parse(fs.readFileSync(resolved, 'utf8')) };
}

function assertNoSecretLeak(serialized) {
  const suspicious = [
    /mock-structural-key-do-not-write/,
    /sk-[A-Za-z0-9_-]{16,}/,
    /Bearer\s+[A-Za-z0-9._~+/=-]{16,}/i,
    /deepseek[_-]?api[_-]?key["']?\s*[:=]\s*["'][^"']+/i,
  ];
  if (suspicious.some((pattern) => pattern.test(serialized))) {
    fail('evidence appears to contain an API secret or unredacted mock key');
  } else {
    pass('evidence does not contain obvious API secret patterns');
  }
}

function allPresent(checks) {
  return Array.isArray(checks) && checks.length > 0 && checks.every((check) => check.present === true);
}

const { path: evidencePath, data: evidence } = readEvidence(process.argv[2]);
const serialized = JSON.stringify(evidence);

if (evidence.kind === 'ai-openai-compatible-structural-mock') {
  pass('evidence kind is structural mock');
} else {
  fail(`unexpected evidence kind: ${evidence.kind}`);
}

if (evidence.status === 'STRUCTURAL_ONLY') {
  pass('status is STRUCTURAL_ONLY');
} else {
  fail(`unexpected status: ${evidence.status}`);
}

if (evidence.readinessImpact === 'NO_FINAL_READINESS_CREDIT' && evidence.finalReadinessCredit === false) {
  pass('evidence explicitly has no final readiness credit');
} else {
  fail('readiness impact does not block final readiness credit');
}

if (evidence.mockOnly === true && evidence.externalNetworkRequestMade === false && evidence.keyPresent === false) {
  pass('evidence is mock-only and did not use a real key or network');
} else {
  fail('mock-only safety flags are incomplete');
}

if (evidence.safety?.adWriteActionsPerformed === false && evidence.safety?.full8Started === false && evidence.safety?.appSettingsMutated === false) {
  pass('evidence reports no ad writes, full8 run, or app settings mutation');
} else {
  fail('safety flags do not prove isolated AI structural check');
}

if (allPresent(evidence.sourceChecks?.openAiCompatibleProvider)) {
  pass('OpenAI-compatible provider source has expected request/response hooks');
} else {
  fail('OpenAI-compatible provider source checks are incomplete');
}

if (allPresent(evidence.sourceChecks?.listingAiDraftFlow)) {
  pass('Listing AI draft source has expected AI success mapping hooks');
} else {
  fail('Listing AI draft source checks are incomplete');
}

if (
  evidence.requestShape?.method === 'POST'
  && /\/chat\/completions$/.test(evidence.requestShape?.url || '')
  && evidence.requestShape?.headers?.authorization === 'Bearer [redacted-mock-key]'
  && evidence.requestShape?.hasMessagesArray === true
  && evidence.requestShape?.usesOpenAiCompatibleTokenField === true
  && evidence.requestShape?.body?.response_format?.type === 'json_object'
) {
  pass('request shape matches OpenAI-compatible chat completions with JSON object output');
} else {
  fail('request shape is incomplete');
}

if (
  evidence.responseShape?.hasChoicesMessageContent === true
  && Number(evidence.responseShape?.usage?.total_tokens || 0) > 0
  && Number(evidence.responseShape?.parsedListingDraft?.suggestedTextLength || 0) > 0
  && Number(evidence.responseShape?.parsedListingDraft?.reasonLength || 0) > 0
  && evidence.responseShape?.parsedListingDraft?.evidenceWouldContainAiReason === true
  && evidence.responseShape?.parsedListingDraft?.sourceWouldBeAi === true
  && evidence.responseShape?.parsedListingDraft?.fallbackWouldBeCleared === true
) {
  pass('mock response shape can produce a non-fallback AI Listing draft');
} else {
  fail('mock response shape does not prove AI draft structural mapping');
}

assertNoSecretLeak(serialized);

if (process.exitCode) {
  console.error('\nNEEDS_WORK: AI structural mock evidence is incomplete.');
  process.exit(process.exitCode);
}

console.log(`\nAI_STRUCTURAL_MOCK_EVIDENCE verified: ${evidencePath}`);
