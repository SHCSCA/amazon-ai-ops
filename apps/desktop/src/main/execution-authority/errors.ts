import { type PolicyGrantDispatchCode } from '@amazon-ai-ops/local-db';
export class ExecutionAuthorityShutdownError extends Error {
    readonly code = 'DRAIN_TIMEOUT' as const;
    constructor(readonly timeoutMs: number, message = 'Execution authority did not drain before the shutdown deadline.', options?: {
        cause?: unknown;
    }) {
        super(message, options);
        this.name = 'ExecutionAuthorityShutdownError';
    }
}
export class PolicyGrantDispatchFailure extends Error {
    constructor(readonly status: 'waiting_runtime' | 'attention_required', readonly code: PolicyGrantDispatchCode, message: string) {
        super(message);
        this.name = 'PolicyGrantDispatchFailure';
    }
}
