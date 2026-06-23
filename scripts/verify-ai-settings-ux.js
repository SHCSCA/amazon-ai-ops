const fs = require('fs');
const path = require('path');

const root = path.resolve(__dirname, '..');

function read(relativePath) {
  return fs.readFileSync(path.join(root, relativePath), 'utf8');
}

function pass(message) {
  console.log(`[PASS] ${message}`);
}

function fail(message) {
  console.error(`[FAIL] ${message}`);
  process.exitCode = 1;
}

function expectContains(source, needle, message) {
  if (source.includes(needle)) {
    pass(message);
  } else {
    fail(`${message} missing: ${needle}`);
  }
}

function expectNotContains(source, needle, message) {
  if (!source.includes(needle)) {
    pass(message);
  } else {
    fail(`${message} still present: ${needle}`);
  }
}

const main = read('apps/desktop/src/main/index.ts');
const preload = read('apps/desktop/src/preload/index.ts');
const settingsPage = read('apps/desktop/src/renderer/pages/settings-page.tsx');
const recommendationsPage = read('apps/desktop/src/renderer/pages/recommendations-page.tsx');
const adQuantPage = read('apps/desktop/src/renderer/pages/ad-quant-page.tsx');
const approvalPage = read('apps/desktop/src/renderer/pages/approval-page.tsx');
const aiCallDiagnostics = read('apps/desktop/src/renderer/ai-call-diagnostics.ts');
const aiSettingsNormalization = read('apps/desktop/src/main/ai-settings-normalization.ts');
const aiProvider = read('packages/ai-adapter/src/openai-compatible.ts');
const aiProviderTest = read('packages/ai-adapter/src/openai-compatible.test.ts');
const adStrategyDiagnosis = read('packages/ai-adapter/src/ad-strategy-diagnosis.ts');
const adActionReason = read('packages/ai-adapter/src/ad-action-reason.ts');
const listingDraftMain = read('apps/desktop/src/main/index.ts');
const liveVerifier = read('scripts/verify-ai-live-connection.js');
const liveWrapper = read('scripts/verify-ai-live.js');
const installedRunner = read('scripts/run-v15-installed-live.js');

