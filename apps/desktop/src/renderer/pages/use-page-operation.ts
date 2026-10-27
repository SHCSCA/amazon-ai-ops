import { useWorkspaceOperation } from '../components/workspace/use-workspace-operation';
import { useOptionalMissionControlStoreContext } from '../mission-control/store-context';

export function usePageOperation(scopeKey: string) {
  const authority = useOptionalMissionControlStoreContext();
  const contextKey = JSON.stringify([authority?.authorityKey, authority?.contextEpoch,
    authority?.phase, authority?.authoritativeContext, scopeKey]);
  const operation = useWorkspaceOperation(contextKey);
  const hasAuthority = authority?.phase === 'ready' && Boolean(authority.authoritativeContext);
  const blockedReason = authority?.phase === 'loading' || authority?.phase === 'switching'
    ? '正在确认当前店铺，请等待顶部店铺状态就绪后重试。'
    : '当前店铺权威尚未就绪，请在顶部选择店铺并重新连接后重试。';
  return { ...operation, authority, contextKey, hasAuthority, blockedReason,
    begin: () => hasAuthority ? operation.begin() : null };
}
