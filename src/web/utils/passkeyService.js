const {
  generateRegistrationOptions,
  verifyRegistrationResponse,
  generateAuthenticationOptions,
  verifyAuthenticationResponse
} = require('@simplewebauthn/server');

const { env } = require('../../config/env');

function collectCandidateOrigins() {
  const candidates = [
    String(env.PUBLIC_BASE_URL || '').trim(),
    String(env.CALLBACK_URL || '').trim(),
    `http://localhost:${env.PORT}`
  ];

  const origins = [];
  for (const candidate of candidates) {
    if (!candidate) continue;
    try {
      const url = new URL(candidate);
      if (!['http:', 'https:'].includes(url.protocol)) continue;
      const origin = url.origin;
      if (!origins.includes(origin)) origins.push(origin);
    } catch {
      // Ignore invalid URLs and keep the remaining candidates.
    }
  }

  return origins;
}

function getPrimaryOrigin() {
  return collectCandidateOrigins()[0] || `http://localhost:${env.PORT}`;
}

function getRpId() {
  try {
    return new URL(getPrimaryOrigin()).hostname;
  } catch {
    return 'localhost';
  }
}

function buildRegistrationDescriptors(passkeys = []) {
  return (Array.isArray(passkeys) ? passkeys : [])
    .map((entry) => {
      const credentialID = String(entry?.credentialID || '').trim();
      if (!credentialID) return null;
      return {
        id: Buffer.from(credentialID, 'base64url'),
        type: 'public-key',
        transports: Array.isArray(entry?.transports) ? entry.transports : []
      };
    })
    .filter(Boolean);
}

async function createPasskeyRegistrationOptions({ user, passkeys = [] }) {
  const userId = String(user?._id || '').trim();
  const email = String(user?.email || '').trim();
  const displayName = String(user?.name || '').trim() || email || 'Administrator';
  if (!userId || !email) {
    throw new Error('Passkey registration requires a valid admin account.');
  }

  return await generateRegistrationOptions({
    rpName: 'Rodstarkian Suite',
    rpID: getRpId(),
    userID: userId,
    userName: email,
    userDisplayName: displayName,
    attestationType: 'none',
    timeout: 60000,
    excludeCredentials: buildRegistrationDescriptors(passkeys),
    authenticatorSelection: {
      residentKey: 'required',
      userVerification: 'preferred'
    }
  });
}

async function createPasskeyAuthenticationOptions({ passkeys = null } = {}) {
  const descriptors = Array.isArray(passkeys) && passkeys.length ? buildRegistrationDescriptors(passkeys) : undefined;
  return await generateAuthenticationOptions({
    rpID: getRpId(),
    userVerification: 'preferred',
    timeout: 60000,
    ...(descriptors ? { allowCredentials: descriptors } : {})
  });
}

async function verifyPasskeyRegistration({ response, challenge }) {
  return await verifyRegistrationResponse({
    response,
    expectedChallenge: String(challenge || ''),
    expectedOrigin: collectCandidateOrigins(),
    expectedRPID: getRpId(),
    requireUserVerification: true
  });
}

async function verifyPasskeyAuthentication({ response, challenge, authenticator }) {
  return await verifyAuthenticationResponse({
    response,
    expectedChallenge: String(challenge || ''),
    expectedOrigin: collectCandidateOrigins(),
    expectedRPID: getRpId(),
    authenticator,
    requireUserVerification: true
  });
}

module.exports = {
  collectCandidateOrigins,
  getPrimaryOrigin,
  getRpId,
  createPasskeyRegistrationOptions,
  createPasskeyAuthenticationOptions,
  verifyPasskeyRegistration,
  verifyPasskeyAuthentication
};
