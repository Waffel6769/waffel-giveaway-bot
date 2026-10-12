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

function initStats(userId) {
  if (!statsDatabase[userId]) statsDatabase[userId] = { entered: 0, won: 0 };
}

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent,
    GatewayIntentBits.GuildMembers
  ]
});

// Register a fuller set of slash commands (restored preview commands)
const commands = [
  new SlashCommandBuilder().setName('ticket').setDescription('Open a private ticket with Staff'),
  new SlashCommandBuilder()
    .setName('rename')
    .setDescription('Rename a ticket channel (staff only)')
    .addStringOption(option => option.setName('name').setDescription('New channel name').setRequired(true)),
  new SlashCommandBuilder().setName('gcreate').setDescription('Open the menu to create a giveaway 🧇'),
  new SlashCommandBuilder().setName('gend').setDescription('Forcefully end an active giveaway instantly 🔒')
    .addStringOption(option => option.setName('message_id').setDescription('The ID of the giveaway message').setRequired(true)),
  new SlashCommandBuilder().setName('greroll').setDescription('Reroll a new winner for a finished giveaway 🎲')
    .addStringOption(option => option.setName('message_id').setDescription('The ID of the giveaway message').setRequired(true)),
  new SlashCommandBuilder().setName('gwblacklist').setDescription('Blacklist a user from joining any giveaways 🚫')
    .addUserOption(option => option.setName('target').setDescription('The user to blacklist').setRequired(true)),
  new SlashCommandBuilder().setName('gwunblacklist').setDescription('Remove a user from the giveaway blacklist ✅')
    .addUserOption(option => option.setName('target').setDescription('The user to unblacklist').setRequired(true)),
  new SlashCommandBuilder().setName('winnerinfo').setDescription('Show summary of last finished giveaway in this channel 🏆'),
  new SlashCommandBuilder().setName('faq').setDescription('Display the server FAQ menu 📖'),
  new SlashCommandBuilder().setName('userinfo').setDescription('Display profile information about a user 👤')
    .addUserOption(option => option.setName('target').setDescription('The user to view').setRequired(false)),
  new SlashCommandBuilder().setName('serverinfo').setDescription('Display key statistics about this server 📊'),
  new SlashCommandBuilder().setName('avatar').setDescription('Get the full size avatar of a member 🖼️')
    .addUserOption(option => option.setName('target').setDescription('The user to view').setRequired(false)),
  new SlashCommandBuilder().setName('infractions').setDescription('View warning history of a user 📜')
    .addUserOption(option => option.setName('target').setDescription('The user to view').setRequired(false)),
  new SlashCommandBuilder().setName('help').setDescription('Display the list of all available bot commands 📋'),
  new SlashCommandBuilder().setName('wjamal').setDescription('Send a random funny frog GIF 🐸'),
  new SlashCommandBuilder().setName('claimtime').setDescription('Display official giveaway claim times and rules 🕐'),
  new SlashCommandBuilder().setName('stats').setDescription('Display your giveaway statistics or those of another user 📊')
    .addUserOption(option => option.setName('target').setDescription('The user to view stats for').setRequired(false)),
  new SlashCommandBuilder().setName('statsreset').setDescription('Reset all giveaway statistics for a specific user 🔄')
    .addUserOption(option => option.setName('target').setDescription('The user whose statistics will be wiped clean').setRequired(true))
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
  if (message.content === '!ping') return message.reply('Pong!');
});

