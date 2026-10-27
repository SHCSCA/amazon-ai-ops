const { captureWorkspaceEvidence, runWorkspaceEvidenceTargets } = require('./workspace-ui-capture-capture.js');
const { collectWorkspaceDomMetrics } = require('./workspace-ui-capture-dom.js');
const { collectWorkspaceStateEvidence, prepareWorkspaceVisualState } = require('./workspace-ui-capture-state.js');
const { normalizeWorkspaceEvidenceConfig, parseWorkspaceEvidenceArgs } = require('./workspace-ui-capture-contracts.js');
module.exports = { captureWorkspaceEvidence, collectWorkspaceDomMetrics, collectWorkspaceStateEvidence, normalizeWorkspaceEvidenceConfig, parseWorkspaceEvidenceArgs, prepareWorkspaceVisualState, runWorkspaceEvidenceTargets };
