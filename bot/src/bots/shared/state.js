function nowMs() {
  return Date.now();
}

function setWithExpiry(map, key, value, ttlMs) {
  map.set(key, { value, expiresAt: nowMs() + ttlMs });
}

function getActive(map, key) {
  const entry = map.get(key);
  if (!entry) return null;
  if (entry.expiresAt <= nowMs()) {
    map.delete(key);
    return null;
  }
  return entry.value;
}

function cleanupMap(map) {
  const t = nowMs();
  for (const [k, v] of map.entries()) {
    if (v.expiresAt <= t) map.delete(k);
  }
}

function createState() {
  const blackjack = new Map();
  const crash = new Map();
  const pvp = new Map();
  const marriage = new Map();

  return {
    blackjack,
    crash,
    pvp,
    marriage,
    setWithExpiry,
    getActive,
    cleanup() {
      cleanupMap(blackjack);
      cleanupMap(crash);
      cleanupMap(pvp);
      cleanupMap(marriage);
    }
  };
}

module.exports = { createState };

