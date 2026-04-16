'use strict';

const { AttachmentBuilder, EmbedBuilder, SlashCommandBuilder } = require('discord.js');
const Item = require('../../../../db/models/Item');
const { getOrCreateUser } = require('../../../../services/economy/userService');
const { resolveItemByQuery } = require('../../../../services/economy/shopService');
const { getEconomyEmojis, formatCredits, formatNumber } = require('../../util/credits');
const {
  setBio,
  setTitle,
  setWallpaper,
  follow,
  unfollow,
  getProfile
} = require('../../../../services/economy/profileService');
const { buildCharacterSnapshot, buildTopCombatInventory } = require('../../../../services/economy/characterService');
const { createProfileCardBuffer } = require('../../../../services/economy/profileCardService');
const { replyWithSocialConnections } = require('./profileSocialShared');

async function resolveDisplayName(interaction, target) {
  if (target?.id === interaction.user.id) {
    return interaction.member?.displayName || interaction.user.globalName || interaction.user.username;
  }
  const guild = interaction.guild;
  const member = guild ? await guild.members.fetch(target.id).catch(() => null) : null;
  return member?.displayName || target.globalName || target.username;
}

module.exports = {
  data: new SlashCommandBuilder()
    .setName('profile')
    .setDescription('View or customize your profile.')
    .addSubcommand((sub) =>
      sub
        .setName('view')
        .setDescription('View a profile')
        .addUserOption((opt) => opt.setName('user').setDescription('User').setRequired(false))
    )
    .addSubcommand((sub) =>
      sub
        .setName('bio')
        .setDescription('Set your bio')
        .addStringOption((opt) => opt.setName('text').setDescription('Bio text').setRequired(true))
    )
    .addSubcommand((sub) =>
      sub
        .setName('title')
        .setDescription('Set your title')
        .addStringOption((opt) => opt.setName('text').setDescription('Title text').setRequired(true))
    )
    .addSubcommand((sub) =>
      sub
        .setName('wallpaper')
        .setDescription('Set your wallpaper (must own it)')
        .addStringOption((opt) => opt.setName('item').setDescription('Wallpaper name or itemId').setRequired(true))
    )
    .addSubcommand((sub) =>
      sub
        .setName('follow')
        .setDescription('Follow a user')
        .addUserOption((opt) => opt.setName('user').setDescription('User').setRequired(true))
    )
    .addSubcommand((sub) =>
      sub
        .setName('unfollow')
        .setDescription('Unfollow a user')
        .addUserOption((opt) => opt.setName('user').setDescription('User').setRequired(true))
    )
    .addSubcommand((sub) =>
      sub
        .setName('followers')
        .setDescription('View a user\'s followers')
        .addUserOption((opt) => opt.setName('user').setDescription('User').setRequired(false))
    )
    .addSubcommand((sub) =>
      sub
        .setName('following')
        .setDescription('View who a user is following')
        .addUserOption((opt) => opt.setName('user').setDescription('User').setRequired(false))
    ),
  async execute(client, interaction) {
    const guildId = interaction.guildId;
    if (!guildId) return await interaction.reply({ content: 'Guild only.', ephemeral: true });

    const emojis = await getEconomyEmojis(client, guildId);
    const sub = interaction.options.getSubcommand(true);

    if (sub === 'view') {
      const target = interaction.options.getUser('user') || interaction.user;
      const displayName = await resolveDisplayName(interaction, target);
      if (target.id === interaction.user.id) {
        await getOrCreateUser({ guildId, discordId: target.id, username: target.username });
      }
      const profile = await getProfile({ guildId, discordId: target.id });
      if (!profile) return await interaction.reply({ content: 'No profile data found.', ephemeral: true });

      const { user, wallpaper, spouse, marriageRing } = profile;
      const snapshot = await buildCharacterSnapshot(user);
      const ownedItemIds = [...new Set((Array.isArray(user.inventory) ? user.inventory : []).map((entry) => String(entry?.itemId || '').trim()).filter(Boolean))];
      const ownedItems = ownedItemIds.length ? await Item.find({ itemId: { $in: ownedItemIds } }).lean() : [];
      const itemMap = new Map(ownedItems.map((item) => [String(item.itemId || '').trim(), item]));
      const topPvpItems = buildTopCombatInventory(user.inventory, itemMap, { limit: 3 });

      try {
        const buffer = await createProfileCardBuffer({
          user,
          wallpaper,
          marriageRing,
          snapshot,
          displayName,
          guildName: interaction.guild?.name || user.originGuildName || 'RoBot Network',
          avatarUrl: target.displayAvatarURL({ extension: 'png', size: 256 }),
          spouseName: spouse?.username || spouse?.discordId || user.marriedTo || '',
          topPvpItems
        });
        const attachment = new AttachmentBuilder(buffer, { name: 'robot-profile.png' });
        return await interaction.reply({ files: [attachment], ephemeral: false });
      } catch (_error) {
        const embed = new EmbedBuilder()
          .setTitle(`${displayName}'s Profile`)
          .setColor(0xe11d48)
          .addFields(
            { name: 'Title', value: user.profileTitle || 'default', inline: false },
            { name: 'Bio', value: user.profileBio || 'default', inline: false },
            { name: 'Level', value: `Lv ${formatNumber(user.level)}`, inline: true },
            { name: 'Credits', value: formatCredits(user.balance, emojis.currency), inline: true },
            { name: 'Gear Score', value: formatNumber(snapshot.gearScore), inline: true },
            { name: 'Max HP', value: formatNumber(snapshot.maxHp), inline: true },
            { name: 'Marriage', value: user.marriedTo ? `<@${user.marriedTo}>` : 'Single', inline: true },
            { name: 'Followers', value: String(user.followers?.length || 0), inline: true },
            { name: 'Following', value: String(user.following?.length || 0), inline: true }
          )
          .setTimestamp();

        if (wallpaper?.wallpaperUrl) embed.setImage(wallpaper.wallpaperUrl);
        return await interaction.reply({ embeds: [embed], ephemeral: false });
      }
    }

    if (sub === 'bio') {
      const text = interaction.options.getString('text', true);
      await getOrCreateUser({ guildId, discordId: interaction.user.id, username: interaction.user.username });
      const result = await setBio({ guildId, discordId: interaction.user.id, bio: text });
      if (!result.ok) return await interaction.reply({ content: result.reason, ephemeral: true });
      return await interaction.reply({ content: '✅ Bio updated.', ephemeral: true });
    }

    if (sub === 'title') {
      const text = interaction.options.getString('text', true);
      await getOrCreateUser({ guildId, discordId: interaction.user.id, username: interaction.user.username });
      const result = await setTitle({ guildId, discordId: interaction.user.id, title: text });
      if (!result.ok) return await interaction.reply({ content: result.reason, ephemeral: true });
      return await interaction.reply({ content: '✅ Title updated.', ephemeral: true });
    }

    if (sub === 'wallpaper') {
      const item = interaction.options.getString('item', true);
      await getOrCreateUser({ guildId, discordId: interaction.user.id, username: interaction.user.username });
      const result = await setWallpaper({
        guildId,
        discordId: interaction.user.id,
        wallpaperQuery: item,
        resolveItemByQuery
      });
      if (!result.ok) return await interaction.reply({ content: result.reason, ephemeral: true });
      return await interaction.reply({ content: `✅ Wallpaper set to **${result.wallpaper.name}**.`, ephemeral: true });
    }

    if (sub === 'follow') {
      const target = interaction.options.getUser('user', true);
      await getOrCreateUser({ guildId, discordId: interaction.user.id, username: interaction.user.username });
      await getOrCreateUser({ guildId, discordId: target.id, username: target.username });
      const result = await follow({ guildId, followerId: interaction.user.id, targetId: target.id });
      if (!result.ok) return await interaction.reply({ content: result.reason, ephemeral: true });
      return await interaction.reply({ content: `✅ You are now following <@${target.id}>.`, ephemeral: true });
    }

    if (sub === 'unfollow') {
      const target = interaction.options.getUser('user', true);
      await getOrCreateUser({ guildId, discordId: interaction.user.id, username: interaction.user.username });
      await getOrCreateUser({ guildId, discordId: target.id, username: target.username });
      const result = await unfollow({ guildId, followerId: interaction.user.id, targetId: target.id });
      if (!result.ok) return await interaction.reply({ content: result.reason, ephemeral: true });
      return await interaction.reply({ content: `✅ You unfollowed <@${target.id}>.`, ephemeral: true });
    }

    if (sub === 'followers' || sub === 'following') {
      const target = interaction.options.getUser('user') || interaction.user;
      return await replyWithSocialConnections(interaction, { guildId, targetUser: target, type: sub });
    }
  }
};
