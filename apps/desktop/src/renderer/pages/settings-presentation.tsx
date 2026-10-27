// 保留页面编排与原有交互，纯值规则和展示规则按职责复用。
import React, { useEffect, useMemo, useState } from 'react';
import { aiCallEvidenceLabel, aiCallEvidenceTotal, aiCallKindLabel, aiCallOutputFormatLabel, buildAiCallDiagnostics } from '../ai-call-diagnostics';
import { aiContractPrimaryCopy, aiOutputContracts, aiOutputContractTags } from '../ai-output-contracts';
import { TagMetricGroup, type TagMetricItem } from '../components/tag-metric-group';
import type { AiCallLogView, AiConnectionStatus, AiProviderSettings, SettingsRuleConfig, StoragePathsView } from '../types';
import { readString } from './settings-values';
import { type SettingsTaskActionKind, type SettingsRuleActionButtonInput, type SettingsRuleActionButtonView, type SettingsLocalActionButtonInput, type SettingsLocalActionButtonView } from './settings-contracts';

export function aiAuditIntroText(): string {
    return '只显示最近调用的模型、固定输出格式、证据包规模和成败状态；不保存 API Key，也不展示完整提示词。';
}

export function aiAuditPurposeText(): string {
    return '用于排查 AI 是否成功返回固定字段、是否带输出格式版本、是否带证据包摘要。';
}

export function aiAuditLogFormatLine(log: Pick<AiCallLogView, 'schemaVersion' | 'promptVersion'>): string {
    return `输出格式 ${aiCallOutputFormatLabel(log)}`;
}

export function aiAuditLogTitle(log: Pick<AiCallLogView, 'promptKey'>): string {
    return aiCallKindLabel(log);
}

export function aiSettingsActionHint(input: {
    canSaveSettings: boolean;
    keyPresent: boolean;
    canTestAi: boolean;
}): string {
    if (!input.canSaveSettings)
        return '当前预览环境只能查看配置；请在桌面应用中保存或清除 API Key。';
    if (!input.keyPresent)
        return '填写 API Key 后才能测试连接。';
    if (!input.canTestAi)
        return '当前预览环境不能发起 AI 连接测试。';
    return '';
}

export function storagePathDisplay(value: unknown, label: string): string {
    const pathValue = readString(value).trim();
    return pathValue || `${label}会在桌面应用中显示。`;
}

export function settingsAiContractPrimaryCopy(): string {
    return aiContractPrimaryCopy();
}

export function settingsAiContractTags(): TagMetricItem[] {
    return aiOutputContractTags().map((tag) => ({
        label: tag.label,
        detail: tag.detail,
        tone: tag.tone,
    }));
}

export function settingsAiContractVersionItems(): TagMetricItem[] {
    return aiOutputContracts.map((contract) => ({
        label: `${contract.label} v1`,
        value: '系统固定',
        detail: `${contract.usedBy}：${contract.consumedAs}`,
        tone: 'neutral',
    }));
}

export function tagToneToStatusPillTone(tone: TagMetricItem['tone']): 'ready' | 'warning' | 'blocked' | 'pending' {
    if (tone === 'ready' || tone === 'warning' || tone === 'blocked')
        return tone;
    return 'pending';
}

export function statusLabel(status: AiConnectionStatus): string {
    const labels: Record<AiConnectionStatus, string> = {
        unconfigured: '未配置',
        pending_test: '待测试',
        testing: '测试中',
        available: 'AI 可用',
        failed: 'AI 不可用',
    };
    return labels[status];
}

export function statusTone(status: AiConnectionStatus): 'ready' | 'pending' | 'blocked' | 'warning' {
    if (status === 'available')
        return 'ready';
    if (status === 'testing' || status === 'pending_test')
        return 'pending';
    if (status === 'failed')
        return 'blocked';
    return 'warning';
}

