import { readFileSync } from 'node:fs';
import ts from 'typescript';
import { describe, expect, it } from 'vitest';

const source = readFileSync(new URL('./index.ts', import.meta.url), 'utf8');
const startupRecoveryMethodNames = [
  'issueStartupRecoveryConfirmationCapability',
  'confirmStartupRecoverySafe',
] as const;

function findStartupRecoveryConfirmationReferences(candidate: string): string[] {
  const sourceFile = ts.createSourceFile(
    'policy-dispatch-suppression-contract.ts',
    candidate,
    ts.ScriptTarget.Latest,
    true,
    ts.ScriptKind.TS,
  );
  const methodNames = new Set<string>(startupRecoveryMethodNames);
  const found = new Set<string>();
  const visit = (node: ts.Node): void => {
    if ((ts.isIdentifier(node)
      || ts.isStringLiteral(node)
      || ts.isNoSubstitutionTemplateLiteral(node))
      && methodNames.has(node.text)) {
      found.add(node.text);
    }
    ts.forEachChild(node, visit);
  };
  visit(sourceFile);
  return Array.from(found);
}

describe('Main policy-dispatch suppression composition root', () => {
  it('shares one fail-closed controller through a delayed Execution read port and MainRuntime', () => {
    const constructor = 'const storeCollectionPolicySuppression = new StoreCollectionPolicySuppressionController();';
    const authority = 'const executionAuthorityService = new ExecutionAuthorityService({';

    expect(source).toContain(
      "import { StoreCollectionPolicySuppressionController } from './store-collection-policy-suppression';",
    );
    expect(source.match(/new StoreCollectionPolicySuppressionController\(\)/g)).toHaveLength(1);
    expect(source.indexOf(constructor)).toBeGreaterThan(0);
    expect(source.indexOf(constructor)).toBeLessThan(source.indexOf(authority));
    expect(source).toContain('const executionPolicyDispatchSuppression = Object.freeze({');
    expect(source).toContain('state.storeCollectionMainRuntime?.isPolicyDispatchSuppressed()');
    expect(source).toContain('?? storeCollectionPolicySuppression.isPolicyDispatchSuppressed()');
    expect(source).toContain('policyDispatchSuppression: executionPolicyDispatchSuppression,');
    expect(source).toContain('policySuppression: storeCollectionPolicySuppression,');
    expect(source).toContain('await state.storeCollectionMainRuntime!.recoverStartupThenConfirm()');
    expect(findStartupRecoveryConfirmationReferences(source)).toEqual([]);
    expect(source).not.toContain('storeCollectionPolicySuppression.resume');
    expect(source).not.toContain('storeCollectionPolicySuppression.pump');
  });

  it('detects startup recovery confirmation calls made through an alias', () => {
    const aliasFixture = `
      const suppressionAlias = storeCollectionPolicySuppression;
      const capability = suppressionAlias.issueStartupRecoveryConfirmationCapability();
      suppressionAlias.confirmStartupRecoverySafe(capability);
    `;

    expect(findStartupRecoveryConfirmationReferences(aliasFixture)).toEqual([
      'issueStartupRecoveryConfirmationCapability',
      'confirmStartupRecoverySafe',
    ]);
  });

  it('detects startup recovery confirmation calls made through bracket access', () => {
    const bracketFixture = `
      const suppressionAlias = storeCollectionPolicySuppression;
      const capability = suppressionAlias['issueStartupRecoveryConfirmationCapability']();
      suppressionAlias["confirmStartupRecoverySafe"](capability);
    `;

    expect(findStartupRecoveryConfirmationReferences(bracketFixture)).toEqual([
      'issueStartupRecoveryConfirmationCapability',
      'confirmStartupRecoverySafe',
    ]);
  });

  it.each([
    [
      'optional chaining',
      `
        const suppressionAlias = storeCollectionPolicySuppression;
        const capability = suppressionAlias
          ?.issueStartupRecoveryConfirmationCapability?.();
        suppressionAlias?.confirmStartupRecoverySafe?.(capability);
      `,
    ],
    [
      'destructuring',
      `
        const {
          issueStartupRecoveryConfirmationCapability: issueRecovery,
          confirmStartupRecoverySafe: confirmRecovery,
        } = storeCollectionPolicySuppression;
        const capability = issueRecovery();
        confirmRecovery(capability);
      `,
    ],
    [
      'bind aliases',
      `
        const suppressionAlias = storeCollectionPolicySuppression;
        const issueRecovery = suppressionAlias
          .issueStartupRecoveryConfirmationCapability
          .bind(suppressionAlias);
        const confirmRecovery = suppressionAlias['confirmStartupRecoverySafe']
          .bind(suppressionAlias);
        const capability = issueRecovery();
        confirmRecovery(capability);
      `,
    ],
    [
      'indirect function aliases',
      `
        const suppressionAlias = storeCollectionPolicySuppression;
        const issueRecovery = suppressionAlias.issueStartupRecoveryConfirmationCapability;
        const indirectIssueRecovery = issueRecovery;
        const confirmRecovery = suppressionAlias.confirmStartupRecoverySafe;
        const indirectConfirmRecovery = confirmRecovery;
        const capability = indirectIssueRecovery();
        indirectConfirmRecovery(capability);
      `,
    ],
  ])('detects startup recovery confirmation calls made through %s', (_label, fixture) => {
    expect(findStartupRecoveryConfirmationReferences(fixture)).toEqual([
      'issueStartupRecoveryConfirmationCapability',
      'confirmStartupRecoverySafe',
    ]);
  });
});
