function pickWeighted(items, getWeight) {
  const weights = items.map((item) => Math.max(0, Number(getWeight(item) ?? 0)));
  const total = weights.reduce((a, b) => a + b, 0);
  if (total <= 0) return null;
  let r = Math.random() * total;
  for (let i = 0; i < items.length; i += 1) {
    r -= weights[i];
    if (r <= 0) return items[i];
  }
  return items[items.length - 1] ?? null;
}

module.exports = { pickWeighted };

