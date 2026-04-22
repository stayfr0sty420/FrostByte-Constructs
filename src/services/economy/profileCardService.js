const fs = require('fs/promises');
const path = require('path');
const sharp = require('sharp');
const { formatCompactNumber } = require('./economyFormatService');
const { getRarityMeta, getItemDisplayMediaUrl } = require('./itemService');
const { formatMarriageDurationCompact } = require('./marriageService');
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

function wrapText(value, { maxChars = 36, maxLines = 2 } = {}) {
  const safe = normalizeString(value);
  if (!safe) return [];

  const words = safe.split(/\s+/).filter(Boolean);
  const lines = [];
  let current = '';

  for (const word of words) {
    const next = current ? `${current} ${word}` : word;
    if (next.length <= maxChars) {
      current = next;
      continue;
    }

    if (current) lines.push(current);
    current = word;
    if (lines.length >= maxLines - 1) break;
  }

  if (lines.length < maxLines && current) lines.push(current);
  if (!lines.length) lines.push(clampText(safe, maxChars));

  if (lines.length > maxLines) lines.length = maxLines;
  const consumed = lines.join(' ').length;
  if (consumed < safe.length) {
    lines[lines.length - 1] = clampText(lines[lines.length - 1], Math.max(6, maxChars - 1));
    if (!lines[lines.length - 1].endsWith('…')) lines[lines.length - 1] = `${lines[lines.length - 1]}…`;
  }

  return lines;
}

function renderTextLines(lines, { x, y, lineHeight, fill, fontSize, fontWeight = '400' }) {
  return lines
    .map(
      (line, index) => `
        <text x="${x}" y="${y + index * lineHeight}" fill="${fill}" font-family="Segoe UI, Arial, sans-serif" font-size="${fontSize}" font-weight="${fontWeight}">${escapeXml(line)}</text>
      `
    )
    .join('');
}

