import React, { useEffect, useMemo, useRef, useState } from 'react';
import type { AppRoute, ListingContentVersionView, ListingContentView, ListingDraftView, ListingHandoffPayload, ListingSection, ListingSuggestionView } from '../types';
import { type ListingManualFieldGroup, type ListingAiStatus } from './listing-contracts';

export function listingManualFieldGroups(): ListingManualFieldGroup[] {
  return [
    {
      title: '基础信息',
      fields: [
        { key: 'asin', label: 'ASIN', status: '必填' },
        { key: 'versionLabel', label: '版本名称', status: '建议填写' },
        { key: 'changeSummary', label: '修改说明', status: '建议填写' },
      ],
    },
    {
      title: '标题',
      fields: [
        { key: 'title', label: '标题', status: '必填' },
      ],
    },
    {
      title: '五点',
      fields: [1, 2, 3, 4, 5].map((index) => ({ key: `bullet-${index}`, label: `五点 ${index}`, status: '建议填写' })),
    },
    {
      title: '详情与搜索词',
      fields: [
        { key: 'description', label: '详情 / A+ 内容', status: '建议填写' },
        { key: 'backendTerms', label: '后台搜索词', status: '必填' },
        { key: 'imageCopy', label: '图片文案', status: '可选' },
      ],
    },
  ];
}

export function buildSuggestedText(keyword: string, section: ListingSection, currentText: string): string {
  if (!currentText.trim()) return keyword;
  if (currentText.toLowerCase().includes(keyword.toLowerCase())) return currentText;
  if (section === 'backend_terms') return `${currentText.trim()} ${keyword}`.trim();
  return `${currentText.trim()} ${keyword}`.trim();
}

export function hasMeaningfulListingContent(listing?: ListingContentView | null): listing is ListingContentView {
  if (!listing) return false;
  return Boolean(
    listing.asin?.trim()
    && (
      listing.title?.trim()
      || listing.backendTerms?.trim()
      || (Array.isArray(listing.bullets) && listing.bullets.some((bullet) => bullet.trim()))
    ),
  );
}

export function getListingContentBlocker(listing?: ListingContentView | null): string | null {
  if (!listing) return '未返回 Listing 内容';
  if (!listing.asin?.trim()) return '未读取到 ASIN';
  if (!listing.title?.trim() && !listing.backendTerms?.trim() && !(listing.bullets || []).some((bullet) => bullet.trim())) {
    return '未读取到标题、五点或后台词';
  }
  return null;
}

export function readString(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

export function readBoolean(value: unknown): boolean {
  return typeof value === 'boolean' ? value : false;
}

export function ensureFiveBullets(input?: string[]): string[] {
  const bullets = Array.isArray(input) ? input.slice(0, 5) : [];
  while (bullets.length < 5) bullets.push('');
  return bullets;
}

export function normalizeBaseUrl(value: unknown): string {
  return readString(value).replace(/\/+$/, '');
}

export function listingAiStatusFromSettings(settings: Record<string, unknown> | null | undefined): ListingAiStatus {
  if (!settings) {
    return {
      label: 'Listing AI 状态未读取',
      detail: '无法读取设置时仍可生成本地规则参考草案，但不会声称 AI 已参与。',
      tone: 'pending',
    };
  }
  const apiKey = readString(settings.aiApiKey ?? settings.ai_api_key);
  const keyConfigured = readBoolean(settings.aiKeyConfigured ?? settings.ai_key_configured);
  const baseUrl = readString(settings.aiBaseUrl ?? settings.ai_base_url) || 'https://api.deepseek.com';
  const model = readString(settings.aiModel ?? settings.ai_model) || 'deepseek-v4-flash';
  const lastStatus = readString(settings.aiLastTestStatus ?? settings.ai_last_test_status);
  const lastBaseUrl = readString(settings.aiLastTestBaseUrl ?? settings.ai_last_test_base_url);
  const lastModel = readString(settings.aiLastTestModel ?? settings.ai_last_test_model);
  const lastMessage = readString(settings.aiLastTestMessage ?? settings.ai_last_test_message);
  const keyPresent = Boolean(apiKey || keyConfigured);
  if (!keyPresent) {
    return {
      label: 'Listing AI 未配置',
      detail: '未配置 API Key，Listing 草案会生成本地规则参考。',
      tone: 'warning',
    };
  }
  const testMatchesCurrent = normalizeBaseUrl(lastBaseUrl) === normalizeBaseUrl(baseUrl) && lastModel === model;
  if (testMatchesCurrent && lastStatus === 'available') {
    return {
      label: 'Listing AI 可用',
      detail: `${model} 已测试通过；生成草案时会尝试调用 AI，但仍只保存本地草案。`,
      tone: 'ready',
    };
  }
  if (testMatchesCurrent && lastStatus === 'failed') {
    return {
      label: 'Listing AI 测试失败',
      detail: lastMessage || '最近一次 AI 连接测试失败，草案会使用本地规则参考。',
      tone: 'blocked',
    };
  }
  return {
    label: 'Listing AI 待测试',
    detail: `${model} 已配置但当前模型/Base URL 尚未通过连接测试，建议到设置页测试。`,
    tone: 'pending',
  };
}
