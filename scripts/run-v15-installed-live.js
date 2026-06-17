const fs = require('fs');
const path = require('path');
const { createRequire } = require('module');
const { execFileSync } = require('child_process');

const repoRoot = path.resolve(__dirname, '..');
const desktopRequire = createRequire(path.join(repoRoot, 'apps', 'desktop', 'package.json'));
const { _electron: electron } = desktopRequire('playwright');

const REPORT_TYPES = new Set([
  'campaign',
  'ad_group',
  'placement',
  'advertised_product',
  'auto_targeting',
  'keyword',
  'product_targeting',
  'user_search_term',
]);

function usage() {
  return [
    'Usage:',
    '  node scripts/run-v15-installed-live.js --mode diagnostic [--start 2026-05-01 --end 2026-05-25 --store FT-US-US --marketplace US]',
    '  node scripts/run-v15-installed-live.js --mode canary --report-type keyword [--start 2026-05-01 --end 2026-05-25 --store FT-US-US --marketplace US]',
    '  node scripts/run-v15-installed-live.js --mode full8 [--start 2026-05-01 --end 2026-05-25 --store FT-US-US --marketplace US]',
    '  node scripts/run-v15-installed-live.js --mode listing-read --listing-url https://erp.lingxing.com/erp/listing --login',
    '  node scripts/run-v15-installed-live.js --mode listing-ai-draft --source-app',
    '  node scripts/run-v15-installed-live.js --mode ad-ai-explanation [--start 2026-05-01 --end 2026-05-25 --store FT-US-US --marketplace US]',
    '',
    'Options:',
    '  --exe <path>              Packaged app exe. Defaults to apps/desktop/release/win-unpacked/AmazonAIOpsAgent.exe',
    '  --source-app              Launch the workspace Electron app from apps/desktop instead of a packaged exe.',
    '  --login                   Call browserLogin before running. Reads LINGXING_USERNAME and LINGXING_PASSWORD.',
    '  --keep-open               Leave the Electron app open after the run.',
    '  --probe-detail            In listing-read mode, try one fail-closed read-only detail-page probe from the current ASIN row.',
    '  --invoke-timeout-ms <ms>   Timeout for each renderer IPC call. Defaults to 420000.',
    '  --close-timeout-ms <ms>    Timeout for graceful app close. Defaults to 15000.',
    '  --listing-url <url>        Lingxing Listing/Product URL for listing-read mode. If omitted, reads current browser page.',
    '  --out <path>              Evidence JSON path. Defaults to installed-live-diagnostic-* or installed-canary-* under output/codex-evidence.',
    '',
    'Safety:',
    '  diagnostic, listing-read, listing-ai-draft, and ad-ai-explanation are read-only. canary runs one explicit report. full8 starts the full 8-report collection.',
    '  --source-app is for pre-installer evidence only; final delivery still requires packaged app evidence.',
    '  No mode executes ad write actions.',
  ].join('\n');
}

function parseArgs(argv) {
  const args = {};
  for (let index = 2; index < argv.length; index += 1) {
    const token = argv[index];
    if (!token.startsWith('--')) throw new Error(`Unexpected argument: ${token}`);
    const key = token.slice(2);
    if (['login', 'keep-open', 'help', 'source-app', 'probe-detail'].includes(key)) {
      args[key] = true;
    } else {
      const value = argv[index + 1];
      if (!value || value.startsWith('--')) throw new Error(`Missing value for --${key}`);
      args[key] = value;
      index += 1;
    }
  }
  return args;
}

function defaultExePath() {
  return path.join(repoRoot, 'apps', 'desktop', 'release', 'win-unpacked', 'AmazonAIOpsAgent.exe');
}

function safeSegment(value) {
  return String(value || '').replace(/[^a-zA-Z0-9_-]+/g, '-').replace(/^-+|-+$/g, '') || 'unknown';
}

function defaultEvidencePath(mode, request) {
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  if (mode === 'canary') {
    return path.join(repoRoot, 'output', 'codex-evidence', `installed-canary-${safeSegment(request.reportType)}-${stamp}.json`);
  }
  if (mode === 'full8') {
    return path.join(repoRoot, 'output', 'codex-evidence', `desktop-live-full-8-e2e-${stamp}.json`);
  }
  if (mode === 'listing-read') {
    return path.join(repoRoot, 'output', 'codex-evidence', `installed-listing-read-${stamp}.json`);
  }
  if (mode === 'listing-ai-draft') {
    return path.join(repoRoot, 'output', 'codex-evidence', `installed-listing-ai-draft-${stamp}.json`);
  }
  if (mode === 'ad-ai-explanation') {
    return path.join(repoRoot, 'output', 'codex-evidence', `installed-ad-ai-explanation-${stamp}.json`);
  }
  return path.join(repoRoot, 'output', 'codex-evidence', `installed-live-diagnostic-${stamp}.json`);
}

