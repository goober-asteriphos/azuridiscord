const fs = require('fs');
const path = require('path');
const {
  Client,
  Collection,
  Events,
  GatewayIntentBits,
  ActivityType,
  EmbedBuilder,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  MessageFlags,
} = require('discord.js');
const { config, validateConfig } = require('./config');
const azuracast = require('./azuracast');
const { sessionManager } = require('./audioPlayer');

validateConfig();

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildVoiceStates,
  ],
});

// Load commands
client.commands = new Collection();
const commandsPath = path.join(__dirname, 'commands');
const commandFiles = fs.readdirSync(commandsPath).filter(file => file.endsWith('.js'));

for (const file of commandFiles) {
  const filePath = path.join(commandsPath, file);
  const command = require(filePath);
  if ('data' in command && 'execute' in command) {
    client.commands.set(command.data.name, command);
  } else {
    console.warn(`[Command Warning] The command at ${filePath} is missing a required "data" or "execute" property.`);
  }
}

// Client ready event
client.once(Events.ClientReady, (readyClient) => {
  console.log(`===============================================`);
  console.log(`🤖 Logged in as ${readyClient.user.tag}`);
  console.log(`📡 AzuraCast Instance: ${config.azuracast.baseUrl || 'Not configured'}`);
  console.log(`===============================================`);

  updateBotPresence();
  // Periodically refresh presence (status)
  setInterval(updateBotPresence, config.behavior.updatePresenceIntervalSeconds * 1000);
});

/**
 * Dynamically updates the bot status / Rich Presence with currently playing track
 */
async function updateBotPresence() {
  if (!client.user) return;

  // 1. Check if there's an active voice session streaming
  let activeStation = null;
  for (const [, session] of sessionManager.sessions) {
    if (session.isPlaying() && session.currentStation) {
      activeStation = session.currentStation;
      break;
    }
  }

  // 2. Fall back to the main selected station (e.g. station 8)
  const targetStationIdentifier = activeStation ? activeStation.id : (config.azuracast.defaultStation || '8');

  try {
    const np = await azuracast.getNowPlaying(targetStationIdentifier);
    // If nowplaying returns an array (when queried without specific id), find the matching station
    const npData = Array.isArray(np)
      ? (np.find(s => String(s.station?.id) === String(targetStationIdentifier) || s.station?.shortcode === String(targetStationIdentifier)) || np[0])
      : np;

    if (npData && npData.now_playing?.song) {
      const songText = npData.now_playing.song.text || `${npData.now_playing.song.title} - ${npData.now_playing.song.artist}`;
      const stationName = npData.station?.name || activeStation?.name || 'Radio';
      const isLive = npData.live?.is_live;
      const streamerName = npData.live?.streamer_name;

      let activityText = '';
      if (isLive && streamerName) {
        activityText = `🎙️ ${streamerName}: ${songText}`;
      } else {
        activityText = `${songText}`;
      }

      // Discord presence activity name limit is 128 characters
      client.user.setPresence({
        activities: [{
          name: activityText.slice(0, 128),
          type: ActivityType.Listening,
        }],
        status: 'online',
      });
    } else {
      client.user.setPresence({
        activities: [{
          name: '/play | AzuraCast Radio',
          type: ActivityType.Listening,
        }],
        status: 'online',
      });
    }
  } catch (e) {
    // presence update error non-fatal
  }
}

