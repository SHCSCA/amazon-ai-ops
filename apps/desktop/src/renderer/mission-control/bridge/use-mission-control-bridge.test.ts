import fs from 'node:fs';
import { describe, expect, it } from 'vitest';

describe('useMissionControlBridge contract', () => {
  it('resets and re-bootstrap on authority changes and guards both query and command responses', () => {
    const source = fs.readFileSync(new URL('./use-mission-control-bridge.ts', import.meta.url), 'utf8');
    expect(source).toContain('setCapabilities([])');
    expect(source).toContain('setAutonomy(null)');
    expect(source).toContain('store.authorityKey');
    expect(source).toContain('store.contextEpoch');
    expect(source.match(/isMissionControlResponseCurrent/g)?.length).toBeGreaterThanOrEqual(2);
    expect(source).toContain('.missionControl.query');
    expect(source).toContain('.missionControl.command');
    expect(source).toContain('latestBootstrapSequenceRef');
    expect(source).toContain('bootstrapSequence !== latestBootstrapSequenceRef.current');
  });

  it('propagates command transport failures instead of reporting a false success', () => {
    const source = fs.readFileSync(new URL('./use-mission-control-bridge.ts', import.meta.url), 'utf8');
    const commandBlock = source.slice(source.indexOf('const setAutonomyMode'), source.indexOf('return { capabilities'));
    expect(commandBlock).toContain('throw caught');
    expect(commandBlock).not.toMatch(/catch \(caught\)[\s\S]*return null;/);
  });
});
