const { SlashCommandBuilder, MessageFlags } = require('discord.js');
const { sessionManager } = require('../audioPlayer');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('volume')
    .setDescription('Adjust the radio playback volume')
    .addIntegerOption(option =>
      option
        .setName('percent')
        .setDescription('Volume level between 0 and 100')
        .setRequired(true)
        .setMinValue(0)
        .setMaxValue(100)
    ),

  async execute(interaction) {
    const session = sessionManager.get(interaction.guildId);

    if (!session || !session.isPlaying()) {
      return interaction.reply({
        content: 'ℹ️ The bot is not currently playing audio in this server.',
        flags: MessageFlags.Ephemeral,
      });
    }

    const memberVoice = interaction.member.voice.channel;
    if (!memberVoice || memberVoice.id !== session.voiceChannel?.id) {
      return interaction.reply({
        content: '❌ You must be in the same voice channel as the bot to change the volume.',
        flags: MessageFlags.Ephemeral,
      });
    }

    const volumePercent = interaction.options.getInteger('percent');
    const newVol = session.setVolume(volumePercent);

    return interaction.reply({
      content: `🔊 Volume set to **${newVol}%**`,
    });
  },
};
