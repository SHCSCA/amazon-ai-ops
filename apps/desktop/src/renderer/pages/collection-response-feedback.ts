import type { StoreContextEnvelope } from '@amazon-ai-ops/shared-types';
import { collectionActionFeedbackBelongsToAuthority } from './collection-jobs';

export async function refreshCollectionForwardResponse(input: {
  captured: StoreContextEnvelope;
  current: StoreContextEnvelope | null;
  isCurrent(): boolean;
  refresh(context: StoreContextEnvelope): Promise<void>;
  setNotice(message: string): void;
  notifyDataUpdated(): void;
}): Promise<boolean> {
  if (!input.isCurrent() || !input.current
    || input.current.sessionGeneration <= input.captured.sessionGeneration
    || !collectionActionFeedbackBelongsToAuthority(input.captured, input.current)) return false;
  // 新会话只重读当前账本，不把旧响应升级为新会话的成功事实或授权。
  input.setNotice('采集动作已返回，店铺会话已更新，正在重新核对当前任务记录…');
  await input.refresh({ ...input.current });
  if (input.isCurrent()) {
    input.notifyDataUpdated();
    input.setNotice('采集动作已返回；已请求刷新当前店铺账本，请按最新任务状态确认结果。');
  }
  return true;
}
