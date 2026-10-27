

export function readbackRepairRelatedBlockers(label: string): string[] {
  if (label === '执行前值' || label === '执行后值') {
    return ['执行前值和执行后值不能相同', '降价动作必须证明执行后值低于执行前值'];
  }
  if (label === '回读值' || label === '执行后值') {
    return ['回读值必须等于执行后值'];
  }
  if (label === '执行前截图' || label === '执行后截图' || label === '回读证据') {
    return ['执行前、执行后和回读证据文件不能复用'];
  }
  if (label === '审批时间' || label === '执行前时间' || label === '执行时间' || label === '执行后时间' || label === '回读时间') {
    return [`${label}不是可解析时间`, '时间顺序必须为审批≤执行前≤执行动作≤执行后≤回读'];
  }
  return [];
}

export function readbackRepairFieldClass(label: string, missing: string[], active: boolean, pulsing: boolean): string {
  if (!active) return '';
  const needsAttention = missing.includes(label)
    || readbackRepairRelatedBlockers(label).some((blocker) => missing.includes(blocker));
  if (!needsAttention) return '';
  return [
    'readback-repair-field-active',
    pulsing ? 'readback-repair-field-pulse' : '',
  ].filter(Boolean).join(' ');
}
