'use strict';

const { SlashCommandBuilder, EmbedBuilder } = require('discord.js');
const { safeReply } = require('../../shared/util/reply');

module.exports = {
  data: new SlashCommandBuilder().setName('help').setDescription('Show Verification commands and setup tips.'),
  async execute(_client, interaction) {
    const embed = new EmbedBuilder()
      .setTitle('Verification Help')
      .setColor(0xe67e22)
      .setDescription('Member + admin commands (slash):')
      .addFields(
        { name: 'Member', value: '`/verify` or click the **Verify** button in the channel.', inline: false },
        { name: 'Admin', value: '`/verify` (posts the verify panel)', inline: false },
        { name: 'Quick lookups', value: '`/roles [search]` `/member <role>` `/members <role>`', inline: false },
        { name: 'Profiles', value: '`/dev` `/exec` `/execs`', inline: false },
        { name: 'Show settings', value: '`/config show`', inline: false },
        { name: 'Roles', value: '`/config temp-role` `/config verified-role`', inline: false },
        { name: 'Log channels', value: '`/config log-channel` `/config verification-log-channel`', inline: false },
        { name: 'Questions', value: '`/config verification-questions`', inline: false },
        { name: 'Toggles', value: '`/config toggle-log` `/config verification-enable`', inline: false }
      )
      .setFooter({ text: 'Setup tip: bot role must be above Temp/Verified roles. Members verify via the website.' })
      .setTimestamp();

    return await safeReply(interaction, { embeds: [embed], ephemeral: true });
  }
};
