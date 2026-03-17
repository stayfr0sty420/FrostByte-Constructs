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
  const coinflip = new Map();
  const blackjack = new Map();
  const crash = new Map();
  const pvp = new Map();
  const marriage = new Map();
  const color = new Map();
  const colorgame = new Map();
  const dice = new Map();
  const slots = new Map();

  return {
    coinflip,
    blackjack,
    crash,
    pvp,
    marriage,
    color,
    colorgame,
    dice,
    slots,
    setWithExpiry,
    getActive,
    cleanup() {
      cleanupMap(coinflip);
      cleanupMap(blackjack);
      cleanupMap(crash);
      cleanupMap(pvp);
      cleanupMap(marriage);
      cleanupMap(color);
      cleanupMap(colorgame);
      cleanupMap(dice);
      cleanupMap(slots);
    }
  };
}

module.exports = { createState };
