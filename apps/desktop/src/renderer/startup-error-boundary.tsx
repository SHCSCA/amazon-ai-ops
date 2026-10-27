import React from 'react';
import { WorkspaceState } from './components/workspace/workspace-state';
import { rendererRuntimeLog } from './runtime-log';

interface StartupErrorBoundaryProps {
  children: React.ReactNode;
  reload?: () => void;
}

interface StartupErrorBoundaryState {
  failed: boolean;
  reloading: boolean;
  retryFailed: boolean;
}

export class StartupErrorBoundary extends React.Component<StartupErrorBoundaryProps, StartupErrorBoundaryState> {
  state: StartupErrorBoundaryState = { failed: false, reloading: false, retryFailed: false };
  private reloadAdmitted = false;

  static getDerivedStateFromError(): Partial<StartupErrorBoundaryState> {
    return { failed: true };
  }

  componentDidCatch(error: Error, info: React.ErrorInfo): void {
    rendererRuntimeLog.error('renderer.startup_render_failed', { error, componentStack: info.componentStack });
  }

  private reload = (): void => {
    if (this.reloadAdmitted) return;
    this.reloadAdmitted = true;
    this.setState({ reloading: true, retryFailed: false });
    try {
      (this.props.reload ?? (() => window.location.reload()))();
    } catch (error) {
      rendererRuntimeLog.error('renderer.startup_reload_failed', { error });
      this.reloadAdmitted = false;
      this.setState({ reloading: false, retryFailed: true });
    }
  };

  render(): React.ReactNode {
    if (!this.state.failed) return this.props.children;
    return (
      <main aria-label="应用启动恢复" className="page-frame">
        <WorkspaceState
          kind="error"
          title="应用未能完成启动"
          description={this.state.retryFailed
            ? '重新加载未能启动。请关闭并重新打开应用，并保留日志供排查。'
            : '启动时发生错误，工作台尚未加载。请手动重新加载；若仍失败，请关闭并重新打开应用，并保留日志供排查。'}
          action={{
            label: '重新加载应用',
            onClick: this.reload,
            busy: this.state.reloading,
            busyLabel: '正在重新加载…',
            disabledReason: '正在重新加载应用，请等待新界面出现。',
          }}
        />
      </main>
    );
  }
}