// Interaction handling (Slash commands, autocomplete, buttons, select menus)
client.on(Events.InteractionCreate, async (interaction) => {
  // 1. Handle Autocomplete
  if (interaction.isAutocomplete()) {
    const command = client.commands.get(interaction.commandName);
    if (!command || !command.autocomplete) return;

    try {
      await command.autocomplete(interaction);
    } catch (error) {
      console.error(`[Autocomplete Error ${interaction.commandName}]:`, error);
    }
    return;
  }

  // 2. Handle Slash Commands
  if (interaction.isChatInputCommand()) {
    const command = client.commands.get(interaction.commandName);
    if (!command) {
      console.error(`No command matching ${interaction.commandName} was found.`);
      return;
    }

    try {
      await command.execute(interaction);
    } catch (error) {
      console.error(`[Command Error ${interaction.commandName}]:`, error);
      const response = {
        content: '⚠️ There was an error while executing this command!',
        flags: MessageFlags.Ephemeral,
      };
      if (interaction.replied || interaction.deferred) {
        await interaction.followUp(response);
      } else {
        await interaction.reply(response);
      }
    }
    return;
  }

  // 3. Handle Select Menu for Stations
  if (interaction.isStringSelectMenu()) {
    if (interaction.customId === 'select_station') {
      const selectedStationKey = interaction.values[0];
      const memberVoice = interaction.member?.voice?.channel;

      if (!memberVoice) {
        return interaction.reply({
          content: '❌ You must join a voice channel first before choosing a station!',
          flags: MessageFlags.Ephemeral,
        });
      }

      await interaction.deferReply();

      try {
        const station = await azuracast.findStation(selectedStationKey);
        if (!station) {
          return interaction.editReply({
            content: `❌ Could not find station "${selectedStationKey}".`,
          });
        }

        const session = sessionManager.getOrCreate(interaction.guildId);
        await session.play(memberVoice, station, interaction.channel);

        const npData = await azuracast.getNowPlaying(station.id);
        const songText = npData?.now_playing?.song?.text || 'Live Radio Stream';

        const embed = new EmbedBuilder()
          .setColor(0x00AEEF)
          .setTitle(`📻 Now Streaming: ${station.name}`)
          .setDescription(`**Track:** ${songText}\n**Channel:** ${memberVoice.name}`)
          .setTimestamp();

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
        console.error('[Select Station Error]:', err);
        return interaction.editReply({
          content: `❌ Failed to play station: ${err.message}`,
        });
      }
    }
    return;
  }

  // 4. Handle Button Clicks
  if (interaction.isButton()) {
    const session = sessionManager.get(interaction.guildId);

    if (interaction.customId === 'btn_stop') {
      if (!session || !session.connection) {
        return interaction.reply({ content: 'ℹ️ Bot is not currently in voice.', flags: MessageFlags.Ephemeral });
      }
      session.destroy();
      return interaction.reply({ content: '⏹️ Playback stopped and left voice channel.' });
    }

    if (interaction.customId === 'btn_toggle_pause') {
      if (!session || !session.player) {
        return interaction.reply({ content: 'ℹ️ No active playback to pause.', flags: MessageFlags.Ephemeral });
      }
      if (session.isPaused()) {
        session.unpause();
        return interaction.reply({ content: '▶️ Resumed stream playback.', flags: MessageFlags.Ephemeral });
      } else {
        session.pause();
        return interaction.reply({ content: '⏸️ Paused stream playback.', flags: MessageFlags.Ephemeral });
      }
    }

    if (interaction.customId === 'btn_now_playing') {
      const npCmd = client.commands.get('nowplaying');
      if (npCmd) {
        return npCmd.execute(interaction);
      }
    }
  }
});

// Auto-leave empty voice channels
client.on(Events.VoiceStateUpdate, (oldState, newState) => {
  if (!config.behavior.autoLeaveEmptyVC) return;

  const guildId = oldState.guild.id;
  const session = sessionManager.get(guildId);
  if (!session || !session.voiceChannel) return;

  const botVoiceChannel = session.voiceChannel;

  // Check how many non-bot members are in the channel
  const nonBotMembers = botVoiceChannel.members.filter(m => !m.user.bot);

  if (nonBotMembers.size === 0) {
    console.log(`[Voice ${guildId}] Voice channel ${botVoiceChannel.name} is now empty. Scheduling auto-leave...`);
    session.scheduleLeave();
  } else {
    // Channel is no longer empty, cancel any pending leave timer
    session.cancelLeaveTimer();
  }
});

// Graceful shutdown
function handleShutdown(signal) {
  console.log(`\nReceived ${signal}. Shutting down gracefully...`);
  for (const [, session] of sessionManager.sessions) {
    session.destroy();
  }
  client.destroy();
  process.exit(0);
}

process.on('SIGINT', () => handleShutdown('SIGINT'));
process.on('SIGTERM', () => handleShutdown('SIGTERM'));

// Start client
if (config.token) {
  client.login(config.token).catch(err => {
    console.error('[Discord Login Error]:', err.message);
  });
} else {
  console.warn('⚠️ No DISCORD_TOKEN found in .env. Bot not logged in.');
}
