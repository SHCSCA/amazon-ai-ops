const fs = require('fs');
const path = require('path');

const root = path.resolve(__dirname, '..');
const evidenceDir = path.join(root, 'output', 'codex-evidence');

function latestEvidence() {
  if (!fs.existsSync(evidenceDir)) return null;
  return fs.readdirSync(evidenceDir)
    .filter((name) => /^installed-listing-read-.*\.json$/.test(name))
    .map((name) => path.join(evidenceDir, name))
    .sort((a, b) => fs.statSync(b).mtimeMs - fs.statSync(a).mtimeMs)[0] || null;
}

function fail(message) {
  console.error(`[FAIL] ${message}`);
  process.exitCode = 1;
}

function pass(message) {
  console.log(`[PASS] ${message}`);
}

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, 'utf8'));
}

const evidencePath = process.argv[2] ? path.resolve(process.argv[2]) : latestEvidence();
if (!evidencePath || !fs.existsSync(evidencePath)) {
  console.error('NEEDS_WORK: listing-read evidence file is missing. Run run:v15-installed-live -- --mode listing-read first.');
  process.exit(2);
}

const evidence = readJson(evidencePath);
const result = evidence.listingRead || {};
const listing = result.listing || {};
const readEvidence = result.evidence || {};
const completeness = readEvidence.completeness || {};

if (evidence.kind === 'installed-live-diagnostic' || evidence.kind === 'desktop-live-full-8-e2e') {
  fail(`unexpected evidence kind: ${evidence.kind}`);
} else {
  pass('evidence kind is listing-read compatible');
}

if (evidence.safety?.adWriteActionsPerformed === false && evidence.safety?.full8Started === false && evidence.safety?.listingReadOnly === true) {
  pass('listing read evidence is marked read-only');
} else {
  fail('read-only safety flags are missing or unsafe');
}

if (Array.isArray(evidence.errors) && evidence.errors.length === 0) {
  pass('runner reported no top-level errors');
} else {
  fail(`runner errors present: ${(evidence.errors || []).join('; ')}`);
}

if (result.ready === true) {
  pass('listing extraction returned ready=true');
} else {
  fail(`listing extraction not ready: ${result.reason || 'no reason'}`);
}

if (result.fullContentReady === true || readEvidence.fullContentReady === true) {
  pass('listing extraction returned fullContentReady=true');
} else {
  fail('listing extraction is only partial; fullContentReady is not true');
}

if (/^B0[A-Z0-9]{8}$/i.test(listing.asin || '')) {
  pass(`ASIN extracted: ${listing.asin}`);
} else {
  fail('valid ASIN was not extracted');
}

if (typeof listing.title === 'string' && listing.title.trim().length >= 5) {
  pass('title extracted');
} else {
  fail('title was not extracted');
}

if (Array.isArray(listing.bullets) && listing.bullets.length > 0) {
  pass(`bullet fields extracted: ${listing.bullets.length}`);
} else {
  fail('bullet fields were not extracted');
}

if (typeof listing.backendTerms === 'string' && listing.backendTerms.trim().length > 0) {
  pass('backend terms extracted');
} else {
  fail('backend terms were not extracted');
}

if (completeness.asin && completeness.title && completeness.bullets && completeness.backendTerms) {
  pass('required full-content completeness fields passed');
} else {
  fail('required full-content completeness fields did not pass');
}

if (typeof readEvidence.pageUrl === 'string' && /^https:\/\/(erp|ads)\.lingxing\.com\//.test(readEvidence.pageUrl)) {
  pass('pageUrl is a sanitized Lingxing URL');
} else {
  fail('pageUrl is missing or not Lingxing');
}

if (
  readEvidence.detailProbe?.clicked === true
  || /(edit|detail|view|listing\/edit|product|goods|spu|sku|详情|编辑|查看)/i.test(readEvidence.pageUrl || '')
) {
  pass('evidence comes from a detail/edit page or a recorded detail probe');
} else {
  fail('evidence does not prove a detail/edit page or detail probe was used');
}

if (typeof readEvidence.screenshotPath === 'string' && fs.existsSync(readEvidence.screenshotPath)) {
  pass('listing read screenshot exists');
} else {
  fail('listing read screenshot is missing');
}

if (process.exitCode) {
  console.error('\nNEEDS_WORK: Lingxing Listing read evidence is incomplete.');
  process.exit(process.exitCode);
}

console.log(`\nLISTING_READ_EVIDENCE verified: ${evidencePath}`);
