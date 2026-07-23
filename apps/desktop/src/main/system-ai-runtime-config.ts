import { createHash } from 'crypto';
import type { AIConfig } from '@amazon-ai-ops/ai-adapter';
import {
  normalizeAiSettingsRecord,
  type SystemAiProvider,
} from './ai-settings-normalization';

export const AD_STRATEGY_ANALYSIS_PROMPT_SCHEMA_VERSION = 'ad_strategy_diagnosis_v1' as const;

/** Main-only resolved AI runtime. The API key must never enter renderer projections or fingerprints. */
export interface SystemAiRuntimeConfig {
  provider: SystemAiProvider;
  apiKey: string;
  keyConfigured: boolean;
  baseUrl: string;
  model: string;
  temperature: number;
  maxTokens: number;
  persona: string;
  outputLanguage: string;
}

export interface AnalysisAiRuntimeRevisionInput {
  system: SystemAiRuntimeConfig;
  storeAiRecommendationsEnabled: boolean;
  promptSchemaVersion?: string;
}

export interface AnalysisAiRuntimeRevisionPayload {
  provider: SystemAiProvider;
  baseUrl: string;
  model: string;
  temperature: number;
  maxTokens: number;
  personaHash: string;
  outputLanguage: string;
  promptSchemaVersion: string;
  storeAiRecommendationsEnabled: boolean;
  keyConfigured: boolean;
}

export type SystemAiProviderConfig = AIConfig & { baseUrl: string };

export function resolveSystemAiRuntimeConfig(
  settings: Record<string, unknown> = {},
): SystemAiRuntimeConfig {
  const normalized = normalizeAiSettingsRecord(settings);
  return {
    provider: normalized.aiProvider,
    apiKey: normalized.aiApiKey,
    keyConfigured: Boolean(normalized.aiApiKey.trim()),
    baseUrl: normalizeAiRuntimeBaseUrl(normalized.aiBaseUrl),
    model: normalized.aiModel,
    temperature: finiteNumber(normalized.aiTemperature, 0.3),
    maxTokens: finiteInteger(normalized.aiMaxTokens, 8192),
    persona: normalized.aiPersona,
    outputLanguage: normalized.aiOutputLanguage,
  };
}

export function buildSystemAiProviderConfig(runtime: SystemAiRuntimeConfig): SystemAiProviderConfig {
  // The switch makes any future provider addition an explicit Main change.
  switch (runtime.provider) {
    case 'openai-compatible':
      return {
        apiKey: runtime.apiKey,
        baseUrl: runtime.baseUrl,
        model: runtime.model,
        temperature: runtime.temperature,
        maxTokens: runtime.maxTokens,
      };
  }
}

export function analysisAiRuntimeRevisionPayload(
  input: AnalysisAiRuntimeRevisionInput,
): AnalysisAiRuntimeRevisionPayload {
  return {
    provider: input.system.provider,
    baseUrl: normalizeAiRuntimeBaseUrl(input.system.baseUrl),
    model: input.system.model.trim(),
    temperature: input.system.temperature,
    maxTokens: input.system.maxTokens,
    personaHash: createHash('sha256').update(input.system.persona.trim()).digest('hex'),
    outputLanguage: input.system.outputLanguage.trim(),
    promptSchemaVersion: requiredVersion(
      input.promptSchemaVersion ?? AD_STRATEGY_ANALYSIS_PROMPT_SCHEMA_VERSION,
    ),
    storeAiRecommendationsEnabled: input.storeAiRecommendationsEnabled,
    keyConfigured: input.system.keyConfigured,
  };
}

export function analysisAiRuntimeRevision(input: AnalysisAiRuntimeRevisionInput): string {
  return createHash('sha256')
    .update(JSON.stringify(analysisAiRuntimeRevisionPayload(input)))
    .digest('hex');
}

export function normalizeAiRuntimeBaseUrl(value: unknown): string {
  return String(value ?? '').trim().replace(/\/+$/, '');
}

function requiredVersion(value: string): string {
  const normalized = value.trim();
  if (!normalized) throw new TypeError('AI prompt/schema version is required');
  return normalized;
}

function finiteNumber(value: unknown, fallback: number): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function finiteInteger(value: unknown, fallback: number): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? Math.trunc(parsed) : fallback;
}
