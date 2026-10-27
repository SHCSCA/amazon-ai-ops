import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { invalidateV16Outputs } from './delivery-v16-output-state';
import type { DeliveryV16Request } from './delivery-v16-contracts';

const roots: string[] = [];
function fixture() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'amazon-ai-ops-v16-invalidation-'));
  roots.push(root);
  const nonce = '43e27ff7-7768-4ce9-a958-4a364c719761', output = path.join(root, nonce);
  fs.mkdirSync(path.join(output, 'delivery-bundle'), { recursive: true });
  fs.writeFileSync(path.join(root, 'formal-original.json'), 'preserve-original');
  fs.writeFileSync(path.join(output, 'README.md'), '**DELIVERY: APP_READY — READY.** isolated test marker\n');
  for (const file of ['readiness.json', 'publication-closure.json', 'delivery-bundle/delivery-bundle-manifest.json']) fs.writeFileSync(path.join(output, file), JSON.stringify({ phase: 'PUBLISHED' }));
  return { root, output, request: { paths: { outputRoot: root }, binding: { nonce, epoch: 1, authoritySha256: 'test' } } as DeliveryV16Request };
}
afterEach(() => { for (const root of roots.splice(0)) fs.rmSync(root, { recursive: true, force: true }); });

describe('V16 private output invalidation', () => {
  it('revokes each private publication and preserves the work package original', async () => {
    const input = fixture();
    await invalidateV16Outputs(input.request, new Error('AUTHORITY_CHANGED'));
    expect(fs.readFileSync(path.join(input.output, 'README.md'), 'utf8')).toContain('INTERNAL NON_READY');
    expect(JSON.parse(fs.readFileSync(path.join(input.output, 'readiness.json'), 'utf8')).overallStatus).toBe('APP_NEEDS_WORK');
    for (const file of ['publication-closure.json', 'delivery-bundle/delivery-bundle-manifest.json']) expect(JSON.parse(fs.readFileSync(path.join(input.output, file), 'utf8'))).toMatchObject({ phase: 'ABORTED', status: 'APP_NEEDS_WORK' });
    expect(fs.readFileSync(path.join(input.root, 'formal-original.json'), 'utf8')).toBe('preserve-original');
  });
  it('continues to revoke the bundle when the README and closure each refuse invalidation', async () => {
    const input = fixture();
    for (const file of ['README.md', 'publication-closure.json']) { fs.unlinkSync(path.join(input.output, file)); fs.mkdirSync(path.join(input.output, file)); }
    const failure = await invalidateV16Outputs(input.request, new Error('CANCELLED')).catch(error => error);
    expect(failure).toBeInstanceOf(AggregateError);
    expect(failure.errors).toHaveLength(2);
    expect(JSON.parse(fs.readFileSync(path.join(input.output, 'delivery-bundle/delivery-bundle-manifest.json'), 'utf8')).phase).toBe('ABORTED');
    expect(JSON.parse(fs.readFileSync(path.join(input.output, 'readiness.json'), 'utf8')).overallStatus).toBe('APP_NEEDS_WORK');
  });
  it('does not create a publication for a request that never wrote output', async () => {
    const input = fixture();
    const request = { ...input.request, binding: { ...input.request.binding, nonce: 'never-started' } };
    await invalidateV16Outputs(request, new Error('SPAWN_FAILED'));
    expect(fs.existsSync(path.join(input.root, 'never-started'))).toBe(false);
  });
});
