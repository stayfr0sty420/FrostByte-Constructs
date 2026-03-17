'use strict';

const { SlashCommandBuilder, EmbedBuilder } = require('discord.js');
const { getOrCreateUser } = require('../../../../services/economy/userService');
const { resolveItemByQuery } = require('../../../../services/economy/shopService');
const {
  setBio,
  setTitle,
  setWallpaper,
  follow,
  unfollow,
  getProfile
} = require('../../../../services/economy/profileService');

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
      sub.setName('bio').setDescription('Set your bio').addStringOption((opt) => opt.setName('text').setRequired(true))
    )
    .addSubcommand((sub) =>
      sub
        .setName('title')
        .setDescription('Set your title')
        .addStringOption((opt) => opt.setName('text').setRequired(true))
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
    ),
  async execute(_client, interaction) {
    const guildId = interaction.guildId;
    if (!guildId) return await interaction.reply({ content: 'Guild only.', ephemeral: true });

    const sub = interaction.options.getSubcommand(true);

    if (sub === 'view') {
      const target = interaction.options.getUser('user') || interaction.user;
      if (target.id === interaction.user.id) {
        await getOrCreateUser({ guildId, discordId: target.id, username: target.username });
      }
      const profile = await getProfile({ guildId, discordId: target.id });
      if (!profile) return await interaction.reply({ content: 'No profile data found.', ephemeral: true });

      const { user, wallpaper } = profile;
      const embed = new EmbedBuilder()
        .setTitle(`${target.username}'s Profile`)
        .setColor(0x9b59b6)
        .addFields(
          { name: 'Title', value: user.profileTitle || 'default', inline: false },
          { name: 'Bio', value: user.profileBio || 'default', inline: false },
          { name: 'Level', value: `Lv ${user.level}`, inline: true },
          { name: 'Coins', value: String(user.balance), inline: true },
          { name: 'Followers', value: String(user.followers?.length || 0), inline: true },
          { name: 'Following', value: String(user.following?.length || 0), inline: true }
        )
        .setTimestamp();

      if (wallpaper?.wallpaperUrl) embed.setImage(wallpaper.wallpaperUrl);

      return await interaction.reply({ embeds: [embed], ephemeral: true });
    }

    if (sub === 'bio') {
      const text = interaction.options.getString('text', true);
      await getOrCreateUser({ guildId, discordId: interaction.user.id, username: interaction.user.username });
      const result = await setBio({ guildId, discordId: interaction.user.id, bio: text });
      if (!result.ok) return await interaction.reply({ content: result.reason, ephemeral: true });
      return await interaction.reply({ content: `✅ Bio updated.`, ephemeral: true });
    }

    if (sub === 'title') {
      const text = interaction.options.getString('text', true);
      await getOrCreateUser({ guildId, discordId: interaction.user.id, username: interaction.user.username });
      const result = await setTitle({ guildId, discordId: interaction.user.id, title: text });
      if (!result.ok) return await interaction.reply({ content: result.reason, ephemeral: true });
      return await interaction.reply({ content: `✅ Title updated.`, ephemeral: true });
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
  }
};
