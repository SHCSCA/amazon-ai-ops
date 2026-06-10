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
    throw new Error('Usage: node scripts/verify-listing-ai-draft-evidence.js <evidence-json>');
  }
  const resolved = path.resolve(inputPath);
  return { path: resolved, data: JSON.parse(fs.readFileSync(resolved, 'utf8')) };
}

function assertNoSecretLeak(serialized) {
  const suspicious = [
    /sk-[A-Za-z0-9_-]{16,}/,
    /Bearer\s+[A-Za-z0-9._~+/=-]{16,}/i,
    /deepseek[_-]?api[_-]?key["']?\s*[:=]\s*["'][^"']+/i,
  ];
  if (suspicious.some((pattern) => pattern.test(serialized))) {
    fail('evidence appears to contain an API secret');
  } else {
    pass('evidence does not contain obvious API secret patterns');
  }
}

const { path: evidencePath, data: evidence } = readEvidence(process.argv[2]);
const serialized = JSON.stringify(evidence);

if (evidence.kind === 'installed-listing-ai-draft') {
  pass('evidence kind is installed-listing-ai-draft');
} else {
  fail(`unexpected evidence kind: ${evidence.kind}`);
}

if (evidence.safety?.adWriteActionsPerformed === false && evidence.safety?.full8Started === false) {
  pass('evidence reports no ad writes and no full-8 report run');
} else {
  fail('evidence safety flags do not prove AI-draft-only execution');
}

if (evidence.safety?.listingAiDraftOnly === true) {
  pass('evidence is marked listingAiDraftOnly');
} else {
  fail('listingAiDraftOnly safety flag missing');
}

if (!Array.isArray(evidence.errors) || evidence.errors.length === 0) {
  pass('runner reported no top-level errors');
} else {
  fail(`runner reported errors: ${evidence.errors.join('; ')}`);
}

if (evidence.ai?.keyPresent === true && evidence.ai?.testSuccess === true && evidence.ai?.status === 'PASS') {
  pass(`AI provider connected and draft gate passed for ${evidence.ai.model}`);
} else {
  fail(`AI provider/draft status is not PASS: ${evidence.ai?.status || 'missing'}`);
}

const draftEvidence = evidence.listingAiDraft;
if (draftEvidence?.suggestion?.status === 'accepted') {
  pass('AI draft was generated from an accepted Listing suggestion');
} else {
  fail('accepted Listing suggestion proof is missing');
}

const drafts = Array.isArray(draftEvidence?.drafts) ? draftEvidence.drafts : [];
const aiDrafts = drafts.filter((draft) =>
  draft.source === 'ai'
  && draft.hasFallback === false
  && draft.evidenceHasAiReason === true
  && Number(draft.draftedTextLength) > 0
);
if (aiDrafts.length > 0) {
  pass(`AI Listing draft produced without fallback: ${aiDrafts.length}`);
} else {
  fail('no AI Listing draft proved source=ai, no fallback, AI reason, and drafted text');
}

if (draftEvidence?.settingsRestored === true) {
  pass('AI settings were restored after the proof run');
} else {
  fail('AI settings restore proof is missing');
}

assertNoSecretLeak(serialized);

if (process.exitCode) {
  console.error('\nNEEDS_WORK: Listing AI draft evidence is incomplete.');
  process.exit(process.exitCode);
}

console.log(`\nLISTING_AI_DRAFT_EVIDENCE verified: ${evidencePath}`);
