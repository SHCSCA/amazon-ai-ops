import  {
  describe,
  expect,
  expectTypeOf,
  it,
} from 'vitest';
import { ExecutionAuthorityService, type ExecutionAuthorityServiceOptions } from './execution-authority-service';
import { type PolicyDispatchSuppressionReadPort } from './store-collection-policy-suppression';
describe("ExecutionAuthorityService safety orchestration", () => {
it('requires an explicit policy suppression read port at type and runtime boundaries', () => {
    type SuppressionPortIsRequired = ExecutionAuthorityServiceOptions extends {
      policyDispatchSuppression: PolicyDispatchSuppressionReadPort;
    } ? true : false;
    expectTypeOf<SuppressionPortIsRequired>().toEqualTypeOf<true>();
    expect(() => new ExecutionAuthorityService(
      {} as ExecutionAuthorityServiceOptions,
    )).toThrow('policyDispatchSuppression read port is required');
  });
});
