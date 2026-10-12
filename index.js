require('dotenv').config();

const {
  Client,
  GatewayIntentBits,
  REST,
  Routes,
  SlashCommandBuilder,
  EmbedBuilder,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  PermissionFlagsBits,
  ChannelType
} = require('discord.js');

const express = require('express');
const fs = require('fs');

const DATA_FILE = './database.json';
const app = express();

const SECURE_STAFF_ROLE_ID = process.env.SECURE_STAFF_ROLE_ID || '1423749610395930707';
const SECURE_CATEGORY_ID = process.env.SECURE_CATEGORY_ID || null;

let warnDatabase = {};
let blacklistDatabase = new Set();
let statsDatabase = {};
let giveawaysDatabase = {};

try {
  if (fs.existsSync(DATA_FILE)) {
    const raw = fs.readFileSync(DATA_FILE, 'utf8');
    const parsed = JSON.parse(raw);
    warnDatabase = parsed.warns || {};
    statsDatabase = parsed.stats || {};
    giveawaysDatabase = parsed.giveaways || {};
    blacklistDatabase = new Set(parsed.blacklist || []);
    console.log('💾 Loaded database from', DATA_FILE);
  }
} catch (err) {
  console.error('Failed loading database, starting fresh:', err);
}

function saveDatabase() {
  try {
    fs.writeFileSync(
      DATA_FILE,
      JSON.stringify(
        {
          warns: warnDatabase,
          stats: statsDatabase,
          giveaways: giveawaysDatabase,
          blacklist: Array.from(blacklistDatabase),
        },
        null,
        2
      ),
      'utf8'
    );
  } catch (err) {
    console.error('Failed saving database:', err);
  }
}

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent,
    GatewayIntentBits.GuildMembers
  ]
});

const commands = [
  new SlashCommandBuilder().setName('ticket').setDescription('Open a private ticket with Staff'),
  new SlashCommandBuilder()
    .setName('rename')
    .setDescription('Rename a ticket channel (staff only)')
    .addStringOption(option =>
      option.setName('name').setDescription('New channel name').setRequired(true)
    )
].map(cmd => cmd.toJSON());

client.once('ready', async () => {
  console.log(`✨ Logged in as ${client.user.tag}`);

  const rest = new REST({ version: '10' }).setToken(process.env.DISCORD_TOKEN);

  try {
    await rest.put(Routes.applicationCommands(client.user.id), { body: commands });
    console.log('✅ Registered application commands');
  } catch (err) {
    console.error('Failed to register commands:', err);
  }
});

app.get('/', (req, res) => {
  res.type('text').send("Waffel's Giveaway Bot - alive");
});

