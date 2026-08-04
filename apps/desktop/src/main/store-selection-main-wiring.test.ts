import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

describe('Main store selection and cross-store status wiring', () => {
  const source = fs.readFileSync(path.join(__dirname, 'index.ts'), 'utf8');

  it('restores operator selection only after startup recovery has settled', () => {
    const coordinatorConstruction = source.indexOf('const storeCoordinator = new StoreCoordinator');
    const runtimeRecovery = source.indexOf("console.log('[App] init:store-collection-runtime-recovery-confirmed')");
    const executionRecovery = source.indexOf('executionAuthorityService.recoverStartup()');
    const selectionRestore = source.indexOf('restoreOperatorWorkspaceSelectionAfterRecovery()');

    expect(coordinatorConstruction).toBeGreaterThan(-1);
    expect(selectionRestore).toBeGreaterThan(runtimeRecovery);
    expect(selectionRestore).toBeGreaterThan(executionRecovery);
    expect(source.slice(coordinatorConstruction, runtimeRecovery))
      .not.toContain('restoreOperatorWorkspaceSelectionAfterRecovery()');
  });

  it('uses app_settings selection storage and a deferred cross-store read transaction', () => {
    expect(source).toContain("operator_workspace_selection:v1");
    expect(source).toContain("selectionPersistence: packageUiReadOnlyRuntime ? 'read_only' : 'read_write'");
    expect(source).toContain('readTransaction: (work) => state.db!.transaction(work).deferred()');
    expect(source).not.toContain('readTransaction: (work) => state.storeRepo!.transaction(work)');
  });

  it('registers the read model separately from the user store mutation lane', () => {
    expect(source).toContain('const storeDailyStatusReader = new StoreDailyStatusProjectionReader');
    expect(source).toContain('}, state.storeDailyStatusReader);');
  });

  it('fails every store mutation closed at the Main lane entry in Package UI read-only mode', () => {
    const laneEntry = source.indexOf('withUserStoreMutation: async (scope, work) => {');
    const readOnlyGuard = source.indexOf('if (packageUiReadOnlyRuntime)', laneEntry);
    const authorityRead = source.indexOf(
      'const active = state.storeCoordinator!.getActiveStoreContext()',
      laneEntry,
    );

    expect(laneEntry).toBeGreaterThan(-1);
    expect(readOnlyGuard).toBeGreaterThan(laneEntry);
    expect(readOnlyGuard).toBeLessThan(authorityRead);
    expect(source.slice(readOnlyGuard, authorityRead)).toContain("'PACKAGE_UI_READ_ONLY'");
  });

  it('validates an exact switch target inside the lane before closing the visible runtime', () => {
    const laneCallback = source.indexOf(
      'const laneActive = state.storeCoordinator!.getActiveStoreContext()',
    );
    const targetPreflight = source.indexOf(
      'assertStoreIpcMutationTargetPreflight(',
      laneCallback,
    );
    const visibleTransition = source.indexOf('runUserVisibleBrowserTransition({', laneCallback);
    expect(laneCallback).toBeGreaterThan(-1);
    expect(targetPreflight).toBeGreaterThan(laneCallback);
    expect(targetPreflight).toBeLessThan(visibleTransition);
  });
});
