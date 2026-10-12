require('dotenv').config();

const {
  Client,
  GatewayIntentBits,
  REST,
  Routes,
  SlashCommandBuilder,
  EmbedBuilder,
  PermissionFlagsBits,
} = require('discord.js');

const express = require('express');
const fs = require('fs');

const DATA_FILE = './database.json';
const app = express();

const SECURE_STAFF_ROLE_ID = process.env.SECURE_STAFF_ROLE_ID || '1423749610395930707';

let warnDatabase = {};
let statsDatabase = {};
let blacklistDatabase = new Set();

try {
  if (fs.existsSync(DATA_FILE)) {
    const raw = fs.readFileSync(DATA_FILE, 'utf8');
    const parsed = JSON.parse(raw);
    warnDatabase = parsed.warns || {};
    statsDatabase = parsed.stats || {};
    blacklistDatabase = new Set(parsed.blacklist || []);
    console.log('💾 Database loaded from', DATA_FILE);
  }
} catch (err) {
  console.error('❌ Database load failed, starting fresh:', err);
}

function saveDatabase() {
  try {
    fs.writeFileSync(
      DATA_FILE,
      JSON.stringify({
        warns: warnDatabase,
        stats: statsDatabase,
        blacklist: Array.from(blacklistDatabase),
      }, null, 2),
      'utf8'
    );
  } catch (err) {
    console.error('❌ Database save failed:', err);
  }
}

function initStats(userId) {
  if (!statsDatabase[userId]) {
    statsDatabase[userId] = { entered: 0, won: 0 };
  }
}

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent,
    GatewayIntentBits.GuildMembers,
  ],
});

const commands = [
  new SlashCommandBuilder()
    .setName('rename')
    .setDescription('Rename a ticket channel (staff only)')
    .addStringOption((option) =>
      option.setName('name').setDescription('New channel name').setRequired(true)
    ),

  new SlashCommandBuilder()
    .setName('help')
    .setDescription('Display all available commands 📋'),

  new SlashCommandBuilder()
    .setName('stats')
    .setDescription('Display giveaway stats for a user')
    .addUserOption((option) =>
      option.setName('target').setDescription('User to view stats for').setRequired(false)
    ),

  new SlashCommandBuilder()
    .setName('statsreset')
    .setDescription('Reset a user giveaway stats')
    .addUserOption((option) =>
      option.setName('target').setDescription('User whose stats should be reset').setRequired(true)
    ),

  new SlashCommandBuilder()
    .setName('claimtime')
    .setDescription('Show giveaway claim times'),

  new SlashCommandBuilder()
    .setName('wjamal')
    .setDescription('Send a random funny frog GIF 🐸'),

  new SlashCommandBuilder()
    .setName('userinfo')
    .setDescription('Show official user info')
    .addUserOption((option) =>
      option.setName('target').setDescription('User to inspect').setRequired(false)
    ),

  new SlashCommandBuilder()
    .setName('serverinfo')
    .setDescription('Show this server info 📊'),

  new SlashCommandBuilder()
    .setName('avatar')
    .setDescription('Show user avatar 🖼️')
    .addUserOption((option) =>
      option.setName('target').setDescription('User to inspect').setRequired(false)
    ),

  new SlashCommandBuilder()
    .setName('infractions')
    .setDescription('Show warnings for a user')
    .addUserOption((option) =>
      option.setName('target').setDescription('User to inspect').setRequired(false)
    ),

  new SlashCommandBuilder()
    .setName('faq')
    .setDescription('Show the FAQ menu 📖'),
].map((cmd) => cmd.toJSON());

client.once('ready', async () => {
  console.log(`✨ Bot logged in as ${client.user.tag}`);

  const rest = new REST({ version: '10' }).setToken(process.env.DISCORD_TOKEN);

  try {
    await rest.put(
      Routes.applicationCommands(client.user.id),
      { body: commands }
    );
    console.log('✅ Slash commands reloaded successfully');
  } catch (err) {
    console.error('❌ Failed to register commands:', err);
  }
});

app.get('/', (req, res) => {
  res.send("Waffel's Giveaway is alive");
});

app.get('/health', (req, res) => {
  res.json({ status: 'ok', bot: client.user ? client.user.tag : null });
});

app.listen(process.env.PORT || 3000, '0.0.0.0', () => {
  console.log('HTTP server started');
});

client.on('messageCreate', async (message) => {
  if (message.author.bot) return;

  if (message.content === '!ping') {
    return message.reply('Pong!');
  }
});

