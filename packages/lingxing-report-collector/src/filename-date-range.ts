export interface FilenameDateRangeAnalysis {
  filename: string;
  dateStart: string;
  dateEnd: string;
  validInputDates: boolean;
  normalizedFilename: string;
  startToken: string;
  endToken: string;
  hasStartToken: boolean;
  hasEndToken: boolean;
  missing: Array<'dateStart' | 'dateEnd' | 'dateInput'>;
}

export function analyzeFilenameDateRange(
  filename: string,
  dateStart: string,
  dateEnd: string,
): FilenameDateRangeAnalysis {
  const validInputDates = isIsoDate(dateStart) && isIsoDate(dateEnd);
  const normalizedFilename = normalizeDateToken(filename);
  const startToken = normalizeDateToken(dateStart);
  const endToken = normalizeDateToken(dateEnd);
  const hasStartToken = validInputDates && normalizedFilename.includes(startToken);
  const hasEndToken = validInputDates && normalizedFilename.includes(endToken);
  const missing: FilenameDateRangeAnalysis['missing'] = [];

  if (!validInputDates) {
    missing.push('dateInput');
  } else {
    if (!hasStartToken) missing.push('dateStart');
    if (!hasEndToken) missing.push('dateEnd');
  }

  return {
    filename,
    dateStart,
    dateEnd,
    validInputDates,
    normalizedFilename,
    startToken,
    endToken,
    hasStartToken,
    hasEndToken,
    missing,
  };
}

export function filenameContainsDateRange(filename: string, dateStart: string, dateEnd: string): boolean {
  const analysis = analyzeFilenameDateRange(filename, dateStart, dateEnd);
  return analysis.validInputDates && analysis.hasStartToken && analysis.hasEndToken;
}

export function filenameDateRangeAnalysisSummary(analysis: FilenameDateRangeAnalysis): string {
  if (!analysis.validInputDates) {
    return `invalid date input: ${analysis.dateStart} to ${analysis.dateEnd}`;
  }
  if (analysis.missing.length === 0) {
    return `filename contains start=${analysis.startToken} and end=${analysis.endToken}`;
  }
  return [
    `missing ${analysis.missing.join(',')}`,
    `expected start=${analysis.startToken}`,
    `end=${analysis.endToken}`,
    `normalized filename=${analysis.normalizedFilename || 'empty'}`,
  ].join('; ');
}

function normalizeDateToken(value: string): string {
  return value.replace(/\D/g, '');
}

function isIsoDate(value: string): boolean {
  return /^\d{4}-\d{2}-\d{2}$/.test(value);
}
