const { insist } = require('./v16-native-artifacts');
const path = require('node:path');
const INDEPENDENT_AUTHORITY_FIELDS = Object.freeze(['authorityId', 'missionGrantId', 'batchId', 'jobId', 'proposalId', 'decisionId']);

// 只比较已通过专用 DB/原件验证的两套 canary，不能单独提供验收信用。
function verifyCanaryIndependence(verifiedReports, validations) {
  const reports = verifiedReports.filter(report => report.kind === 'mission-control-execution-canary-evidence');
  const manual = reports.filter(report => report.mode === 'manual_approval');
  const policy = reports.filter(report => report.mode === 'policy_auto');
  insist(manual.length === 1 && policy.length === 1, 'INDEPENDENT_CANARY_MODES_REQUIRED');
  for (const key of INDEPENDENT_AUTHORITY_FIELDS) {
    const left = manual[0].authority?.[key], right = policy[0].authority?.[key];
    insist(typeof left === 'string' && left.trim() && typeof right === 'string' && right.trim() && left !== right, 'CANARIES_NOT_INDEPENDENT:' + key);
  }
  const proofs = [manual[0], policy[0]].map(report => validations?.get(report));
  insist(proofs.every(proof => proof?.ok === true), 'VERIFIED_CANARY_DATABASE_PROOFS_REQUIRED');
  const intents = proofs.map(proof => proof.canaryBinding?.submitIntentId);
  insist(intents.every(value => typeof value === 'string' && value.trim()) && intents[0] !== intents[1], 'CANARIES_NOT_INDEPENDENT:submitIntentId');
  const evidence = [manual[0], policy[0]].map((report, index) => {
    const records = report.execution?.evidence, originals = proofs[index].verifiedPngArtifacts;
    insist(records?.length === 3 && originals?.length === 3 && ['before', 'after', 'reload'].every(slot => records.filter(record => record.slot === slot).length === 1
      && originals.filter(record => record.slot === slot).length === 1), 'INDEPENDENT_CANARY_ORIGINALS_REQUIRED');
    return records.map(record => ({ ...record, original: originals.find(original => original.slot === record.slot) }));
  });
  const keys = {
    evidenceId: record => record.id,
    artifactRef: record => record.artifactRef,
    artifactPath: record => path.resolve(record.original.filePath).toLowerCase(),
    contentSha256: record => record.original.sha256?.toLowerCase(),
    fileIdentity: record => record.original.fileIdentity && `${record.original.fileIdentity.dev}:${record.original.fileIdentity.ino}`,
  };
  for (const [key, select] of Object.entries(keys)) {
    const values = evidence.flat().map(select);
    insist(values.every(value => typeof value === 'string' && value.trim()) && new Set(values).size === 6, 'CANARIES_SHARE_EXECUTION_ORIGINAL:' + key);
  }
  return true;
}
module.exports = { INDEPENDENT_AUTHORITY_FIELDS, verifyCanaryIndependence };
