const KOREAN_PUBLIC_HOLIDAY_SOURCE = {
  provider: 'Korea Astronomy and Space Science Institute / Korea Customs Service',
  coverage: '2025-2026',
  policy:
    'Fixed app calendar data for Korean holiday/day-off display. Labor Day is included for business-calendar visibility; Constitution Day is excluded because it is not a public day-off.',
  links: [
    'https://www.kasi.re.kr/kor/post/newsMaterial/32031',
    'https://www.customs.go.kr/engportal/cm/cntnts/cntntsView.do?cntntsId=7401&mi=13284',
    'https://www.data.go.kr/dataset/15012690/openapi.do',
  ],
  notes: [
    '2026 KASI calendar standard announcement published 2025-06-30.',
    'Korea Customs Service national holiday page cross-checks 2025 and 2026 listed dates.',
    'data.go.kr exposes the KASI special-day API, but the app uses fixed data so calendar rendering is not blocked by API keys or network failures.',
  ],
};

const KOREAN_PUBLIC_HOLIDAYS = {
  '2025-01-01': [{ name: '신정', shortName: '신정' }],
  '2025-01-27': [{ name: '임시공휴일', shortName: '임시' }],
  '2025-01-28': [{ name: '설날 연휴', shortName: '설' }],
  '2025-01-29': [{ name: '설날', shortName: '설날' }],
  '2025-01-30': [{ name: '설날 연휴', shortName: '설' }],
  '2025-03-01': [{ name: '삼일절', shortName: '3·1' }],
  '2025-03-03': [{ name: '대체공휴일(삼일절)', shortName: '대체' }],
  '2025-05-01': [{ name: '근로자의 날', shortName: '근로' }],
  '2025-05-05': [
    { name: '어린이날', shortName: '어린이' },
    { name: '부처님오신날', shortName: '부처님' },
  ],
  '2025-05-06': [{ name: '대체공휴일', shortName: '대체' }],
  '2025-06-03': [{ name: '대통령 선거일', shortName: '선거' }],
  '2025-06-06': [{ name: '현충일', shortName: '현충' }],
  '2025-08-15': [{ name: '광복절', shortName: '광복' }],
  '2025-10-03': [{ name: '개천절', shortName: '개천' }],
  '2025-10-05': [{ name: '추석 연휴', shortName: '추석' }],
  '2025-10-06': [{ name: '추석', shortName: '추석' }],
  '2025-10-07': [{ name: '추석 연휴', shortName: '추석' }],
  '2025-10-08': [{ name: '대체공휴일(추석)', shortName: '대체' }],
  '2025-10-09': [{ name: '한글날', shortName: '한글' }],
  '2025-12-25': [{ name: '성탄절', shortName: '성탄' }],

  '2026-01-01': [{ name: '신정', shortName: '신정' }],
  '2026-02-16': [{ name: '설날 연휴', shortName: '설' }],
  '2026-02-17': [{ name: '설날', shortName: '설날' }],
  '2026-02-18': [{ name: '설날 연휴', shortName: '설' }],
  '2026-03-01': [{ name: '삼일절', shortName: '3·1' }],
  '2026-03-02': [{ name: '대체공휴일(삼일절)', shortName: '대체' }],
  '2026-05-01': [{ name: '근로자의 날', shortName: '근로' }],
  '2026-05-05': [{ name: '어린이날', shortName: '어린이' }],
  '2026-05-24': [{ name: '부처님오신날', shortName: '부처님' }],
  '2026-05-25': [{ name: '대체공휴일(부처님오신날)', shortName: '대체' }],
  '2026-06-03': [{ name: '전국동시지방선거일', shortName: '선거' }],
  '2026-06-06': [{ name: '현충일', shortName: '현충' }],
  '2026-08-15': [{ name: '광복절', shortName: '광복' }],
  '2026-08-17': [{ name: '대체공휴일(광복절)', shortName: '대체' }],
  '2026-09-24': [{ name: '추석 연휴', shortName: '추석' }],
  '2026-09-25': [{ name: '추석', shortName: '추석' }],
  '2026-09-26': [{ name: '추석 연휴', shortName: '추석' }],
  '2026-10-03': [{ name: '개천절', shortName: '개천' }],
  '2026-10-05': [{ name: '대체공휴일(개천절)', shortName: '대체' }],
  '2026-10-09': [{ name: '한글날', shortName: '한글' }],
  '2026-12-25': [{ name: '성탄절', shortName: '성탄' }],
};

function toDateKey(value) {
  if (!value) return '';
  if (typeof value === 'string') return value.slice(0, 10);
  if (!(value instanceof Date) || Number.isNaN(value.getTime())) return '';

  return [
    value.getFullYear(),
    String(value.getMonth() + 1).padStart(2, '0'),
    String(value.getDate()).padStart(2, '0'),
  ].join('-');
}

function cloneHoliday(holiday, dateKey) {
  return {
    ...holiday,
    date: dateKey,
  };
}

export function getKoreanPublicHolidaysForDate(value) {
  const dateKey = toDateKey(value);
  return (KOREAN_PUBLIC_HOLIDAYS[dateKey] || []).map((holiday) => cloneHoliday(holiday, dateKey));
}

export function getKoreanPublicHolidaysForMonth(year, monthIndex) {
  const monthPrefix = `${year}-${String(monthIndex + 1).padStart(2, '0')}-`;
  return Object.entries(KOREAN_PUBLIC_HOLIDAYS)
    .filter(([dateKey]) => dateKey.startsWith(monthPrefix))
    .flatMap(([dateKey, holidays]) => holidays.map((holiday) => cloneHoliday(holiday, dateKey)));
}

export function hasKoreanPublicHolidayDataForYear(year) {
  return Object.keys(KOREAN_PUBLIC_HOLIDAYS).some((dateKey) => dateKey.startsWith(`${year}-`));
}

export function getKoreanPublicHolidayCoverage() {
  return KOREAN_PUBLIC_HOLIDAY_SOURCE;
}

export { KOREAN_PUBLIC_HOLIDAYS };
