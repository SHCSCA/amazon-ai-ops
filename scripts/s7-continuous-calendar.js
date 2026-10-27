// 按职责复用原有严格校验，公共入口继续保持兼容。

const { BUSINESS_TIMEZONE, fail } = require('./s7-continuous-contracts.js');

function inclusiveDates(dateFrom, dateTo) {
    if (!validIsoDate(dateFrom) || !validIsoDate(dateTo) || dateFrom > dateTo)
        return [];
    const dates = [];
    const cursor = new Date(`${dateFrom}T12:00:00.000Z`);
    const end = new Date(`${dateTo}T12:00:00.000Z`);
    while (cursor <= end && dates.length < 31) {
        dates.push(cursor.toISOString().slice(0, 10));
        cursor.setUTCDate(cursor.getUTCDate() + 1);
    }
    return dates;
}

function isoDate(year, monthIndex, dayOfMonth) {
    return new Date(Date.UTC(year, monthIndex, dayOfMonth, 12)).toISOString().slice(0, 10);
}

function observedFixedHoliday(year, monthIndex, dayOfMonth) {
    const actual = new Date(Date.UTC(year, monthIndex, dayOfMonth, 12));
    const weekday = actual.getUTCDay();
    if (weekday === 6)
        actual.setUTCDate(actual.getUTCDate() - 1);
    else if (weekday === 0)
        actual.setUTCDate(actual.getUTCDate() + 1);
    return actual.toISOString().slice(0, 10);
}

function nthWeekdayOfMonth(year, monthIndex, weekday, occurrence) {
    const first = new Date(Date.UTC(year, monthIndex, 1, 12));
    const offset = (weekday - first.getUTCDay() + 7) % 7;
    return isoDate(year, monthIndex, 1 + offset + ((occurrence - 1) * 7));
}

function lastWeekdayOfMonth(year, monthIndex, weekday) {
    const last = new Date(Date.UTC(year, monthIndex + 1, 0, 12));
    const offset = (last.getUTCDay() - weekday + 7) % 7;
    return isoDate(year, monthIndex, last.getUTCDate() - offset);
}

function usFederalHolidayDates(year) {
    const holidays = new Set([
        observedFixedHoliday(year, 0, 1),
        nthWeekdayOfMonth(year, 1, 1, 3),
        lastWeekdayOfMonth(year, 4, 1),
        observedFixedHoliday(year, 6, 4),
        nthWeekdayOfMonth(year, 8, 1, 1),
        nthWeekdayOfMonth(year, 9, 1, 2),
        observedFixedHoliday(year, 10, 11),
        nthWeekdayOfMonth(year, 10, 4, 4),
        observedFixedHoliday(year, 11, 25),
    ]);
    if (year >= 1986)
        holidays.add(nthWeekdayOfMonth(year, 0, 1, 3));
    if (year >= 2021)
        holidays.add(observedFixedHoliday(year, 5, 19));
    return holidays;
}

function usFederalBusinessDates(dateFrom, dateTo) {
    const calendarDates = inclusiveDates(dateFrom, dateTo);
    if (calendarDates.length === 0)
        return [];
    const firstYear = Number(calendarDates[0].slice(0, 4));
    const lastYear = Number(calendarDates.at(-1).slice(0, 4));
    const holidays = new Set();
    for (let year = firstYear - 1; year <= lastYear + 1; year += 1) {
        for (const holiday of usFederalHolidayDates(year))
            holidays.add(holiday);
    }
    return calendarDates.filter((value) => {
        const day = new Date(`${value}T12:00:00.000Z`).getUTCDay();
        return day >= 1 && day <= 5 && !holidays.has(value);
    });
}

function usWeekdayBusinessDates(dateFrom, dateTo) {
    return usFederalBusinessDates(dateFrom, dateTo);
}

function businessDateInTimezone(value, timeZone = BUSINESS_TIMEZONE) {
    const date = value instanceof Date ? value : new Date(value);
    if (!Number.isFinite(date.valueOf()))
        return '';
    const parts = new Intl.DateTimeFormat('en-US', {
        day: '2-digit',
        month: '2-digit',
        timeZone,
        year: 'numeric',
    }).formatToParts(date);
    const values = Object.fromEntries(parts.map((part) => [part.type, part.value]));
    return `${values.year}-${values.month}-${values.day}`;
}

function previousIsoDate(value) {
    if (!validIsoDate(value))
        return '';
    const date = new Date(`${value}T12:00:00.000Z`);
    date.setUTCDate(date.getUTCDate() - 1);
    return date.toISOString().slice(0, 10);
}

function recentCompletedUsBusinessDates(generatedAt) {
    const currentBusinessDate = businessDateInTimezone(generatedAt);
    if (!currentBusinessDate)
        fail('Continuous-operation generatedAt is invalid.');
    const dates = [];
    let cursor = previousIsoDate(currentBusinessDate);
    for (let index = 0; dates.length < 7 && index < 31; index += 1) {
        if (usFederalBusinessDates(cursor, cursor).length === 1)
            dates.unshift(cursor);
        cursor = previousIsoDate(cursor);
    }
    if (dates.length !== 7)
        fail('Unable to resolve the most recent seven completed US federal business dates.');
    return dates;
}

function validIsoDate(value) {
    if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value))
        return false;
    const date = new Date(`${value}T00:00:00.000Z`);
    return !Number.isNaN(date.valueOf()) && date.toISOString().slice(0, 10) === value;
}

module.exports = { inclusiveDates, isoDate, observedFixedHoliday, nthWeekdayOfMonth, lastWeekdayOfMonth, usFederalHolidayDates, usFederalBusinessDates, usWeekdayBusinessDates, businessDateInTimezone, previousIsoDate, recentCompletedUsBusinessDates, validIsoDate };
