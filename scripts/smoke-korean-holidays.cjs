const fs = require('fs');
const path = require('path');
const vm = require('vm');

const repoRoot = path.resolve(__dirname, '..');
const holidayPath = path.join(repoRoot, 'app', 'src', 'utils', 'koreanHolidays.js');
const dashboardPath = path.join(repoRoot, 'app', 'src', 'components', 'Dashboard.jsx');

const source = fs.readFileSync(holidayPath, 'utf8');
const transformed = source
  .replace(/export function /g, 'function ')
  .replace(/export const /g, 'const ')
  .replace(/export \{ KOREAN_PUBLIC_HOLIDAYS \};/g, '')
  + `
module.exports = {
  KOREAN_PUBLIC_HOLIDAYS,
  getKoreanPublicHolidaysForDate,
  getKoreanPublicHolidaysForMonth,
  hasKoreanPublicHolidayDataForYear,
  getKoreanPublicHolidayCoverage,
};`;

const sandbox = { module: { exports: {} }, exports: {} };
vm.runInNewContext(transformed, sandbox, { filename: holidayPath });

const {
  KOREAN_PUBLIC_HOLIDAYS,
  getKoreanPublicHolidaysForDate,
  getKoreanPublicHolidaysForMonth,
  hasKoreanPublicHolidayDataForYear,
  getKoreanPublicHolidayCoverage,
} = sandbox.module.exports;

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function names(dateKey) {
  return getKoreanPublicHolidaysForDate(dateKey).map((holiday) => holiday.name);
}

assert(hasKoreanPublicHolidayDataForYear(2025), '2025 coverage missing');
assert(hasKoreanPublicHolidayDataForYear(2026), '2026 coverage missing');
assert(!hasKoreanPublicHolidayDataForYear(2027), '2027 should be outside declared fixed coverage');

assert(names('2026-03-02').includes('대체공휴일(삼일절)'), '2026-03-02 substitute holiday missing');
assert(names('2026-05-25').includes('대체공휴일(부처님오신날)'), '2026-05-25 substitute holiday missing');
assert(names('2026-10-05').includes('대체공휴일(개천절)'), '2026-10-05 substitute holiday missing');
assert(names('2026-06-03').includes('전국동시지방선거일'), '2026 election holiday missing');
assert(names('2025-01-27').includes('임시공휴일'), '2025 one-time holiday missing');
assert(names('2025-05-05').length === 2, '2025-05-05 combined holidays missing');
assert(names('2026-07-17').length === 0, 'Constitution Day must not be marked as a public day-off holiday');

const may2026 = getKoreanPublicHolidaysForMonth(2026, 4);
assert(may2026.some((holiday) => holiday.date === '2026-05-01'), '2026 May Labor Day missing');
assert(may2026.some((holiday) => holiday.date === '2026-05-24'), '2026 May Buddha birthday missing');
assert(may2026.some((holiday) => holiday.date === '2026-05-25'), '2026 May substitute holiday missing');

const dashboardSource = fs.readFileSync(dashboardPath, 'utf8');
assert(dashboardSource.includes('getKoreanPublicHolidaysForDate'), 'Dashboard does not import/use holiday date lookup');
assert(dashboardSource.includes('calendar-day') && dashboardSource.includes('holiday-label'), 'Dashboard holiday cell markers missing');
assert(dashboardSource.includes('selected-date-holidays'), 'Dashboard selected-date holiday markers missing');
assert(dashboardSource.includes(' 외 '), 'Dashboard multi-holiday cell label should use Korean overflow wording');

const coverage = getKoreanPublicHolidayCoverage();
assert(Array.isArray(coverage.links) && coverage.links.length >= 3, 'Holiday source links missing');

console.log('KOREAN_HOLIDAYS_SMOKE_OK');
console.log(JSON.stringify({
  coverage: coverage.coverage,
  totalDateKeys: Object.keys(KOREAN_PUBLIC_HOLIDAYS).length,
  checks: {
    substitute20260302: names('2026-03-02'),
    substitute20260525: names('2026-05-25'),
    substitute20261005: names('2026-10-05'),
    combined20250505: names('2025-05-05'),
    may2026Count: may2026.length,
  },
}, null, 2));
