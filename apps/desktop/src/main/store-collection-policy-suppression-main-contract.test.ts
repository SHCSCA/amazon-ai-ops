import { mainRuntimeModuleContracts, mainRuntimeModuleContract, mainRuntimeFunctionContract, mainRuntimeVariableContract, mainRuntimeSectionContract } from './main-runtime-source.test-support';
import { readFileSync } from 'node:fs';
import ts from 'typescript';
import { describe, expect, it } from 'vitest';

const source = mainRuntimeModuleContract('main-runtime-context.ts');
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

    expect(mainRuntimeModuleContract('main-runtime-context.ts')).toContain(
      "import { StoreCollectionPolicySuppressionController } from './store-collection-policy-suppression';",
    );
    expect(source.match(/new StoreCollectionPolicySuppressionController\(\)/g)).toHaveLength(1);
    expect(source.indexOf(constructor)).toBeGreaterThan(0);
    const initialization = mainRuntimeFunctionContract('initApp');
    const collection = mainRuntimeFunctionContract('initializeStoreCollectionProductionRuntime');
    const entry = mainRuntimeModuleContract('index.ts');
    expect(initialization.indexOf(authority)).toBeGreaterThan(0);
    expect(entry.indexOf('installMainRuntimeContext(createMainRuntimeContext(__filename))')).toBeLessThan(entry.indexOf('void startDesktopApplication({'));
    expect(mainRuntimeModuleContract('main-runtime-context.ts')).toContain('const executionPolicyDispatchSuppression = Object.freeze({');
    expect(mainRuntimeModuleContract('main-runtime-context.ts')).toContain('state.storeCollectionMainRuntime?.isPolicyDispatchSuppressed()');
    expect(mainRuntimeModuleContract('main-runtime-context.ts')).toContain('?? storeCollectionPolicySuppression.isPolicyDispatchSuppressed()');
    expect(mainRuntimeModuleContract('main-application-initialization-runtime.ts')).toContain('policyDispatchSuppression: executionPolicyDispatchSuppression,');
    expect(mainRuntimeModuleContract('main-collection-initialization-runtime.ts')).toContain('policySuppression: storeCollectionPolicySuppression,');
    expect(mainRuntimeModuleContract('main-application-initialization-runtime.ts')).toContain('await state.storeCollectionMainRuntime!.recoverStartupThenConfirm()');
    expect(mainRuntimeModuleContracts().flatMap((module) => findStartupRecoveryConfirmationReferences(module.source))).toEqual([]);
    for (const module of mainRuntimeModuleContracts()) { expect(module.source).not.toContain('storeCollectionPolicySuppression.resume'); }
    for (const module of mainRuntimeModuleContracts()) { expect(module.source).not.toContain('storeCollectionPolicySuppression.pump'); }
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
