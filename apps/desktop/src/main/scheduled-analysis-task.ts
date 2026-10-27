import type { LocalScheduler } from '@amazon-ai-ops/scheduler';

export interface ScheduledAnalysisTaskPorts<Scope> {
  readScope(): Scope;
  runAnalysis(scope: Scope): Promise<unknown>;
}

export function registerScheduledAnalysisTask<Scope>(
  scheduler: Pick<LocalScheduler, 'register'>,
  ports: ScheduledAnalysisTaskPorts<Scope>,
): void {
  scheduler.register({
    name: 'daily_recommendation_generate',
    cron: '0 9 * * *',
    enabled: false,
    callback: async () => { await ports.runAnalysis(ports.readScope()); },
  });
}