function firstEnv(names) {
  for (const name of names) {
    const value = process.env[name];
    if (value && value.trim()) {
      return { name, value: value.trim() };
    }
  }
  return { name: '', value: '' };
}

function parsePositiveInteger(value, fallback) {
  if (value === undefined || value === null || value === '') return fallback;
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed <= 0) {
    throw new Error(`Expected a positive integer, got: ${value}`);
  }
  return parsed;
}

function isRealReportSourceFile(filePath) {
  return /\.(xlsx|xls|csv)$/i.test(String(filePath || '').trim().split(/[?#]/)[0]);
}

function aiRecommendationEvidenceBlockers(rec) {
  const blockers = [];
  if (!rec || rec.explanationSource !== 'ai') blockers.push('not_ai_explanation');
  if (!rec?.aiExplanation) blockers.push('missing_ai_explanation');
  if (rec?.aiFallbackReason) blockers.push('ai_fallback_reason');
  if (!rec?.aiModel) blockers.push('missing_ai_model');
  if (!rec?.metricDate) blockers.push('missing_metric_date');
  if (!rec?.currentValue) blockers.push('missing_current_value');
  if (!rec?.recommendedValue) blockers.push('missing_recommended_value');
  const sourceFiles = Array.isArray(rec?.sourceFiles) ? rec.sourceFiles : [];
  if (!sourceFiles.some(isRealReportSourceFile)) blockers.push('missing_real_report_source_file');
  if (!(Number(rec?.sourceRow) > 0)) blockers.push('missing_source_row');
  return blockers;
}

function serializeError(error) {
  return error?.stack || error?.message || String(error);
}

function writeEvidence(evidencePath, evidence) {
  evidence.updatedAt = new Date().toISOString();
  const tempPath = `${evidencePath}.tmp`;
  fs.writeFileSync(tempPath, `${JSON.stringify(evidence, null, 2)}\n`, 'utf8');
  fs.renameSync(tempPath, evidencePath);
}

async function withTimeout(label, promise, timeoutMs) {
  let timer;
  try {
    return await Promise.race([
      promise,
      new Promise((_, reject) => {
        timer = setTimeout(() => reject(new Error(`${label} timed out after ${timeoutMs}ms`)), timeoutMs);
      }),
    ]);
  } finally {
    clearTimeout(timer);
  }
}

async function rendererInvoke(window, method, ...args) {
  return window.evaluate(async ({ method, args }) => {
    const api = window.electronAPI;
    if (!api || typeof api[method] !== 'function') {
      throw new Error(`electronAPI.${method} is not available`);
    }
    return api[method](...args);
  }, { method, args });
}

async function timedRendererInvoke(window, timeoutMs, method, ...args) {
  return withTimeout(`electronAPI.${method}`, rendererInvoke(window, method, ...args), timeoutMs);
}

async function waitForApi(window) {
  await window.waitForFunction(() => Boolean(window.electronAPI?.getState), null, { timeout: 30000 });
}

async function closeAppWithTimeout(app, timeoutMs) {
  if (!app) return;
  await withTimeout('Electron app close', app.close(), timeoutMs).catch(() => undefined);
}

function cleanupInstalledProcessTree(exePath, rootPid) {
  if (process.platform !== 'win32' || !rootPid) return;
  const script = `
$rootPid = ${Number(rootPid)}
$exePath = ${JSON.stringify(path.resolve(exePath))}
$all = Get-CimInstance Win32_Process
$ids = New-Object System.Collections.Generic.HashSet[int]
$queue = New-Object System.Collections.Generic.Queue[int]
[void]$queue.Enqueue($rootPid)
while ($queue.Count -gt 0) {
  $parent = $queue.Dequeue()
  foreach ($proc in $all | Where-Object { $_.ParentProcessId -eq $parent }) {
    if ($ids.Add([int]$proc.ProcessId)) { [void]$queue.Enqueue([int]$proc.ProcessId) }
  }
}
foreach ($proc in $all | Where-Object { $_.ExecutablePath -eq $exePath }) {
  [void]$ids.Add([int]$proc.ProcessId)
}
foreach ($id in $ids) {
  Stop-Process -Id $id -Force -ErrorAction SilentlyContinue
}
`;
  execFileSync('powershell.exe', ['-NoProfile', '-Command', script], { stdio: 'ignore' });
}

async function main() {
  const args = parseArgs(process.argv);
  if (args.help) {
    console.log(usage());
    return;
  }

  const mode = args.mode;
  if (!['diagnostic', 'canary', 'full8', 'listing-read', 'listing-ai-draft', 'ad-ai-explanation'].includes(mode)) {
    throw new Error('Missing or invalid --mode. Use diagnostic, canary, full8, listing-read, listing-ai-draft, or ad-ai-explanation.');
  }

  const reportType = args['report-type'];
  if (mode === 'canary' && !REPORT_TYPES.has(reportType)) {
    throw new Error(`--report-type is required for canary and must be one of: ${[...REPORT_TYPES].join(', ')}`);
  }

  const request = {
    start: args.start || '2026-05-01',
    end: args.end || '2026-05-25',
    storeName: args.store || 'FT-US-US',
    marketplaceCode: args.marketplace || 'US',
    reportType,
  };
  const dateRange = {
    start: request.start,
    end: request.end,
    storeName: request.storeName,
    marketplaceCode: request.marketplaceCode,
  };

  const exePath = path.resolve(args.exe || defaultExePath());
  const appDir = path.join(repoRoot, 'apps', 'desktop');
  if (!args['source-app'] && !fs.existsSync(exePath)) throw new Error(`Packaged app exe not found: ${exePath}`);

  const evidencePath = path.resolve(args.out || defaultEvidencePath(mode, request));
  fs.mkdirSync(path.dirname(evidencePath), { recursive: true });
  const invokeTimeoutMs = parsePositiveInteger(args['invoke-timeout-ms'], 420000);
  const closeTimeoutMs = parsePositiveInteger(args['close-timeout-ms'], 15000);

  const evidence = {
    kind: mode === 'canary'
      ? 'installed-live-single-report-canary'
      : mode === 'full8'
        ? 'desktop-live-full-8-e2e'
        : mode === 'listing-read'
          ? 'installed-listing-read'
          : mode === 'listing-ai-draft'
            ? 'installed-listing-ai-draft'
            : mode === 'ad-ai-explanation'
              ? 'installed-ad-ai-explanation'
              : 'installed-live-diagnostic',
    createdAt: new Date().toISOString(),
    exePath: args['source-app'] ? null : exePath,
    appDir: args['source-app'] ? appDir : null,
    runtimeMode: args['source-app'] ? 'source-app' : 'packaged-app',
    evidencePath,
    request,
    safety: {
      full8Started: false,
      adWriteActionsPerformed: false,
      reportTypesRequested: mode === 'canary'
        ? [reportType]
        : mode === 'full8'
          ? [...REPORT_TYPES]
          : [],
      listingReadOnly: mode === 'listing-read',
      listingAiDraftOnly: mode === 'listing-ai-draft',
      adAiExplanationOnly: mode === 'ad-ai-explanation',
    },
    timeouts: {
      invokeTimeoutMs,
      closeTimeoutMs,
    },
    steps: [],
    errors: [],
  };

  let app;
  let appProcessId;
  let window;
  let aiRestoreSettings = null;
  let aiSettingsChanged = false;
  const checkpoint = () => writeEvidence(evidencePath, evidence);
  checkpoint();
  if (mode === 'listing-ai-draft' || mode === 'ad-ai-explanation') {
    const key = firstEnv(['DEEPSEEK_API_KEY', 'AI_API_KEY', 'OPENAI_API_KEY']);
    evidence.ai = {
      status: 'NEEDS_WORK',
      provider: 'openai-compatible',
      keySource: key.name || null,
      keyPresent: Boolean(key.value),
      baseUrl: (process.env.DEEPSEEK_BASE_URL || process.env.AI_BASE_URL || process.env.OPENAI_BASE_URL || 'https://api.deepseek.com').replace(/\/+$/, ''),
      model: process.env.DEEPSEEK_MODEL || process.env.AI_MODEL || 'deepseek-v4-flash',
    };
    checkpoint();
  }
  try {
    app = args['source-app']
      ? await electron.launch({ args: [appDir], cwd: appDir })
      : await electron.launch({ executablePath: exePath });
    appProcessId = app.process()?.pid;
    evidence.appProcessId = appProcessId;
    window = await app.firstWindow({ timeout: 60000 });
    await waitForApi(window);
    evidence.steps.push({ label: 'window-ready', title: await window.title().catch(() => '') });
    checkpoint();

    const stateBefore = await timedRendererInvoke(window, invokeTimeoutMs, 'getState');
    const browserReadyBefore = await timedRendererInvoke(window, invokeTimeoutMs, 'isBrowserReady').catch(() => false);
    evidence.stateBefore = stateBefore;
    evidence.browserReadyBefore = browserReadyBefore;
    checkpoint();

    const browserSessionRequired = !['listing-ai-draft', 'ad-ai-explanation'].includes(mode);
    if (args.login || (browserSessionRequired && !browserReadyBefore)) {
      const username = process.env.LINGXING_USERNAME;
      const password = process.env.LINGXING_PASSWORD;
      if (!username || !password) {
        throw new Error('Browser session is not ready. Set LINGXING_USERNAME and LINGXING_PASSWORD and pass --login.');
      }
      const loginSession = await timedRendererInvoke(window, invokeTimeoutMs, 'browserLogin', username, password);
      evidence.steps.push({
        label: 'browser-login',
        erpSessionReused: loginSession?.erpSessionReused,
        adsEntryMode: loginSession?.adsEntryMode,
        adsTitle: loginSession?.adsTitle,
        adsUrl: loginSession?.adsUrl,
      });
      checkpoint();
    }

    if (mode === 'listing-read') {
      const listingUrl = args['listing-url'];
      evidence.steps.push({ label: 'listing-read-start', listingUrl: listingUrl || null });
      checkpoint();
      evidence.listingRead = args['probe-detail']
        ? await timedRendererInvoke(window, invokeTimeoutMs, 'probeLingxingListingDetailAndExtract', listingUrl || undefined)
        : listingUrl
          ? await timedRendererInvoke(window, invokeTimeoutMs, 'openLingxingListingAndExtract', listingUrl)
          : await timedRendererInvoke(window, invokeTimeoutMs, 'extractListingFromLingxing');
      evidence.steps.push({
        label: 'listing-read',
        ready: evidence.listingRead?.ready,
        partialReady: evidence.listingRead?.partialReady,
        fullContentReady: evidence.listingRead?.fullContentReady,
        reason: evidence.listingRead?.reason,
        asin: evidence.listingRead?.listing?.asin,
        pageUrl: evidence.listingRead?.evidence?.pageUrl,
        screenshotPath: evidence.listingRead?.evidence?.screenshotPath,
        completeness: evidence.listingRead?.evidence?.completeness,
        detailCandidateCount: evidence.listingRead?.evidence?.detailCandidates?.length || 0,
        detailProbeStarted: Boolean(evidence.listingRead?.evidence?.detailProbe?.started),
        detailProbeClicked: Boolean(evidence.listingRead?.evidence?.detailProbe?.clicked),
        detailProbeStatus: evidence.listingRead?.evidence?.detailProbe?.status,
        detailProbeReason: evidence.listingRead?.evidence?.detailProbe?.reason,
        finalUrl: evidence.listingRead?.evidence?.pageUrl,
        asinMatched: Boolean(evidence.listingRead?.listing?.asin),
      });
      checkpoint();
      return;
    }

    if (mode === 'listing-ai-draft') {
      const key = firstEnv(['DEEPSEEK_API_KEY', 'AI_API_KEY', 'OPENAI_API_KEY']);
      const previousSettings = await timedRendererInvoke(window, invokeTimeoutMs, 'getSettings').catch(() => ({})) || {};
      const previousKeyConfigured = Boolean(
        previousSettings.aiKeyConfigured
        || previousSettings.ai_key_configured
        || previousSettings.aiApiKey
        || previousSettings.ai_api_key
      );
      if (!key.value && !previousKeyConfigured) {
        throw new Error('AI 生成需要真实 DeepSeek/OpenAI Key：请先在设置页保存并测试 AI Key，或通过 DEEPSEEK_API_KEY/AI_API_KEY 临时注入。');
      }
      const baseUrl = (process.env.DEEPSEEK_BASE_URL || process.env.AI_BASE_URL || process.env.OPENAI_BASE_URL || previousSettings.aiBaseUrl || previousSettings.ai_base_url || 'https://api.deepseek.com').replace(/\/+$/, '');
      const model = process.env.DEEPSEEK_MODEL || process.env.AI_MODEL || previousSettings.aiModel || previousSettings.ai_model || 'deepseek-v4-flash';
      evidence.steps.push({
        label: 'listing-ai-draft-settings-before',
        hadAiKey: Boolean(previousSettings.aiApiKey || previousSettings.ai_api_key),
        previousKeyConfigured,
        previousBaseUrl: previousSettings.aiBaseUrl || previousSettings.ai_base_url || null,
        previousModel: previousSettings.aiModel || previousSettings.ai_model || null,
      });
      checkpoint();

      if (key.value) {
        const aiSettings = {
          ...previousSettings,
          aiApiKey: key.value,
          ai_api_key: key.value,
          aiBaseUrl: baseUrl,
          ai_base_url: baseUrl,
          aiModel: model,
          ai_model: model,
          aiTemperature: '0.3',
          ai_temperature: '0.3',
          aiMaxTokens: process.env.AI_MAX_TOKENS || process.env.DEEPSEEK_MAX_TOKENS || '8192',
          ai_max_tokens: process.env.AI_MAX_TOKENS || process.env.DEEPSEEK_MAX_TOKENS || '8192',
        };
        await timedRendererInvoke(window, invokeTimeoutMs, 'saveSettings', aiSettings);
        aiSettingsChanged = true;
      }
      const appliedSettings = await timedRendererInvoke(window, invokeTimeoutMs, 'getSettings');
      const appliedKey = appliedSettings.ai_api_key || appliedSettings.aiApiKey || '';
      const appliedKeyConfigured = Boolean(appliedSettings.ai_key_configured || appliedSettings.aiKeyConfigured);
      const storedKeyAccepted = !key.value && appliedKeyConfigured;
      const keyAccepted = key.value ? (appliedKey === key.value || appliedKeyConfigured) : storedKeyAccepted;
      const appliedBaseUrl = appliedSettings.ai_base_url || appliedSettings.aiBaseUrl || '';
      const appliedModel = appliedSettings.ai_model || appliedSettings.aiModel || '';
      evidence.steps.push({
        label: 'listing-ai-draft-settings-applied',
        keyMatchesEnv: appliedKey === key.value,
        keyConfigured: appliedKeyConfigured,
        storedKeyAccepted,
        keyAccepted,
        baseUrl: appliedBaseUrl,
        model: appliedModel,
      });
      if (!keyAccepted || appliedBaseUrl !== baseUrl || appliedModel !== model) {
        throw new Error('AI settings did not apply to the app before Listing AI draft generation.');
      }
      const testResult = key.value
        ? await timedRendererInvoke(window, invokeTimeoutMs, 'testAiSettings', {
            aiApiKey: key.value,
            aiBaseUrl: baseUrl,
            aiModel: model,
            aiTemperature: 0,
            aiMaxTokens: 8,
          })
        : { success: true, message: '使用应用内已保存的隐藏 AI Key，跳过明文连接测试。' };
      evidence.ai = {
        status: testResult?.success ? 'CONNECTED' : 'NEEDS_WORK',
        provider: 'openai-compatible',
        keySource: key.name || 'saved-settings',
        keyPresent: true,
        storedKeyAccepted,
        baseUrl,
        model,
        testSuccess: Boolean(testResult?.success),
        testMessage: testResult?.message || '',
      };
      checkpoint();

      const suggestion = {
        asin: args.asin || 'B0GTTJFQTM',
        keyword: args.keyword || 'keyless entry door handle',
        section: args.section || 'bullet',
        currentText: args['current-text'] || '5 UNLOCKING METHODS — Open with fingerprint, 6-digit passcode, key card, Tuya Bluetooth App, or backup keys.',
        suggestedText: args['suggested-text'] || 'Highlight keyless entry door handle access with fingerprint, keypad, key card, Tuya Bluetooth app, and backup keys for bedroom and interior doors.',
        evidence: args.evidence || 'Live Listing read evidence plus keyword opportunity sample for AI draft proof.',
        riskWarnings: [],
        status: 'accepted',
        createdAt: new Date().toISOString(),
      };
      const drafts = await timedRendererInvoke(window, invokeTimeoutMs, 'generateListingDrafts', [suggestion]);
      evidence.listingAiDraft = {
        suggestion: {
          asin: suggestion.asin,
          keyword: suggestion.keyword,
          section: suggestion.section,
          status: suggestion.status,
        },
        draftCount: Array.isArray(drafts) ? drafts.length : 0,
        drafts: Array.isArray(drafts)
          ? drafts.map((draft) => ({
              id: draft.id,
              asin: draft.asin,
              section: draft.section,
              source: draft.source,
              hasFallback: Boolean(draft.aiFallbackReason),
              aiFallbackReason: draft.aiFallbackReason || null,
              evidenceHasAiReason: typeof draft.evidence === 'string' && /AI (reason:|理由：)/.test(draft.evidence),
              draftedTextLength: typeof draft.draftedText === 'string' ? draft.draftedText.length : 0,
              riskWarnings: draft.riskWarnings || [],
            }))
          : [],
      };

      const previousApiKey = previousSettings.ai_api_key || previousSettings.aiApiKey || '';
      const previousBaseUrl = previousSettings.ai_base_url || previousSettings.aiBaseUrl || baseUrl;
      const previousModel = previousSettings.ai_model || previousSettings.aiModel || model;
      aiRestoreSettings = {
        ...previousSettings,
        aiApiKey: previousApiKey,
        ai_api_key: previousApiKey,
        aiBaseUrl: previousBaseUrl,
        ai_base_url: previousBaseUrl,
        aiModel: previousModel,
        ai_model: previousModel,
      };
      evidence.ai.status = evidence.listingAiDraft.drafts.some((draft) =>
        draft.source === 'ai' && !draft.hasFallback && draft.evidenceHasAiReason && draft.draftedTextLength > 0
      ) ? 'PASS' : 'NEEDS_WORK';
      checkpoint();
      return;
    }

    if (mode === 'ad-ai-explanation') {
      const key = firstEnv(['DEEPSEEK_API_KEY', 'AI_API_KEY', 'OPENAI_API_KEY']);
      const previousSettings = await timedRendererInvoke(window, invokeTimeoutMs, 'getSettings').catch(() => ({})) || {};
      const previousKeyConfigured = Boolean(
        previousSettings.aiKeyConfigured
        || previousSettings.ai_key_configured
        || previousSettings.aiApiKey
        || previousSettings.ai_api_key
      );
      if (!key.value && !previousKeyConfigured) {
        throw new Error('AI 生成需要真实 DeepSeek/OpenAI Key：请先在设置页保存并测试 AI Key，或通过 DEEPSEEK_API_KEY/AI_API_KEY 临时注入。');
      }
      const baseUrl = (process.env.DEEPSEEK_BASE_URL || process.env.AI_BASE_URL || process.env.OPENAI_BASE_URL || previousSettings.aiBaseUrl || previousSettings.ai_base_url || 'https://api.deepseek.com').replace(/\/+$/, '');
      const model = process.env.DEEPSEEK_MODEL || process.env.AI_MODEL || previousSettings.aiModel || previousSettings.ai_model || 'deepseek-v4-flash';
      evidence.steps.push({
        label: 'ad-ai-explanation-settings-before',
        hadAiKey: Boolean(previousSettings.aiApiKey || previousSettings.ai_api_key),
        previousKeyConfigured,
        previousBaseUrl: previousSettings.aiBaseUrl || previousSettings.ai_base_url || null,
        previousModel: previousSettings.aiModel || previousSettings.ai_model || null,
      });
      checkpoint();

      if (key.value) {
        const aiSettings = {
          ...previousSettings,
          aiApiKey: key.value,
          ai_api_key: key.value,
          aiBaseUrl: baseUrl,
          ai_base_url: baseUrl,
          aiModel: model,
          ai_model: model,
          aiTemperature: '0.2',
          ai_temperature: '0.2',
          aiMaxTokens: process.env.AI_MAX_TOKENS || process.env.DEEPSEEK_MAX_TOKENS || '8192',
          ai_max_tokens: process.env.AI_MAX_TOKENS || process.env.DEEPSEEK_MAX_TOKENS || '8192',
        };
        await timedRendererInvoke(window, invokeTimeoutMs, 'saveSettings', aiSettings);
        aiSettingsChanged = true;
      }
      const appliedSettings = await timedRendererInvoke(window, invokeTimeoutMs, 'getSettings');
      const appliedKey = appliedSettings.ai_api_key || appliedSettings.aiApiKey || '';
      const appliedKeyConfigured = Boolean(appliedSettings.ai_key_configured || appliedSettings.aiKeyConfigured);
      const storedKeyAccepted = !key.value && appliedKeyConfigured;
      const keyAccepted = key.value ? (appliedKey === key.value || appliedKeyConfigured) : storedKeyAccepted;
      const appliedBaseUrl = appliedSettings.ai_base_url || appliedSettings.aiBaseUrl || '';
      const appliedModel = appliedSettings.ai_model || appliedSettings.aiModel || '';
      evidence.steps.push({
        label: 'ad-ai-explanation-settings-applied',
        keyMatchesEnv: appliedKey === key.value,
        keyConfigured: appliedKeyConfigured,
        storedKeyAccepted,
        keyAccepted,
        baseUrl: appliedBaseUrl,
        model: appliedModel,
      });
      if (!keyAccepted || appliedBaseUrl !== baseUrl || appliedModel !== model) {
        throw new Error('AI settings did not apply to the app before ad AI explanation generation.');
      }

      const testResult = key.value
        ? await timedRendererInvoke(window, invokeTimeoutMs, 'testAiSettings', {
            aiApiKey: key.value,
            aiBaseUrl: baseUrl,
            aiModel: model,
            aiTemperature: 0,
            aiMaxTokens: 8,
          })
        : { success: true, message: '使用应用内已保存的隐藏 AI Key，跳过明文连接测试。' };
      evidence.ai = {
        status: testResult?.success ? 'CONNECTED' : 'NEEDS_WORK',
        provider: 'openai-compatible',
        keySource: key.name || 'saved-settings',
        keyPresent: true,
        storedKeyAccepted,
        baseUrl,
        model,
        testSuccess: Boolean(testResult?.success),
        testMessage: testResult?.message || '',
      };
      checkpoint();

      const recommendationFilter = {
        dateFrom: request.start,
        dateTo: request.end,
        storeName: request.storeName,
        marketplaceCode: request.marketplaceCode,
        asin: args.asin || undefined,
        limit: parsePositiveInteger(args.limit, 30),
      };
      evidence.generation = await timedRendererInvoke(window, invokeTimeoutMs, 'generateRecommendations', recommendationFilter);
      checkpoint();

      const rows = await timedRendererInvoke(window, invokeTimeoutMs, 'getRecommendations', recommendationFilter);
      const recommendations = Array.isArray(rows) ? rows : [];
      const aiExplainedRecommendations = recommendations
        .filter((rec) => rec && rec.evidence?.explanationSource === 'ai')
        .map((rec) => ({
          id: rec.id,
          storeName: rec.storeName || rec.evidence?.storeName || recommendationFilter.storeName,
          marketplaceCode: rec.marketplaceCode || rec.evidence?.marketplaceCode || recommendationFilter.marketplaceCode,
          asin: rec.asin || rec.evidence?.asin,
          entityType: rec.entityType,
          entityId: rec.entityId,
          entityName: rec.entityName,
          actionType: rec.actionType,
          currentValue: rec.currentValue,
          recommendedValue: rec.recommendedValue,
          metricDate: rec.evidence?.date,
          batchId: rec.evidence?.batchId || null,
          reportType: rec.evidence?.reportType || null,
          sourceFiles: Array.isArray(rec.evidence?.sourceFiles) ? rec.evidence.sourceFiles : [],
          sourceRow: rec.evidence?.sourceRow || null,
          explanationSource: rec.evidence?.explanationSource,
          aiExplanation: rec.evidence?.aiExplanation || rec.reason,
          aiRiskWarnings: rec.evidence?.aiRiskWarnings || [],
          aiAlternativeSuggestions: rec.evidence?.aiAlternativeSuggestions || [],
          aiFallbackReason: rec.evidence?.aiFallbackReason || null,
          aiModel: rec.evidence?.aiModel || model,
        }));
      const evidenceLimit = parsePositiveInteger(args['evidence-limit'], 10);
      evidence.recommendations = aiExplainedRecommendations
        .filter((rec) => aiRecommendationEvidenceBlockers(rec).length === 0)
        .slice(0, evidenceLimit);
      evidence.rejectedRecommendations = aiExplainedRecommendations
        .map((rec) => ({ ...rec, evidenceBlockers: aiRecommendationEvidenceBlockers(rec) }))
        .filter((rec) => rec.evidenceBlockers.length > 0)
        .slice(0, evidenceLimit);
      evidence.steps.push({
        label: 'ad-ai-explanation',
        generated: evidence.generation?.generated,
        metrics: evidence.generation?.metrics,
        skippedDuplicates: evidence.generation?.skippedDuplicates,
        fetchedRecommendations: recommendations.length,
        aiExplainedRecommendations: aiExplainedRecommendations.length,
        validAiExplainedRecommendations: evidence.recommendations.length,
        rejectedAiExplainedRecommendations: evidence.rejectedRecommendations.length,
      });

      const previousApiKey = previousSettings.ai_api_key || previousSettings.aiApiKey || '';
      const previousBaseUrl = previousSettings.ai_base_url || previousSettings.aiBaseUrl || baseUrl;
      const previousModel = previousSettings.ai_model || previousSettings.aiModel || model;
      aiRestoreSettings = {
        ...previousSettings,
        aiApiKey: previousApiKey,
        ai_api_key: previousApiKey,
        aiBaseUrl: previousBaseUrl,
        ai_base_url: previousBaseUrl,
        aiModel: previousModel,
        ai_model: previousModel,
      };
      evidence.status = evidence.ai.testSuccess && evidence.recommendations.length > 0 ? 'PASS' : 'NEEDS_WORK';
      evidence.ai.status = evidence.status;
      checkpoint();
      return;
    }

    evidence.pageModel = await timedRendererInvoke(window, invokeTimeoutMs, 'getDownloadCenterPageModel');
    checkpoint();
    evidence.diagnostic = await timedRendererInvoke(window, invokeTimeoutMs, 'diagnoseLingxingDownloadCenter', dateRange);
    evidence.steps.push({
      label: 'diagnostic',
      id: evidence.diagnostic?.id,
      ready: evidence.diagnostic?.ready,
      url: evidence.diagnostic?.url,
      screenshotPath: evidence.diagnostic?.screenshotPath,
      domSnapshotPath: evidence.diagnostic?.domSnapshotPath,
    });
    checkpoint();

    if (evidence.diagnostic?.id) {
      evidence.diagnosticBundlePath = await timedRendererInvoke(window, invokeTimeoutMs, 'exportDownloadCenterDiagnosticBundle', evidence.diagnostic.id)
        .catch((error) => {
          evidence.errors.push(`exportDiagnosticBundle: ${error.message || error}`);
          return null;
        });
      checkpoint();
    }

    evidence.preflight = await timedRendererInvoke(window, invokeTimeoutMs, 'preflightLingxingCollection', dateRange)
      .catch((error) => {
        evidence.errors.push(`preflight: ${error.message || error}`);
        return null;
      });
    checkpoint();

    if (mode === 'canary') {
      evidence.canary = await timedRendererInvoke(window, invokeTimeoutMs, 'runLingxingCanaryReport', dateRange, reportType);
      evidence.batch = evidence.canary?.batch;
      evidence.files = evidence.canary?.files || [];
      evidence.steps.push({
        label: 'canary',
        reportType,
        batchId: evidence.batch?.id,
        batchStatus: evidence.batch?.status,
        downloaded: evidence.files.filter((file) => file.status === 'downloaded').length,
        failed: evidence.files.filter((file) => file.status === 'failed').length,
      });
      checkpoint();

      if (evidence.batch?.id) {
        evidence.acceptanceAuditPath = await timedRendererInvoke(window, invokeTimeoutMs, 'exportLingxingAcceptanceAudit', evidence.batch.id, evidence.diagnostic?.id)
          .catch((error) => {
            evidence.errors.push(`exportAcceptanceAudit: ${error.message || error}`);
            return null;
          });
        checkpoint();
      }
    }

    if (mode === 'full8') {
      evidence.safety.full8Started = true;
      checkpoint();
      evidence.result = await timedRendererInvoke(window, invokeTimeoutMs, 'collectLingxingReports', dateRange);
      evidence.batch = evidence.result?.batch;
      evidence.files = evidence.result?.files || [];
      evidence.steps.push({
        label: 'full8',
        batchId: evidence.batch?.id,
        batchStatus: evidence.batch?.status,
        downloaded: evidence.files.filter((file) => file.status === 'downloaded').length,
        failed: evidence.files.filter((file) => file.status === 'failed').length,
      });
      checkpoint();

      if (evidence.batch?.id) {
        evidence.acceptanceAuditPath = await timedRendererInvoke(window, invokeTimeoutMs, 'exportLingxingAcceptanceAudit', evidence.batch.id, evidence.diagnostic?.id)
          .catch((error) => {
            evidence.errors.push(`exportAcceptanceAudit: ${error.message || error}`);
            return null;
          });
        checkpoint();
      }
    }
  } catch (error) {
    evidence.errors.push(serializeError(error));
    checkpoint();
    throw error;
  } finally {
    evidence.aiSettingsChanged = aiSettingsChanged;
    if ((mode === 'listing-ai-draft' || mode === 'ad-ai-explanation') && aiSettingsChanged && window && aiRestoreSettings) {
      const restoreTarget = mode === 'listing-ai-draft'
        ? (evidence.listingAiDraft ||= {})
        : (evidence.adAiExplanation ||= {});
      try {
        await timedRendererInvoke(window, invokeTimeoutMs, 'saveSettings', aiRestoreSettings);
        const restoredSettings = await timedRendererInvoke(window, invokeTimeoutMs, 'getSettings');
        const expectedKey = aiRestoreSettings.ai_api_key || aiRestoreSettings.aiApiKey || '';
        const expectedBaseUrl = aiRestoreSettings.ai_base_url || aiRestoreSettings.aiBaseUrl || '';
        const expectedModel = aiRestoreSettings.ai_model || aiRestoreSettings.aiModel || '';
        const restoredKey = restoredSettings.ai_api_key || restoredSettings.aiApiKey || '';
        const restoredBaseUrl = restoredSettings.ai_base_url || restoredSettings.aiBaseUrl || '';
        const restoredModel = restoredSettings.ai_model || restoredSettings.aiModel || '';
        restoreTarget.settingsRestored = restoredKey === expectedKey
          && restoredBaseUrl === expectedBaseUrl
          && restoredModel === expectedModel;
        evidence.steps.push({
          label: mode === 'listing-ai-draft' ? 'listing-ai-draft-settings-restored' : 'ad-ai-explanation-settings-restored',
          restored: restoreTarget.settingsRestored,
          baseUrl: restoredBaseUrl,
          model: restoredModel,
        });
        if (!restoreTarget.settingsRestored) {
          evidence.errors.push('restore-ai-settings: restored settings did not match previous settings');
        }
      } catch (error) {
        restoreTarget.settingsRestored = false;
        evidence.errors.push(`restore-ai-settings: ${error.message || error}`);
      }
    }
    checkpoint();
    if (app && !args['keep-open']) {
      await closeAppWithTimeout(app, closeTimeoutMs);
      if (!args['source-app']) {
        cleanupInstalledProcessTree(exePath, appProcessId);
      }
    }
    console.log(`Evidence written: ${evidencePath}`);
  }
}

main().catch((error) => {
  console.error(error?.message || error);
  process.exit(1);
});