export function displayAiStatusLabel(status: AiConnectionStatus, keyPresent: boolean): string {
    if (status === 'pending_test' && keyPresent)
        return '待测试';
    return statusLabel(status);
}

export function displayAiStatusTone(status: AiConnectionStatus, keyPresent: boolean): 'ready' | 'pending' | 'blocked' | 'warning' {
    if (status === 'pending_test' && keyPresent)
        return 'pending';
    return statusTone(status);
}

export function settingsPrimaryAiStatusItems(settings: Pick<AiProviderSettings, 'aiBaseUrl' | 'aiModel'>, status: AiConnectionStatus, keyPresent: boolean) {
    return [
        { label: 'API Key', value: keyPresent ? '已配置（已隐藏）' : '未配置' },
        { label: 'Base URL', value: settings.aiBaseUrl || '未配置' },
        { label: 'Model', value: settings.aiModel || '未配置' },
        { label: '连接状态', value: status === 'pending_test' ? '已配置，待测试' : statusLabel(status) },
    ];
}

export function settingsAiTaskTitle(input: {
    status: AiConnectionStatus;
    keyPresent: boolean;
}): string {
    if (!input.keyPresent || input.status === 'unconfigured')
        return '先填写 API Key 并保存';
    if (input.status === 'testing')
        return '正在测试当前 AI 连接';
    if (input.status === 'available')
        return 'AI 连接已可用';
    if (input.status === 'failed')
        return 'AI 连接需要处理';
    return '测试当前 AI 连接';
}

export function settingsAiConnectionFeedback(input: {
    status: AiConnectionStatus;
    keyPresent: boolean;
    saving: boolean;
    message?: string;
}): {
    label: string;
    detail: string;
    tone: 'ready' | 'pending' | 'blocked' | 'warning';
} {
    const message = String(input.message || '').trim();
    if (input.saving) {
        return {
            label: '正在保存 AI 设置',
            detail: 'API Key 会交给主进程本地安全存储，页面不会回显明文。',
            tone: 'pending',
        };
    }
    if (/^AI 设置保存失败|^AI Key 清除失败/.test(message)) {
        return {
            label: 'AI 设置处理失败',
            detail: message,
            tone: 'blocked',
        };
    }
    if (/^AI 设置已保存|^AI Key 已清除/.test(message)) {
        return {
            label: '设置保存完成',
            detail: message,
            tone: 'ready',
        };
    }
    if (!input.keyPresent || input.status === 'unconfigured') {
        return {
            label: '等待 API Key',
            detail: '填写并保存 Key 后，再测试当前 Base URL 和模型是否可用。',
            tone: 'warning',
        };
    }
    if (input.status === 'testing') {
        return {
            label: '正在测试 AI 连接',
            detail: '主进程正在用当前 Base URL、模型和脱敏 Key 做握手验证。',
            tone: 'pending',
        };
    }
    if (input.status === 'available') {
        return {
            label: 'AI 连接测试通过',
            detail: message || '测试通过，当前模型可用于广告诊断、建议解释和 Listing 草案。',
            tone: 'ready',
        };
    }
    if (input.status === 'failed') {
        return {
            label: 'AI 连接测试失败',
            detail: message || '请检查 Base URL、模型名称、API Key 或服务端额度后重新测试。',
            tone: 'blocked',
        };
    }
    return {
        label: '等待连接测试',
        detail: '当前连接字段已有配置变化，需要重新测试后再让 AI 参与建议生成。',
        tone: 'pending',
    };
}

