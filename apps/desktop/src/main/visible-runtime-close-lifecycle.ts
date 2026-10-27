import {
  type StoreContextEnvelope,
} from '@amazon-ai-ops/shared-types';
import {
  type VisibleBrowserRuntimeClaim,
  type VisibleBrowserRuntimeEmptyProof,
  VisibleBrowserRuntimeRegistryError,
  type RuntimeClaimRecord,
} from "./visible-runtime-contracts";
import {
  sameContext,
  uniqueControllers,
  nextEpoch,
} from "./visible-runtime-values";

import type { VisibleRuntimeRegistryContext } from './visible-runtime-runtime';

export function strictClose(this: VisibleRuntimeRegistryContext,
  claim: VisibleBrowserRuntimeClaim): Promise<VisibleBrowserRuntimeEmptyProof> {
    this.assertNotTerminalSealed();
    if (this.closing) {
      throw new VisibleBrowserRuntimeRegistryError(
        'RUNTIME_CLOSING',
        'visible browser runtime is already closing',
      );
    }
    const record = this.consumeClaim(claim);
    const operation = this.performStrictClose(record);
    this.closeOperation = operation;
    return operation;
  }

export function strictCloseCurrent(this: VisibleRuntimeRegistryContext,
  expectedContext?: StoreContextEnvelope): Promise<VisibleBrowserRuntimeEmptyProof> {
    this.assertNotTerminalSealed();
    if (this.closing) {
      const runtime = this.currentRuntime;
      if (expectedContext && (!runtime || !sameContext(runtime.context, expectedContext))) {
        throw new VisibleBrowserRuntimeRegistryError(
          'RUNTIME_CAS_MISMATCH',
          'closing visible runtime does not match the exact Store/Profile/date/generation',
        );
      }
      if (this.closeOperation) return this.closeOperation;
      throw new VisibleBrowserRuntimeRegistryError(
        'RUNTIME_CLOSING',
        'visible browser runtime is already closing without a shared operation',
      );
    }
    const runtime = this.requireCurrent();
    if (expectedContext && !sameContext(runtime.context, expectedContext)) {
      throw new VisibleBrowserRuntimeRegistryError(
        'RUNTIME_CAS_MISMATCH',
        'visible runtime does not match the exact close Store/Profile/date/generation',
      );
    }
    // 严格关闭前按真实身份撤销登录候选声明，再颁发唯一关闭声明。
    if (this.liveClaim) {
      const liveRecord = this.requireClaim(this.liveClaim, false);
      liveRecord.used = true;
      this.liveClaim = null;
    }
    const closeClaim = this.issueClaim(runtime);
    return this.strictClose(closeClaim);
  }

export async function performStrictClose(this: VisibleRuntimeRegistryContext,
  record: RuntimeClaimRecord): Promise<VisibleBrowserRuntimeEmptyProof> {
    const runtime = record.runtime;
    this.closing = true;
    const controllers = uniqueControllers(runtime.controllers);
    const failures: unknown[] = [];
    try {
      for (const controller of controllers) {
        try {
          await controller.close();
          this.assertRuntimeCas(runtime, record.epoch);
        } catch (error) {
          failures.push(error);
        }
      }
      if (failures.length > 0) {
        throw new VisibleBrowserRuntimeRegistryError(
          'RUNTIME_CLOSE_FAILED',
          `visible runtime close failed for ${failures.length} controller(s)`,
          { cause: failures[0] },
        );
      }
      for (const controller of controllers) {
        let page: unknown;
        let context: unknown;
        try {
          page = controller.getPage();
          context = controller.getContext();
        } catch (error) {
          throw new VisibleBrowserRuntimeRegistryError(
            'RUNTIME_RESIDUE',
            'visible runtime residue could not be inspected',
            { cause: error },
          );
        }
        if (page !== null || context !== null) {
          throw new VisibleBrowserRuntimeRegistryError(
            'RUNTIME_RESIDUE',
            'visible runtime retained a page or browser context after close',
          );
        }
      }
      this.assertRuntimeCas(runtime, record.epoch);
      this.revokeAmazonAdsIdentityClaim();
      this.currentRuntime = null;
      this.epoch = nextEpoch(this.epoch);
      return this.issueEmptyProof();
    } finally {
      // 失败时保留浏览器引用，仅精确成功的 CAS 路径可清除。
      this.closing = false;
      this.closeOperation = null;
    }
  }

