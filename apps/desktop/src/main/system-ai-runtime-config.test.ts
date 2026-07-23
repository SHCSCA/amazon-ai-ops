import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import {
  AD_STRATEGY_ANALYSIS_PROMPT_SCHEMA_VERSION,
  analysisAiRuntimeRevision,
  analysisAiRuntimeRevisionPayload,
  buildSystemAiProviderConfig,
  resolveSystemAiRuntimeConfig,
} from './system-ai-runtime-config';

describe('system AI runtime config', () => {
  it('resolves legacy settings through one canonical Main-only provider config', () => {
    const runtime = resolveSystemAiRuntimeConfig({
      ai_provider: 'deepseek',
      ai_api_key: '  sk-main-only-secret  ',
      ai_base_url: ' https://api.deepseek.com/// ',
      ai_model: 'deepseek-v4-flash',
      ai_temperature: '0.2',
      ai_max_tokens: '9000',
    });

    expect(runtime).toEqual({
      provider: 'openai-compatible',
      apiKey: 'sk-main-only-secret',
      keyConfigured: true,
      baseUrl: 'https://api.deepseek.com',
      model: 'deepseek-v4-flash',
      temperature: 0.2,
      maxTokens: 9000,
      persona: expect.stringContaining('亚马逊广告运营顾问'),
      outputLanguage: '简体中文',
    });
    expect(buildSystemAiProviderConfig(runtime)).toEqual({
      apiKey: 'sk-main-only-secret',
      baseUrl: 'https://api.deepseek.com',
      model: 'deepseek-v4-flash',
      temperature: 0.2,
      maxTokens: 9000,
    });
  });

  it('fingerprints only the non-secret analysis runtime authority inputs', () => {
    const first = resolveSystemAiRuntimeConfig({
      aiApiKey: 'sk-first-secret',
      aiBaseUrl: 'https://api.example.com/v1/',
      aiModel: 'model-a',
    });
    const second = resolveSystemAiRuntimeConfig({
      aiApiKey: 'sk-second-secret',
      aiBaseUrl: 'https://api.example.com/v1',
      aiModel: 'model-a',
    });
    const input = { system: first, storeAiRecommendationsEnabled: true };
    const payload = analysisAiRuntimeRevisionPayload(input);

    expect(payload).toEqual({
      provider: 'openai-compatible',
      baseUrl: 'https://api.example.com/v1',
      model: 'model-a',
      temperature: 0.3,
      maxTokens: 8192,
      personaHash: expect.stringMatching(/^[a-f0-9]{64}$/),
      outputLanguage: '简体中文',
      promptSchemaVersion: AD_STRATEGY_ANALYSIS_PROMPT_SCHEMA_VERSION,
      storeAiRecommendationsEnabled: true,
      keyConfigured: true,
    });
    expect(JSON.stringify(payload)).not.toContain('sk-first-secret');
    expect(analysisAiRuntimeRevision(input)).toBe(analysisAiRuntimeRevision({
      system: second,
      storeAiRecommendationsEnabled: true,
    }));
  });

  it('stales analysis authority when any effective AI runtime fact changes', () => {
    const system = resolveSystemAiRuntimeConfig({
      aiApiKey: 'sk-secret',
      aiBaseUrl: 'https://api.example.com/v1',
      aiModel: 'model-a',
    });
    const revision = analysisAiRuntimeRevision({ system, storeAiRecommendationsEnabled: true });
    const changed = [
      { system: { ...system, provider: 'future-provider' as never }, storeAiRecommendationsEnabled: true },
      { system: { ...system, baseUrl: 'https://api.other.example/v1' }, storeAiRecommendationsEnabled: true },
      { system: { ...system, model: 'model-b' }, storeAiRecommendationsEnabled: true },
      { system: { ...system, temperature: 0.7 }, storeAiRecommendationsEnabled: true },
      { system: { ...system, maxTokens: 16384 }, storeAiRecommendationsEnabled: true },
      { system: { ...system, persona: '另一个广告分析角色' }, storeAiRecommendationsEnabled: true },
      { system: { ...system, outputLanguage: 'English' }, storeAiRecommendationsEnabled: true },
      { system: { ...system, keyConfigured: false, apiKey: '' }, storeAiRecommendationsEnabled: true },
      { system, storeAiRecommendationsEnabled: false },
      { system, storeAiRecommendationsEnabled: true, promptSchemaVersion: 'ad_strategy_diagnosis_v2' },
    ];

    for (const candidate of changed) {
      expect(analysisAiRuntimeRevision(candidate)).not.toBe(revision);
    }
  });

  it('binds Mission generation revisions and both AI phases to one immutable Main snapshot', () => {
    const source = readFileSync(new URL('./index.ts', import.meta.url), 'utf8');
    const captureStart = source.indexOf('function captureRecommendationGenerationRuntimeSnapshot');
    const captureEnd = source.indexOf('async function runRecommendationGeneration', captureStart);
    const capture = source.slice(captureStart, captureEnd);
    expect(capture).toContain('currentStoreRuntimeAnalysisConfig()');
    expect(capture).toContain('aiSettings: { ...readAiSettingsForMain() }');
    expect(capture).toContain('deepFreezeGenerationSnapshot(snapshot)');

    const authorityStart = source.indexOf('captureGenerationAuthority: () => {');
    const authorityEnd = source.indexOf('currentRuleRevision:', authorityStart);
    const authority = source.slice(authorityStart, authorityEnd);
    expect(authority).toContain('const captured = captureRecommendationGenerationRuntimeSnapshot()');
    expect(authority).toContain('storeRuntimeRuleRevisionPayload(captured.runtimeConfig)');
    expect(authority).toContain('resolveSystemAiRuntimeConfig(captured.aiSettings)');
    expect(authority).toContain('runRecommendationGeneration(scope, captured)');

    const generationStart = source.indexOf('async function runRecommendationGeneration');
    const generationEnd = source.indexOf('interface AdStrategyGenerationSummary', generationStart);
    const generation = source.slice(generationStart, generationEnd);
    expect(generation).toContain('const runtimeConfig = generationRuntime.runtimeConfig');
    expect(generation).toContain('aiSettings: generationRuntime.aiSettings');
    expect(generation).toContain('generationRuntime.aiSettings,');
    expect(generation).not.toContain('currentStoreRuntimeAnalysisConfig()');
    expect(generation).not.toContain('readAiSettingsForMain()');

    const explanationsStart = source.indexOf('async function enrichAdRecommendationsWithAiExplanations');
    const explanationsEnd = source.indexOf('async function enrichAdRecommendationsWithStrategyDiagnosis', explanationsStart);
    const explanations = source.slice(explanationsStart, explanationsEnd);
    expect(explanations).not.toContain('readAiSettingsForMain()');

    const diagnosisStart = explanationsEnd;
    const diagnosisEnd = source.indexOf('function buildAiInsightsFromValidation', diagnosisStart);
    const diagnosis = source.slice(diagnosisStart, diagnosisEnd);
    expect(diagnosis).toContain('const settings = options.aiSettings');
    expect(diagnosis).not.toContain('readAiSettingsForMain()');
  });
});
