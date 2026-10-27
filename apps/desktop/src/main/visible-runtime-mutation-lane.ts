import {
  type MutationAuthorityRecord,
  type MutationClaimRecord,
  type StoreMutationLaneClaim,
  type StoreMutationLaneKind,
  StoreMutationLaneError,
  type StoreMutationLaneReleaseReceipt,
  type StoreMutationLaneSnapshot,
} from "./visible-runtime-contracts";
import {
  normalizeOwner,
  runtimeObject,
} from "./visible-runtime-values";

export class StoreMutationLane {
  private readonly authorities = new WeakMap<object, MutationAuthorityRecord>();
  private readonly claims = new WeakMap<object, MutationClaimRecord>();
  private current: StoreMutationLaneClaim | null = null;
  private sequence = 0;
  private stickyUnknown = false;

  registerAuthority(input: {
    kind: StoreMutationLaneKind;
    owner: string;
    capability: Readonly<object>;
  }): void {
    this.assertSafetyKnown();
    const owner = normalizeOwner(input?.owner);
    if ((input.kind !== 'user' && input.kind !== 'automation')
      || !runtimeObject(input.capability)) {
      throw new StoreMutationLaneError(
        'INVALID_AUTHORITY',
        'mutation lane authority is invalid',
      );
    }
    const previous = this.authorities.get(input.capability);
    if (previous
      && (previous.kind !== input.kind || previous.owner !== owner)) {
      throw new StoreMutationLaneError(
        'INVALID_AUTHORITY',
        'mutation lane capability cannot cross owner or user/automation domains',
      );
    }
    if (!previous) {
      this.authorities.set(input.capability, {
        kind: input.kind,
        owner,
        lifecycle: 'registered',
      });
    }
  }

  claim(input: {
    kind: StoreMutationLaneKind;
    owner: string;
    capability: Readonly<object>;
  }): StoreMutationLaneClaim {
    this.assertSafetyKnown();
    const owner = normalizeOwner(input?.owner);
    const record = runtimeObject(input?.capability)
      ? this.authorities.get(input.capability)
      : undefined;
    if (!record || record.kind !== input.kind || record.owner !== owner) {
      throw new StoreMutationLaneError(
        'INVALID_AUTHORITY',
        'mutation lane authority is forged or owner/domain mismatched',
      );
    }
    if (record.lifecycle !== 'registered') {
      throw new StoreMutationLaneError(
        'AUTHORITY_REPLAYED',
        'mutation lane authority is one-shot and was already claimed',
      );
    }
    if (this.current) {
      throw new StoreMutationLaneError(
        'LANE_HELD',
        `store mutation lane is already held by ${this.current.kind}:${this.current.owner}`,
      );
    }
    const sequence = this.sequence + 1;
    if (!Number.isSafeInteger(sequence)) {
      throw new StoreMutationLaneError(
        'SEQUENCE_EXHAUSTED',
        'store mutation lane sequence is exhausted',
      );
    }
    this.sequence = sequence;
    // 返回调用方前消费权限，确保首次等待前令牌已不可重放。
    record.lifecycle = 'claimed';
    const claimCapability = Object.freeze({});
    const claim = Object.freeze({
      kind: input.kind,
      owner,
      authorityCapability: input.capability,
      claimCapability,
      sequence,
    }) as StoreMutationLaneClaim;
    this.claims.set(claimCapability, { claim, released: false });
    this.current = claim;
    return claim;
  }

  release(claim: StoreMutationLaneClaim): StoreMutationLaneReleaseReceipt {
    this.assertSafetyKnown();
    const record = claim && runtimeObject(claim.claimCapability)
      ? this.claims.get(claim.claimCapability)
      : undefined;
    if (!record || record.claim !== claim || this.current !== claim) {
      throw new StoreMutationLaneError(
        record?.released ? 'CLAIM_REPLAYED' : 'INVALID_CLAIM',
        'mutation lane claim is forged, stale, or replayed',
      );
    }
    const authority = this.authorities.get(claim.authorityCapability);
    if (!authority
      || authority.lifecycle !== 'claimed'
      || authority.kind !== claim.kind
      || authority.owner !== claim.owner) {
      throw new StoreMutationLaneError(
        'INVALID_AUTHORITY',
        'mutation lane authority lifecycle no longer matches the exact claim',
      );
    }
    record.released = true;
    authority.lifecycle = 'released';
    this.current = null;
    return Object.freeze({
      claimCapability: claim.claimCapability,
      released: true,
      sequence: claim.sequence,
    });
  }

  isHeld(): boolean {
    return this.current !== null;
  }

  markSafetyStateUnknown(): StoreMutationLaneSnapshot {
    this.stickyUnknown = true;
    return this.inspect();
  }

  inspect(): StoreMutationLaneSnapshot {
    const current = this.current
      ? Object.freeze({
        kind: this.current.kind,
        owner: this.current.owner,
        sequence: this.current.sequence,
      })
      : undefined;
    return Object.freeze({
      state: this.stickyUnknown
        ? 'sticky_unknown'
        : current
          ? 'held'
          : 'available',
      held: current !== undefined,
      stickyUnknown: this.stickyUnknown,
      sequence: this.sequence,
      ...(current ? { current } : {}),
    });
  }

  private assertSafetyKnown(): void {
    if (this.stickyUnknown) {
      throw new StoreMutationLaneError(
        'SAFETY_STATE_UNKNOWN',
        'store mutation lane safety state is unknown',
      );
    }
  }
}
