import {
  ANALYSIS_REQUIRED_REPORT_TYPES,
} from '@amazon-ai-ops/shared-types';
import type {
  StoreCollectionScheduleProjection,
  StoreContextEnvelope,
} from '@amazon-ai-ops/shared-types';
import {
  classifyStoreCollectionDurableProof,
} from './store-collection-orchestrator-scheduler-adapter';
import {
  type AuthorizedReadback,
} from "./collection-schedule-view-contracts";
import {
  assertUsContext,
  assertConfig,
  assertDurableIdentity,
  assertProtectedIdentity,
} from "./collection-schedule-view-identity-proof";
import {
  deriveWindow,
  semanticFingerprint,
  detailForState,
  localBusinessClock,
} from "./collection-schedule-view-values";
import type { CollectionScheduleViewRuntime } from './collection-schedule-view-runtime';

export function get(this: CollectionScheduleViewRuntime,
  contextInput: StoreContextEnvelope): StoreCollectionScheduleProjection {
    return this.readAuthorized(contextInput).projection;
  }

export function readAuthorized(this: CollectionScheduleViewRuntime,
  contextInput: StoreContextEnvelope): AuthorizedReadback {
    const context = this.options.authority.assertActiveStoreContext(contextInput);
    assertUsContext(context);
    const config = this.options.runtimeConfig.get(context).current;
    if (!config) {
      return {
        context,
        projection: {
          storeId: context.storeId,
          businessDate: context.businessDate,
          enabled: false,
          state: 'not_configured',
          detail: '当前店铺尚未配置采集计划。',
        },
      };
    }
    assertConfig(context, config);
    if (config.status === 'archived') {
      return {
        context,
        projection: {
          storeId: context.storeId,
          businessDate: context.businessDate,
          enabled: false,
          state: 'archived',
          detail: '当前店铺采集配置已归档。',
        },
      };
    }
    const automation = this.options.automationControl.get(context);
    const window = deriveWindow(context.businessDate, config.values.collectionLookbackDays);
    const fingerprint = semanticFingerprint({
      context,
      lookbackDays: config.values.collectionLookbackDays,
      ...window,
    });
    const durable = this.options.importRepository.inspectUniqueCollectionJobForSemanticScope({
      storeId: context.storeId,
      browserProfileId: context.browserProfileId,
      businessDate: context.businessDate,
      ...window,
      mode: 'create-and-download',
      reportTypes: ANALYSIS_REQUIRED_REPORT_TYPES,
    });
    const protectedAttempt = this.options.orchestrator.readProtectedSemanticAttempt({
      storeId: context.storeId,
      browserProfileId: context.browserProfileId,
      expectedFingerprint: fingerprint,
    });
    const durableContext = durable
      ? assertDurableIdentity(context, window, durable)
      : undefined;
    const durableState = durable && durableContext
      ? classifyStoreCollectionDurableProof(durable, {
          context: durableContext,
          requestId: durable.jobRow.requestId,
          ...window,
        })
      : undefined;
    if (protectedAttempt) {
      const succeededResumeReceipt = durable
        && durableState === 'succeeded'
        && (protectedAttempt.terminalOutcome?.state === 'failed'
          || protectedAttempt.terminalOutcome?.state === 'blocked')
        ? this.options.importRepository.readUniqueSucceededCollectionResumeReceiptForStore(
            context.storeId,
            durable.job.jobId,
            durable.job.request.requestId,
          )
        : undefined;
      assertProtectedIdentity(
        context,
        fingerprint,
        protectedAttempt,
        durable,
        durableState,
        succeededResumeReceipt,
      );
    }
    const base = {
      storeId: context.storeId,
      businessDate: context.businessDate,
      enabled: true,
      ...(automation.source === 'explicit-override' ? {
        automaticCollectionEnabled: automation.automaticCollectionEnabled,
        automationSource: automation.source, automationRevision: automation.revision,
      } : {}),
      scheduleLocalTime: config.values.collectionScheduleLocalTime,
      configRevision: config.revision,
      ...window,
      fingerprint,
    } as const;
    if (durable) {
      const state = durableState!;
      return {
        context,
        durable,
        protectedAttempt: protectedAttempt ?? undefined,
        projection: {
          ...base,
          state,
          detail: detailForState(state),
        },
      };
    }
    if (protectedAttempt) {
      const terminalState = protectedAttempt.terminalOutcome?.state;
      if (terminalState === 'succeeded') {
        throw new Error('protected success has no exact authority DB job');
      }
      const state = terminalState === 'failed' || terminalState === 'blocked'
        ? 'failed'
        : 'claimed';
      return {
        context,
        protectedAttempt,
        projection: {
          ...base,
          state,
          detail: detailForState(state),
        },
      };
    }
    const clock = localBusinessClock(this.now(), context.businessTimezone);
    if (clock.businessDate !== context.businessDate) {
      throw new Error('store collection clock does not match the active Main business date');
    }
    const due = automation.automaticCollectionEnabled
      && clock.localTime >= config.values.collectionScheduleLocalTime;
    const state = due ? 'due' : 'waiting';
    return {
      context,
      projection: {
        ...base,
        state,
        detail: automation.automaticCollectionEnabled ? detailForState(state)
          : '自动采集已关闭；手动采集仍须通过原有权限和可见会话校验。',
      },
    };
  }
