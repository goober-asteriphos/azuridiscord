const { SlashCommandBuilder } = require('discord.js');
const { sessionManager } = require('../audioPlayer');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('stop')
    .setDescription('Stop radio playback and leave the voice channel'),

  async execute(interaction) {
    const session = sessionManager.get(interaction.guildId);

    if (!session || !session.connection) {
      return interaction.reply({
        content: 'ℹ️ The bot is not currently connected to any voice channel.',
        ephemeral: true,
      });
    }

    const memberVoice = interaction.member.voice.channel;
    if (!memberVoice || memberVoice.id !== session.voiceChannel?.id) {
      return interaction.reply({
        content: '❌ You must be in the same voice channel as the bot to stop playback.',
        ephemeral: true,
      });
    }

    session.destroy();

    return interaction.reply({
      content: '⏹️ Stopped playback and disconnected from the voice channel.',
    });
  },
};
