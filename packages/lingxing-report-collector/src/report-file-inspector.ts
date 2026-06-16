import * as path from 'path';
import * as fs from 'fs';
import * as XLSX from 'xlsx';
import type { LingxingReportType } from '@amazon-ai-ops/shared-types';

const REPORT_TOKENS: Record<LingxingReportType, string[]> = {
  campaign: ['广告活动报告', '广告活动', 'campaign report', 'campaign name', 'campaign'],
  ad_group: ['广告组报告', '广告组', 'ad group report', 'ad group'],
  placement: ['广告位报告', '广告位', '投放位置', 'placement report', 'placement'],
  advertised_product: ['推广的商品报告', '广告推广商品报告', '广告商品', '推广的商品', 'advertised product report', 'advertised product'],
  auto_targeting: ['自动投放报告', '自动投放', '自动定向', 'auto targeting report', 'auto targeting', 'auto target'],
  keyword: ['关键词报告', '关键词', '投放关键词', 'keyword report', 'keyword', 'match type'],
  product_targeting: ['商品投放报告', '商品投放', 'asin投放', '商品定位', 'product targeting report', 'product targeting', 'targeting expression'],
  user_search_term: ['用户搜索词报告', '用户搜索词', '客户搜索词', '搜索词报告', '搜索词', 'search term report', 'search term'],
};

const AMBIGUOUS_BASE_TOKENS = new Set(['campaign', '广告活动', 'ad group', '广告组']);

export interface ReportContentInspection {
  readable: boolean;
  matched: boolean;
  matchedTokens: string[];
  sampledText: string;
  errorMessage?: string;
}

function normalizeText(value: unknown): string {
  return String(value ?? '')
    .toLowerCase()
    .replace(/[\s_\-()/（）【】[\]{}:：,，.。]+/g, '');
}

function compactToken(value: string): string {
  return normalizeText(value);
}

function sampleWorkbookText(filePath: string): string {
  const extension = path.extname(filePath).toLowerCase();
  if (extension === '.csv' || extension === '.txt' || extension === '.tsv') {
    return fs.readFileSync(filePath, 'utf8')
      .split(/\r?\n/)
      .slice(0, 12)
      .flatMap((line) => line.split(extension === '.tsv' ? '\t' : ',').slice(0, 40))
      .map((value) => value.trim())
      .filter(Boolean)
      .join(' | ');
  }

  const workbook = XLSX.readFile(filePath, { cellDates: false, raw: false });
  const sheetName = workbook.SheetNames[0];
  if (!sheetName) return '';
  const worksheet = workbook.Sheets[sheetName];
  const rows = XLSX.utils.sheet_to_json<unknown[]>(worksheet, {
    header: 1,
    defval: '',
    raw: false,
  });
  return rows
    .slice(0, 12)
    .flatMap((row) => Array.isArray(row) ? row.slice(0, 40) : [])
    .map((value) => String(value ?? '').trim())
    .filter(Boolean)
    .join(' | ');
}

function tokenMatches(sample: string, token: string): boolean {
  const normalizedToken = compactToken(token);
  return Boolean(normalizedToken) && sample.includes(normalizedToken);
}

export function inspectReportFileContent(filePath: string, expectedReportType: LingxingReportType): ReportContentInspection {
  try {
    const sampledText = sampleWorkbookText(filePath);
    const normalizedSample = normalizeText(`${path.basename(filePath)} | ${sampledText}`);
    const expectedTokens = REPORT_TOKENS[expectedReportType] ?? [];
    const matchedTokens = expectedTokens.filter((token) => tokenMatches(normalizedSample, token));

    if (matchedTokens.length === 0) {
      return {
        readable: true,
        matched: false,
        matchedTokens: [],
        sampledText,
      };
    }

    const strongMatch = matchedTokens.some((token) => !AMBIGUOUS_BASE_TOKENS.has(token.toLowerCase()));
    return {
      readable: true,
      matched: strongMatch,
      matchedTokens,
      sampledText,
    };
  } catch (error) {
    return {
      readable: false,
      matched: false,
      matchedTokens: [],
      sampledText: '',
      errorMessage: error instanceof Error ? error.message : String(error),
    };
  }
}
