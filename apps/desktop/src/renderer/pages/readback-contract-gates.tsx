import {
  type ReadbackFormState,
  type ReadbackContractCheck,
  type ReadbackContractStatus,
} from "./readback-contracts";
import {
  sourceFileLines,
  isSpreadsheetReportPath,
  valuesMatch,
  executableNumber,
  normalizePathForCompare,
} from "./readback-form";

export function requiredMissing(form: ReadbackFormState, currentBatchId?: string): string[] {
  const missing: string[] = [];
  const requireText = (value: string, label: string) => {
    if (!value.trim()) missing.push(label);
  };
  const requirePositiveNumber = (value: string, label: string) => {
    const parsed = Number(value);
    if (!Number.isFinite(parsed) || parsed <= 0) missing.push(label);
  };
  const requireFlag = (ok: boolean, label: string) => {
    if (!ok) missing.push(label);
  };
  requireText(form.storeName, '店铺');
  requireText(form.marketplaceCode, '站点');
  requireText(form.asin, 'ASIN');
  requireText(form.campaignName, '广告活动');
  requireText(form.adGroupName, '广告组');
  requireText(form.entityType, '对象类型');
  requireText(form.entityName, '对象名称');
  requireText(form.actionType, '动作类型');
  requireText(form.currentValue, '来源当前值');
  requireText(form.recommendedValue, '来源建议值');
  requireText(form.sourceBatchId, '来源批次');
  requireText(form.sourceMetricDate, '指标日期');
  requirePositiveNumber(form.sourceRow, '来源行号');
  requireText(form.sourceFiles, '推荐来源文件');
  const sourceFiles = sourceFileLines(form.sourceFiles);
  if (sourceFiles.length === 1 && !isSpreadsheetReportPath(sourceFiles[0])) {
    missing.push('推荐来源文件必须是真实报表');
  } else if (sourceFiles.length > 1 && !sourceFiles.every(isSpreadsheetReportPath)) {
    missing.push('推荐来源文件必须全部是真实报表');
  }
  requireText(form.approverName, '审批人');
  requireText(form.approvalArtifactPath, '审批凭证');
  requireText(form.approvalConfirmedAt, '审批时间');
  requireText(form.executedBy, '执行人');
  requireText(form.executionId, '执行编号');
  requireText(form.executionExecutedAt, '执行时间');
  requireText(form.beforeValue, '执行前值');
  requireText(form.beforeCapturedAt, '执行前时间');
  requireText(form.afterValue, '执行后值');
  requireText(form.afterCapturedAt, '执行后时间');
  requireText(form.readbackActualValue, '回读值');
  requireText(form.readbackReadAt, '回读时间');
  requireText(form.beforeScreenshotPath, '执行前截图');
  requireText(form.afterScreenshotPath, '执行后截图');
  requireText(form.readbackEvidencePath, '回读证据');
  requireText(form.liveBidSourceNote, '现场行证明');
  requireFlag(form.operatorConfirmed, '审批人确认范围');
  requireFlag(form.realWriteApproved, '外部审批允许');
  requireFlag(form.allowedByPolicy, '低风险策略允许');
  requireFlag(form.executionSuccess, '执行成功确认');
  requireFlag(form.executionVerified, '执行核验');
  requireFlag(form.readbackVerified, '回读核验');
  if (form.beforeValue && form.afterValue && valuesMatch(form.beforeValue, form.afterValue)) missing.push('执行前值和执行后值不能相同');
  if (form.afterValue && form.readbackActualValue && !valuesMatch(form.afterValue, form.readbackActualValue)) missing.push('回读值必须等于执行后值');
  if (form.actionType === 'lower_bid' && form.beforeValue && form.afterValue) {
    const beforeNumber = executableNumber(form.beforeValue);
    const afterNumber = executableNumber(form.afterValue);
    if (beforeNumber === null || afterNumber === null || afterNumber >= beforeNumber) {
      missing.push('降价动作必须证明执行后值低于执行前值');
    }
  }
  const evidencePaths = [form.beforeScreenshotPath, form.afterScreenshotPath, form.readbackEvidencePath]
    .filter((value) => value.trim())
    .map(normalizePathForCompare);
  if (evidencePaths.length === 3 && new Set(evidencePaths).size !== 3) {
    missing.push('执行前、执行后和回读证据文件不能复用');
  }
  const timestamps = [
    ['审批时间', form.approvalConfirmedAt],
    ['执行前时间', form.beforeCapturedAt],
    ['执行时间', form.executionExecutedAt],
    ['执行后时间', form.afterCapturedAt],
    ['回读时间', form.readbackReadAt],
  ] as const;
  const parsedTimestamps = timestamps.map(([label, value]) => ({ label, value, ms: Date.parse(value) }));
  for (const item of parsedTimestamps) {
    if (item.value.trim() && Number.isNaN(item.ms)) missing.push(`${item.label}不是可解析时间`);
  }
  if (parsedTimestamps.every((item) => item.value.trim() && Number.isFinite(item.ms))) {
    for (let index = 1; index < parsedTimestamps.length; index += 1) {
      if (parsedTimestamps[index].ms < parsedTimestamps[index - 1].ms) {
        missing.push('时间顺序必须为审批≤执行前≤执行动作≤执行后≤回读');
        break;
      }
    }
  }
  if (currentBatchId && form.sourceBatchId.trim() && form.sourceBatchId.trim() !== currentBatchId) {
    missing.push('来源批次必须等于当前批次');
  }
  return missing;
}

