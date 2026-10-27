const { PERFORMANCE_METRICS } = require('./v16-native-scenario-adapters');

const EXTERNAL_AI_METRICS = Object.freeze(['ai-latency', 'ai-timeout', 'ai-call-count', 'ai-token-count', 'ai-cost', 'offline-fallback']);
const SOFTWARE_METRICS = Object.freeze(PERFORMANCE_METRICS.filter(metric => !EXTERNAL_AI_METRICS.includes(metric)));
function captureStatus(targets, measurements, issues) {
  const key = row => `${row.metric}/${row.fixture}/${row.percentile}`;
  const actual = new Set(measurements.map(key));
  const group = metrics => {
    const required = targets.filter(row => metrics.includes(row.metric));
    const relevantIssues = issues.filter(issue => !issue.metric || metrics.includes(issue.metric));
    const missing = required.filter(row => !actual.has(key(row))).map(key);
    return { status: missing.length === 0 && relevantIssues.length === 0 ? 'MEASURED' : 'INCOMPLETE',
      metrics: [...metrics], requiredTargets: required.length, measuredTargets: required.length - missing.length,
      missing, issues: relevantIssues };
  };
  return { software: group(SOFTWARE_METRICS), externalAi: group(EXTERNAL_AI_METRICS),
    formalAcceptanceEvidence: false, appReady: false };
}
module.exports = { EXTERNAL_AI_METRICS, SOFTWARE_METRICS, captureStatus };
