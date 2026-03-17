const geoip = require('geoip-lite');
const net = require('net');

function normalizeIp(ip) {
  const raw = String(ip || '').trim();
  if (!raw) return '';
  if (raw.includes(',')) return raw.split(',')[0].trim();
  if (raw.startsWith('::ffff:')) return raw.slice('::ffff:'.length);
  if (raw === '::1') return '127.0.0.1';
  return raw;
}

function lookupIpGeo(ip) {
  const clean = normalizeIp(ip);
  if (!clean || !net.isIP(clean)) return { ok: false, reason: 'invalid_ip' };

  const data = geoip.lookup(clean);
  if (!data) return { ok: false, reason: 'not_found' };

  const ll = Array.isArray(data.ll) ? data.ll : [];
  const lat = typeof ll[0] === 'number' ? ll[0] : null;
  const lon = typeof ll[1] === 'number' ? ll[1] : null;

  return {
    ok: true,
    source: 'geoip-lite',
    ip: clean,
    country: String(data.country || ''),
    region: String(data.region || ''),
    city: String(data.city || ''),
    timezone: String(data.timezone || ''),
    lat,
    lon
  };
}

function ipGeoToText(ipGeo) {
  if (!ipGeo || typeof ipGeo !== 'object') return '(none)';
  const parts = [];
  if (ipGeo.city) parts.push(ipGeo.city);
  if (ipGeo.region) parts.push(ipGeo.region);
  if (ipGeo.country) parts.push(ipGeo.country);
  const place = parts.length ? parts.join(', ') : '';
  const tz = ipGeo.timezone ? ` (${ipGeo.timezone})` : '';

  const hasCoords = typeof ipGeo.lat === 'number' && typeof ipGeo.lon === 'number';
  const map = hasCoords
    ? `https://www.google.com/maps?q=${encodeURIComponent(`${ipGeo.lat},${ipGeo.lon}`)}`
    : '';

  if (place && map) return `${place}${tz}\n${map}`;
  if (place) return `${place}${tz}`;
  if (map) return map;
  return '(none)';
}

module.exports = { lookupIpGeo, ipGeoToText };

