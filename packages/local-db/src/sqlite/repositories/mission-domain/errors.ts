export type MissionDomainRepositoryErrorCode =
  | 'INVALID_CONTEXT'
  | 'STALE_CONTEXT'
  | 'STORE_NOT_ACTIVE'
  | 'INVALID_INPUT'
  | 'NOT_FOUND'
  | 'REVISION_CONFLICT'
  | 'STATE_CONFLICT'
  | 'REFERENCE_CONFLICT'
  | 'IMMUTABLE_RECORD'
  | 'DUPLICATE_IDENTITY';

export class MissionDomainRepositoryError extends Error {
  constructor(
    readonly code: MissionDomainRepositoryErrorCode,
    message: string,
  ) {
    super(message);
    this.name = 'MissionDomainRepositoryError';
  }
}
