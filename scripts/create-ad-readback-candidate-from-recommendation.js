const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');

const root = path.resolve(__dirname, '..');
const evidenceDir = path.join(root, 'output', 'codex-evidence');

function parseArgs(argv) {
  const args = {};
  for (let index = 2; index < argv.length; index += 1) {
    const token = argv[index];
    if (!token.startsWith('--')) throw new Error(`Unexpected argument: ${token}`);
    const key = token.slice(2);
    const value = argv[index + 1];
    if (!value || value.startsWith('--')) throw new Error(`Missing value for --${key}`);
    args[key] = value;
    index += 1;
  }
  return args;
}

function latestEvidence(pattern) {
  if (!fs.existsSync(evidenceDir)) return null;
  const files = fs.readdirSync(evidenceDir)
    .filter((name) => pattern.test(name))
    .map((name) => {
      const filePath = path.join(evidenceDir, name);
      return { filePath, mtimeMs: fs.statSync(filePath).mtimeMs };
    })
    .sort((a, b) => b.mtimeMs - a.mtimeMs);
  return files[0]?.filePath || null;
}

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, 'utf8'));
}

function hasText(value) {
  return typeof value === 'string' && value.trim().length > 0;
}

function pickRecommendation(source, recommendationId) {
  const recommendations = Array.isArray(source.recommendations) ? source.recommendations : [];
  if (recommendations.length === 0) {
    throw new Error('No recommendations found in source evidence.');
  }
  if (recommendationId) {
    const found = recommendations.find((item) => String(item.id) === String(recommendationId));
    if (!found) throw new Error(`Recommendation id not found in source evidence: ${recommendationId}`);
    return found;
  }
  const lowerBid = recommendations.find((item) => item.actionType === 'lower_bid');
  return lowerBid || recommendations[0];
}

function sourceValue(args, rec, key, fallback = '') {
  const argKey = `source-${key.replace(/[A-Z]/g, (letter) => `-${letter.toLowerCase()}`)}`;
  return args[argKey] || rec[key] || fallback;
}

function sourceEvidenceValue(args, rec, key, fallback = '') {
  const argKey = `source-${key.replace(/[A-Z]/g, (letter) => `-${letter.toLowerCase()}`)}`;
  const evidence = rec.evidence || {};
  return args[argKey] || evidence[key] || rec[key] || fallback;
}

function sourceFilesForRecommendation(args, rec) {
  if (hasText(args['source-files'])) {
    return String(args['source-files']).split(/\r?\n|,/).map((item) => item.trim()).filter(Boolean);
  }
  const evidence = rec.evidence || {};
  if (Array.isArray(evidence.sourceFiles) && evidence.sourceFiles.length > 0) return evidence.sourceFiles;
  if (Array.isArray(rec.sourceFiles) && rec.sourceFiles.length > 0) return rec.sourceFiles;
  return [];
}

function sourceRowForRecommendation(args, rec) {
  const raw = args['source-row'] ?? rec.evidence?.sourceRow ?? rec.sourceRow;
  const number = Number(raw);
  return Number.isFinite(number) ? number : undefined;
}

function reportTypeFromFilePath(filePath) {
  const name = path.basename(String(filePath || '')).toLowerCase();
  if (/auto[_-]?targeting/.test(name)) return 'auto_targeting';
  if (/product[_-]?targeting/.test(name)) return 'product_targeting';
  if (/search[_-]?term|user[_-]?search/.test(name)) return 'search_term';
  if (/keyword/.test(name)) return 'keyword';
  return '';
}

function resolveWritableEntity(rec, sourceFiles, sourceRow, context) {
  if (rec.entityType && rec.entityType !== 'search_term') {
    return { entityType: rec.entityType, entityName: context.entityName, sourceReportType: '' };
  }

  const sourceReportTypes = sourceFiles.map(reportTypeFromFilePath).filter(Boolean);
  if (sourceReportTypes.includes('keyword')) {
    return { entityType: 'keyword', entityName: context.entityName, sourceReportType: 'keyword' };
  }
  if (sourceReportTypes.includes('auto_targeting')) {
    return { entityType: 'target', entityName: context.entityName, sourceReportType: 'auto_targeting' };
  }
  if (sourceReportTypes.includes('product_targeting')) {
    return { entityType: 'target', entityName: context.entityName, sourceReportType: 'product_targeting' };
  }

  const reportTypes = sourceFiles.map((filePath) => `${reportTypeFromFilePath(filePath) || 'unknown'}:${path.basename(filePath)}`).join(', ');
  throw new Error([
    `Search-term lower_bid recommendation cannot be converted into an Ads UI write target from sourceRow ${sourceRow}.`,
    'A formal readback candidate must bind to a writable keyword, auto-targeting, or product-targeting source report.',
    reportTypes ? `Source report types: ${reportTypes}.` : 'No writable source report type was found.',
  ].join(' '));
}