client.on('interactionCreate', async (interaction) => {
  try {
    if (interaction.isChatInputCommand()) {
      // Ticket create / rename handled first
      if (interaction.commandName === 'ticket') {
        await interaction.deferReply({ ephemeral: true });

        const guild = interaction.guild;
        if (!guild) return interaction.editReply({ content: 'This command can only be used in a server.' });

        const channelName = `🎫-${interaction.user.username}`.toLowerCase().replace(/[^a-z0-9-_]/g, '-').slice(0, 90);
        const permissionOverwrites = [
          { id: guild.roles.everyone.id, deny: [PermissionFlagsBits.ViewChannel] },
          { id: interaction.user.id, allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages, PermissionFlagsBits.ReadMessageHistory] }
        ];
        if (SECURE_STAFF_ROLE_ID) permissionOverwrites.push({ id: SECURE_STAFF_ROLE_ID, allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages, PermissionFlagsBits.ReadMessageH[...]

        const createdChannel = await guild.channels.create({ name: channelName, type: ChannelType.GuildText, parent: SECURE_CATEGORY_ID || undefined, permissionOverwrites }).catch(() => null);
        if (!createdChannel) return interaction.editReply({ content: '❌ Failed to create a ticket channel. Check bot permissions.' });

        const closeBtn = new ButtonBuilder().setCustomId('close_ticket').setLabel('Close Ticket 🔴').setStyle(ButtonStyle.Danger);
        const row = new ActionRowBuilder().addComponents(closeBtn);
        const embed = new EmbedBuilder().setTitle('🎫 Ticket Opened').setDescription('A staff member will be with you shortly. Click the red button to close this ticket when resolved.').setColo[...]
        await createdChannel.send({ content: `<@&${SECURE_STAFF_ROLE_ID}> | New ticket from ${interaction.user}`, embeds: [embed], components: [row] }).catch(() => null);
        return interaction.editReply({ content: `✅ Your ticket has been created: ${createdChannel}` });
      }

      if (interaction.commandName === 'rename') {
        const newName = interaction.options.getString('name');
        const member = interaction.member;
        const isStaff = member.roles && member.roles.cache && member.roles.cache.has(SECURE_STAFF_ROLE_ID);
        const isAdmin = member.permissions && member.permissions.has(PermissionFlagsBits.Administrator);
        if (!isStaff && !isAdmin) return interaction.reply({ content: '❌ You are not authorized to rename tickets.', ephemeral: true });
        const channel = interaction.channel;
        if (!channel) return interaction.reply({ content: '❌ Unable to access this channel.', ephemeral: true });
        const channelName = (channel.name || '').toLowerCase();
        if (!channelName.startsWith('🎫-') && !channelName.startsWith('ticket-')) return interaction.reply({ content: '❌ This command can only rename ticket channels.', ephemeral: true });
        await channel.setName(newName.slice(0, 90)).catch(() => null);
        return interaction.reply({ content: `✅ Ticket renamed to **${newName}**`, ephemeral: true });
      }

      // Giveaway / utility commands (minimal preview implementations)
      if (interaction.commandName === 'help') {
        const embed = new EmbedBuilder()
          .setTitle('📋 Available Bot Commands Inventory')
          .setColor('#F1C40F')
          .setDescription('Here is a list of the main features and commands:')
          .addFields(
            { name: '✨ Slash Commands (/)', value: '`/ticket` `/rename` `/gcreate` `/gend` `/greroll` `/gwblacklist` `/gwunblacklist` `/winnerinfo` `/faq` `/userinfo` `/serverinfo` `/avatar` `/[...]
            { name: '🛠️ Prefix Commands (?)', value: '`?lock` `?unlock` `?clear` `?roleadd` `?unwarn` `?to`' },
            { name: '🎉 Automation (!)', value: '`!gstart <minutes> <prize>`' }
          ).setFooter({ text: `Waffel's Giveaway Utility` });
        return interaction.reply({ embeds: [embed] });
      }

      if (interaction.commandName === 'stats') {
        const target = interaction.options.getUser('target') || interaction.user;
        initStats(target.id);
        const s = statsDatabase[target.id];
        const winRate = s.entered > 0 ? ((s.won / s.entered) * 100).toFixed(1) : '0.0';
        const statsEmbed = new EmbedBuilder()
          .setTitle(`📊 Giveaway Statistics - ${target.username}`)
          .setColor('#F1C40F')
          .addFields(
            { name: '📥 Giveaways Entered', value: `\`${s.entered}\` times`, inline: true },
            { name: '🏆 Giveaways Won', value: `\`${s.won}\` times`, inline: true },
            { name: '📈 Win Rate', value: `\`${winRate}%\``, inline: true }
          )
          .setTimestamp();
        return interaction.reply({ embeds: [statsEmbed] });
      }

      if (interaction.commandName === 'statsreset') {
        const target = interaction.options.getUser('target');
        if (!target) return interaction.reply({ content: 'Please specify a user.', ephemeral: true });
        statsDatabase[target.id] = { entered: 0, won: 0 };
        saveDatabase();
        return interaction.reply({ content: `✅ Statistics reset for ${target.toString()}` });
      }

      if (interaction.commandName === 'claimtime') {
        const embed = new EmbedBuilder().setTitle('🎉 Giveaway Info').setColor('#F1C40F').setDescription('Quickdrops: 30 minutes\nWeekly/Daily: 24 hours\nBig Giveaways: 12 hours').setTimestamp([...]
        return interaction.reply({ embeds: [embed] });
      }

      if (interaction.commandName === 'wjamal') {
        const gif = 'https://media.giphy.com/media/3o6Zt6ML6BklcajjsA/giphy.gif';
        const embed = new EmbedBuilder().setTitle('🐸 W JAMAL').setImage(gif).setColor('#2ECC71');
        return interaction.reply({ embeds: [embed] });
      }

      if (interaction.commandName === 'userinfo') {
        const target = interaction.options.getUser('target') || interaction.user;
        const embed = new EmbedBuilder()
          .setTitle(`👤 User Info - ${target.tag}`)
          .setThumbnail(target.displayAvatarURL())
          .addFields(
            { name: '🆔', value: '`' + target.id + '`', inline: true },
            { name: 'Bot', value: target.bot ? 'Yes' : 'No', inline: true }
          ).setTimestamp();
        return interaction.reply({ embeds: [embed] });
      }

      if (interaction.commandName === 'serverinfo') {
        const g = interaction.guild;
        const embed = new EmbedBuilder()
          .setTitle(`📊 Server Info - ${g.name}`)
          .addFields(
            { name: 'Owner', value: `<@${g.ownerId}>`, inline: true },
            { name: 'Members', value: `${g.memberCount}`, inline: true }
          ).setTimestamp();
        return interaction.reply({ embeds: [embed] });
      }

      if (interaction.commandName === 'avatar') {
        const target = interaction.options.getUser('target') || interaction.user;
        const embed = new EmbedBuilder().setTitle(`🖼️ Avatar - ${target.tag}`).setImage(target.displayAvatarURL({ size: 1024 })).setTimestamp();
        return interaction.reply({ embeds: [embed] });
      }

      if (interaction.commandName === 'infractions') {
        const target = interaction.options.getUser('target') || interaction.user;
        const warns = warnDatabase[target.id] || [];
        const embed = new EmbedBuilder().setTitle(`📜 Infractions - ${target.username}`).setColor(warns.length ? '#E74C3C' : '#2ECC71');
        if (!warns.length) embed.setDescription('✅ No infractions found'); else warns.forEach((w, i) => embed.addFields({ name: `Warning #${i+1}`, value: w.reason || 'No reason' }));
        return interaction.reply({ embeds: [embed] });
      }

      if (interaction.commandName === 'faq') {
        const faq = `Q: How do I join?\nA: Follow instructions in the server channels.\n\nQ: How to claim?\nA: Open a ticket within the claim window.`;
        const embed = new EmbedBuilder().setTitle("📖 FAQ").setDescription(faq).setTimestamp();
        return interaction.reply({ embeds: [embed] });
      }

      if (interaction.commandName === 'gwblacklist') {
        const target = interaction.options.getUser('target');
        if (!target) return interaction.reply({ content: 'Please specify a user.', ephemeral: true });
        blacklistDatabase.add(target.id); saveDatabase();
        return interaction.reply({ content: `🚫 ${target.tag} added to giveaway blacklist.` });
      }

      if (interaction.commandName === 'gwunblacklist') {
        const target = interaction.options.getUser('target');
        if (!target) return interaction.reply({ content: 'Please specify a user.', ephemeral: true });
        blacklistDatabase.delete(target.id); saveDatabase();
        return interaction.reply({ content: `✅ ${target.tag} removed from giveaway blacklist.` });
      }

      // Minimal stubs for giveaway features restored as commands but not fully implemented
      if (['gcreate','gend','greroll','winnerinfo'].includes(interaction.commandName)) {
        return interaction.reply({ content: 'This giveaway feature is temporarily disabled; use ticket to request staff assistance.', ephemeral: true });
      }
    }

    // Button interactions
    if (interaction.isButton() && interaction.customId === 'close_ticket') {
      const channel = interaction.channel;
      if (!channel) return interaction.reply({ content: '❌ Unable to access this channel.', ephemeral: true });

      const isStaff = interaction.member.roles && interaction.member.roles.cache && interaction.member.roles.cache.has(SECURE_STAFF_ROLE_ID);
      const isAdmin = interaction.member.permissions && interaction.member.permissions.has(PermissionFlagsBits.Administrator);
      const ticketPrefix = (channel.name || '').replace(/^🎫-?/i, '').toLowerCase();
      const isTicketOpener = ticketPrefix && interaction.user.username.toLowerCase().includes(ticketPrefix);

      if (!isStaff && !isAdmin && !isTicketOpener) return interaction.reply({ content: '❌ You are not authorized to close this ticket.', ephemeral: true });

      await interaction.reply({ content: '🔒 Closing ticket in 5 seconds...' });
      setTimeout(() => channel.delete().catch(() => null), 5000);
      return;
    }
  } catch (err) {
    console.error('Interaction handler error:', err);
    if (interaction.replied || interaction.deferred) {
      try { interaction.editReply({ content: '❌ An internal error occurred.' }).catch(() => null); } catch {}
    } else {
      try { interaction.reply({ content: '❌ An internal error occurred.', ephemeral: true }).catch(() => null); } catch {}
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
