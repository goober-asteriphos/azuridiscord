const { SlashCommandBuilder, EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle, MessageFlags } = require('discord.js');
const azuracast = require('../azuracast');
const { sessionManager } = require('../audioPlayer');

function createProgressBar(elapsed, duration) {
  if (!duration || duration <= 0) return '';
  const totalBars = 12;
  const progress = Math.min(Math.max(elapsed / duration, 0), 1);
  const filledBars = Math.round(progress * totalBars);
  const emptyBars = totalBars - filledBars;
  const bar = '▬'.repeat(Math.max(0, filledBars - 1)) + '🔘' + '▬'.repeat(emptyBars);

  const formatTime = (secs) => {
    const m = Math.floor(secs / 60);
    const s = Math.floor(secs % 60);
    return `${m}:${s < 10 ? '0' : ''}${s}`;
  };

  return `\`${formatTime(elapsed)}\` ${bar} \`${formatTime(duration)}\``;
}

module.exports = {
  data: new SlashCommandBuilder()
    .setName('nowplaying')
    .setDescription('Display detailed information about what is currently playing'),

  async execute(interaction) {
    const session = sessionManager.get(interaction.guildId);

    if (!session || !session.currentStation) {
      return interaction.reply({
        content: 'ℹ️ No station is currently playing in this server. Use `/play` to start streaming!',
        flags: MessageFlags.Ephemeral,
      });
    }

    await interaction.deferReply();

    try {
      const npData = await azuracast.getNowPlaying(session.currentStation.id);
      const song = npData?.now_playing?.song;
      const songText = song?.text || 'Live Radio Stream';
      const albumArt = song?.art || null;
      const listeners = npData?.listeners?.current ?? 'N/A';
      const elapsed = npData?.now_playing?.elapsed || 0;
      const duration = npData?.now_playing?.duration || 0;
      const isLive = npData?.live?.is_live;
      const streamerName = npData?.live?.streamer_name;
      const nextSong = npData?.playing_next?.song?.text;

      const embed = new EmbedBuilder()
        .setColor(0x00AEEF)
        .setTitle(`🎵 Now Playing: ${session.currentStation.name}`)
        .setDescription(`**${songText}**`)
        .addFields(
          { name: '📡 Station', value: session.currentStation.name, inline: true },
          { name: '👥 Listeners', value: `${listeners}`, inline: true },
          { name: '🔊 Voice Channel', value: `${session.voiceChannel?.name || 'VC'}`, inline: true }
        )
        .setTimestamp();

      if (duration > 0) {
        const progressBar = createProgressBar(elapsed, duration);
        if (progressBar) {
          embed.addFields({ name: 'Progress', value: progressBar, inline: false });
        }
      }

      if (isLive && streamerName) {
        embed.addFields({ name: '🎙️ Live DJ', value: streamerName, inline: true });
      }

      if (nextSong) {
        embed.addFields({ name: '⏭️ Up Next', value: nextSong, inline: false });
      }

      if (albumArt && albumArt.startsWith('http')) {
        embed.setThumbnail(albumArt);
      }

      const row = new ActionRowBuilder().addComponents(
        new ButtonBuilder()
          .setCustomId('btn_stop')
          .setLabel('Stop')
          .setStyle(ButtonStyle.Danger)
          .setEmoji('⏹️'),
        new ButtonBuilder()
          .setCustomId('btn_toggle_pause')
          .setLabel(session.isPaused() ? 'Resume' : 'Pause')
          .setStyle(ButtonStyle.Secondary)
          .setEmoji(session.isPaused() ? '▶️' : '⏸️'),
        new ButtonBuilder()
          .setCustomId('btn_now_playing')
          .setLabel('Refresh')
          .setStyle(ButtonStyle.Primary)
          .setEmoji('🔄')
      );

      await interaction.editReply({ embeds: [embed], components: [row] });
    } catch (err) {
      console.error('[NowPlaying Error]:', err);
      return interaction.editReply({
        content: `❌ Failed to fetch current song details: ${err.message}`,
      });
    }
  },
};
