import type { SettingsRuleConfig } from '../types';

export const DEFAULT_QUANT_RULE_CONFIG: Pick<SettingsRuleConfig, 'targetAcos' | 'highAcosThreshold' | 'noOrderClickThreshold' | 'minSpend'> = {
  targetAcos: 0.25,
  highAcosThreshold: 0.4,
  noOrderClickThreshold: 30,
  minSpend: 10,
};