export function buildSettingsTaskBannerState(input: {
    canSaveSettings: boolean;
    canTestAi: boolean;
    keyPresent: boolean;
    loading: boolean;
    message?: string;
    saving: boolean;
    status: AiConnectionStatus;
}) {
    const feedback = settingsAiConnectionFeedback({
        status: input.status,
        keyPresent: input.keyPresent,
        saving: input.saving,
        message: input.message,
    });
    const needsConnection = !input.keyPresent || input.status === 'unconfigured';
    const busy = input.loading || input.saving || input.status === 'testing';
    const primaryAction: {
        kind: SettingsTaskActionKind;
        label: string;
        busy: boolean;
        busyLabel: string;
        disabled: boolean;
        disabledReason?: string;
    } = needsConnection
        ? {
            kind: 'edit-connection',
            label: '填写并保存 AI 设置',
            busy,
            busyLabel: input.loading ? '正在读取设置...' : '正在保存...',
            disabled: !input.canSaveSettings,
            disabledReason: input.canSaveSettings ? undefined : '当前预览环境不能保存 AI 设置，请在桌面应用中操作。',
        }
        : {
            kind: 'test-connection',
            label: input.status === 'available' ? '重新测试当前连接' : '测试当前连接',
            busy,
            busyLabel: input.loading ? '正在读取设置...' : input.saving ? '正在保存...' : '正在测试...',
            disabled: !input.canTestAi,
            disabledReason: input.canTestAi ? undefined : '当前环境不能发起 AI 连接测试。',
        };
    const secondaryActions: Array<{
        kind: SettingsTaskActionKind;
        label: string;
        disabled?: boolean;
        disabledReason?: string;
    }> = [];
    if (!needsConnection) {
        secondaryActions.push({
            kind: 'edit-connection',
            label: '编辑连接',
            disabled: !input.canSaveSettings,
            disabledReason: input.canSaveSettings ? undefined : '当前预览环境不能保存 AI 设置。',
        });
    }
    secondaryActions.push({ kind: 'open-contract', label: '查看输出合同' });
    return {
        title: input.loading ? '正在读取 AI 设置' : settingsAiTaskTitle({ status: input.status, keyPresent: input.keyPresent }),
        description: input.loading ? '正在从主进程读取 AI 连接、模型和脱敏 Key 状态。' : feedback.detail,
        statusLabel: input.loading ? '读取中' : feedback.label,
        statusTone: input.loading ? 'pending' as const : feedback.tone,
        tone: input.loading
            ? 'neutral' as const
            : feedback.tone === 'ready'
                ? 'confirmed' as const
                : feedback.tone === 'blocked'
                    ? 'blocked' as const
                    : 'attention' as const,
        primaryAction,
        secondaryActions: secondaryActions.slice(0, 2),
    };
}

export function settingsSecondaryStatusMessage(message: string): string {
    const text = message.trim();
    if (!text)
        return '';
    if (/^(AI 设置|AI Key|AI 连接|正在测试 AI 连接|请先填写 API Key|saveSettings 未接入|testAiSettings 未接入)/.test(text)) {
        return '';
    }
    return text;
}

export function settingsRuleActionButtonView(input: SettingsRuleActionButtonInput): SettingsRuleActionButtonView {
    return {
        ariaBusy: input.active ? true : undefined,
        className: [input.baseClassName, input.active ? 'button-loading' : ''].filter(Boolean).join(' '),
        disabled: Boolean(input.disabled || input.active),
        label: input.active ? input.busyLabel : input.label,
        showSpinner: input.active,
    };
}

export function settingsLocalActionButtonView(input: SettingsLocalActionButtonInput): SettingsLocalActionButtonView {
    const active = input.activeAction === input.action;
    return {
        ariaBusy: active ? true : undefined,
        className: [input.baseClassName, active ? 'button-loading' : ''].filter(Boolean).join(' '),
        disabled: Boolean(input.disabled || active || (input.activeAction && !active)),
        label: active ? input.busyLabel : input.label,
        showSpinner: active,
    };
}

export function settingsLocalActionButtonContent(view: SettingsLocalActionButtonView) {
    if (!view.showSpinner)
        return view.label;
    return (<span className="button-content">
      <span aria-hidden="true" className="button-spinner"/>
      <span>{view.label}</span>
    </span>);
}
