const { SlashCommandBuilder, EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle } = require('discord.js');
const azuracast = require('../azuracast');
const { sessionManager } = require('../audioPlayer');
const { config } = require('../config');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('play')
    .setDescription('Stream a radio station from your AzuraCast instance in VC')
    .addStringOption(option =>
      option
        .setName('station')
        .setDescription('Select or search for an AzuraCast station')
        .setRequired(false)
        .setAutocomplete(true)
    ),

  /**
   * Handle station autocomplete suggestions
   */
  async autocomplete(interaction) {
    const focusedValue = interaction.options.getFocused().toLowerCase();
    try {
      const stations = await azuracast.getStations();
      const filtered = stations.filter(station => {
        const name = (station.name || '').toLowerCase();
        const shortcode = (station.shortcode || '').toLowerCase();
        return name.includes(focusedValue) || shortcode.includes(focusedValue);
      });

      const choices = filtered.slice(0, 25).map(station => ({
        name: `${station.name} (${station.shortcode})`.slice(0, 100),
        value: station.shortcode || String(station.id),
      }));

      await interaction.respond(choices);
    } catch (err) {
      console.error('[Autocomplete Error]:', err.message);
      await interaction.respond([]);
    }
  },

  /**
   * Execute /play
   */
  async execute(interaction) {
    const member = interaction.member;
    const voiceChannel = member.voice.channel;

    if (!voiceChannel) {
      return interaction.reply({
        content: '❌ You must be in a voice channel to use this command!',
        ephemeral: true,
      });
    }

    const permissions = voiceChannel.permissionsFor(interaction.client.user);
    if (!permissions.has('Connect') || !permissions.has('Speak')) {
      return interaction.reply({
        content: '❌ I do not have permission to join and speak in your voice channel!',
        ephemeral: true,
      });
    }

    await interaction.deferReply();

    const stationInput = interaction.options.getString('station') || config.azuracast.defaultStation;
    let targetStation = null;

    try {
      if (stationInput) {
        targetStation = await azuracast.findStation(stationInput);
      } else {
        // Fallback: pick the first available station from AzuraCast
        const allStations = await azuracast.getStations();
        if (allStations && allStations.length > 0) {
          targetStation = allStations[0];
        }
      }

      if (!targetStation) {
        return interaction.editReply({
          content: `❌ Could not find a station matching "${stationInput || 'default'}". Use \`/stations\` to see available stations.`,
        });
      }

      const session = sessionManager.getOrCreate(interaction.guildId);
      await session.play(voiceChannel, targetStation, interaction.channel);

      // Fetch now-playing info for rich embed
      const npData = await azuracast.getNowPlaying(targetStation.id);
      const currentSong = npData?.now_playing?.song?.text || 'Live Radio Stream';
      const albumArt = npData?.now_playing?.song?.art || null;
      const listeners = npData?.listeners?.current ?? 'N/A';
      const isLive = npData?.live?.is_live ? `🎙️ Live DJ: ${npData.live.streamer_name || 'Active'}` : null;

      const embed = new EmbedBuilder()
        .setColor(0x00AEEF)
        .setTitle(`📻 Now Streaming: ${targetStation.name}`)
        .setDescription(targetStation.description || 'Broadcasting live from AzuraCast')
        .addFields(
          { name: '🎵 Current Track', value: currentSong, inline: false },
          { name: '🔊 Voice Channel', value: `${voiceChannel.name}`, inline: true },
          { name: '👥 Listeners', value: `${listeners}`, inline: true }
        )
        .setFooter({ text: 'Powered by AzuraCast & Discord.js' })
        .setTimestamp();

      if (isLive) {
        embed.addFields({ name: 'Live Streamer', value: isLive, inline: true });
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
          .setLabel('Pause / Resume')
          .setStyle(ButtonStyle.Secondary)
          .setEmoji('⏯️'),
        new ButtonBuilder()
          .setCustomId('btn_now_playing')
          .setLabel('Now Playing')
          .setStyle(ButtonStyle.Primary)
          .setEmoji('ℹ️')
      );

      await interaction.editReply({ embeds: [embed], components: [row] });
    } catch (err) {
      console.error('[Play Error]:', err);
      return interaction.editReply({
        content: `❌ Failed to start playback: ${err.message}`,
      });
    }
  },
};
