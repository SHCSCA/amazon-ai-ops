import { DEFAULT_RULE_CONFIG, type RuleConfig } from '@amazon-ai-ops/rules-engine';
import type { ConfigurationBus } from './configuration-bus';

export function bindRuleConfiguration(
  bus: ConfigurationBus,
  apply: (configuration: RuleConfig) => void,
): () => void {
  const refresh = (): void => {
    apply((bus.getRuleConfig() ?? DEFAULT_RULE_CONFIG) as unknown as RuleConfig);
  };
  refresh();
  return bus.subscribe((change) => {
    if (change.key === 'rule_config') refresh();
  });
}
