import { useStoreConnectionWorkbench,type StoreConnectionWorkbenchProps } from './app-store-connection-controller';
import { StoreConnectionWorkbenchView } from './app-store-connection-view';

export function StoreConnectionWorkbench(props: StoreConnectionWorkbenchProps) {
  return <StoreConnectionWorkbenchView {...useStoreConnectionWorkbench(props)} />;
}
