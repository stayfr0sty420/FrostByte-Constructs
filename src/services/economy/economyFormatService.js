const COMPACT_UNITS = [
  { value: 1e15, suffix: 'Q' },
  { value: 1e12, suffix: 'T' },
  { value: 1e9, suffix: 'B' },
  { value: 1e6, suffix: 'M' },
  { value: 1e3, suffix: 'K' }
];

function toSafeNumber(value, fallback = 0) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function formatExactNumber(value) {
  return Math.floor(toSafeNumber(value, 0)).toLocaleString('en-US');
}

function formatCompactNumber(value, { threshold = 1000, fallback = '0' } = {}) {
  const raw = toSafeNumber(value, NaN);
  if (!Number.isFinite(raw)) return fallback;

  const sign = raw < 0 ? '-' : '';
  const abs = Math.abs(raw);
  if (abs < threshold) return `${sign}${Math.floor(abs).toLocaleString('en-US')}`;

  for (let index = 0; index < COMPACT_UNITS.length; index += 1) {
    const unit = COMPACT_UNITS[index];
    if (abs < unit.value) continue;

    let compact = Math.round(abs / unit.value);
    if (compact >= 1000 && COMPACT_UNITS[index - 1]) {
      const nextUnit = COMPACT_UNITS[index - 1];
      compact = Math.round(abs / nextUnit.value);
      return `${sign}${compact}${nextUnit.suffix}`;
    }

    return `${sign}${compact}${unit.suffix}`;
  }

  return `${sign}${Math.floor(abs).toLocaleString('en-US')}`;
}

function formatDisplayNumber(value, options = {}) {
  const short = formatCompactNumber(value, options);
  const full = formatExactNumber(value);
  return {
    short,
    full,
    compacted: short !== full
  };
}

function formatTransactionNumber(value, { compactThreshold = 100_000_000_000 } = {}) {
  const raw = toSafeNumber(value, 0);
  if (Math.abs(raw) < compactThreshold) return formatExactNumber(raw);
  return formatCompactNumber(raw, { threshold: compactThreshold });
}

module.exports = {
  COMPACT_UNITS,
  toSafeNumber,
  formatExactNumber,
  formatCompactNumber,
  formatDisplayNumber,
  formatTransactionNumber
};