export function groupMissing(items: string[]) {
  const target = ['店铺', '站点', 'ASIN', '广告活动', '广告组', '对象类型', '对象名称', '动作类型'];
  const source = ['来源当前值', '来源建议值', '来源批次', '指标日期', '来源行号', '推荐来源文件', '推荐来源文件必须是真实报表', '推荐来源文件必须全部是真实报表', '来源批次必须等于当前批次'];
  const proof = ['审批人', '审批凭证', '审批时间', '执行人', '执行编号', '执行时间', '执行前值', '执行前时间', '执行后值', '执行后时间', '回读值', '回读时间', '执行前截图', '执行后截图', '回读证据', '现场行证明', '降价动作必须证明执行后值低于执行前值', '执行前、执行后和回读证据文件不能复用'];
  const confirmation = ['审批人确认范围', '外部审批允许', '低风险策略允许', '执行成功确认', '执行核验', '回读核验', '执行前值和执行后值不能相同', '回读值必须等于执行后值', '审批时间不是可解析时间', '执行前时间不是可解析时间', '执行时间不是可解析时间', '执行后时间不是可解析时间', '回读时间不是可解析时间', '时间顺序必须为审批≤执行前≤执行动作≤执行后≤回读'];
  return [
    { title: '执行对象', items: items.filter((item) => target.includes(item)) },
    { title: '建议来源', items: items.filter((item) => source.includes(item)) },
    { title: '证据文件和值', items: items.filter((item) => proof.includes(item)) },
    { title: '审批与核验', items: items.filter((item) => confirmation.includes(item)) },
  ].filter((group) => group.items.length > 0);
}

export function readbackPrecheckCopy(missing: string[]) {
  if (missing.length) {
    return {
      statusLabel: `未满足 ${missing.length} 项`,
      chipLabel: '',
      exportButtonLabel: '导出缺口草稿',
      helperText: '缺项状态下只能导出本地草稿，方便定位缺口；不能作为最终执行完成证据。',
    };
  }
  return {
    statusLabel: '字段已填写，待导出校验',
    chipLabel: '执行前、执行后和回读值已填写；导出时会校验本地文件存在。',
      exportButtonLabel: '导出回读证据',
      helperText: '字段已填写时仍需导出证据文件和说明文件，并由后端校验截图、真实报表和回读证据文件是否存在。',
  };
}

