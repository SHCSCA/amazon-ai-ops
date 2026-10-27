import { authorityGateProjection, type AuthorityGatePriority, type AuthorityGateProjection } from '@amazon-ai-ops/shared-types/src/authority-gates';
import { MissionDomainRepositoryError } from './errors';
export interface MissionAuthorityGateCheck {
  priority: AuthorityGatePriority;
  check: () => void;
}

export interface MissionAuthorityGateFailure {
  priority: AuthorityGatePriority;
  error: unknown;
}

export class MissionAuthorityGateError extends MissionDomainRepositoryError {
  readonly authorityGate: AuthorityGateProjection;

  constructor(readonly failures: readonly MissionAuthorityGateFailure[]) {
    const projection = authorityGateProjection(failures.map(failure => failure.priority));
    const first = failures[0]?.error;
    if (!projection) throw new TypeError('门禁错误必须包含至少一项失败。');
    super(first instanceof MissionDomainRepositoryError ? first.code : 'STATE_CONFLICT',
      first instanceof Error ? first.message : projection.primaryBlocker.message);
    this.name = 'MissionAuthorityGateError';
    this.authorityGate = projection;
  }
}

export function assertMissionAuthorityGates(checks: readonly MissionAuthorityGateCheck[]): void {
  const failures: MissionAuthorityGateFailure[] = [];
  const ordered = [...checks].sort((left, right) => left.priority.localeCompare(right.priority));
  for (const gate of ordered) {
    try { gate.check(); }
    catch (error) { failures.push({ priority: gate.priority, error }); }
  }
  if (failures.length) throw new MissionAuthorityGateError(failures);
}
