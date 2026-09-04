/**
 * V1.6 Six-Module Navigation Tests
 */

import { describe, it, expect } from 'vitest';
import { getModuleDefaultIntent } from './v16-module-navigation';

describe('getModuleDefaultIntent', () => {
  it('returns correct default intent for today module', () => {
    expect(getModuleDefaultIntent('today')).toEqual({
      workspace: 'today',
      subview: 'overview',
    });
  });

  it('returns correct default intent for operations-assets module', () => {
    expect(getModuleDefaultIntent('operations-assets')).toEqual({
      workspace: 'objects',
      subview: 'products',
    });
  });

  it('returns correct default intent for decision-center module', () => {
    expect(getModuleDefaultIntent('decision-center')).toEqual({
      workspace: 'missions',
      subview: 'overview',
    });
  });

  it('returns correct default intent for execution-experiments module', () => {
    expect(getModuleDefaultIntent('execution-experiments')).toEqual({
      workspace: 'execution',
      subview: 'live',
    });
  });

  it('returns correct default intent for operating-memory module', () => {
    expect(getModuleDefaultIntent('operating-memory')).toEqual({
      workspace: 'memory',
      subview: 'timeline',
    });
  });

  it('returns correct default intent for system-settings module', () => {
    expect(getModuleDefaultIntent('system-settings')).toEqual({
      workspace: 'policy',
      subview: 'rules',
    });
  });

  it('throws error for unknown module id', () => {
    expect(() => getModuleDefaultIntent('unknown' as any)).toThrow(/Unknown module id/);
  });
});
