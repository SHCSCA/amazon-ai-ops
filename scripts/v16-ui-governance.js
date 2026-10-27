const fs = require('node:fs');
const path = require('node:path');
const { createHash } = require('node:crypto');
const { createRuntimeLogRecord } = require('../packages/shared-types/src/runtime-log-format.cjs');

const SOURCE = 'docs/v16_companion_verification_traceability.md';
const REQUIRED_PRIMITIVES = ['App Shell / sidebar', 'WorkspaceSubviewShell', 'PageFrame / TaskBanner', 'ReasonRequiredDialog',
  'ResponsiveInspector', 'PriorityDataTable / virtual table', 'WorkspaceState / status', 'FormTable / controls', 'Progress / motion', 'Store / AI settings'];
const REQUIRED_TERMS = ['Mission', 'Analysis Run', 'Decision', 'MissionGrant', 'Experiment', 'READBACK / EFFECT', 'UNKNOWN',
  'manual_approval / policy_auto', 'StoreContext / session generation / revision', 'rule / rule_ai / ai / rule_fallback'];

function insist(condition, code) { if (!condition) throw new Error(code); }
function section(markdown, heading) {
  const start = markdown.indexOf(`## ${heading}\n`);
  insist(start >= 0, 'UI_GOVERNANCE_SECTION_MISSING');
  const end = markdown.indexOf('\n## ', start + heading.length + 4);
  return markdown.slice(start, end < 0 ? undefined : end);
}
function rows(text) {
  return text.split('\n').filter(line => line.startsWith('|')).slice(2).map(line => line.split('|').slice(1, -1).map(cell => cell.trim()));
}
function exactInventory(actual, required, code) {
  insist(new Set(actual).size === actual.length && actual.length === required.length
    && required.every(value => actual.includes(value)), code);
}

function parseUiGovernance(markdown) {
  insist(typeof markdown === 'string', 'UI_GOVERNANCE_TEXT_REQUIRED');
  const normalized = markdown.replace(/\r\n/g, '\n');
  const terms = section(normalized, 'UI 术语表');
  const register = section(normalized, 'Accessibility Delta Register');
  insist(terms.includes('`v16.ui-terminology/1`'), 'UI_TERMINOLOGY_VERSION_MISMATCH');
  insist(register.includes('`v16.accessibility-delta/1`') && register.includes('v1.5.1'), 'ACCESSIBILITY_REGISTER_VERSION_MISMATCH');
  const terminology = rows(terms).map(cells => {
    insist(cells.length === 3 && cells.every(Boolean), 'UI_TERMINOLOGY_ROW_INVALID');
    return { term: cells[0], operatorCopy: cells[1], allowedLocation: cells[2] };
  });
  exactInventory(terminology.map(row => row.term), REQUIRED_TERMS, 'UI_TERMINOLOGY_INVENTORY_MISMATCH');
  const accessibility = rows(register).map(cells => {
    insist(cells.length === 8 && cells.every(Boolean), 'ACCESSIBILITY_REGISTER_ROW_INVALID');
    const [primitive, interactionRisk, keyboardFocusRisk, screenReaderRisk, motionZoomRisk, method, owner, status] = cells;
    insist(['PENDING', 'PASS', 'FAIL'].includes(status), 'ACCESSIBILITY_REGISTER_STATUS_INVALID');
    insist(!/待定|未指派|unknown|todo/i.test(owner), 'ACCESSIBILITY_REGISTER_OWNER_REQUIRED');
    return { primitive, interactionRisk, keyboardFocusRisk, screenReaderRisk, motionZoomRisk, method, owner, status };
  });
  exactInventory(accessibility.map(row => row.primitive), REQUIRED_PRIMITIVES, 'ACCESSIBILITY_REGISTER_INVENTORY_MISMATCH');
  insist(register.includes('源码测试通过不自动改为 PASS') && register.includes('不声明屏幕阅读器通过或 WCAG 等级'), 'ACCESSIBILITY_UNVERIFIED_CLAIM_BOUNDARY_MISSING');
  return { terminologyVersion: 'v16.ui-terminology/1', terminology, accessibilityVersion: 'v16.accessibility-delta/1',
    baseline: '1.5.1', accessibility, sourceSha256: createHash('sha256').update(markdown).digest('hex') };
}

function readUiGovernance(root) { return parseUiGovernance(fs.readFileSync(path.resolve(root, SOURCE), 'utf8')); }
module.exports = { SOURCE, REQUIRED_PRIMITIVES, REQUIRED_TERMS, parseUiGovernance, readUiGovernance };
if (require.main === module) {
  try {
    const result = readUiGovernance(process.cwd());
    process.stdout.write(JSON.stringify({ ...createRuntimeLogRecord('info', 'v16.ui_governance_checked'),
      terminologyVersion: result.terminologyVersion, accessibilityVersion: result.accessibilityVersion,
      primitiveCount: result.accessibility.length, currentPackageStatus: result.accessibility.every(row => row.status === 'PASS') ? 'REQUIRES_NATIVE_EVIDENCE' : 'PENDING' }) + '\n');
  } catch {
    process.stderr.write(JSON.stringify(createRuntimeLogRecord('error', 'v16.ui_governance_failed', { code: 'UI_GOVERNANCE_CONTRACT_INVALID' })) + '\n');
    process.exitCode = 1;
  }
}