expectContains(main, "ipcMain.handle('settings:test-ai'", 'desktop main registers AI test IPC');
expectContains(main, 'handleTestAiSettings', 'desktop main has structured AI test handler');
expectContains(aiSettingsNormalization, 'https://api.deepseek.com', 'AI defaults use DeepSeek base URL');
expectContains(main, 'deepseek-v4-flash', 'AI defaults use current DeepSeek flash model');
expectContains(main, 'normalizeAiSettings', 'desktop main normalizes AI settings schema');
expectContains(main, 'aiApiKey: config.apiKey', 'desktop main writes canonical camelCase AI key');
expectContains(main, 'ai_api_key: config.apiKey', 'desktop main writes canonical snake_case AI key');
expectContains(main, "ipcMain.handle('settings:get', () => sanitizeAiSettingsForRenderer", 'settings:get returns sanitized normalized AI settings');
expectContains(main, 'state.settingsRepo?.save(normalizeAiSettings', 'settings:save persists normalized AI settings');
expectContains(main, '未配置 AI Key', 'AI test returns operator-facing missing-key message');
expectContains(main, 'AI 调用异常', 'Listing AI generation falls back on provider exceptions');
expectContains(main, 'AdActionReasonExplainer', 'desktop main wires AI explanation into ad recommendations');
expectContains(main, 'enrichAdRecommendationsWithAiExplanations', 'desktop main has ad recommendation AI explanation enrichment');
expectNotContains(main, "throw new Error('Not logged in');", 'ad recommendation generation no longer requires a Lingxing browser login after real reports are imported');
expectContains(main, 'RECOMMENDATION_METRIC_LOAD_LIMIT', 'ad recommendation generation loads enough range data before applying presentation limits');
expectContains(main, '未配置 AI Key，广告建议解释使用规则引擎', 'ad recommendation generation records no-key AI fallback');
expectContains(main, 'explanationSource', 'ad recommendation generation records AI/rule explanation source');
expectContains(main, "ipcMain.handle('settings:ai-call-logs'", 'desktop main exposes AI call audit logs');
expectContains(main, 'aiDiagnosisRunRepo?.insert', 'desktop main records AI diagnosis run evidence');
expectContains(preload, 'testAiSettings', 'preload exposes AI test IPC safely');
expectContains(preload, 'listAiCallLogs', 'preload exposes AI call audit logs safely');
expectContains(liveVerifier, "buildOpenAiCompatibleUrl(baseUrl, '/chat/completions')", 'AI live verifier uses same baseUrl + chat/completions rule as app provider');
expectNotContains(liveVerifier, 'baseUrl}/v1/chat/completions', 'AI live verifier no longer hardcodes /v1 for DeepSeek');
expectContains(liveWrapper, "require('./verify-ai-live-connection')", 'compatibility wrapper scripts/verify-ai-live.js exists');
expectContains(installedRunner, 'aiApiKey: key.value', 'installed runner writes camelCase AI key');
expectContains(installedRunner, 'ai_api_key: key.value', 'installed runner writes snake_case AI key');
expectContains(installedRunner, 'listing-ai-draft-settings-applied', 'installed runner verifies AI settings were applied before draft generation');
expectContains(installedRunner, 'keyAccepted', 'installed runner accepts sanitized hidden-key settings after save');
expectContains(installedRunner, 'aiKeyConfigured', 'installed runner checks sanitized AI key configured flag instead of requiring plaintext key echo');
expectContains(installedRunner, 'rejectedRecommendations', 'installed runner separates stale or non-executable AI explanations from valid evidence recommendations');
expectContains(installedRunner, 'validAiExplainedRecommendations', 'installed runner records valid AI explanation count separately');
expectContains(installedRunner, 'previousKeyConfigured', 'installed runner can use an already-saved hidden AI key');
expectContains(installedRunner, 'storedKeyAccepted', 'installed runner records when saved hidden AI key is accepted');
expectContains(installedRunner, 'AI 生成需要真实 DeepSeek/OpenAI Key', 'installed runner fails after settings inspection when no AI key is available');
expectContains(installedRunner, "['listing-ai-draft', 'ad-ai-explanation'].includes(mode)", 'installed runner does not require Lingxing browser session for already-imported ad AI analysis');
expectContains(installedRunner, 'evidence.aiSettingsChanged = aiSettingsChanged', 'installed runner records whether AI settings were modified');
expectContains(installedRunner, 'listing-ai-draft-settings-restored', 'installed runner records restored AI settings proof');
expectContains(installedRunner, 'settingsRestored = false', 'installed runner records restore failure instead of unconditional success');
expectContains(settingsPage, 'DeepSeek / OpenAI Compatible', 'settings page exposes AI provider configuration section');
expectContains(settingsPage, '测试 AI 连接', 'settings page exposes AI connection test button');
expectContains(settingsPage, '保存 AI 设置', 'settings page exposes AI settings save action');
expectContains(settingsPage, '清除本地 AI Key', 'settings page exposes explicit local key clearing action');
expectContains(settingsPage, '输出语言', 'settings page exposes AI output language control');
expectContains(settingsPage, 'AI 人设与输出约束', 'settings page exposes operator-editable AI persona control');
expectContains(settingsPage, '广告诊断、广告建议解释和 Listing 草案都会要求 AI 返回标准 JSON', 'settings page explains structured AI output boundary');
expectContains(settingsPage, 'AI 调用审计', 'settings page exposes AI call audit section');
expectContains(settingsPage, 'listAiCallLogs', 'settings page loads AI call logs');
expectContains(settingsPage, '不保存 API Key，也不展示完整提示词', 'settings page states redaction boundary');
expectContains(settingsPage, '广告量化阈值', 'settings page exposes operator threshold configuration');
expectContains(settingsPage, 'USD', 'settings page uses USD for cross-border ad spend thresholds');
expectContains(settingsPage, '执行前、执行后和回读证据', 'settings page keeps real write safety policy visible');
expectContains(aiCallDiagnostics, '标准 JSON 输出格式', 'AI diagnostics translate schema issues into operator-facing JSON format language');
expectContains(aiCallDiagnostics, '证据包', 'AI diagnostics surfaces evidence pack state');
expectContains(recommendationsPage, 'AI 判断依据', 'recommendations page displays AI reasoning section');
expectContains(recommendationsPage, '引用证据详情', 'recommendations page displays evidence detail section');
expectContains(recommendationsPage, 'AI 仅生成洞察，未进入建议池', 'recommendations page separates insight-only AI candidates');
expectContains(recommendationsPage, '解释来源', 'recommendations page displays explanation source');
expectContains(adQuantPage, 'AI 判断依据', 'ad quant page displays AI diagnosis reasoning');
expectContains(adQuantPage, '引用证据包', 'ad quant page summarizes evidence pack');
expectContains(adQuantPage, '缺少阈值证据，需人工复核', 'ad quant page blocks unreviewed AI threshold overwrite');
expectContains(approvalPage, 'AI 判断依据', 'approval page displays AI reasoning before approval');
expectContains(approvalPage, '引用证据详情', 'approval page displays evidence details before approval');
expectContains(aiProvider, 'response_format', 'OpenAI-compatible provider can request JSON object output');
expectContains(aiProvider, "responseFormat !== 'json_object'", 'JSON object output is opt-in, not applied to text health probes');
expectContains(aiProviderTest, 'does not request JSON object output for DeepSeek text health probes', 'provider tests protect AI connection probes from JSON-mode regression');
expectContains(adStrategyDiagnosis, "responseFormat: 'json_object'", 'ad strategy diagnosis requests structured JSON output');
expectContains(adActionReason, "responseFormat: 'json_object'", 'ad action explanation requests structured JSON output');
expectContains(listingDraftMain, "responseFormat: 'json_object'", 'Listing AI draft requests structured JSON output');

if (process.exitCode) {
  console.error('\nNEEDS_WORK: AI settings UX regression gate failed.');
  process.exit(process.exitCode);
}

console.log('\nAI_SETTINGS_UX verified.');
