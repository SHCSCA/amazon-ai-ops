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
const app = read('apps/desktop/src/renderer/App.tsx');
const liveVerifier = read('scripts/verify-ai-live-connection.js');
const liveWrapper = read('scripts/verify-ai-live.js');
const installedRunner = read('scripts/run-v15-installed-live.js');

expectContains(main, "ipcMain.handle('settings:test-ai'", 'desktop main registers AI test IPC');
expectContains(main, 'handleTestAiSettings', 'desktop main has structured AI test handler');
expectContains(main, 'https://api.deepseek.com', 'AI defaults use DeepSeek base URL');
expectContains(main, 'deepseek-v4-flash', 'AI defaults use current DeepSeek flash model');
expectContains(main, 'normalizeAiSettings', 'desktop main normalizes AI settings schema');
expectContains(main, 'aiApiKey: apiKey', 'desktop main writes canonical camelCase AI key');
expectContains(main, 'ai_api_key: apiKey', 'desktop main writes canonical snake_case AI key');
expectContains(main, "ipcMain.handle('settings:get', () => normalizeAiSettings", 'settings:get returns normalized AI settings');
expectContains(main, 'state.settingsRepo?.save(normalizeAiSettings', 'settings:save persists normalized AI settings');
expectContains(main, '未配置 AI Key', 'AI test returns operator-facing missing-key message');
expectContains(main, 'AI 调用异常', 'Listing AI generation falls back on provider exceptions');
expectContains(main, 'AdActionReasonExplainer', 'desktop main wires AI explanation into ad recommendations');
expectContains(main, 'enrichAdRecommendationsWithAiExplanations', 'desktop main has ad recommendation AI explanation enrichment');
expectContains(main, '未配置 AI Key，广告建议解释使用规则引擎', 'ad recommendation generation records no-key AI fallback');
expectContains(main, 'explanationSource', 'ad recommendation generation records AI/rule explanation source');
expectContains(preload, 'testAiSettings', 'preload exposes AI test IPC safely');
expectContains(liveVerifier, "buildOpenAiCompatibleUrl(baseUrl, '/chat/completions')", 'AI live verifier uses same baseUrl + chat/completions rule as app provider');
expectNotContains(liveVerifier, 'baseUrl}/v1/chat/completions', 'AI live verifier no longer hardcodes /v1 for DeepSeek');
expectContains(liveWrapper, "require('./verify-ai-live-connection')", 'compatibility wrapper scripts/verify-ai-live.js exists');
expectContains(installedRunner, 'aiApiKey: key.value', 'installed runner writes camelCase AI key');
expectContains(installedRunner, 'ai_api_key: key.value', 'installed runner writes snake_case AI key');
expectContains(installedRunner, 'listing-ai-draft-settings-applied', 'installed runner verifies AI settings were applied before draft generation');
expectContains(installedRunner, 'listing-ai-draft-settings-restored', 'installed runner records restored AI settings proof');
expectContains(installedRunner, 'settingsRestored = false', 'installed runner records restore failure instead of unconditional success');
expectContains(app, 'AI / DeepSeek 配置', 'settings page exposes AI configuration section');
expectContains(app, '测试 AI 连接', 'settings page exposes AI connection test button');
expectContains(app, '保存 AI 设置', 'settings page exposes AI settings save action');
expectContains(app, 'aiFallbackReason', 'settings page explains AI fallback behavior');
expectContains(app, 'AI 交付证据', 'settings page exposes AI delivery evidence guidance');
expectContains(app, '生成广告 AI 解释', 'settings page shows ad AI explanation evidence step');
expectContains(app, '解释来源：', 'recommendations page displays ad explanation source');
expectContains(app, '保存真实 Key', 'settings page shows AI evidence workflow step: save real key');
expectContains(app, '生成 Listing AI 草案', 'settings page shows AI evidence workflow step: generate listing AI draft');
expectContains(app, '复制 AI 验收命令', 'settings page exposes AI evidence command copy action');
expectContains(app, '$env:DEEPSEEK_API_KEY="<your-deepseek-key>"', 'settings page exposes safe environment variable template without a real key');
expectContains(app, '真实交付需要三份证据', 'settings page explains live AI, ad AI explanation, and Listing AI draft evidence boundary');
expectContains(app, 'verify:ad-ai-explanation', 'settings page shows ad AI explanation verification command');
expectContains(app, 'verify:listing-ai-draft', 'settings page shows Listing AI draft verification command');
expectContains(app, 'installed-listing-ai-draft-manual.json', 'settings page uses a fixed Listing AI draft evidence filename');

if (process.exitCode) {
  console.error('\nNEEDS_WORK: AI settings UX regression gate failed.');
  process.exit(process.exitCode);
}

console.log('\nAI_SETTINGS_UX verified.');
