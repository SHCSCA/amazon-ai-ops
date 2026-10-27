import {
  type VisibleBrowserRuntimeEmptyProof,
  VisibleBrowserRuntimeRegistryError,
} from "./visible-runtime-contracts";
import {
  runtimeObject,
} from "./visible-runtime-values";
import type { VisibleRuntimeRegistryContext } from './visible-runtime-runtime';

export function proveEmpty(this: VisibleRuntimeRegistryContext): VisibleBrowserRuntimeEmptyProof {
    if (this.terminalSealed) return this.requireTerminalEmptyProof();
    if (this.terminalSealing) {
      throw new VisibleBrowserRuntimeRegistryError(
        'RUNTIME_CLOSING',
        'cannot issue an independently consumable proof while terminal sealing is in progress',
      );
    }
    if (this.currentRuntime || this.closing) {
      throw new VisibleBrowserRuntimeRegistryError(
        'RUNTIME_ALREADY_ACTIVE',
        'cannot prove the visible runtime registry empty while a runtime is attached',
      );
    }
    return this.issueEmptyProof();
  }

export function consumeEmptyProof(this: VisibleRuntimeRegistryContext,
  proof: VisibleBrowserRuntimeEmptyProof): void {
    if (this.terminalSealing && !this.terminalSealed) {
      throw new VisibleBrowserRuntimeRegistryError(
        'RUNTIME_CLOSING',
        'cannot consume an empty proof while terminal sealing is in progress',
      );
    }
    this.assertEmptyProofCurrent(proof);
    // 终止退出证明必须稳定且可幂等核验。
    if (this.terminalSealed && proof === this.terminalEmptyProof) return;
    this.emptyProofs.delete(proof.capability);
  }

export function assertEmptyProofCurrent(this: VisibleRuntimeRegistryContext,
  proof: VisibleBrowserRuntimeEmptyProof): void {
    if (!proof
      || proof.empty !== true
      || !runtimeObject(proof.capability)
      || this.emptyProofs.get(proof.capability) !== proof
      || proof.epoch !== this.epoch
      || this.currentRuntime
      || this.closing) {
      throw new VisibleBrowserRuntimeRegistryError(
        'INVALID_EMPTY_PROOF',
        'visible runtime empty proof is forged, replayed, stale, or no longer true',
      );
    }
  }

export function requireTerminalEmptyProof(this: VisibleRuntimeRegistryContext): VisibleBrowserRuntimeEmptyProof {
    if (!this.terminalSealed || !this.terminalEmptyProof) {
      throw new VisibleBrowserRuntimeRegistryError(
        'INVALID_EMPTY_PROOF',
        'terminal visible runtime empty proof is unavailable',
      );
    }
    this.assertEmptyProofCurrent(this.terminalEmptyProof);
    return this.terminalEmptyProof;
  }

export function issueEmptyProof(this: VisibleRuntimeRegistryContext): VisibleBrowserRuntimeEmptyProof {
    if (this.currentRuntime) {
      throw new VisibleBrowserRuntimeRegistryError(
        'RUNTIME_ALREADY_ACTIVE',
        'cannot issue an empty proof while a runtime remains attached',
      );
    }
    const capability = Object.freeze({});
    const proof = Object.freeze({ capability, empty: true, epoch: this.epoch });
    this.emptyProofs.set(capability, proof);
    return proof;
  }