function isRealReportFile(filePath) {
  if (!hasText(filePath)) return false;
  const extension = path.extname(String(filePath).trim()).toLowerCase();
  return ['.xlsx', '.xls', '.csv'].includes(extension) && fs.existsSync(filePath);
}

function requireTraceableSourceReport(sourceFiles, sourceRow) {
  const hasRealSourceFiles = Array.isArray(sourceFiles)
    && sourceFiles.length > 0
    && sourceFiles.every(isRealReportFile);
  const hasSourceRow = Number.isFinite(sourceRow) && sourceRow > 0;
  if (hasRealSourceFiles && hasSourceRow) return;

  const problems = [];
  if (!hasRealSourceFiles) {
    problems.push('real .xlsx/.xls/.csv source report file(s)');
  }
  if (!hasSourceRow) {
    problems.push('positive original source row');
  }
  throw new Error([
    `Recommendation evidence lacks traceable source report data: missing ${problems.join(' and ')}.`,
    'Rerun recommendation generation with current imported Lingxing reports, or pass --source-files and --source-row from the original report row.',
  ].join(' '));
}

function requireSourceRecommendationValues(currentValue, recommendedValue) {
  const missing = [];
  if (!hasText(currentValue)) missing.push('source current value');
  if (!hasText(recommendedValue)) missing.push('source recommended value');
  if (missing.length === 0) return;
  throw new Error([
    `Recommendation evidence lacks executable source recommendation values: missing ${missing.join(' and ')}.`,
    'Rerun recommendation generation so currentValue/recommendedValue are persisted, or pass --source-current-value and --source-recommended-value from the approved recommendation.',
  ].join(' '));
}

function contextFromEntityId(entityId) {
  if (!hasText(entityId)) return null;
  const parts = String(entityId).split('_').map((part) => part.trim()).filter(Boolean);
  if (parts.length < 3) return null;
  return {
    campaignName: parts.slice(0, -2).join('_'),
    adGroupName: parts[parts.length - 2],
    entityName: parts[parts.length - 1],
  };
}

function recommendationContext(source, rec) {
  const evidence = rec.evidence || {};
  const parsed = contextFromEntityId(rec.entityId);
  const contextFallback = {
    campaignName: !hasText(evidence.campaignName) && hasText(parsed?.campaignName),
    adGroupName: !hasText(evidence.adGroupName) && hasText(parsed?.adGroupName),
    entityName: !hasText(rec.entityName) && hasText(parsed?.entityName),
  };
  const campaignName = evidence.campaignName || parsed?.campaignName || '';
  const adGroupName = evidence.adGroupName || parsed?.adGroupName || '';
  const entityName = rec.entityName || parsed?.entityName || '';
  return {
    storeName: rec.storeName || source.request?.storeName || '',
    marketplaceCode: rec.marketplaceCode || source.request?.marketplaceCode || '',
    portfolioName: evidence.portfolioName || '',
    asin: rec.asin || evidence.asin || '',
    metricDate: rec.metricDate || evidence.date || '',
    campaignName,
    adGroupName,
    entityName,
    contextFallback,
    hasFallback: Object.values(contextFallback).some(Boolean),
  };
}

function buildApprovalScope(target) {
  return [
    target.storeName,
    target.marketplaceCode,
    target.portfolioName,
    target.campaignName,
    target.adGroupName,
    `editable ${target.entityType}=${target.entityName}`,
    `${target.actionType}; before and after values must be read from Ads UI`,
  ].filter(Boolean).join(' / ');
}

function pushArg(argv, key, value, options = {}) {
  const text = value === undefined || value === null ? '' : String(value);
  if (!options.required && text.trim().length === 0) return;
  argv.push(key, text);
}

function runTemplate(args) {
  const result = spawnSync(process.execPath, [
    path.join(root, 'scripts', 'create-ad-readback-evidence-template.js'),
    ...args,
  ], {
    cwd: root,
    encoding: 'utf8',
  });
  if (result.status !== 0) {
    throw new Error(`Template generation failed:\n${result.stdout}\n${result.stderr}`);
  }
  return result;
}

