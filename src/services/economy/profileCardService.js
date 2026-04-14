const fs = require('fs/promises');
const path = require('path');
const sharp = require('sharp');
const { formatCompactNumber } = require('./economyFormatService');
const { env } = require('../../config/env');

const CARD_WIDTH = 1040;
const CARD_HEIGHT = 600;

function normalizeString(value, fallback = '') {
  const normalized = String(value || '').trim();
  return normalized || fallback;
}

function escapeXml(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function clampText(value, max) {
  const safe = normalizeString(value);
  if (safe.length <= max) return safe;
  return `${safe.slice(0, Math.max(0, max - 1))}…`;
}

async function fetchImageBuffer(url) {
  const safeUrl = normalizeString(url);
  if (!safeUrl) return null;

  if (safeUrl.startsWith('/')) {
    const assetPath = safeUrl.replace(/^\/+/, '');
    if (assetPath.startsWith('assets/images/')) {
      const relativeImagePath = assetPath.slice('assets/'.length);
      const absolutePath = path.resolve(process.cwd(), relativeImagePath);
      const imagesRoot = path.resolve(process.cwd(), 'images');
      if (absolutePath.startsWith(imagesRoot)) {
        try {
          const buffer = await fs.readFile(absolutePath);
          return buffer.length ? buffer : null;
        } catch {
          return null;
        }
      }
    }

    const publicBaseUrl = normalizeString(env.PUBLIC_BASE_URL);
    if (!publicBaseUrl) return null;

    try {
      const response = await fetch(new URL(safeUrl, publicBaseUrl).toString());
      if (!response.ok) return null;
      const contentType = String(response.headers.get('content-type') || '').toLowerCase();
      if (!contentType.startsWith('image/')) return null;
      const arrayBuffer = await response.arrayBuffer();
      const buffer = Buffer.from(arrayBuffer);
      return buffer.length ? buffer : null;
    } catch {
      return null;
    }
  }

  try {
    const response = await fetch(safeUrl);
    if (!response.ok) return null;
    const contentType = String(response.headers.get('content-type') || '').toLowerCase();
    if (!contentType.startsWith('image/')) return null;
    const arrayBuffer = await response.arrayBuffer();
    const buffer = Buffer.from(arrayBuffer);
    return buffer.length ? buffer : null;
  } catch {
    return null;
  }
}

function createOverlaySvg({
  displayName,
  title,
  bio,
  guildName,
  stats,
  followers,
  following,
  marriageLabel,
  topPvpItems = []
}) {
  const topGearMarkup = topPvpItems
    .slice(0, 3)
    .map((entry, index) => {
      const x = 610 + index * 118;
      const rarity = clampText(String(entry?.item?.rarity || 'gear').toUpperCase(), 12);
      const name = clampText(entry?.item?.name || entry?.itemId || 'Unknown Gear', 14);
      const score = Math.max(0, Number(entry?.combatScore) || 0);
      const refinement = Math.max(0, Number(entry?.refinement) || 0);
      return `
        <g transform="translate(${x}, 82)">
          <rect width="108" height="84" rx="18" fill="rgba(6, 4, 8, 0.54)" stroke="rgba(255,255,255,0.08)" />
          <text x="16" y="24" fill="rgba(248, 113, 113, 0.82)" font-family="Segoe UI, Arial, sans-serif" font-size="13" font-weight="700">TOP ${index + 1}</text>
          <text x="16" y="46" fill="#ffffff" font-family="Segoe UI, Arial, sans-serif" font-size="13" font-weight="700">${escapeXml(name)}</text>
          <text x="16" y="62" fill="rgba(255,255,255,0.7)" font-family="Segoe UI, Arial, sans-serif" font-size="11">${escapeXml(rarity)}</text>
          <text x="16" y="76" fill="rgba(255,255,255,0.86)" font-family="Segoe UI, Arial, sans-serif" font-size="11">GS ${escapeXml(String(score))}${refinement ? ` • +${escapeXml(String(refinement))}` : ''}</text>
        </g>
      `;
    })
    .join('');

  return Buffer.from(`
    <svg width="${CARD_WIDTH}" height="${CARD_HEIGHT}" viewBox="0 0 ${CARD_WIDTH} ${CARD_HEIGHT}" xmlns="http://www.w3.org/2000/svg">
      <defs>
        <linearGradient id="bgShade" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0%" stop-color="rgba(9, 3, 7, 0.04)" />
          <stop offset="100%" stop-color="rgba(0, 0, 0, 0.42)" />
        </linearGradient>
        <linearGradient id="panelGlow" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0%" stop-color="rgba(239, 68, 68, 0.74)" />
          <stop offset="50%" stop-color="rgba(190, 24, 93, 0.74)" />
          <stop offset="100%" stop-color="rgba(15, 23, 42, 0.62)" />
        </linearGradient>
      </defs>
      <rect width="${CARD_WIDTH}" height="${CARD_HEIGHT}" fill="rgba(5, 2, 5, 0.5)" />
      <rect width="${CARD_WIDTH}" height="${CARD_HEIGHT}" fill="url(#bgShade)" />
      <rect x="34" y="34" width="${CARD_WIDTH - 68}" height="${CARD_HEIGHT - 68}" rx="30" fill="rgba(7, 4, 8, 0.42)" stroke="rgba(255,255,255,0.12)" />
      <rect x="54" y="54" width="932" height="178" rx="28" fill="url(#panelGlow)" opacity="0.92" />
      <rect x="286" y="256" width="700" height="290" rx="24" fill="rgba(6, 4, 8, 0.62)" stroke="rgba(255,255,255,0.08)" />
      <rect x="54" y="256" width="206" height="290" rx="24" fill="rgba(6, 4, 8, 0.62)" stroke="rgba(255,255,255,0.08)" />

      <text x="286" y="105" fill="rgba(255, 230, 230, 0.88)" font-family="Segoe UI, Arial, sans-serif" font-size="18" letter-spacing="5">ROBOT PROFILE</text>
      <text x="286" y="154" fill="#ffffff" font-family="Segoe UI, Arial, sans-serif" font-size="44" font-weight="700">${escapeXml(displayName)}</text>
      <text x="286" y="194" fill="rgba(255, 228, 230, 0.82)" font-family="Segoe UI, Arial, sans-serif" font-size="22">${escapeXml(title)}</text>
      ${topGearMarkup}

      <text x="306" y="300" fill="rgba(248, 113, 113, 0.88)" font-family="Segoe UI, Arial, sans-serif" font-size="16" letter-spacing="4">BIO</text>
      <text x="306" y="338" fill="rgba(255,255,255,0.92)" font-family="Segoe UI, Arial, sans-serif" font-size="20">${escapeXml(bio)}</text>
      <text x="306" y="388" fill="rgba(248, 113, 113, 0.88)" font-family="Segoe UI, Arial, sans-serif" font-size="16" letter-spacing="4">SERVER</text>
      <text x="306" y="425" fill="rgba(255,255,255,0.9)" font-family="Segoe UI, Arial, sans-serif" font-size="22">${escapeXml(guildName)}</text>

      <text x="306" y="474" fill="rgba(248, 113, 113, 0.88)" font-family="Segoe UI, Arial, sans-serif" font-size="16" letter-spacing="4">SOCIAL</text>
      <text x="306" y="512" fill="rgba(255,255,255,0.9)" font-family="Segoe UI, Arial, sans-serif" font-size="22">Followers ${escapeXml(String(followers))} • Following ${escapeXml(String(following))}</text>
      <text x="306" y="542" fill="rgba(255,255,255,0.72)" font-family="Segoe UI, Arial, sans-serif" font-size="19">${escapeXml(marriageLabel)}</text>

      <text x="84" y="292" fill="rgba(248, 113, 113, 0.88)" font-family="Segoe UI, Arial, sans-serif" font-size="16" letter-spacing="4">STATS</text>
      <text x="84" y="345" fill="#ffffff" font-family="Segoe UI, Arial, sans-serif" font-size="20">Level</text>
      <text x="84" y="378" fill="rgba(255,255,255,0.92)" font-family="Segoe UI, Arial, sans-serif" font-size="34" font-weight="700">${escapeXml(stats.level)}</text>
      <text x="84" y="432" fill="#ffffff" font-family="Segoe UI, Arial, sans-serif" font-size="20">Wallet</text>
      <text x="84" y="465" fill="rgba(255,255,255,0.92)" font-family="Segoe UI, Arial, sans-serif" font-size="34" font-weight="700">${escapeXml(stats.wallet)}</text>
      <text x="84" y="519" fill="#ffffff" font-family="Segoe UI, Arial, sans-serif" font-size="20">Gear</text>
      <text x="84" y="552" fill="rgba(255,255,255,0.92)" font-family="Segoe UI, Arial, sans-serif" font-size="34" font-weight="700">${escapeXml(stats.gearScore)}</text>

      <text x="746" y="300" fill="rgba(248, 113, 113, 0.88)" font-family="Segoe UI, Arial, sans-serif" font-size="16" letter-spacing="4">BANK</text>
      <text x="746" y="338" fill="#ffffff" font-family="Segoe UI, Arial, sans-serif" font-size="38" font-weight="700">${escapeXml(stats.bank)}</text>
      <text x="746" y="388" fill="rgba(248, 113, 113, 0.88)" font-family="Segoe UI, Arial, sans-serif" font-size="16" letter-spacing="4">PVP</text>
      <text x="746" y="425" fill="#ffffff" font-family="Segoe UI, Arial, sans-serif" font-size="38" font-weight="700">${escapeXml(stats.pvp)}</text>
      <text x="746" y="474" fill="rgba(248, 113, 113, 0.88)" font-family="Segoe UI, Arial, sans-serif" font-size="16" letter-spacing="4">ENERGY</text>
      <text x="746" y="512" fill="#ffffff" font-family="Segoe UI, Arial, sans-serif" font-size="38" font-weight="700">${escapeXml(stats.energy)}</text>
      <text x="746" y="542" fill="rgba(255,255,255,0.72)" font-family="Segoe UI, Arial, sans-serif" font-size="18">Image card generated by RoBot</text>
    </svg>
  `);
}

async function createAvatarLayer(avatarUrl) {
  const avatarBuffer = await fetchImageBuffer(avatarUrl);
  if (!avatarBuffer) return null;

  const circleMask = Buffer.from(`
    <svg width="180" height="180" viewBox="0 0 180 180" xmlns="http://www.w3.org/2000/svg">
      <circle cx="90" cy="90" r="90" fill="#ffffff" />
    </svg>
  `);

  return await sharp(avatarBuffer, { failOnError: false })
    .resize(180, 180, { fit: 'cover' })
    .composite([{ input: circleMask, blend: 'dest-in' }])
    .png()
    .toBuffer();
}

async function createBackgroundLayer(wallpaperUrl) {
  const wallpaperBuffer = await fetchImageBuffer(wallpaperUrl);
  if (!wallpaperBuffer) {
    return await sharp({
      create: {
        width: CARD_WIDTH,
        height: CARD_HEIGHT,
        channels: 4,
        background: { r: 32, g: 5, b: 15, alpha: 1 }
      }
    })
      .png()
      .toBuffer();
  }

  return await sharp(wallpaperBuffer, { failOnError: false })
    .resize(CARD_WIDTH, CARD_HEIGHT, { fit: 'cover' })
    .blur(1.15)
    .modulate({ brightness: 0.92, saturation: 1.12 })
    .png()
    .toBuffer();
}

async function createProfileCardBuffer({
  user,
  wallpaper,
  marriageRing,
  snapshot,
  displayName,
  guildName = '',
  avatarUrl = '',
  spouseName = '',
  topPvpItems = []
}) {
  const safeName = clampText(displayName || user?.username || user?.discordId || 'Unknown Player', 28);
  const safeTitle = clampText(user?.profileTitle && user.profileTitle !== 'default' ? user.profileTitle : 'No title equipped', 34);
  const safeBio = clampText(user?.profileBio && user.profileBio !== 'default' ? user.profileBio : 'No profile bio set yet.', 86);
  const safeGuildName = clampText(guildName || user?.originGuildName || 'RoBot Network', 32);
  const followers = Number(user?.followers?.length || 0).toLocaleString('en-US');
  const following = Number(user?.following?.length || 0).toLocaleString('en-US');
  const ringName = clampText(marriageRing?.name || snapshot?.ring?.name || '', 22);
  const safeSpouse = clampText(spouseName || user?.marriedTo || '', 22);
  const marriageLabel = safeSpouse ? `Married to ${safeSpouse}${ringName ? ` • Ring ${ringName}` : ''}` : 'Single';
  const stats = {
    level: formatCompactNumber(user?.level || 0),
    wallet: formatCompactNumber(user?.balance || 0),
    bank: formatCompactNumber(user?.bank || 0),
    gearScore: formatCompactNumber(snapshot?.gearScore || 0),
    pvp: formatCompactNumber(user?.pvpRating || 0),
    energy: `${formatCompactNumber(user?.energy || 0)}/${formatCompactNumber(user?.energyMax || 0)}`
  };

  const [background, avatar, overlay] = await Promise.all([
    createBackgroundLayer(wallpaper?.wallpaperUrl || ''),
    createAvatarLayer(avatarUrl),
    Promise.resolve(
      createOverlaySvg({
        displayName: safeName,
        title: safeTitle,
        bio: safeBio,
        guildName: safeGuildName,
        stats,
        followers,
        following,
        marriageLabel,
        topPvpItems
      })
    )
  ]);

  const composites = [{ input: overlay }];
  if (avatar) {
    composites.push({
      input: avatar,
      top: 86,
      left: 76
    });
  }

  const avatarRing = Buffer.from(`
    <svg width="196" height="196" viewBox="0 0 196 196" xmlns="http://www.w3.org/2000/svg">
      <circle cx="98" cy="98" r="93" fill="none" stroke="rgba(255,255,255,0.95)" stroke-width="6" />
      <circle cx="98" cy="98" r="96" fill="none" stroke="rgba(248,113,113,0.45)" stroke-width="2" />
    </svg>
  `);

  composites.push({
    input: avatarRing,
    top: 78,
    left: 68
  });

  return await sharp(background)
    .composite(composites)
    .png()
    .toBuffer();
}

module.exports = {
  createProfileCardBuffer
};