export function readbackContractChecks(form: ReadbackFormState): ReadbackContractCheck[] {
  const timeFields = [
    { label: '审批时间', value: form.approvalConfirmedAt },
    { label: '执行前时间', value: form.beforeCapturedAt },
    { label: '执行动作时间', value: form.executionExecutedAt },
    { label: '执行后时间', value: form.afterCapturedAt },
    { label: '回读时间', value: form.readbackReadAt },
  ];
  const missingTimes = timeFields.filter((field) => !field.value.trim()).map((field) => field.label);
  const invalidTimes = timeFields
    .filter((field) => field.value.trim() && Number.isNaN(Date.parse(field.value)))
    .map((field) => field.label);
  let timeStatus: ReadbackContractStatus = 'ready';
  let timeDetail = '审批、执行前、执行动作、执行后和回读时间顺序已满足。';
  if (missingTimes.length > 0) {
    timeStatus = 'pending';
    timeDetail = `待填写：${missingTimes.join('、')}。`;
  } else if (invalidTimes.length > 0) {
    timeStatus = 'blocked';
    timeDetail = `${invalidTimes.join('、')}不是可解析 ISO 时间。`;
  } else {
    const parsed = timeFields.map((field) => ({ ...field, ms: Date.parse(field.value) }));
    const brokenIndex = parsed.findIndex((field, index) => index > 0 && field.ms < parsed[index - 1].ms);
    if (brokenIndex > 0) {
      timeStatus = 'blocked';
      timeDetail = `${parsed[brokenIndex - 1].label}晚于${parsed[brokenIndex].label}；必须满足审批≤执行前≤执行动作≤执行后≤回读。`;
    }
  }

  let valueChangeStatus: ReadbackContractStatus = 'ready';
  let valueChangeDetail = '执行前值和执行后值已变化，可证明现场发生了真实修改。';
  if (!form.beforeValue.trim() || !form.afterValue.trim()) {
    valueChangeStatus = 'pending';
    valueChangeDetail = '待填写执行前值和执行后值。';
  } else if (valuesMatch(form.beforeValue, form.afterValue)) {
    valueChangeStatus = 'blocked';
    valueChangeDetail = '执行前值和执行后值相同，不能证明真实修改。';
  }

  let readbackMatchStatus: ReadbackContractStatus = 'ready';
  let readbackMatchDetail = '回读值与执行后值一致。';
  if (!form.afterValue.trim() || !form.readbackActualValue.trim()) {
    readbackMatchStatus = 'pending';
    readbackMatchDetail = '待填写执行后值和真实 ERP 回读值。';
  } else if (!valuesMatch(form.afterValue, form.readbackActualValue)) {
    readbackMatchStatus = 'blocked';
    readbackMatchDetail = '真实 ERP 回读值必须等于执行后值。';
  }

  let directionStatus: ReadbackContractStatus = 'ready';
  let directionDetail = form.actionType === 'lower_bid'
    ? '降价动作已证明执行后值低于执行前值。'
    : '当前动作不适用降价方向校验；仍需满足值变化和回读一致。';
  if (form.actionType === 'lower_bid') {
    const beforeNumber = executableNumber(form.beforeValue);
    const afterNumber = executableNumber(form.afterValue);
    if (!form.beforeValue.trim() || !form.afterValue.trim()) {
      directionStatus = 'pending';
      directionDetail = '待填写执行前值和执行后值后校验降价方向。';
    } else if (beforeNumber === null || afterNumber === null) {
      directionStatus = 'blocked';
      directionDetail = '降价动作的执行前值和执行后值必须能解析为数字。';
    } else if (afterNumber >= beforeNumber) {
      directionStatus = 'blocked';
      directionDetail = '降价动作必须证明执行后值低于执行前值。';
    }
  }

  const evidenceFields = [
    { label: '执行前截图', value: form.beforeScreenshotPath },
    { label: '执行后截图', value: form.afterScreenshotPath },
    { label: '回读证据', value: form.readbackEvidencePath },
  ];
  const missingEvidence = evidenceFields.filter((field) => !field.value.trim()).map((field) => field.label);
  let evidenceStatus: ReadbackContractStatus = 'ready';
  let evidenceDetail = '执行前、执行后和回读证据路径互不复用。';
  if (missingEvidence.length > 0) {
    evidenceStatus = 'pending';
    evidenceDetail = `待补：${missingEvidence.join('、')}。`;
  } else {
    const normalized = evidenceFields.map((field) => normalizePathForCompare(field.value));
    if (new Set(normalized).size !== normalized.length) {
      evidenceStatus = 'blocked';
      evidenceDetail = '执行前、执行后和回读证据文件不能复用。';
    }
  }

  return [
    { key: 'time-order', title: '时间顺序', status: timeStatus, detail: timeDetail },
    { key: 'value-change', title: '前后值变化', status: valueChangeStatus, detail: valueChangeDetail },
    { key: 'readback-match', title: '回读值一致', status: readbackMatchStatus, detail: readbackMatchDetail },
    { key: 'lower-bid-direction', title: '动作方向', status: directionStatus, detail: directionDetail },
    { key: 'evidence-distinct', title: '截图不复用', status: evidenceStatus, detail: evidenceDetail },
  ];
}

export function readbackContractStatusLabel(status: ReadbackContractStatus): string {
  if (status === 'ready') return '通过';
  if (status === 'blocked') return '阻断';
  return '待填写';
}

export function ReadbackContractStrip({ checks }: { checks: ReadbackContractCheck[] }) {
  const blockedCount = checks.filter((check) => check.status === 'blocked').length;
  const pendingCount = checks.filter((check) => check.status === 'pending').length;
  const summary = blockedCount > 0
    ? `阻断 ${blockedCount} 项`
    : pendingCount > 0
      ? `待填写 ${pendingCount} 项`
      : '合同通过';

  return (
    <div className="readback-contract-panel" role="status" aria-live="polite">
      <div className="readback-contract-heading">
        <span>时间和值安全合同</span>
        <strong>{summary}</strong>
      </div>
      <div className="readback-contract-grid">
        {checks.map((check) => (
          <div className={`readback-contract-card readback-contract-${check.status}`} key={check.key}>
            <span>{readbackContractStatusLabel(check.status)}</span>
            <strong>{check.title}</strong>
            <small>{check.detail}</small>
          </div>
        ))}
      </div>
    </div>
  );
}
