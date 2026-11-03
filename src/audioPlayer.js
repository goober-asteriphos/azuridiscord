const {
  joinVoiceChannel,
  createAudioPlayer,
  createAudioResource,
  AudioPlayerStatus,
  VoiceConnectionStatus,
  entersState,
  StreamType,
  NoSubscriberBehavior,
} = require('@discordjs/voice');
const { spawn } = require('child_process');
const azuracast = require('./azuracast');
const { config } = require('./config');

// Resolve ffmpeg binary path: prefer env, then ffmpeg-static package, then system PATH
let ffmpegPath = process.env.FFMPEG_PATH;
if (!ffmpegPath) {
  try {
    ffmpegPath = require('ffmpeg-static');
  } catch (e) {
    ffmpegPath = 'ffmpeg';
  }
}
if (ffmpegPath && !process.env.FFMPEG_PATH) {
  process.env.FFMPEG_PATH = ffmpegPath;
}

class GuildAudioSession {
  constructor(guildId) {
    this.guildId = guildId;
    this.connection = null;
    this.player = null;
    this.resource = null;
    this.ffmpegProcess = null;
    this.currentStation = null;
    this.voiceChannel = null;
    this.textChannel = null;
    this.volume = (config.behavior.defaultVolume ?? 25) / 100;
    this.leaveTimeout = null;
    this.isStopping = false;

    this.initPlayer();
  }

  initPlayer() {
    this.player = createAudioPlayer({
      behaviors: {
        noSubscriber: NoSubscriberBehavior.Play,
        maxMissedFrames: 50,
      },
    });

    this.player.on('stateChange', (oldState, newState) => {
      console.log(`[AudioPlayer ${this.guildId}] State: ${oldState.status} -> ${newState.status}`);
      if (newState.status === AudioPlayerStatus.Idle && !this.isStopping) {
        // If the live radio stream unexpectedly stopped, attempt auto-reconnect after 2 seconds
        console.warn(`[AudioPlayer ${this.guildId}] Stream ended unexpectedly. Reconnecting...`);
        if (this.currentStation && this.voiceChannel) {
          setTimeout(() => {
            if (!this.isStopping && this.currentStation) {
              this.streamStation(this.currentStation).catch(err => {
                console.error(`[AudioPlayer ${this.guildId}] Auto-reconnect failed:`, err);
              });
            }
          }, 2000);
        }
      }
    });

    this.player.on('error', (error) => {
      console.error(`[AudioPlayer Error ${this.guildId}]:`, error.message);
    });
  }

  async connect(voiceChannel, textChannel = null) {
    this.voiceChannel = voiceChannel;
    if (textChannel) this.textChannel = textChannel;

    this.cancelLeaveTimer();

    // If already connected in the same channel, reuse
    if (this.connection && this.connection.state.status !== VoiceConnectionStatus.Destroyed) {
      if (this.connection.joinConfig.channelId === voiceChannel.id) {
        return this.connection;
      }
    }

    this.connection = joinVoiceChannel({
      channelId: voiceChannel.id,
      guildId: voiceChannel.guild.id,
      adapterCreator: voiceChannel.guild.voiceAdapterCreator,
      selfDeaf: true,
      selfMute: false,
      debug: true,
    });

    this.connection.on('debug', (message) => {
      console.log(`[Voice Debug ${this.guildId}]: ${message}`);
    });

    this.connection.on('stateChange', (oldState, newState) => {
      console.log(`[VoiceConnection ${this.guildId}] State: ${oldState.status} -> ${newState.status}`);
    });

    this.connection.on('error', (error) => {
      console.error(`[VoiceConnection Error ${this.guildId}]:`, error.message);
    });

    this.connection.on(VoiceConnectionStatus.Disconnected, async () => {
      try {
        await Promise.race([
          entersState(this.connection, VoiceConnectionStatus.Signalling, 5_000),
          entersState(this.connection, VoiceConnectionStatus.Connecting, 5_000),
        ]);
        // Reconnection successful
      } catch (error) {
        // Unrecoverable disconnect
        console.log(`[Voice ${this.guildId}] Connection lost, destroying session.`);
        this.destroy();
      }
    });

    this.connection.on(VoiceConnectionStatus.Destroyed, () => {
      this.cleanup();
    });

    try {
      await entersState(this.connection, VoiceConnectionStatus.Ready, 30_000);
      this.connection.subscribe(this.player);
      return this.connection;
    } catch (err) {
      this.destroy();
      throw new Error(`Failed to join voice channel: ${err.message}`);
    }
  }