function main() {
  const args = parseArgs(process.argv);
  const sourcePath = path.resolve(args.source || latestEvidence(/^installed-ad-ai-explanation-.*\.json$/i) || '');
  if (!sourcePath || !fs.existsSync(sourcePath)) {
    throw new Error('Missing --source and no installed-ad-ai-explanation evidence was found.');
  }
  const source = readJson(sourcePath);
  const rec = pickRecommendation(source, args['recommendation-id']);
  const context = recommendationContext(source, rec);
  const recommendationId = String(rec.id || args['recommendation-id'] || 'candidate');
  const out = path.resolve(args.out || path.join(evidenceDir, `real-ad-execution-readback-candidate-rec-${recommendationId}.json`));
  const mdOut = path.resolve(args['md-out'] || out.replace(/\.json$/i, '.md'));

  if (rec.actionType !== 'lower_bid') {
    throw new Error(`Refusing to create first readback candidate for unsupported actionType: ${rec.actionType}`);
  }
  if (!hasText(context.campaignName) || !hasText(context.adGroupName) || !hasText(context.entityName)) {
    throw new Error('Recommendation evidence lacks campaign/ad group/entity context.');
  }

  const sourceEntityType = sourceValue(args, rec, 'entityType', rec.entityType || '');
  const sourceCurrentValue = sourceValue(args, rec, 'currentValue', rec.currentValue || '');
  const sourceRecommendedValue = sourceValue(args, rec, 'recommendedValue', rec.recommendedValue || '');
  const sourceAiStrategyFallbackReason = sourceEvidenceValue(args, rec, 'aiStrategyFallbackReason');
  const sourceAiActionFallbackReason = sourceEvidenceValue(args, rec, 'aiActionFallbackReason');
  const sourceFiles = sourceFilesForRecommendation(args, rec);
  const sourceRow = sourceRowForRecommendation(args, rec);
  requireTraceableSourceReport(sourceFiles, sourceRow);
  requireSourceRecommendationValues(sourceCurrentValue, sourceRecommendedValue);
  const writableEntity = resolveWritableEntity(rec, sourceFiles, sourceRow, context);
  const writeEntityType = writableEntity.entityType;
  const writeEntityName = writableEntity.entityName || context.entityName;
  const riskRationale = [
    `Candidate is only low risk if Ads UI exposes an editable ${writeEntityType} bid row for ${writeEntityName}.`,
    'Lowering one bid is bounded and reversible, does not increase budget or expand traffic,',
    'and still requires operator approval plus before/after readback.',
    `Source recommendation came from ${sourceEntityType || 'unknown'} evidence; source values are recommendation inputs, not proven live Ads bid values.`,
    writableEntity.sourceReportType ? `Writable Ads UI object was bound from ${writableEntity.sourceReportType} source row ${sourceRow}.` : '',
    context.hasFallback
      ? 'Campaign/ad group/entity context was completed from entityId fallback and must be re-confirmed in the live Ads UI before approval.'
      : '',
  ].join(' ');

  const target = {
    storeName: context.storeName,
    marketplaceCode: context.marketplaceCode,
    portfolioName: context.portfolioName,
    campaignName: context.campaignName,
    adGroupName: context.adGroupName,
    entityType: writeEntityType,
    entityName: writeEntityName,
    actionType: rec.actionType,
  };

  const templateArgs = [];
  pushArg(templateArgs, '--out', out, { required: true });
  pushArg(templateArgs, '--md-out', mdOut, { required: true });
  pushArg(templateArgs, '--store', context.storeName);
  pushArg(templateArgs, '--marketplace', context.marketplaceCode);
  pushArg(templateArgs, '--portfolio', context.portfolioName);
  pushArg(templateArgs, '--asin', context.asin);
  pushArg(templateArgs, '--metric-date', context.metricDate);
  pushArg(templateArgs, '--campaign', context.campaignName, { required: true });
  pushArg(templateArgs, '--ad-group', context.adGroupName, { required: true });
  pushArg(templateArgs, '--entity-type', writeEntityType, { required: true });
  pushArg(templateArgs, '--entity', writeEntityName, { required: true });
  pushArg(templateArgs, '--action', rec.actionType, { required: true });
  pushArg(templateArgs, '--recommendation-id', recommendationId, { required: true });
  pushArg(templateArgs, '--source-evidence', path.relative(root, sourcePath));
  pushArg(templateArgs, '--source-files', sourceFiles.join(','));
  pushArg(templateArgs, '--source-row', sourceRow);
  pushArg(templateArgs, '--source-entity-type', sourceEntityType);
  pushArg(templateArgs, '--source-current-value', sourceCurrentValue);
  pushArg(templateArgs, '--source-recommended-value', sourceRecommendedValue);
  pushArg(templateArgs, '--source-ai-strategy-fallback-reason', sourceAiStrategyFallbackReason);
  pushArg(templateArgs, '--source-ai-action-fallback-reason', sourceAiActionFallbackReason);
  pushArg(templateArgs, '--approval-scope', buildApprovalScope(target), { required: true });
  pushArg(templateArgs, '--risk-rationale', riskRationale, { required: true });

  runTemplate(templateArgs);
  console.log(`Readback candidate generated from recommendation ${recommendationId}`);
  console.log(`Source: ${sourcePath}`);
  console.log(`Candidate JSON: ${out}`);
  console.log(`Candidate checklist: ${mdOut}`);
  console.log('Status: NEEDS_WORK. This is approval material, not ad execution evidence.');
}

main();
