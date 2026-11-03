const {
  SlashCommandBuilder,
  EmbedBuilder,
  ActionRowBuilder,
  StringSelectMenuBuilder,
  StringSelectMenuOptionBuilder,
} = require('discord.js');
const azuracast = require('../azuracast');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('stations')
    .setDescription('List all available radio stations from your AzuraCast instance'),

  async execute(interaction) {
    await interaction.deferReply();

    try {
      const stations = await azuracast.getStations(true);

      if (!stations || stations.length === 0) {
        return interaction.editReply({
          content: '⚠️ No stations were found on the AzuraCast instance.',
        });
      }

      const embed = new EmbedBuilder()
        .setColor(0x00AEEF)
        .setTitle('📻 Available AzuraCast Stations')
        .setDescription(
          `Found **${stations.length}** station(s). You can play any station using \`/play <station>\` or by selecting from the menu below!`
        )
        .setTimestamp();

      const options = [];

      for (const station of stations.slice(0, 25)) {
        const desc = station.description || `Shortcode: ${station.shortcode}`;
        embed.addFields({
          name: `📡 ${station.name}`,
          value: `${desc}\n*Code:* \`${station.shortcode}\``,
          inline: true,
        });

        options.push(
          new StringSelectMenuOptionBuilder()
            .setLabel(station.name.slice(0, 100))
            .setDescription((station.description || station.shortcode).slice(0, 100))
            .setValue(station.shortcode || String(station.id))
            .setEmoji('📻')
        );
      }

      const components = [];
      if (options.length > 0) {
        const selectMenu = new StringSelectMenuBuilder()
          .setCustomId('select_station')
          .setPlaceholder('Select a station to play immediately...')
          .addOptions(options);

        components.push(new ActionRowBuilder().addComponents(selectMenu));
      }

      await interaction.editReply({ embeds: [embed], components });
    } catch (err) {
      console.error('[Stations Error]:', err);
      return interaction.editReply({
        content: `❌ Failed to retrieve stations: ${err.message}`,
      });
    }
  },
};