  async play(voiceChannel, station, textChannel = null) {
    this.isStopping = false;
    this.currentStation = station;
    await this.connect(voiceChannel, textChannel);
    await this.streamStation(station);
  }

  async streamStation(station) {
    const streamUrl = azuracast.getStreamUrl(station);
    if (!streamUrl) {
      throw new Error(`Could not find a valid stream URL for station "${station.name}".`);
    }

    console.log(`[AudioPlayer ${this.guildId}] Streaming "${station.name}" from ${streamUrl}`);

    // Kill existing ffmpeg process if running
    this.killFFmpeg();

    // Spawn FFmpeg to pull HTTP/HTTPS stream and pipe as raw 48kHz 16-bit stereo PCM
    // -icy 0 prevents in-band metadata chunks from interrupting the audio stream
    // -nobuffer and low_delay prevent buffer burst jumps
    const args = [
      '-reconnect', '1',
      '-reconnect_streamed', '1',
      '-reconnect_delay_max', '2',
      '-fflags', '+nobuffer',
      '-flags', 'low_delay',
      '-probesize', '32768',
      '-analyzeduration', '0',
      '-err_detect', 'ignore_err',
      '-icy', '0',
      '-i', streamUrl,
      '-loglevel', 'warning',
      '-f', 's16le',
      '-ar', '48000',
      '-ac', '2',
      'pipe:1'
    ];

    this.ffmpegProcess = spawn(ffmpegPath, args, {
      stdio: ['ignore', 'pipe', 'ignore'],
    });

    this.ffmpegProcess.on('error', (err) => {
      console.error(`[FFmpeg Error ${this.guildId}]:`, err.message);
    });

    this.ffmpegProcess.on('close', (code) => {
      console.log(`[FFmpeg ${this.guildId}] Exited with code ${code}`);
    });

    this.resource = createAudioResource(this.ffmpegProcess.stdout, {
      inputType: StreamType.Raw,
      inlineVolume: true,
    });

    if (this.resource.volume) {
      this.resource.volume.setVolume(this.volume);
    }

    this.player.play(this.resource);
  }

  killFFmpeg() {
    if (this.ffmpegProcess) {
      try {
        this.ffmpegProcess.stdout.destroy();
        this.ffmpegProcess.kill('SIGKILL');
      } catch (e) {
        // ignore
      }
      this.ffmpegProcess = null;
    }
  }

  setVolume(percent) {
    const clamped = Math.max(0, Math.min(100, percent));
    this.volume = clamped / 100;
    if (this.resource && this.resource.volume) {
      this.resource.volume.setVolume(this.volume);
    }
    return clamped;
  }

  pause() {
    if (this.player) {
      return this.player.pause();
    }
    return false;
  }

  unpause() {
    if (this.player) {
      return this.player.unpause();
    }
    return false;
  }

  isPaused() {
    return this.player?.state.status === AudioPlayerStatus.Paused;
  }

  isPlaying() {
    return this.player?.state.status === AudioPlayerStatus.Playing;
  }

  stop() {
    this.isStopping = true;
    this.currentStation = null;
    this.killFFmpeg();
    if (this.player) {
      this.player.stop(true);
    }
  }

  destroy() {
    this.stop();
    if (this.connection && this.connection.state.status !== VoiceConnectionStatus.Destroyed) {
      try {
        this.connection.destroy();
      } catch (e) {
        // ignore
      }
    }
    this.cleanup();
  }

  cleanup() {
    this.cancelLeaveTimer();
    this.connection = null;
    this.voiceChannel = null;
    sessionManager.remove(this.guildId);
  }

  scheduleLeave(timeoutSeconds) {
    this.cancelLeaveTimer();
    const waitMs = (timeoutSeconds || config.behavior.autoLeaveTimeoutSeconds) * 1000;
    this.leaveTimeout = setTimeout(() => {
      console.log(`[Voice ${this.guildId}] Inactive/empty voice channel timeout reached. Leaving.`);
      this.destroy();
    }, waitMs);
  }

  cancelLeaveTimer() {
    if (this.leaveTimeout) {
      clearTimeout(this.leaveTimeout);
      this.leaveTimeout = null;
    }
  }
}

class SessionManager {
  constructor() {
    this.sessions = new Map();
  }

  get(guildId) {
    return this.sessions.get(guildId);
  }

  getOrCreate(guildId) {
    let session = this.sessions.get(guildId);
    if (!session) {
      session = new GuildAudioSession(guildId);
      this.sessions.set(guildId, session);
    }
    return session;
  }

  remove(guildId) {
    this.sessions.delete(guildId);
  }
}

const sessionManager = new SessionManager();

module.exports = {
  GuildAudioSession,
  sessionManager,
};
