import { ExecutionAuthorityRepositoryError } from '@amazon-ai-ops/local-db';
import { PolicyGrantDispatchFailure } from './errors';
import { safeMessage } from './values';
export function classifyPolicyGrantDispatchFailure(error: unknown): PolicyGrantDispatchFailure {
    if (error instanceof PolicyGrantDispatchFailure)
        return error;
    if (error instanceof ExecutionAuthorityRepositoryError) {
        if (error.code === 'INVALID_CONTEXT' || error.code === 'STORE_NOT_ACTIVE') {
            return new PolicyGrantDispatchFailure('waiting_runtime', 'RUNTIME_UNAVAILABLE', 'The current Amazon Ads connection or visible session is not ready.');
        }
        if (error.code === 'STALE_CONTEXT') {
            return new PolicyGrantDispatchFailure('attention_required', 'SESSION_REAUTHORIZATION_REQUIRED', 'The store session changed; the prior grant cannot be rebound automatically.');
        }
        if (error.code === 'REFERENCE_CONFLICT' || error.code === 'REVISION_CONFLICT') {
            return new PolicyGrantDispatchFailure('attention_required', 'ADS_IDENTITY_AUTHORITY_CHANGED', 'The durable Ads object identity or revision changed and requires a fresh analysis.');
        }
    }
    const message = safeMessage(error);
    if (/(不属于|不一致|已变化|漂移|重绑|stale|mismatch|drift|cross-session|cross-store|stage 5)/i.test(message)) {
        return new PolicyGrantDispatchFailure('attention_required', 'ADS_IDENTITY_AUTHORITY_CHANGED', message);
    }
    if (/(浏览器|会话|登录|连接|正在运行|租约|browser|session|login|connection|not ready|unavailable|disconnected|another external write|lease)/i.test(message)) {
        return new PolicyGrantDispatchFailure('waiting_runtime', 'RUNTIME_UNAVAILABLE', message);
    }
    return new PolicyGrantDispatchFailure('attention_required', 'UNSAFE_DISPATCH_FAILURE', message);
}