function getTopItemSlots() {
  return [
    { left: 658, top: 92, size: 92 },
    { left: 770, top: 92, size: 92 },
    { left: 882, top: 92, size: 92 }
  ];
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

async function fetchFirstAvailableImageBuffer(...urls) {
  for (const url of urls) {
    const buffer = await fetchImageBuffer(url);
    if (buffer) return buffer;
  }
  return null;
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
  hasMarriageIcon = false,
  topPvpItems = []
}) {
  const bioLines = wrapText(bio, { maxChars: 36, maxLines: 2 });
  const serverLines = wrapText(guildName, { maxChars: 24, maxLines: 1 });
  const marriageLines = wrapText(marriageLabel, { maxChars: 28, maxLines: 2 });
  const infoLeft = 306;
  const infoTop = 292;
  const sectionGap = 14;
  const labelSpacing = 26;
  const bioLineHeight = 22;
  const serverLineHeight = 20;
  const relationshipLineHeight = 20;
  const bioLabelY = infoTop;
  const bioTextY = bioLabelY + labelSpacing;
  const serverLabelY = bioTextY + Math.max(1, bioLines.length) * bioLineHeight + sectionGap;
  const serverTextY = serverLabelY + labelSpacing;
  const socialLabelY = serverTextY + Math.max(1, serverLines.length) * serverLineHeight + sectionGap;
  const socialMetricLabelY = socialLabelY + 22;
  const socialMetricValueY = socialMetricLabelY + 24;
  const relationshipLabelY = socialMetricValueY + 22 + 10;
  const relationshipTextY = relationshipLabelY + 24;
  const topSlotMarkup = getTopItemSlots()
    .map((slot, index) => {
      const rarityMeta = getRarityMeta(topPvpItems[index]?.item?.rarity || 'common');
      return `
        <rect x="${slot.left}" y="${slot.top}" width="${slot.size}" height="${slot.size}" rx="24" fill="rgba(6, 4, 8, 0.52)" stroke="${escapeXml(
          rarityMeta.color
        )}" stroke-width="3.5" opacity="${topPvpItems[index] ? '1' : '0.28'}" />
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
      ${topSlotMarkup}

      <text x="306" y="${bioLabelY}" fill="rgba(248, 113, 113, 0.88)" font-family="Segoe UI, Arial, sans-serif" font-size="16" letter-spacing="4">BIO</text>
      ${renderTextLines(bioLines, {
        x: infoLeft,
        y: bioTextY,
        lineHeight: bioLineHeight,
        fill: 'rgba(255,255,255,0.92)',
        fontSize: 17
      })}
      <text x="${infoLeft}" y="${serverLabelY}" fill="rgba(248, 113, 113, 0.88)" font-family="Segoe UI, Arial, sans-serif" font-size="16" letter-spacing="4">SERVER</text>
      ${renderTextLines(serverLines, {
        x: infoLeft,
        y: serverTextY,
        lineHeight: serverLineHeight,
        fill: 'rgba(255,255,255,0.9)',
        fontSize: 18
      })}

      <text x="${infoLeft}" y="${socialLabelY}" fill="rgba(248, 113, 113, 0.88)" font-family="Segoe UI, Arial, sans-serif" font-size="16" letter-spacing="4">SOCIAL</text>
      <text x="${infoLeft}" y="${socialMetricLabelY}" fill="rgba(255, 228, 230, 0.76)" font-family="Segoe UI, Arial, sans-serif" font-size="13" letter-spacing="2.5">FOLLOWERS</text>
      <text x="${infoLeft + 182}" y="${socialMetricLabelY}" fill="rgba(255, 228, 230, 0.76)" font-family="Segoe UI, Arial, sans-serif" font-size="13" letter-spacing="2.5">FOLLOWING</text>
      <text x="${infoLeft}" y="${socialMetricValueY}" fill="#ffffff" font-family="Segoe UI, Arial, sans-serif" font-size="28" font-weight="700">${escapeXml(
        followers
      )}</text>
      <text x="${infoLeft + 182}" y="${socialMetricValueY}" fill="#ffffff" font-family="Segoe UI, Arial, sans-serif" font-size="28" font-weight="700">${escapeXml(
        following
      )}</text>
      <text x="${infoLeft}" y="${relationshipLabelY}" fill="rgba(248, 113, 113, 0.88)" font-family="Segoe UI, Arial, sans-serif" font-size="15" letter-spacing="4">RELATIONSHIP</text>
      ${renderTextLines(marriageLines, {
        x: infoLeft + (hasMarriageIcon ? 34 : 0),
        y: relationshipTextY,
        lineHeight: relationshipLineHeight,
        fill: 'rgba(255,255,255,0.72)',
        fontSize: 15
      })}

      <text x="84" y="292" fill="rgba(248, 113, 113, 0.88)" font-family="Segoe UI, Arial, sans-serif" font-size="16" letter-spacing="4">STATS</text>
      <text x="84" y="336" fill="#ffffff" font-family="Segoe UI, Arial, sans-serif" font-size="20">Level</text>
      <text x="84" y="368" fill="rgba(255,255,255,0.92)" font-family="Segoe UI, Arial, sans-serif" font-size="34" font-weight="700">${escapeXml(stats.level)}</text>
      <text x="84" y="414" fill="#ffffff" font-family="Segoe UI, Arial, sans-serif" font-size="20">Wallet</text>
      <text x="84" y="446" fill="rgba(255,255,255,0.92)" font-family="Segoe UI, Arial, sans-serif" font-size="34" font-weight="700">${escapeXml(stats.wallet)}</text>
      <text x="84" y="492" fill="#ffffff" font-family="Segoe UI, Arial, sans-serif" font-size="20">Gear</text>
      <text x="84" y="524" fill="rgba(255,255,255,0.92)" font-family="Segoe UI, Arial, sans-serif" font-size="34" font-weight="700">${escapeXml(stats.gearScore)}</text>

      <text x="746" y="294" fill="rgba(248, 113, 113, 0.88)" font-family="Segoe UI, Arial, sans-serif" font-size="16" letter-spacing="4">BANK</text>
      <text x="746" y="330" fill="#ffffff" font-family="Segoe UI, Arial, sans-serif" font-size="38" font-weight="700">${escapeXml(stats.bank)}</text>
      <text x="746" y="374" fill="rgba(248, 113, 113, 0.88)" font-family="Segoe UI, Arial, sans-serif" font-size="16" letter-spacing="4">PVP</text>
      <text x="746" y="410" fill="#ffffff" font-family="Segoe UI, Arial, sans-serif" font-size="38" font-weight="700">${escapeXml(stats.pvp)}</text>
      <text x="746" y="454" fill="rgba(248, 113, 113, 0.88)" font-family="Segoe UI, Arial, sans-serif" font-size="16" letter-spacing="4">ENERGY</text>
      <text x="746" y="490" fill="#ffffff" font-family="Segoe UI, Arial, sans-serif" font-size="38" font-weight="700">${escapeXml(stats.energy)}</text>
      <text x="966" y="526" text-anchor="end" fill="rgba(255,255,255,0.56)" font-family="Segoe UI, Arial, sans-serif" font-size="14">Generated by RoBot</text>
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

async function createTopItemIconLayer(entry, size = 92) {
  const borderColor = getRarityMeta(entry?.item?.rarity || 'common').color;
  const refinement = Math.max(0, Number(entry?.inventory?.refinement ?? entry?.refinement) || 0);
  const frame = Buffer.from(`
    <svg width="${size}" height="${size}" viewBox="0 0 ${size} ${size}" xmlns="http://www.w3.org/2000/svg">
      <rect x="2" y="2" width="${size - 4}" height="${size - 4}" rx="24" fill="rgba(8, 6, 10, 0.92)" stroke="${escapeXml(borderColor)}" stroke-width="4" />
      <rect x="12" y="12" width="${size - 24}" height="${size - 24}" rx="18" fill="rgba(18, 8, 12, 0.96)" />
      ${
        refinement > 0
          ? `<rect x="44" y="62" width="40" height="18" rx="9" fill="rgba(0,0,0,0.72)" stroke="rgba(255,255,255,0.2)" />
      <text x="64" y="75" text-anchor="middle" fill="#ffffff" font-family="Segoe UI, Arial, sans-serif" font-size="12" font-weight="700">+${refinement}</text>`
          : ''
      }
    </svg>
  `);

  const base = sharp({
    create: {
      width: size,
      height: size,
      channels: 4,
      background: { r: 0, g: 0, b: 0, alpha: 0 }
    }
  }).composite([{ input: frame }]);

  const imageBuffer = await fetchFirstAvailableImageBuffer(
    getItemDisplayMediaUrl(entry?.item || {}),
    entry?.item?.imageUrl,
    entry?.item?.emojiUrl
  );
  if (!imageBuffer) {
    const fallbackToken = String(entry?.item?.emojiText || '').trim();
    if (!fallbackToken || fallbackToken.startsWith('<')) return await base.png().toBuffer();
    const fallback = Buffer.from(`
      <svg width="${size}" height="${size}" viewBox="0 0 ${size} ${size}" xmlns="http://www.w3.org/2000/svg">
        <text x="${size / 2}" y="${size / 2 + 18}" text-anchor="middle" fill="#ffffff" font-size="44">${escapeXml(fallbackToken)}</text>
      </svg>
    `);
    return await base.composite([{ input: fallback }]).png().toBuffer();
  }

  const innerSize = size - 24;
  const mask = Buffer.from(`
    <svg width="${innerSize}" height="${innerSize}" viewBox="0 0 ${innerSize} ${innerSize}" xmlns="http://www.w3.org/2000/svg">
      <rect width="${innerSize}" height="${innerSize}" rx="18" fill="#ffffff" />
    </svg>
  `);

  const icon = await sharp(imageBuffer, { failOnError: false })
    .resize(innerSize, innerSize, { fit: 'contain', background: { r: 0, g: 0, b: 0, alpha: 0 } })
    .composite([{ input: mask, blend: 'dest-in' }])
    .png()
    .toBuffer()
    .catch(() => null);

  if (!icon) return await base.png().toBuffer();

  return await base
    .composite([{ input: icon, top: 12, left: 12 }])
    .png()
    .toBuffer();
}

async function createRelationshipIconLayer(marriageRing, size = 26) {
  const ringBuffer = await fetchFirstAvailableImageBuffer(
    getItemDisplayMediaUrl(marriageRing || {}),
    marriageRing?.emojiUrl,
    marriageRing?.imageUrl
  );

  if (!ringBuffer) {
    return Buffer.from(`
      <svg width="${size}" height="${size}" viewBox="0 0 ${size} ${size}" xmlns="http://www.w3.org/2000/svg">
        <text x="${size / 2}" y="${size - 4}" text-anchor="middle" fill="#ffffff" font-size="20">💍</text>
      </svg>
    `);
  }

  return await sharp(ringBuffer, { failOnError: false })
    .resize(size, size, { fit: 'contain', background: { r: 0, g: 0, b: 0, alpha: 0 } })
    .png()
    .toBuffer()
    .catch(() => null);
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
  const safeBio = clampText(user?.profileBio && user.profileBio !== 'default' ? user.profileBio : 'No profile bio set yet.', 120);
  const safeGuildName = clampText(guildName || user?.originGuildName || 'RoBot Network', 56);
  const followers = formatCompactNumber(user?.followers?.length || 0);
  const following = formatCompactNumber(user?.following?.length || 0);
  const safeSpouse = clampText(spouseName || user?.marriedTo || '', 22);
  const marriageDuration = user?.marriedTo ? formatMarriageDurationCompact(user?.marriedSince) : '';
  const marriageLabel = safeSpouse ? `${safeSpouse}${marriageDuration ? ` (${marriageDuration})` : ''}` : 'Single';
  const stats = {
    level: formatCompactNumber(user?.level || 0),
    wallet: formatCompactNumber(user?.balance || 0),
    bank: formatCompactNumber(user?.bank || 0),
    gearScore: formatCompactNumber(snapshot?.gearScore || 0),
    pvp: formatCompactNumber(user?.pvpRating || 0),
    energy: `${formatCompactNumber(user?.energy || 0)}/${formatCompactNumber(user?.energyMax || 0)}`
  };

  const topSlots = getTopItemSlots();
  const topEntries = topSlots.map((_, index) => topPvpItems[index] || null);
  const relationshipIcon = safeSpouse ? await createRelationshipIconLayer(marriageRing || snapshot?.ring || null) : null;
  const [background, avatar, overlay, ...topItemLayers] = await Promise.all([
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
        hasMarriageIcon: Boolean(safeSpouse),
        topPvpItems
      })
    ),
    ...topEntries.map((entry) => createTopItemIconLayer(entry))
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

  if (relationshipIcon) {
    composites.push({
      input: relationshipIcon,
      top: 451,
      left: 305
    });
  }

  topSlots.forEach((slot, index) => {
    const layer = topItemLayers[index];
    if (!layer) return;
    composites.push({
      input: layer,
      top: slot.top,
      left: slot.left
    });
  });

  return await sharp(background)
    .composite(composites)
    .png()
    .toBuffer();
}

module.exports = {
  createProfileCardBuffer
};
