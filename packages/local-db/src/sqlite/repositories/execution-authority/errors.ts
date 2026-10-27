import type { AuthorityGateProjection } from '@amazon-ai-ops/shared-types/src/authority-gates';
import { ExecutionAuthorityErrorCode } from './contracts';
export class ExecutionAuthorityRepositoryError extends Error {
    constructor(readonly code: ExecutionAuthorityErrorCode, message: string) {
        super(message);
        this.name = 'ExecutionAuthorityRepositoryError';
    }
}
export class ExecutionAuthorityGateError extends ExecutionAuthorityRepositoryError {
    constructor(code: ExecutionAuthorityErrorCode, message: string, readonly authorityGate: AuthorityGateProjection) {
        super(code, message);
        this.name = 'ExecutionAuthorityGateError';
    }
}
