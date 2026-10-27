const path = require('node:path');
const { insist, readArtifact, same, within } = require('./v16-native-artifacts');
const { readBound } = require('./v16-performance-artifacts');
const { validateEvidenceUserDataPath } = require('./evidence-user-data');
const { validateFixtureWindowMetadata, canonicalProfilePath } = require('./v16-evidence-growth-window');
const { verifyDailyEvidenceBudget } = require('./v16-performance-daily-evidence');

function createScopedDailyArtifactLoader(context, fixtureContracts) {
  const admittedOwners = new Map();
  const key = record => {
    insist(typeof record?.path === 'string' && /^[a-f0-9]{64}$/i.test(record.sha256 ?? ''), 'NATIVE_DAILY_EVIDENCE_BOUND_ARTIFACT_REQUIRED');
    return path.resolve(context.root, record.path).toLowerCase() + '|' + record.sha256.toLowerCase();
  };
  function admitOwner(container) {
    const plan = readArtifact(context.root, container.plan).json();
    const contract = readArtifact(context.root, plan.fixtureContract).json();
    const volume = fixtureContracts.find(row => row.fixture === plan.fixture);
    insist(plan.binding?.sourceSha256 === context.identity.sourceSha256
      && same(plan.binding.packageIdentity, context.current.packageIdentity) && volume
      && plan.fixtureContract?.sha256 === (volume.contractSha256 ?? volume.sha256), 'NATIVE_DAILY_EVIDENCE_OWNER_CURRENT_SCOPE_REQUIRED');
    const ownerPath = path.resolve(context.root, plan.owner?.path ?? '');
    if (within(context.root, ownerPath)) return;
    const profile = validateEvidenceUserDataPath(plan.profile), parent = path.dirname(profile);
    insist(path.basename(ownerPath).toLowerCase() === 'owner.json'
      && canonicalProfilePath(path.dirname(ownerPath)) === canonicalProfilePath(parent),
    'NATIVE_DAILY_EVIDENCE_OWNER_PATH_NOT_SCOPED');
    const owner = readBound({ ...plan.owner, path: ownerPath }).json();
    validateFixtureWindowMetadata(plan, contract, owner);
    // 仅这份已验证owner原件使用明确父根，仍由外层原件账记录并在结束时复核。
    readArtifact(context.root, plan.owner, parent);
    admittedOwners.set(key(plan.owner), parent);
  }
  return record => {
    const parent = admittedOwners.get(key(record));
    const original = parent ? readArtifact(context.root, record, parent) : readArtifact(context.root, record);
    const value = original.json();
    if (value?.kind === 'v16-evidence-growth-window-artifacts') admitOwner(value);
    return original;
  };
}
function verifyFormalDailyEvidenceGrowth(raw, budget, context) {
  insist(raw.dailyEvidenceGrowth?.status === 'OBSERVED', 'NATIVE_DAILY_EVIDENCE_REAL_WINDOWS_REQUIRED');
  const contracts = raw.fixtureClassifications;
  insist(Array.isArray(contracts) && contracts.length === 2
    && contracts.every(row => row.classification === 'real-data-copy' && Array.isArray(row.storeIds) && row.storeIds.length > 0),
  'NATIVE_DAILY_EVIDENCE_REAL_FIXTURE_STORE_CONTRACT_REQUIRED');
  insist(same(raw.packageIdentity, context.current.packageIdentity)
    && raw.sourceSha256 === context.identity.sourceSha256, 'NATIVE_DAILY_EVIDENCE_SOURCE_OR_PACKAGE_MISMATCH');
  return verifyDailyEvidenceBudget(raw.dailyEvidenceGrowth, budget.dailyEvidenceGrowth, {
    ...context, fixtureContracts: contracts, load: createScopedDailyArtifactLoader(context, contracts),
  });
}
module.exports = { createScopedDailyArtifactLoader, verifyFormalDailyEvidenceGrowth };

