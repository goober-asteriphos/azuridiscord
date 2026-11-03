const { REST, Routes } = require('discord.js');
const fs = require('fs');
const path = require('path');
const { config, validateConfig } = require('./config');

validateConfig();

const commands = [];
const commandsPath = path.join(__dirname, 'commands');
const commandFiles = fs.readdirSync(commandsPath).filter(file => file.endsWith('.js'));

for (const file of commandFiles) {
  const filePath = path.join(commandsPath, file);
  const command = require(filePath);
  if ('data' in command && 'execute' in command) {
    commands.push(command.data.toJSON());
  } else {
    console.warn(`[Deploy Warning] The command at ${filePath} is missing a required "data" or "execute" property.`);
  }
}

const rest = new REST().setToken(config.token);

(async () => {
  try {
    console.log(`Started refreshing ${commands.length} application (/) commands.`);

    if (config.guildId) {
      // Guild-specific registration (instant update, ideal for development/testing)
      console.log(`Deploying commands to test guild: ${config.guildId}`);
      const data = await rest.put(
        Routes.applicationGuildCommands(config.clientId, config.guildId),
        { body: commands }
      );
      console.log(`Successfully reloaded ${data.length} guild application (/) commands.`);
    } else {
      // Global registration (available in all servers the bot is in)
      console.log('Deploying commands globally across all guilds...');
      const data = await rest.put(
        Routes.applicationCommands(config.clientId),
        { body: commands }
      );
      console.log(`Successfully reloaded ${data.length} global application (/) commands.`);
    }
  } catch (error) {
    console.error('[Deploy Error]:', error);
  }
})();
