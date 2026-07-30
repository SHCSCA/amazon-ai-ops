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
  it('publishes one fail-closed controller to Execution Authority without confirming startup', () => {
    const constructor = 'const storeCollectionPolicySuppression = new StoreCollectionPolicySuppressionController();';
    const authority = 'const executionAuthorityService = new ExecutionAuthorityService({';
    const publish = 'state.storeCollectionPolicySuppression = storeCollectionPolicySuppression;';

    expect(source).toContain(
      "import { StoreCollectionPolicySuppressionController } from './store-collection-policy-suppression';",
    );
    expect(source.indexOf(constructor)).toBeGreaterThan(0);
    expect(source.indexOf(constructor)).toBeLessThan(source.indexOf(authority));
    expect(source).toContain('policyDispatchSuppression: storeCollectionPolicySuppression,');
    expect(source.indexOf(publish)).toBeGreaterThan(source.indexOf(authority));
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
