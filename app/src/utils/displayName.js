const EMAIL_PATTERN = /^[^\s@<>]+@[^\s@<>]+\.[^\s@<>]+$/;

export function isEmailLike(value) {
  return EMAIL_PATTERN.test(String(value || '').trim());
}

export function getDisplayName(candidates = [], fallback = '사용자') {
  for (const candidate of candidates) {
    const value = String(candidate || '').trim();
    if (value && !isEmailLike(value)) {
      return value;
    }
  }

  return fallback;
}
