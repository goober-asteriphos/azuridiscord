require('dotenv').config();

const config = {
  // Discord Bot
  token: process.env.DISCORD_TOKEN,
  clientId: process.env.DISCORD_CLIENT_ID,
  guildId: process.env.GUILD_ID || null, // Optional: for rapid slash command updates during dev

  // AzuraCast Instance
  azuracast: {
    baseUrl: (process.env.AZURACAST_BASE_URL || '').replace(/\/+$/, ''), // strip trailing slash
    apiKey: process.env.AZURACAST_API_KEY || null, // Optional for public stations
    defaultStation: process.env.DEFAULT_STATION || '8', // Shortcode or numeric ID (defaults to station 8)
  },

  // Bot Behavior
  behavior: {
    defaultVolume: parseInt(process.env.DEFAULT_VOLUME || '25', 10), // default 25% to protect ears
    autoLeaveEmptyVC: process.env.AUTO_LEAVE_EMPTY_VC !== 'false', // default true
    autoLeaveTimeoutSeconds: parseInt(process.env.AUTO_LEAVE_TIMEOUT || '30', 10),
    updatePresenceIntervalSeconds: parseInt(process.env.PRESENCE_INTERVAL || '30', 10),
  }
};

function validateConfig() {
  const missing = [];
  if (!config.token) missing.push('DISCORD_TOKEN');
  if (!config.clientId) missing.push('DISCORD_CLIENT_ID');
  if (!config.azuracast.baseUrl) missing.push('AZURACAST_BASE_URL');

  if (missing.length > 0) {
    console.warn(`[Config Warning] The following environment variables are missing: ${missing.join(', ')}`);
    console.warn(`Please create or edit your .env file before starting the bot.`);
  }
}

module.exports = {
  config,
  validateConfig,
};
