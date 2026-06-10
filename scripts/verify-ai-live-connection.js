const fs = require('fs');
const path = require('path');

const root = path.resolve(__dirname, '..');
const evidenceDir = path.join(root, 'output', 'codex-evidence');

function firstEnv(names) {
  for (const name of names) {
    const value = process.env[name];
    if (value && value.trim()) {
      return { name, value: value.trim() };
    }
  }
  return { name: '', value: '' };
}

function redact(value, apiKey) {
  return String(value || '')
    .replaceAll(apiKey, '[redacted-api-key]')
    .replace(/bearer\s+[A-Za-z0-9._~+/=-]+/gi, 'bearer [redacted]');
}

function writeEvidence(evidence, apiKey) {
  fs.mkdirSync(evidenceDir, { recursive: true });
  const targetPath = path.join(evidenceDir, `deepseek-live-${Date.now()}.json`);
  const serialized = JSON.stringify(evidence, null, 2);
  if (apiKey && serialized.includes(apiKey)) {
    throw new Error('Refusing to write AI evidence because it contains the API key.');
  }
  fs.writeFileSync(targetPath, serialized, 'utf8');
  return targetPath;
}

function buildOpenAiCompatibleUrl(baseUrl, resourcePath) {
  return `${baseUrl.replace(/\/+$/, '')}/${resourcePath.replace(/^\/+/, '')}`;
}

async function main() {
  const key = firstEnv(['DEEPSEEK_API_KEY', 'AI_API_KEY', 'OPENAI_API_KEY']);
  const baseUrl = (process.env.DEEPSEEK_BASE_URL || process.env.AI_BASE_URL || process.env.OPENAI_BASE_URL || 'https://api.deepseek.com').replace(/\/+$/, '');
  const model = process.env.DEEPSEEK_MODEL || process.env.AI_MODEL || 'deepseek-v4-flash';
  const evidence = {
    generatedAt: new Date().toISOString(),
    status: 'NEEDS_WORK',
    provider: 'openai-compatible',
    baseUrl,
    model,
    keySource: key.name || null,
    keyPresent: Boolean(key.value),
    success: false,
    message: '',
    usage: null,
    responseSample: '',
  };

  if (!key.value) {
    evidence.message = 'REAL_DEEPSEEK_KEY_REQUIRED: set DEEPSEEK_API_KEY or AI_API_KEY, then rerun this script.';
    const evidencePath = writeEvidence(evidence, '');
    console.error(`NEEDS_WORK: ${evidence.message}`);
    console.error(`Evidence: ${evidencePath}`);
    process.exit(2);
  }

  const started = Date.now();
  try {
    const response = await fetch(buildOpenAiCompatibleUrl(baseUrl, '/chat/completions'), {
      method: 'POST',
      headers: {
        authorization: `Bearer ${key.value}`,
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        model,
        messages: [{ role: 'user', content: '只回复 ok，用于连接测试。' }],
        temperature: 0,
        max_tokens: 32,
        thinking: { type: 'disabled' },
      }),
    });
    const bodyText = await response.text();
    evidence.latencyMs = Date.now() - started;

    if (!response.ok) {
      evidence.message = `API error ${response.status}: ${redact(bodyText.slice(0, 500), key.value)}`;
      const evidencePath = writeEvidence(evidence, key.value);
      console.error(`NEEDS_WORK: ${evidence.message}`);
      console.error(`Evidence: ${evidencePath}`);
      process.exit(1);
    }

    const data = JSON.parse(bodyText);
    const content = data.choices?.[0]?.message?.content || '';
    evidence.success = Boolean(content);
    evidence.status = evidence.success ? 'PASS' : 'NEEDS_WORK';
    evidence.message = evidence.success ? `AI 连接测试通过：${model}` : 'AI returned no content.';
    evidence.usage = {
      promptTokens: data.usage?.prompt_tokens || 0,
      completionTokens: data.usage?.completion_tokens || 0,
      totalTokens: data.usage?.total_tokens || 0,
    };
    evidence.responseSample = redact(content.slice(0, 80), key.value);

    const evidencePath = writeEvidence(evidence, key.value);
    if (!evidence.success || !evidence.usage.totalTokens) {
      console.error(`NEEDS_WORK: ${evidence.message}`);
      console.error(`Evidence: ${evidencePath}`);
      process.exit(1);
    }
    console.log(`PASS: ${evidence.message}`);
    console.log(`Evidence: ${evidencePath}`);
  } catch (error) {
    evidence.latencyMs = Date.now() - started;
    evidence.message = redact(error instanceof Error ? error.message : String(error), key.value);
    const evidencePath = writeEvidence(evidence, key.value);
    console.error(`NEEDS_WORK: ${evidence.message}`);
    console.error(`Evidence: ${evidencePath}`);
    process.exit(1);
  }
}

main();