client.on('interactionCreate', async (interaction) => {
  try {
    if (!interaction.isChatInputCommand()) return;

    if (interaction.commandName === 'rename') {
      const member = interaction.member;
      const isStaff = member.roles && member.roles.cache && member.roles.cache.has(SECURE_STAFF_ROLE_ID);
      const isAdmin = member.permissions && member.permissions.has(PermissionFlagsBits.Administrator);

      if (!isStaff && !isAdmin) {
        return interaction.reply({
          content: '❌ Only staff members or admins can rename tickets.',
          ephemeral: true,
        });
      }

      const newName = interaction.options.getString('name');
      const channel = interaction.channel;

      if (!channel) {
        return interaction.reply({
          content: '❌ Could not access this channel.',
          ephemeral: true,
        });
      }

      const channelName = (channel.name || '').toLowerCase();
      if (!channelName.startsWith('🎫-') && !channelName.startsWith('ticket-')) {
        return interaction.reply({
          content: '❌ This command only works in ticket channels.',
          ephemeral: true,
        });
      }

      await channel.setName(newName.slice(0, 90));
      return interaction.reply({
        content: `✅ Ticket renamed to **${newName}**`,
        ephemeral: true,
      });
    }

    if (interaction.commandName === 'help') {
      const embed = new EmbedBuilder()
        .setTitle('📋 Available Commands')
        .setColor('#F1C40F')
        .setDescription('Main bot commands:')
        .addFields(
          { name: 'Slash Commands', value: '`/rename` `/help` `/stats` `/statsreset` `/claimtime` `/wjamal` `/userinfo` `/serverinfo` `/avatar` `/infractions` `/faq`', inline: false }
        );

      return interaction.reply({ embeds: [embed] });
    }

    if (interaction.commandName === 'stats') {
      const target = interaction.options.getUser('target') || interaction.user;
      initStats(target.id);
      const s = statsDatabase[target.id];
      const winRate = s.entered > 0 ? ((s.won / s.entered) * 100).toFixed(1) : '0.0';

      const embed = new EmbedBuilder()
        .setTitle(`📊 Stats - ${target.username}`)
        .setColor('#F1C40F')
        .addFields(
          { name: '📥 Entered', value: `\`${s.entered}\``, inline: true },
          { name: '🏆 Won', value: `\`${s.won}\``, inline: true },
          { name: '📈 Win rate', value: `\`${winRate}%\``, inline: true }
        );

      return interaction.reply({ embeds: [embed] });
    }

    if (interaction.commandName === 'statsreset') {
      const target = interaction.options.getUser('target');
      if (!target) {
        return interaction.reply({ content: '❌ Please specify a user.', ephemeral: true });
      }

      statsDatabase[target.id] = { entered: 0, won: 0 };
      saveDatabase();

      return interaction.reply({
        content: `✅ Stats reset for ${target.toString()}`,
      });
    }

    if (interaction.commandName === 'claimtime') {
      const embed = new EmbedBuilder()
        .setTitle('🎉 Giveaway Information')
        .setColor('#F1C40F')
        .setDescription('Quickdrops: 30 minutes\nWeekly/Daily: 24 hours\nBig giveaways: 12 hours');

      return interaction.reply({ embeds: [embed] });
    }

    if (interaction.commandName === 'wjamal') {
      const gif = 'https://media.giphy.com/media/3o6Zt6ML6BklcajjsA/giphy.gif';
      const embed = new EmbedBuilder()
        .setTitle('🐸 W JAMAL')
        .setImage(gif)
        .setColor('#2ECC71');

      return interaction.reply({ embeds: [embed] });
    }

    if (interaction.commandName === 'userinfo') {
      const target = interaction.options.getUser('target') || interaction.user;
      const embed = new EmbedBuilder()
        .setTitle(`👤 User Info - ${target.tag}`)
        .setThumbnail(target.displayAvatarURL())
        .addFields(
          { name: '🆔 ID', value: '`' + target.id + '`', inline: true },
          { name: 'Bot', value: target.bot ? 'Yes' : 'No', inline: true },
          { name: 'Created', value: `<t:${Math.floor(target.createdTimestamp / 1000)}:R>`, inline: true }
        );

      return interaction.reply({ embeds: [embed] });
    }

    if (interaction.commandName === 'serverinfo') {
      const guild = interaction.guild;
      const embed = new EmbedBuilder()
        .setTitle(`📊 Server Info - ${guild.name}`)
        .setColor('#F1C40F')
        .addFields(
          { name: '👑 Owner', value: `<@${guild.ownerId}>`, inline: true },
          { name: '👥 Members', value: `${guild.memberCount}`, inline: true }
        );

      return interaction.reply({ embeds: [embed] });
    }

    if (interaction.commandName === 'avatar') {
      const target = interaction.options.getUser('target') || interaction.user;
      const embed = new EmbedBuilder()
        .setTitle(`🖼️ Avatar - ${target.tag}`)
        .setImage(target.displayAvatarURL({ size: 1024 }))
        .setColor('#F1C40F');

      return interaction.reply({ embeds: [embed] });
    }

    if (interaction.commandName === 'infractions') {
      const target = interaction.options.getUser('target') || interaction.user;
      const warns = warnDatabase[target.id] || [];
      const embed = new EmbedBuilder()
        .setTitle(`📜 Infractions - ${target.username}`)
        .setColor(warns.length ? '#E74C3C' : '#2ECC71');

      if (!warns.length) {
        embed.setDescription('✅ No infractions found.');
      } else {
        embed.setDescription(`⚠️ Total warnings: **${warns.length}**`);
        warns.forEach((warning, index) => {
          embed.addFields({
            name: `Warning #${index + 1}`,
            value: warning.reason || 'No reason provided',
            inline: false,
          });
        });
      }

      return interaction.reply({ embeds: [embed] });
    }

    if (interaction.commandName === 'faq') {
      const embed = new EmbedBuilder()
        .setTitle('📖 FAQ')
        .setColor('#F1C40F')
        .setDescription('Q: How do I join?\nA: Follow the server rules and channels.\n\nQ: How do I claim rewards?\nA: Ask staff in a ticket channel.');

      return interaction.reply({ embeds: [embed] });
    }
  } catch (err) {
    console.error('Interaction error:', err);
    try {
      if (interaction.deferred || interaction.replied) {
        await interaction.editReply({ content: '❌ Something went wrong.' });
      } else {
        await interaction.reply({ content: '❌ Something went wrong.', ephemeral: true });
      }
    } catch (e) {
      // ignore
    }
  }
});

if (!process.env.DISCORD_TOKEN) {
  console.error('DISCORD_TOKEN is missing');
  process.exit(1);
}

client.login(process.env.DISCORD_TOKEN).catch((err) => {
  console.error('Login failed:', err);
  process.exit(1);
});
