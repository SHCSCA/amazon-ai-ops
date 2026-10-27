export function createWorkspaceOperationState() {
  let key: string | null = null;
  let generation = 0;
  let active: symbol | null = null;
  return {
    update(next: string) {
      if (next !== key) { generation += 1; active = null; key = next; }
    },
    invalidate() { generation += 1; active = null; },
    retireActive() { active = null; },
    capture() { const requested = generation; return () => requested === generation; },
    begin() {
      if (active) return null;
      const token = Symbol(), requested = generation;
      active = token;
      return {
        isCurrent: () => requested === generation && active === token,
        finish() { if (active === token) active = null; },
      };
    },
  };
}