app.get('/health', (req, res) => {
  res.json({ status: 'ok', bot: client.user ? client.user.tag : null });
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, '0.0.0.0', () => console.log(`HTTP server listening on port ${PORT}`));

client.on('messageCreate', async (message) => {
  if (message.author.bot) return;
  if (message.content === '!ping') {
    return message.reply('Pong!');
  }
});

client.on('interactionCreate', async (interaction) => {
  try {
    if (interaction.isChatInputCommand()) {
      if (interaction.commandName === 'ticket') {
        await interaction.deferReply({ ephemeral: true });

        const guild = interaction.guild;
        if (!guild) {
          return interaction.editReply({ content: 'This command can only be used in a server.' });
        }

        const channelName = `🎫-${interaction.user.username}`
          .toLowerCase()
          .replace(/[^a-z0-9-_]/g, '-')
          .slice(0, 90);

        const permissionOverwrites = [
          { id: guild.roles.everyone.id, deny: [PermissionFlagsBits.ViewChannel] },
          {
            id: interaction.user.id,
            allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages, PermissionFlagsBits.ReadMessageHistory]
          }
        ];

        if (SECURE_STAFF_ROLE_ID) {
          permissionOverwrites.push({
            id: SECURE_STAFF_ROLE_ID,
            allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages, PermissionFlagsBits.ReadMessageHistory]
          });
        }

        const createdChannel = await guild.channels.create({
          name: channelName,
          type: ChannelType.GuildText,
          parent: SECURE_CATEGORY_ID || undefined,
          permissionOverwrites
        }).catch(() => null);

        if (!createdChannel) {
          return interaction.editReply({ content: '❌ Failed to create a ticket channel. Check bot permissions.' });
        }

        const closeBtn = new ButtonBuilder()
          .setCustomId('close_ticket')
          .setLabel('Close Ticket 🔴')
          .setStyle(ButtonStyle.Danger);

        const row = new ActionRowBuilder().addComponents(closeBtn);

        const embed = new EmbedBuilder()
          .setTitle('🎫 Ticket Opened')
          .setDescription('A staff member will be with you shortly. Click the red button to close this ticket when resolved.')
          .setColor('#2ECC71');

        await createdChannel.send({
          content: `<@&${SECURE_STAFF_ROLE_ID}> | New ticket from ${interaction.user}`,
          embeds: [embed],
          components: [row]
        }).catch(() => null);

        return interaction.editReply({ content: `✅ Your ticket has been created: ${createdChannel}` });
      }

      if (interaction.commandName === 'rename') {
        const newName = interaction.options.getString('name');
        const member = interaction.member;

        const isStaff = member.roles && member.roles.cache && member.roles.cache.has(SECURE_STAFF_ROLE_ID);
        const isAdmin = member.permissions && member.permissions.has(PermissionFlagsBits.Administrator);

        if (!isStaff && !isAdmin) {
          return interaction.reply({ content: '❌ You are not authorized to rename tickets.', ephemeral: true });
        }

        const channel = interaction.channel;
        if (!channel) {
          return interaction.reply({ content: '❌ Unable to access this channel.', ephemeral: true });
        }

        const channelName = (channel.name || '').toLowerCase();
        if (!channelName.startsWith('🎫-') && !channelName.startsWith('ticket-')) {
          return interaction.reply({ content: '❌ This command can only rename ticket channels.', ephemeral: true });
        }

        await channel.setName(newName.slice(0, 90)).catch(() => null);
        return interaction.reply({ content: `✅ Ticket renamed to **${newName}**`, ephemeral: true });
      }
    }

    if (interaction.isButton() && interaction.customId === 'close_ticket') {
      const channel = interaction.channel;
      if (!channel) {
        return interaction.reply({ content: '❌ Unable to access this channel.', ephemeral: true });
      }

      const isStaff = interaction.member.roles && interaction.member.roles.cache && interaction.member.roles.cache.has(SECURE_STAFF_ROLE_ID);
      const isAdmin = interaction.member.permissions && interaction.member.permissions.has(PermissionFlagsBits.Administrator);

      const ticketPrefix = (channel.name || '').replace(/^🎫-?/i, '').toLowerCase();
      const isTicketOpener = ticketPrefix && interaction.user.username.toLowerCase().includes(ticketPrefix);

      if (!isStaff && !isAdmin && !isTicketOpener) {
        return interaction.reply({ content: '❌ You are not authorized to close this ticket.', ephemeral: true });
      }

      await interaction.reply({ content: '🔒 Closing ticket in 5 seconds...' });
      setTimeout(() => {
        channel.delete().catch(() => null);
      }, 5000);
      return;
    }
  } catch (err) {
    console.error('Interaction handler error:', err);
    if (interaction.replied || interaction.deferred) {
      try { await interaction.editReply({ content: '❌ An internal error occurred.' }); } catch {}
    } else {
      try { await interaction.reply({ content: '❌ An internal error occurred.', ephemeral: true }); } catch {}
    }
  }
});

if (!process.env.DISCORD_TOKEN) {
  console.error('DISCORD_TOKEN not set in environment');
  process.exit(1);
}

client.login(process.env.DISCORD_TOKEN).catch(err => {
  console.error('Failed to login:', err);
  process.exit(1);
});
