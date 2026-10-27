const { EXPECTED_MISSION_CONTROL_SCALES, EXPECTED_MISSION_CONTROL_STORE_IDS, EXPECTED_MISSION_CONTROL_WORKSPACES, MISSION_CONTROL_UI_EVIDENCE_KIND, MISSION_CONTROL_UI_EVIDENCE_JSON_SCHEMA, MISSION_CONTROL_UI_EVIDENCE_SCHEMA_VERSION, MISSION_CONTROL_WORKSPACE_CONTRACT, canonicalMissionControlEvidenceJson, fingerprintMissionControlEvidenceValue, missionControlBusinessFactSentinels } = require('./mission-ui-contract-contracts.js');
const { currentMissionControlUiEvidenceSourceHashes, isAbsoluteScreenshotPath, isSha256 } = require('./mission-ui-contract-artifacts.js');
const { evaluateMissionControlUiEvidenceManifest, main, validateMissionControlUiEvidenceManifest } = require('./mission-ui-contract-publication.js');
const { validateMinimumWindowCapture } = require('./mission-ui-contract-isolation.js');
if (require.main === module) {
  const report = error => { process.stderr.write(JSON.stringify(require('../packages/shared-types/src/runtime-log-format.cjs').createRuntimeLogRecord('error', 'mission.ui.contract.failed', { error })) + '\n'); process.exitCode = 1; };
  try { main(); } catch (error) { report(error); }
}

module.exports = { EXPECTED_MISSION_CONTROL_SCALES, EXPECTED_MISSION_CONTROL_STORE_IDS, EXPECTED_MISSION_CONTROL_WORKSPACES, MISSION_CONTROL_UI_EVIDENCE_KIND, MISSION_CONTROL_UI_EVIDENCE_JSON_SCHEMA, MISSION_CONTROL_UI_EVIDENCE_SCHEMA_VERSION, MISSION_CONTROL_WORKSPACE_CONTRACT, canonicalMissionControlEvidenceJson, currentMissionControlUiEvidenceSourceHashes, evaluateMissionControlUiEvidenceManifest, fingerprintMissionControlEvidenceValue, isAbsoluteScreenshotPath, isSha256, main, missionControlBusinessFactSentinels, validateMissionControlUiEvidenceManifest, validateMinimumWindowCapture };