export function closeAll(this: VisibleRuntimeRegistryContext): Promise<VisibleBrowserRuntimeEmptyProof> {
    if (this.terminalSealed) {
      return Promise.resolve(this.requireTerminalEmptyProof());
    }
    if (this.terminalSealing) {
      if (this.terminalSealOperation) return this.terminalSealOperation;
      throw new VisibleBrowserRuntimeRegistryError(
        'RUNTIME_CLOSING',
        'visible browser runtime registry is entering its terminal shutdown seal',
      );
    }
    return this.closeAllUnsealed();
  }

export function closeAllAndSeal(this: VisibleRuntimeRegistryContext): Promise<VisibleBrowserRuntimeEmptyProof> {
    if (this.terminalSealed) {
      return Promise.resolve(this.requireTerminalEmptyProof());
    }
    if (this.terminalSealOperation) return this.terminalSealOperation;

    this.terminalSealing = true;
    let resolveSeal!: (proof: VisibleBrowserRuntimeEmptyProof) => void;
    let rejectSeal!: (error: unknown) => void;
    const operation = new Promise<VisibleBrowserRuntimeEmptyProof>((resolve, reject) => {
      resolveSeal = resolve;
      rejectSeal = reject;
    });
    // 关闭前先公布终止操作并封锁所有准入，保证同步重入共享同次尝试。
    this.terminalSealOperation = operation;
    try {
      void this.completeTerminalSeal(this.closeAllForTerminalSeal())
        .then(resolveSeal, rejectSeal);
    } catch (error) {
      rejectSeal(error);
    }

    void operation.catch(() => {
      // 终止封锁不可逆；关闭失败可重试，但只能推进到精确空证明。
      if (!this.terminalSealed && this.terminalSealOperation === operation) {
        this.terminalSealOperation = null;
      }
    }).catch(() => undefined);
    return operation;
  }

export async function completeTerminalSeal(this: VisibleRuntimeRegistryContext,
  closeOperation: Promise<VisibleBrowserRuntimeEmptyProof>): Promise<VisibleBrowserRuntimeEmptyProof> {
    const proof = await closeOperation;
    this.assertEmptyProofCurrent(proof);
    this.terminalEmptyProof = proof;
    this.terminalSealed = true;
    this.terminalSealing = false;
    return proof;
  }

export function closeAllForTerminalSeal(this: VisibleRuntimeRegistryContext): Promise<VisibleBrowserRuntimeEmptyProof> {
    if (this.closing && this.closeOperation) return this.closeOperation;
    if (!this.currentRuntime) return Promise.resolve(this.issueEmptyProof());
    const runtime = this.currentRuntime;
    // 终止退出按身份消费候选声明，重试之间不得重开公共准入。
    if (this.liveClaim) {
      const liveRecord = this.requireClaim(this.liveClaim, false);
      liveRecord.used = true;
      this.liveClaim = null;
    }
    const closeClaim = this.issueClaim(runtime);
    const record = this.consumeClaim(closeClaim);
    const operation = this.performStrictClose(record);
    this.closeOperation = operation;
    return operation;
  }

export function closeAllUnsealed(this: VisibleRuntimeRegistryContext): Promise<VisibleBrowserRuntimeEmptyProof> {
    if (this.closing && this.closeOperation) return this.closeOperation;
    if (!this.currentRuntime) return Promise.resolve(this.proveEmpty());
    return this.strictCloseCurrent(this.currentRuntime.context);
  }

export function assertNotTerminalSealed(this: VisibleRuntimeRegistryContext): void {
    if (this.terminalSealed || this.terminalSealing) {
      throw new VisibleBrowserRuntimeRegistryError(
        'RUNTIME_REGISTRY_SEALED',
        'visible browser runtime registry is terminally sealed for shutdown',
      );
    }
  }
