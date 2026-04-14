const net = require('net');
const { env } = require('../../config/env');

const IPAPI_BASE_URL = 'https://api.ipapi.is';
const REQUEST_TIMEOUT_MS = 5000;

function isPublicIp(ip) {
  const value = String(ip || '').trim();
  if (!net.isIP(value)) return false;

  if (value === '127.0.0.1' || value === '::1') return false;
  if (value.startsWith('10.')) return false;
  if (value.startsWith('192.168.')) return false;
  if (value.startsWith('169.254.')) return false;
  if (value.startsWith('fc') || value.startsWith('fd')) return false;
  if (value.startsWith('fe80:')) return false;
  if (value.startsWith('172.')) {
    const second = Number(value.split('.')[1] || '');
    if (Number.isFinite(second) && second >= 16 && second <= 31) return false;
  }

  return true;
}

function buildLookupUrl(ip) {
  const url = new URL(IPAPI_BASE_URL);
  url.searchParams.set('q', ip);
  if (env.VERIFICATION_IPAPI_KEY) {
    url.searchParams.set('key', env.VERIFICATION_IPAPI_KEY);
  }
  return url.toString();
}

async function fetchWithTimeout(url, options = {}) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);

  try {
    return await fetch(url, {
      ...options,
      signal: controller.signal,
      headers: {
        accept: 'application/json',
        ...(options.headers || {})
      }
    });
  } finally {
    clearTimeout(timeout);
  }
}

function normalizeCompanyType(payload) {
  const companyType = String(payload?.company?.type || '').trim().toLowerCase();
  if (companyType) return companyType;
  return String(payload?.asn?.type || '').trim().toLowerCase();
}

function buildBlockedMessage(result) {
  const parts = [];
  if (result.vpn) parts.push('VPN');
  if (result.proxy) parts.push('Proxy');
  if (result.tor) parts.push('Tor');
  if (result.hosting) parts.push('Hosting provider');

  const label = parts.length ? parts.join('/') : 'Restricted network';
  return result.service
    ? `${label} detected (${result.service}). Disable it to continue.`
    : `${label} detected. Disable it to continue.`;
}

async function lookupIpSecurity(ip) {
  const normalizedIp = String(ip || '').trim();
  if (!isPublicIp(normalizedIp)) {
    return {
      ok: false,
      skipped: true,
      provider: 'ipapi.is',
      reason: 'invalid_or_private_ip'
    };
  }

  try {
    const response = await fetchWithTimeout(buildLookupUrl(normalizedIp), { method: 'GET' });
    const payload = await response.json().catch(() => null);

    if (!response.ok) {
      return {
        ok: false,
        provider: 'ipapi.is',
        reason: `http_${response.status}`,
        message: 'IP security lookup failed.'
      };
    }

    if (!payload || typeof payload !== 'object') {
      return {
        ok: false,
        provider: 'ipapi.is',
        reason: 'invalid_payload',
        message: 'IP security lookup returned an invalid response.'
      };
    }

    if (payload.error) {
      return {
        ok: false,
        provider: 'ipapi.is',
        reason: 'provider_error',
        message: String(payload.error || 'IP security lookup failed.')
      };
    }

    const companyType = normalizeCompanyType(payload);
    const service = String(payload?.vpn?.service || payload?.company?.name || payload?.asn?.org || '').trim();
    const vpn = Boolean(payload?.is_vpn);
    const proxy = Boolean(payload?.is_proxy);
    const tor = Boolean(payload?.is_tor);
    const hosting = Boolean(payload?.is_datacenter) || companyType === 'hosting';
    const blocked = vpn || proxy || tor || hosting;

    const result = {
      ok: true,
      provider: 'ipapi.is',
      ip: normalizedIp,
      blocked,
      vpn,
      proxy,
      tor,
      hosting,
      service,
      companyType,
      rawMessage: '',
      checkedAt: new Date()
    };

    result.rawMessage = blocked ? buildBlockedMessage(result) : 'Connection safety check passed.';
    return result;
  } catch (error) {
    return {
      ok: false,
      provider: 'ipapi.is',
      reason: error?.name === 'AbortError' ? 'timeout' : 'network_error',
      message: 'IP security lookup failed.'
    };
  }
}

module.exports = {
  isPublicIp,
  lookupIpSecurity
};
