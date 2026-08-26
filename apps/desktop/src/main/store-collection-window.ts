const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

export function deriveStoreCollectionWindow(
  businessDate: string,
  lookbackDays: number,
): { dateStart: string; dateEnd: string } {
  if (!ISO_DATE.test(businessDate)
    || !Number.isInteger(lookbackDays)
    || lookbackDays < 1
    || lookbackDays > 90) {
    throw new TypeError('invalid store collection business date or lookback');
  }
  const dateEnd = shiftIsoDate(businessDate, -1);
  return {
    dateStart: shiftIsoDate(dateEnd, -(lookbackDays - 1)),
    dateEnd,
  };
}

function shiftIsoDate(value: string, days: number): string {
  const parsed = new Date(`${value}T00:00:00.000Z`);
  if (Number.isNaN(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== value) {
    throw new TypeError('invalid ISO business date');
  }
  parsed.setUTCDate(parsed.getUTCDate() + days);
  return parsed.toISOString().slice(0, 10);
}
