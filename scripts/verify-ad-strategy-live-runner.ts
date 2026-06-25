import * as fs from 'fs';
import * as path from 'path';
import { AdStrategyDiagnoser, OpenAICompatibleProvider, type AdStrategyDiagnosisInput } from '../packages/ai-adapter/src/index';

const root = process.cwd();
const evidenceDir = path.join(root, 'output', 'codex-evidence');
const STRUCTURED_TOKEN_FLOOR = 8192;

type LiveInputFile = {
  ai?: {
    baseUrl?: string;
    model?: string;
    temperature?: number;
    maxTokens?: number;
    outputLanguage?: string;
    persona?: string;
  };
  input: AdStrategyDiagnosisInput;
};

function firstEnv(names: string[]): { name: string; value: string } {
  for (const name of names) {
    const value = process.env[name];
    if (value && value.trim()) return { name, value: value.trim() };
  }
  return { name: '', value: '' };
}

function parseArgs() {
  const inputPath = process.argv[2];
  const outIndex = process.argv.indexOf('--out');
  return {
    inputPath,
    outPath: outIndex >= 0 ? process.argv[outIndex + 1] : '',
  };
}

function numeric(value: unknown, fallback: number): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function assertNoSecretLeak(serialized: string, apiKey: string) {
  if (apiKey && serialized.includes(apiKey)) {
    throw new Error('Refusing to write live AI evidence because it contains the API key.');
  }
  if (/Bearer\s+[A-Za-z0-9._~+/=-]{16,}/i.test(serialized) || /sk-[A-Za-z0-9_-]{16,}/.test(serialized)) {
    throw new Error('Refusing to write live AI evidence because it looks like it contains a secret.');
  }
}

function writeEvidence(evidence: unknown, apiKey: string, outPath?: string): string {
  fs.mkdirSync(evidenceDir, { recursive: true });
  const targetPath = outPath || path.join(evidenceDir, `ad-strategy-live-${Date.now()}.json`);
  const serialized = `${JSON.stringify(evidence, null, 2)}\n`;
  assertNoSecretLeak(serialized, apiKey);
  fs.writeFileSync(targetPath, serialized, 'utf8');
  return targetPath;
}

async function main() {
  const { inputPath, outPath } = parseArgs();
  if (!inputPath) {
    throw new Error('Usage: node verify-ad-strategy-live-runner.cjs <input.json> [--out evidence.json]');
  }

  const key = firstEnv(['DEEPSEEK_API_KEY', 'AI_API_KEY', 'OPENAI_API_KEY']);
  const payload = JSON.parse(fs.readFileSync(path.resolve(inputPath), 'utf8')) as LiveInputFile;
  const baseUrl = (payload.ai?.baseUrl || process.env.DEEPSEEK_BASE_URL || process.env.AI_BASE_URL || 'https://api.deepseek.com').replace(/\/+$/, '');
  const model = payload.ai?.model || process.env.DEEPSEEK_MODEL || process.env.AI_MODEL || 'deepseek-v4-flash';
  const temperature = numeric(payload.ai?.temperature, 0.3);
  const maxTokens = Math.max(STRUCTURED_TOKEN_FLOOR, Math.trunc(numeric(payload.ai?.maxTokens, STRUCTURED_TOKEN_FLOOR)));
  const started = Date.now();

  const evidenceBase = {
    generatedAt: new Date().toISOString(),
    kind: 'ad-strategy-live-ai-diagnosis',
    status: 'NEEDS_WORK',
    provider: 'openai-compatible',
    baseUrl,
    model,
    keySource: key.name || null,
    keyPresent: Boolean(key.value),
    requestContract: {
      responseFormat: 'json_object',
      temperature,
      maxTokens,
      tokenFloor: STRUCTURED_TOKEN_FLOOR,
    },
    scope: payload.input?.scope || null,
    evidenceInputSummary: {
      metrics: payload.input?.metrics?.length || 0,
      timelines: payload.input?.adObjectTimelines?.length || 0,
      operationEvents: payload.input?.operationEvents?.length || 0,
      ruleCandidates: payload.input?.ruleCandidates?.length || 0,
      evidencePack: payload.input?.evidencePack?.length || 0,
    },
  };

  if (!key.value) {
    const evidencePath = writeEvidence({
      ...evidenceBase,
      message: 'REAL_DEEPSEEK_KEY_REQUIRED: set DEEPSEEK_API_KEY or AI_API_KEY, then rerun this script.',
    }, '');
    console.error(`NEEDS_WORK: missing live AI key. Evidence: ${evidencePath}`);
    process.exit(2);
  }

  try {
    const provider = new OpenAICompatibleProvider({
      apiKey: key.value,
      baseUrl,
      model,
      temperature,
      maxTokens,
    });
    const diagnoser = new AdStrategyDiagnoser(provider, {
      outputLanguage: payload.ai?.outputLanguage || '简体中文',
      persona: payload.ai?.persona,
      maxTokens,
    });
    const diagnosis = await diagnoser.diagnose(payload.input);
    const pass = diagnosis.source === 'ai' && !diagnosis.aiFallbackReason;
    const evidencePath = writeEvidence({
      ...evidenceBase,
      status: pass ? 'PASS' : 'NEEDS_WORK',
      latencyMs: Date.now() - started,
      diagnosis: {
        source: diagnosis.source,
        aiFallbackReason: diagnosis.aiFallbackReason,
        schemaVersion: diagnosis.schemaVersion,
        lifecycleStage: diagnosis.lifecycleStage,
        lifecycleStageReasonLength: diagnosis.lifecycleStageReason.length,
        lifecycleStageEvidenceRefs: diagnosis.lifecycleStageEvidenceRefs,
        summaryLength: diagnosis.summary.length,
        mainProblems: diagnosis.mainProblems,
        aiCandidateCount: diagnosis.aiCandidates.length,
        insightOnlyCandidateCount: diagnosis.insightOnlyCandidates.length,
        riskWarningsCount: diagnosis.riskWarnings.length,
        evidenceSufficiency: diagnosis.evidenceSufficiency,
        thresholdSuggestions: diagnosis.thresholdSuggestions,
      },
    }, key.value, outPath ? path.resolve(outPath) : undefined);

    if (!pass) {
      console.error(`NEEDS_WORK: live AI strategy diagnosis fell back to ${diagnosis.source}. Evidence: ${evidencePath}`);
      process.exit(1);
    }
    console.log(`PASS: live AI strategy diagnosis returned structured AI output. Evidence: ${evidencePath}`);
  } catch (error) {
    const evidencePath = writeEvidence({
      ...evidenceBase,
      status: 'NEEDS_WORK',
      latencyMs: Date.now() - started,
      message: error instanceof Error ? error.message : String(error),
    }, key.value, outPath ? path.resolve(outPath) : undefined);
    console.error(`NEEDS_WORK: ${error instanceof Error ? error.message : String(error)}. Evidence: ${evidencePath}`);
    process.exit(1);
  }
}

main();
