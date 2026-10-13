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
  ComponentType,
  ChannelType,
  PermissionFlagsBits,
  StringSelectMenuBuilder,
  StringSelectMenuOptionBuilder,
  ModalBuilder,
  TextInputBuilder,
  TextInputStyle
} = require('discord.js');

const express = require('express');
const fs = require('fs');

const DATA_FILE = './database.json';
const app = express();
const port = process.env.PORT || 3000;

// Configurations globales et identifiants de sécurité
const SECURE_CATEGORY_ID = process.env.TICKET_CATEGORY_ID || "1443450226647240796"; 
const SECURE_STAFF_ROLE_ID = process.env.SECURE_STAFF_ROLE_ID || "1423749610395930707";   
const ROLE_TICKET_TEAM = "1497812876046499870";
const ROLE_SKELLY = "1497989066900373504";
const GUILD_ID = process.env.GUILD_ID || null;

let warnDatabase = {};
let blacklistDatabase = new Set();
let statsDatabase = {};
let giveawaysDatabase = {}; 
let ticketPanelsDatabase = {};
const ticketData = new Map();
// 💾 CHARGEMENT DE LA BASE DE DONNÉES JSON
try {
  if (fs.existsSync(DATA_FILE)) {
    const rawData = fs.readFileSync(DATA_FILE, 'utf8');
    const parsed = JSON.parse(rawData);
    warnDatabase = parsed.warns || {};
    statsDatabase = parsed.stats || {};
    giveawaysDatabase = parsed.giveaways || {};
    ticketPanelsDatabase = parsed.ticketPanels || {};
    blacklistDatabase = new Set(parsed.blacklist || []);
    console.log("💾 Base de données chargée avec succès depuis database.json");
  }
} catch (error) {
  console.error("❌ Échec du chargement de la base de données :", error);
}

// 💾 SAUVEGARDE DE LA BASE DE DONNÉES JSON
function saveDatabase() {
  try {
    const dataToSave = {
      warns: warnDatabase,
      stats: statsDatabase,
      giveaways: giveawaysDatabase,
      ticketPanels: ticketPanelsDatabase,
      blacklist: Array.from(blacklistDatabase)
    };
    fs.writeFileSync(DATA_FILE, JSON.stringify(dataToSave, null, 4), 'utf8');
  } catch (error) {
    console.error("❌ Erreur d'écriture de la base de données :", error);
  }
}

function initStats(userId) {
  if (!statsDatabase[userId]) {
    statsDatabase[userId] = { entered: 0, won: 0 };
  }
}
function parseDuration(str) {
  if (!str) return null;
  const match = str.match(/^(\d+)(sec|s|m|h|d)/i);
  if (!match) return null;
  const val = parseInt(match[1], 10);
  const unit = match[2].toLowerCase();
  if (unit === 's' || unit === 'sec') return val * 1000;
  if (unit === 'm') return val * 60 * 1000;
  if (unit === 'h') return val * 60 * 60 * 1000;
  if (unit === 'd') return val * 24 * 60 * 60 * 1000;
  return null;
}

function ensureTicketChannelName(name) {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9-_]+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 80);
}

function createPrefixEmbed(title, description, fields = []) {
  const embed = new EmbedBuilder()
    .setColor(0x2B2D31)
    .setTitle('⚙️ ' + title)
    .setDescription(description)
    .setTimestamp();
        
  if (fields.length > 0) {
    embed.addFields(fields);
  }
  return embed;
}

const client = new Client({ 
  intents: [
    GatewayIntentBits.Guilds, 
    GatewayIntentBits.GuildMessages, 
    GatewayIntentBits.MessageContent, 
    GatewayIntentBits.GuildMembers,
    GatewayIntentBits.GuildMessageReactions
  ] 
});

app.get('/', (req, res) => {
  res.send("Waffel's Complete Infrastructure is operational!");
});
app.get('/health', (req, res) => {
  res.json({ status: 'ok', bot: client.user ? client.user.tag : null });
});
app.listen(port, '0.0.0.0', () => {
  console.log(`🌐 HTTP KeepAlive Server running on port ${port}`);
});
// ==========================================
// PARTIE 4 : COLLECTION ET INJECTION DES COMMANDES SLASH (READY)
// ==========================================

const commands = [
  new SlashCommandBuilder()
    .setName('ticketpanel')
    .setDescription('Deploy the interactive ticket panel with a direct file upload image (Admin Only)')
    .addStringOption(option => option.setName('title').setDescription('The title of the ticket embed menu').setRequired(true))
    .addStringOption(option => option.setName('description').setDescription('Rules and description text (Use \n for new lines)').setRequired(true))
    .addAttachmentOption(option => option.setName('image').setDescription('Drag and drop or upload your panel logo/image here').setRequired(false)),
  new SlashCommandBuilder().setName('gcreate').setDescription('Open the menu to create a giveaway waffle'),
  new SlashCommandBuilder().setName('gend').setDescription('Forcefully end an active giveaway instantly 🔒')
    .addStringOption(option => option.setName('message_id').setDescription('The ID of the giveaway message').setRequired(true)),
  new SlashCommandBuilder().setName('greroll').setDescription('Reroll a new winner for a finished giveaway 🎲')
    .addStringOption(option => option.setName('message_id').setDescription('The ID of the giveaway message').setRequired(true)),
  new SlashCommandBuilder().setName('gwblacklist').setDescription('Blacklist a user from joining any giveaways 🚫')
    .addUserOption(option => option.setName('target').setDescription('The user to blacklist').setRequired(true)),
  new SlashCommandBuilder().setName('gwunblacklist').setDescription('Remove a user from the giveaway blacklist ✅')
    .addUserOption(option => option.setName('target').setDescription('The user to unblacklist').setRequired(true)),
  new SlashCommandBuilder().setName('winnerinfo').setDescription('Scans the channel history to display the summary of the last finished giveaway 🏆'),
  new SlashCommandBuilder().setName('faq').setDescription('Display the server frequency asked questions menu 📖'),
  new SlashCommandBuilder().setName('userinfo').setDescription('Display official profile information about a user 👤')
    .addUserOption(option => option.setName('target').setDescription('The user to view').setRequired(false)),
  new SlashCommandBuilder().setName('serverinfo').setDescription('Display key statistics about this server 📊'),
  new SlashCommandBuilder().setName('avatar').setDescription('Get the full size avatar of a member 🖼️')
    .addUserOption(option => option.setName('target').setDescription('The user to view').setRequired(false)),
  new SlashCommandBuilder().setName('infractions').setDescription('View the moderation history and warnings of a user 📜')
    .addUserOption(option => option.setName('target').setDescription('The user to view').setRequired(false)),
  new SlashCommandBuilder().setName('help').setDescription('Display the list of all available bot commands 📋'),
  new SlashCommandBuilder().setName('wjamal').setDescription('Send a random funny frog GIF 🐸'),
  new SlashCommandBuilder().setName('claimtime').setDescription('Display official giveaway claim times and rules 🕐'),
  new SlashCommandBuilder().setName('stats').setDescription('Display your personal giveaway statistics or those of another user 📊')
    .addUserOption(option => option.setName('target').setDescription('The user to view stats for').setRequired(false)),
  new SlashCommandBuilder().setName('statsreset').setDescription('Reset all giveaway statistics for a specific user 🔄')
    .addUserOption(option => option.setName('target').setDescription('The user whose statistics will be wiped clean').setRequired(true)),
  new SlashCommandBuilder().setName('rename').setDescription('Quickly alter the current channel name')
    .addStringOption(option => option.setName('name').setDescription('New channel name strip').setRequired(true)),
  new SlashCommandBuilder().setName('ticket').setDescription('Open a general support ticket (Deprecated)')
].map(cmd => cmd.toJSON());

client.once('ready', async () => {
  console.log("✨ Waffel Bot fully loaded as: " + client.user.tag);
  const rest = new REST({ version: '10' }).setToken(process.env.DISCORD_TOKEN);
  try {
    if (GUILD_ID) {
      await rest.put(Routes.applicationGuildCommands(client.user.id, GUILD_ID), { body: commands });
      console.log('✅ Application (/) commands injected for the designated Guild.');
    } else {
      await rest.put(Routes.applicationCommands(client.user.id), { body: commands });
      console.log('✅ Application (/) commands injected globally.');
    }
  } catch (error) { 
    console.error(error); 
  }

  for (const msgId in giveawaysDatabase) {
    const gw = giveawaysDatabase[msgId];
    const timeLeft = gw.endTime - Date.now();
    const channel = await client.channels.fetch(gw.channelId).catch(() => null);
    if (!channel) {
      delete giveawaysDatabase[msgId]; saveDatabase(); continue;
    }
    if (timeLeft <= 0) { runGiveawayEnd(channel, msgId); } else { resumeGiveawayCollector(channel, msgId, timeLeft); }
  }
});
// ==========================================
// PARTIE 5 : INTERCEPTION DES SALONS TEXTUELS ET COMMANDES !GSTART / !PING
// ==========================================

client.on('messageCreate', async (message) => {
    if (!message.guild || message.author.bot) return;

    if (message.content === '!ping') {
        return message.reply('Pong!');
    }

    if (message.content.startsWith('!gstart')) {
        if (!message.member.permissions.has(PermissionFlagsBits.ModerateMembers)) {
            return message.channel.send("❌ You need to be a **Staff Member** (with Timeout permissions) to start a giveaway.")
                .then(m => setTimeout(() => m.delete().catch(() => null), 5000));
        }
        setTimeout(() => message.delete().catch(() => null), 500);
        const args = message.content.slice('!gstart'.length).trim().split(/ +/);
        const durationStr = args[0];
        let prize = args.slice(1).join(' ');
        if (!durationStr || !prize) return;

        prize = prize.replace(/\bwaffle\b/gi, '🧇');
        const durationMs = parseDuration(durationStr) || (parseInt(durationStr, 10) * 60 * 1000);
        if (!durationMs) return;
        
        startGiveawayEngine(message.channel, durationMs, prize, 1, 'normal', null, message.author);
        return;
    }

    if (!message.content.startsWith('?')) return;
    const args = message.content.slice(1).trim().split(/ +/);
    const command = args.shift().toLowerCase();

    if (command === 'lock') {
        setTimeout(() => message.delete().catch(() => null), 200);
        if (!message.member.permissions.has(PermissionFlagsBits.ManageChannels)) {
            return message.channel.send({ embeds: [createPrefixEmbed('Error Status', "❌ You don't have permission to use this command.")] })
                .then(m => setTimeout(() => m.delete().catch(() => null), 5000));
        }
        await message.channel.permissionOverwrites.edit(message.guild.roles.everyone, { SendMessages: false });
        
        const logEmbed = createPrefixEmbed('Channel Locked Down', 'Public text streams standard communication rows suspended.', [
            { name: '🔒 Channel Context', value: message.channel.toString(), inline: true },
            { name: '🛡️ Responsible Exec', value: message.author.toString(), inline: true }
        ]);
        return message.channel.send({ embeds: [logEmbed] });
    }
    
    handleCoreModCommands(message, command, args);
});
// ==========================================
// PARTIE 6 : ROUTINES ?UNLOCK, ?CLEAR ET ?ROLEADD
// ==========================================

async function handleCoreModCommands(message, command, args) {
    if (command === 'unlock') {
        setTimeout(() => message.delete().catch(() => null), 200);
        if (!message.member.permissions.has(PermissionFlagsBits.ManageChannels)) {
            return message.channel.send({ embeds: [createPrefixEmbed('Error Status', "❌ You don't have permission to use this command.")] })
                .then(m => setTimeout(() => m.delete().catch(() => null), 5000));
        }
        await message.channel.permissionOverwrites.edit(message.guild.roles.everyone, { SendMessages: true });
        
        const logEmbed = createPrefixEmbed('Channel Restoration Complete', 'Standard interaction flows active again.', [
            { name: '🔓 Channel Context', value: message.channel.toString(), inline: true },
            { name: '🛡️ Responsible Exec', value: message.author.toString(), inline: true }
        ]);
        return message.channel.send({ embeds: [logEmbed] });
    }

    const manageMessagesPerm = message.member.permissions.has(PermissionFlagsBits.ManageMessages);
    const banPerm = message.member.permissions.has(PermissionFlagsBits.BanMembers);
    const manageRolesPerm = message.member.permissions.has(PermissionFlagsBits.ManageRoles);
    const moderateMembersPerm = message.member.permissions.has(PermissionFlagsBits.ModerateMembers);

    if (command === 'clear') {
        if (!manageMessagesPerm) return message.channel.send({ embeds: [createPrefixEmbed('Error Status', "❌ Permission denied.")] }).then(m => setTimeout(() => m.delete().catch(() => null), 5000));
        const amount = parseInt(args[0], 10);
        if (isNaN(amount) || amount < 1 || amount > 100) return message.channel.send({ embeds: [createPrefixEmbed('Warning', "⚠️ Please provide a number between 1 and 100.")] }).then(m => setTimeout(() => m.delete().catch(() => null), 5000));
        await message.channel.bulkDelete(amount + 1, true).catch(() => null);        const logEmbed = createPrefixEmbed('Bulk Clear Operation Executed', 'Message cleanup loop complete.', [
            { name: '🗑️ Cleared Count', value: amount + ' Messages', inline: true },
            { name: '🛡️ Responsible Exec', value: message.author.toString(), inline: true }
        ]);
        return message.channel.send({ embeds: [logEmbed] }).then(m => setTimeout(() => m.delete().catch(() => null), 4000));
    }

    if (command === 'roleadd') {
        setTimeout(() => message.delete().catch(() => null), 200);
        if (!manageRolesPerm) return message.channel.send({ embeds: [createPrefixEmbed('Error Status', "❌ You don't have permission to manage roles.")] }).then(m => setTimeout(() => m.delete().catch(() => null), 5000));
        const target = message.mentions.members.first();
        const role = message.mentions.roles.first();
        if (!target || !role) return message.channel.send({ embeds: [createPrefixEmbed('Warning', "⚠️ Usage: `?roleadd @member @role`")] }).then(m => setTimeout(() => m.delete().catch(() => null), 5000));
        try { 
            await target.roles.add(role); 
            const logEmbed = createPrefixEmbed('Role Assignment Successful', 'Role applied securely to the targeted member.', [
                { name: '👤 Target Member', value: target.toString(), inline: true },
                { name: '📌 Assigned Badge', value: role.toString(), inline: true },
                { name: '🛡️ Responsible Exec', value: message.author.toString(), inline: true }
            ]);
            return message.channel.send({ embeds: [logEmbed] });
        } catch (e) { 
            return message.channel.send({ embeds: [createPrefixEmbed('Error Status', "❌ Unable to add role. Check role hierarchy.")] }).then(m => setTimeout(() => m.delete().catch(() => null), 5000)); 
        }
    }
    
    handleAdvancedModCommands(message, command, args, banPerm, moderateMembersPerm);
}
// ==========================================
// PARTIE 7 : HISTORIQUES DES STRIKES ET PROTECTION UNWARN (SR. MOD +)
// ==========================================

async function handleAdvancedModCommands(message, command, args, banPerm, moderateMembersPerm) {
    if (command === 'unwarn') {
        setTimeout(() => message.delete().catch(() => null), 200);
        if (!banPerm) return message.channel.send({ embeds: [createPrefixEmbed('Error Status', "❌ Command locked to **Sr. Mod +** permissions.")] }).then(m => setTimeout(() => m.delete().catch(() => null), 5000));
        const target = message.mentions.members.first() || message.guild.members.cache.get(args[0]);
        if (!target) return message.channel.send({ embeds: [createPrefixEmbed('Error Status', "❌ Please mention a valid user or provide their ID.")] }).then(m => setTimeout(() => m.delete().catch(() => null), 5000));
        if (!warnDatabase[target.id] || warnDatabase[target.id].length === 0) { 
            return message.channel.send({ embeds: [createPrefixEmbed('Action Aborted', "✅ This member has no active warnings to remove.")] }); 
        }
        warnDatabase[target.id].pop();
        saveDatabase();
        
        const logEmbed = createPrefixEmbed('Infraction Warnings Reset', 'Cleared internal history violations for target profile.', [
            { name: '👤 Target Member', value: target.toString(), inline: true },
            { name: '🛡️ Responsible Exec', value: message.author.toString(), inline: true }
        ]);
        return message.channel.send({ embeds: [logEmbed] });
    }

    if (command === 'warn') {
        setTimeout(() => message.delete().catch(() => null), 200);
        if (!moderateMembersPerm) return message.channel.send({ embeds: [createPrefixEmbed('Error Status', "❌ Permission denied.")] }).then(m => setTimeout(() => m.delete().catch(() => null), 5000));
        const target = message.mentions.members.first() || message.guild.members.cache.get(args[0]);
        if (!target) return message.channel.send({ embeds: [createPrefixEmbed('Warning', "❌ Usage: `?warn @member [reason]`")] }).then(m => setTimeout(() => m.delete().catch(() => null), 5000));
        
        const reason = args.slice(1).join(' ') || "No reason provided";
        if (!warnDatabase[target.id]) warnDatabase[target.id] = [];
        
        warnDatabase[target.id].push({
            reason: reason,
            moderator: message.author.tag,
            date: new Date().toLocaleDateString('fr-FR')
        });
        saveDatabase();

        const logEmbed = createPrefixEmbed('Member Warned Successfully', 'Violation recorded in database ledger.', [
            { name: '👤 Target Member', value: target.toString(), inline: true },
            { name: '📄 Infraction Reason', value: reason, inline: false },
            { name: '🛡️ Issuing Exec', value: message.author.toString(), inline: true }
        ]);
        return message.channel.send({ embeds: [logEmbed] });
    }

    handleTimeAndBanCommands(message, command, args, banPerm, moderateMembersPerm);
}
// ==========================================
// PARTIE 8 : GESTION DU TIMEOUT STAFF ET LOCK DU BAN (SR. MOD +)
// ==========================================

async function handleTimeAndBanCommands(message, command, args, banPerm, moderateMembersPerm) {
    if (command === 'to' || command === 'rto') {
        setTimeout(() => message.delete().catch(() => null), 200);
        if (!moderateMembersPerm) {
            return message.channel.send({ embeds: [createPrefixEmbed('Error Status', "❌ Permission denied.")] }).then(m => setTimeout(() => m.delete().catch(() => null), 5000));
        }
        const target = message.mentions.members.first() || message.guild.members.cache.get(args[0]);
        if (!target) return message.channel.send({ embeds: [createPrefixEmbed('Warning', "❌ Please mention a valid member.")] }).then(m => setTimeout(() => m.delete().catch(() => null), 5000));

        if (command === 'rto') {
            try {
                await target.timeout(null);
                const logEmbed = createPrefixEmbed('Timeout Removal Completed', 'Voice and text restrictions revoked.', [
                    { name: '👤 Target Member', value: target.toString(), inline: true },
                    { name: '🛡️ Responsible Exec', value: message.author.toString(), inline: true }
                ]);
                return message.channel.send({ embeds: [logEmbed] });
            } catch (e) {
                return message.channel.send({ embeds: [createPrefixEmbed('Error Status', "❌ Could not remove timeout.")] });
            }
        }

        let timeArg = args[1]; 
        let durationMs = parseDuration(timeArg);
        let reason = durationMs ? args.slice(2).join(' ') : args.slice(1).join(' ') || "No reason provided";
        let finalDuration = durationMs || (60 * 1000);
        
        if (finalDuration > 28 * 24 * 60 * 60 * 1000) { 
            finalDuration = 28 * 24 * 60 * 60 * 1000; 
            timeArg = "28d (Discord Max)"; 
        }
        
        try {
            await target.timeout(finalDuration, reason);
            const logEmbed = createPrefixEmbed('Timeout Execution Completed', 'Action successfully authorized on target parameters.', [
                { name: '👤 Target Member', value: target.toString(), inline: true },
                { name: '⏱️ Total Duration', value: (timeArg || '1m'), inline: true },
                { name: '📄 Stated Reason', value: reason, inline: false },
                { name: '🛡️ Responsible Exec', value: message.author.toString(), inline: true }
            ]);
            return message.channel.send({ embeds: [logEmbed] });
        } catch (err) {
            return message.channel.send({ embeds: [createPrefixEmbed('Error Status', "❌ Unable to target this user. Verify hierarchical permissions.")] });
        }
    }

    if (command === 'ban') {
        setTimeout(() => message.delete().catch(() => null), 200);
        if (!banPerm) return message.channel.send({ embeds: [createPrefixEmbed('Error Status', "❌ Command locked to **Sr. Mod +** permissions.")] }).then(m => setTimeout(() => m.delete().catch(() => null), 5000));
        const target = message.mentions.members.first() || message.guild.members.cache.get(args[0]);
        if (!target) return message.channel.send({ embeds: [createPrefixEmbed('Warning', "❌ Usage: `?ban @member [reason]`")] }).then(m => setTimeout(() => m.delete().catch(() => null), 5000));
        
        const reason = args.slice(1).join(' ') || "No reason provided";
        try {
            await target.ban({ reason: reason });
            const logEmbed = createPrefixEmbed('Banishment Sequence Executed', 'Profile permanently terminated from the server.', [
                { name: '👤 Target Entity', value: target.user.tag, inline: true },
                { name: '📄 Stated Reason', value: reason, inline: false },
                { name: '🛡️ Responsible Exec', value: message.author.toString(), inline: true }
            ]);
            return message.channel.send({ embeds: [logEmbed] });
        } catch (e) {
            return message.channel.send({ embeds: [createPrefixEmbed('Error Status', "❌ Failed to ban. Hierarchical restriction.")] });
        }
    }

    if (command === 'unban') {
        setTimeout(() => message.delete().catch(() => null), 200);
        if (!banPerm) return message.channel.send({ embeds: [createPrefixEmbed('Error Status', "❌ Command locked to **Sr. Mod +** permissions.")] }).then(m => setTimeout(() => m.delete().catch(() => null), 5000));
        const targetId = args[0];
        if (!targetId) return message.channel.send({ embeds: [createPrefixEmbed('Warning', "❌ Usage: `?unban [User_ID]`")] }).then(m => setTimeout(() => m.delete().catch(() => null), 5000));
        
        try {
            await message.guild.members.unban(targetId);
            const logEmbed = createPrefixEmbed('Banishment Revoked', 'Identity cleared for server re-entry.', [
                { name: '🆔 Cleared ID', value: targetId, inline: true },
                { name: '🛡️ Responsible Exec', value: message.author.toString(), inline: true }
            ]);
            return message.channel.send({ embeds: [logEmbed] });
        } catch (e) {
            return message.channel.send({ embeds: [createPrefixEmbed('Error Status', "❌ Invalid User ID or entity not banned.")] });
        }
    }
}
// ==========================================
// PARTIE 9 : INTERACTIONCREATE ET FILTRE SÉCURITÉ DE LA COMMANDE RENAME UNIVERSELLE
// ==========================================

client.on('interactionCreate', async (interaction) => {
    if (interaction.isChatInputCommand() && ['gcreate', 'gend', 'greroll'].includes(interaction.commandName)) {
        if (!interaction.member.permissions.has(PermissionFlagsBits.ModerateMembers)) {
            return interaction.reply({ content: "❌ You must be a **Staff Member** (with Timeout permissions) to manage giveaways.", ephemeral: true });
        }
    }

    if (interaction.isChatInputCommand() && ['gwblacklist', 'gwunblacklist', 'statsreset', 'ticketpanel'].includes(interaction.commandName)) {
        if (!interaction.member.permissions.has(PermissionFlagsBits.Administrator)) {
            return interaction.reply({ content: "❌ This command is strictly restricted to **Server Administrators**.", ephemeral: true });
        }
    }

    if (interaction.isStringSelectMenu() && interaction.customId === 'select_waffel_mode') {
        if (!interaction.member.permissions.has(PermissionFlagsBits.ModerateMembers)) {
            return interaction.reply({ content: "❌ You don't have Staff permissions to interact with this setup menu.", ephemeral: true });
        }
    }

    if (interaction.isModalSubmit() && interaction.customId.startsWith('modal_waffel_')) {
        if (!interaction.member.permissions.has(PermissionFlagsBits.ModerateMembers)) {
            return interaction.reply({ content: "❌ Permission denied. This action is restricted to Staff.", ephemeral: true });
        }
    }

    if (interaction.isChatInputCommand()) {
        const targetUser = interaction.options.getUser('target') || interaction.user;

        // Commande /rename universelle modifiable à l'infini partout sur le serveur
        if (interaction.commandName === 'rename') {
            const member = interaction.member;
            const isStaff = member.roles && member.roles.cache && member.roles.cache.has(SECURE_STAFF_ROLE_ID);
            const isAdmin = member.permissions && member.permissions.has(PermissionFlagsBits.Administrator);

            if (!isStaff && !isAdmin) {
                return interaction.reply({ content: '❌ Only authenticated operational staff can perform configuration renames.', ephemeral: true });
            }
            
            const channel = interaction.channel;
            if (!channel || !channel.isTextBased()) {
                return interaction.reply({ content: '❌ This command only works in a valid text channel.', ephemeral: true });
            }

            const newNameRaw = interaction.options.getString('name', true);
            const newName = ensureTicketChannelName(newNameRaw);
            if (!newName) {
                return interaction.reply({ content: '❌ Invalid channel name format.', ephemeral: true });
            }

            try {
                await channel.setName(newName);
                return interaction.reply({ content: `✅ Successfully changed channel identity state to: **${newName}**`, ephemeral: true });
            } catch (err) {
                console.error('Failed to rename channel:', err);
                if (err.code === 50035 || err.message.toLowerCase().includes('rate limit')) {
                    return interaction.reply({
                        content: '⚠️ **Discord Rate Limit !** Vous renommez ce salon trop vite. Veuillez patienter 5 à 10 minutes avant de pouvoir changer son nom à nouveau.',
                        ephemeral: true
                    });
                }
                return interaction.reply({ content: '❌ Failed to rename channel. Verify bot permissions (Manage Channels).', ephemeral: true });
            }
        }

        if (interaction.commandName === 'stats') {
            initStats(targetUser.id);
            const userStats = statsDatabase[targetUser.id];
            const winRate = userStats.entered > 0 ? ((userStats.won / userStats.entered) * 100).toFixed(1) : '0.0';

            const statsEmbed = new EmbedBuilder()
                .setTitle("📊 Giveaway Statistics - " + targetUser.username)
                .setColor('#F1C40F')
                .setThumbnail(targetUser.displayAvatarURL())
                .addFields(
                    { name: '📥 Giveaways Entered', value: "`" + userStats.entered + "` times", inline: true },
                    { name: '🏆 Giveaways Won', value: "`" + userStats.won + "` times", inline: true },
                    { name: '📈 Win Rate Percentage', value: "`" + winRate + "%`" }
                )
                .setFooter({ text: "Waffel's Analytical System" })
                .setTimestamp();

            return interaction.reply({ embeds: [statsEmbed] });
        }
        
        handleUtilitySlashCommands(interaction, targetUser);
    }
    
    handleComponentInteractions(interaction);
});
// ==========================================
// PARTIE 10 : COMMANDE UNIFIÉE /TICKETPANEL ET INTÉGRATION DE VOTRE IMAGE GLISSÉE-DÉPOSÉE
// ==========================================

async function handleUtilitySlashCommands(interaction, targetUser) {
    if (interaction.commandName === 'ticketpanel') {
        const title = interaction.options.getString('title', true);
        const descRaw = interaction.options.getString('description', true);
        const desc = descRaw.replace(/\\n/g, '\n'); 
        const imageAttachment = interaction.options.getAttachment('image');

        // Sécurité Anti-Crash Image : Utilisation de l'image glissée-déposée, sinon image transparente invisible par défaut
        let imgUrl = imageAttachment ? imageAttachment.url : "https://imgur.com";

        ticketPanelsDatabase[interaction.guild.id] = { title, desc, image: imgUrl };
        saveDatabase();

        const menu = new StringSelectMenuBuilder().setCustomId('select_ticket_topic').setPlaceholder('Select a topic to open a ticket...')
            .addOptions(
                new StringSelectMenuOptionBuilder().setLabel('Giveaway Claim').setValue('claim').setDescription('Open a channel to claim your reward').setEmoji('🎉'),                new StringSelectMenuOptionBuilder().setLabel('Buy/Sell Spawners').setValue('skelly').setDescription('Trade spawners with staff management').setEmoji('💀'),
                new StringSelectMenuOptionBuilder().setLabel('Support').setValue('support').setDescription('General inquiries and assistance').setEmoji('📩')
            );

        const embed = new EmbedBuilder()
            .setTitle(title)
            .setDescription(desc)
            .setImage(imgUrl)
            .setColor('#00FF66')
            .setFooter({ text: "Powered by Waffel Systems" });

        const row = new ActionRowBuilder().addComponents(menu);

        await interaction.channel.send({ embeds: [embed], components: [row] });
        return interaction.reply({ content: "✅ **Ticket Panel deployed successfully with your uploaded image!** Direct native system active.", ephemeral: true });
    }

    if (interaction.commandName === 'statsreset') {
        const target = interaction.options.getUser('target');
        statsDatabase[target.id] = { entered: 0, won: 0 };
        saveDatabase();

        const resetEmbed = new EmbedBuilder()
            .setTitle('🔄 Statistics Successfully Reset')
            .setColor('#E74C3C')
            .setDescription("All giveaway statistics for " + target.toString() + " have been completely wiped.")
            .setFooter({ text: "Waffel's Database Management" })
            .setTimestamp();

        return interaction.reply({ embeds: [resetEmbed] });
    }

    if (interaction.commandName === 'help') {
        const embed = new EmbedBuilder().setTitle('📋 Available Bot Commands Inventory').setColor('#F1C40F').setDescription('Here is a complete list of all features integrated:\n\n').addFields(
                { name: '✨ Slash Commands (/)', value: '`/ticketpanel` - Configures interactive panels with drag & drop image (Admin)\n`/close` - Closes active ticket channel\n`/help` - Displays this menu\n`/wjamal` - Sends frog GIF\n`/claimtime` - Displays rules\n`/userinfo` - Shows info\n`/serverinfo` - Displays server metrics\n`/avatar` - Avatar view\n`/infractions` - Warnings ledger\n`/gcreate` - Giveaway setup\n`/gend` - Force close\n`/greroll` - Re-roll winner\n`/gwblacklist` - Blacklist user\n`/gwunblacklist` - Unblacklist user\n`/stats` - Giveaway stats\n`/statsreset` - Wipe stats\n`/rename` - Renames channel' },
                { name: '🛠️ Prefix Commands (?)', value: '`?warn` - Warn user\n`?unwarn` - Pop warning (Sr. Mod +)\n`?to` - Timeout member\n`?rto` - Remove timeout\n`?ban` - Ban user (Sr. Mod +)\n`?unban` - Unban profile (Sr. Mod +)\n`?lock` - Lock channel\n`?unlock` - Unlock channel\n``?clear <count>` - Purge messages\n`?roleadd @user @role` - Add role' },
                { name: '🎉 Automation System (!)', value: '`!gstart <minutes> <prize>` - Instantly launches a classic giveaway.' }
            ).setFooter({ text: "Waffel's Giveaway Utility" });
        return interaction.reply({ embeds: [embed] });
    }

    handleRestOfUtilitySlashCommands(interaction, targetUser);
}
// ==========================================
// PARTIE 11 : REQUÊTES D'INFORMATIONS PUBLIQUES ET AFFICHAGE DES COMMANDES FUN
// ==========================================

async function handleRestOfUtilitySlashCommands(interaction, targetUser) {
    if (interaction.commandName === 'claimtime') {
        const embed = new EmbedBuilder().setTitle('🎉 Giveaway Info').setColor('#F1C40F').setDescription(
            "⏰ **Giveaway Claim Time**\n🏆 Quickdrops - 30 Minutes\n🎁 Weekly/Daily Giveaways - 24 hours\n🎉 Big Giveaways - 12 hours\n🏮 Stream Quickdrops - 3 Hours" 
        ).setTimestamp();
        return interaction.reply({ embeds: [embed] });
    }

    if (interaction.commandName === 'wjamal') {
        const embed = new EmbedBuilder().setTitle('🐸 W JAMAL').setColor('#2ECC71').setImage('https://giphy.com');
        return interaction.reply({ embeds: [embed] });
    }

    if (interaction.commandName === 'userinfo') {
        const embed = new EmbedBuilder().setTitle("👤 User Info - " + targetUser.tag).setColor('#F1C40F').setThumbnail(targetUser.displayAvatarURL())
            .addFields({ name: '🆔 User ID', value: targetUser.id, inline: true }, { name: '📅 Created Account', value: "<t:" + Math.floor(targetUser.createdTimestamp / 1000) + ":R>", inline: true }, { name: '🤖 Bot?', value: targetUser.bot ? 'Yes' : 'No', inline: true });
        return interaction.reply({ embeds: [embed] });
    }

    if (interaction.commandName === 'serverinfo') {
        const embed = new EmbedBuilder().setTitle("📊 Server Info - " + interaction.guild.name).setColor('#F1C40F').setThumbnail(interaction.guild.iconURL())
            .addFields({ name: '👑 Owner', value: "<@" + interaction.guild.ownerId + ">", inline: true }, { name: '👥 Total Members', value: "" + interaction.guild.memberCount, inline: true }, { name: '📁 Channel Count', value: "" + interaction.guild.channels.cache.size, inline: true });
        return interaction.reply({ embeds: [embed] });
    }

    if (interaction.commandName === 'avatar') {
        const embed = new EmbedBuilder().setTitle("🖼️ Avatar of " + targetUser.tag).setColor('#F1C40F').setImage(targetUser.displayAvatarURL({ size: 1024 }));
        return interaction.reply({ embeds: [embed] });
    }

    if (interaction.commandName === 'infractions') {
        const warns = warnDatabase[targetUser.id] || [];
        const embed = new EmbedBuilder().setTitle("📜 Moderation History for " + targetUser.username).setColor(warns.length > 0 ? '#E74C3C' : '#2ECC71');
        if (warns.length === 0) { embed.setDescription("✅ This user has a perfectly clean record."); } 
        else { embed.setDescription("⚠️ Total Warnings: **" + warns.length + "**"); warns.forEach((warn, index) => { embed.addFields({ name: "Warning #" + (index + 1) + " (" + warn.date + ")", value: "**Reason:** " + warn.reason + "\n**Moderator:** " + warn.moderator }); }); }
        return interaction.reply({ embeds: [embed] });
    }

    if (interaction.commandName === 'faq') {
        const embed = new EmbedBuilder().setTitle('📖 FAQ').setColor('#F1C40F').setDescription('Q: How do I join?\nA: Follow server channels.\n\nQ: How do I claim rewards?\nA: Click claim and complete support forms.');
        return interaction.reply({ embeds: [embed] });
    }

    if (interaction.commandName === 'ticket') {
        return interaction.reply({ content: "❌ Command deprecated. Please use the server's newly deployed selection menu dropdown layout to open support tickets natively.", ephemeral: true });
    }

    handleGiveawayEngineSlashCommands(interaction);
}
// ==========================================
// PARTIE 12 : INTERCEPTION DE SÉLECTION DU MENU DÉROULANT ET QUESTIONNAIRES MULTI-CHAMPS
// ==========================================

async function handleComponentInteractions(interaction) {
    if (interaction.isStringSelectMenu() && interaction.customId === 'select_ticket_topic') {
        const topic = interaction.values[0];
        
        if (topic === 'claim') {
            const modal = new ModalBuilder().setCustomId('submit_ticket_channel_claim').setTitle('Giveaway Claim Verification');
            
            const q1 = new TextInputBuilder().setCustomId('claim_q1').setLabel("What's your Minecraft username?").setStyle(TextInputStyle.Short).setRequired(true);
            const q2 = new TextInputBuilder().setCustomId('claim_q2').setLabel("How Much Did You Win?").setStyle(TextInputStyle.Short).setPlaceholder("e.g., 15m").setRequired(true);
            const q3 = new TextInputBuilder().setCustomId('claim_q3').setLabel("Who hosted the giveaway?").setStyle(TextInputStyle.Short).setRequired(true);
            const q4 = new TextInputBuilder().setCustomId('claim_q4').setLabel("Type OK").setStyle(TextInputStyle.Short).setPlaceholder("Please send your proof in the ticket.").setRequired(true);

            modal.addComponents(new ActionRowBuilder().addComponents(q1), new ActionRowBuilder().addComponents(q2), new ActionRowBuilder().addComponents(q3), new ActionRowBuilder().addComponents(q4));
            return interaction.showModal(modal);
        }
        
        if (topic === 'skelly') {
            const modal = new ModalBuilder().setCustomId('submit_ticket_channel_skelly').setTitle('Spawner Trade Department');
            
            const q1 = new TextInputBuilder().setCustomId('skelly_q1').setLabel("What's your Minecraft username?").setStyle(TextInputStyle.Short).setRequired(true);
            const q2 = new TextInputBuilder().setCustomId('skelly_q2').setLabel("What type of spawner?").setStyle(TextInputStyle.Short).setPlaceholder("e.g., skellys").setRequired(true);
            const q3 = new TextInputBuilder().setCustomId('skelly_q3').setLabel("Are you buying or selling?").setStyle(TextInputStyle.Short).setPlaceholder("buying / selling").setRequired(true);
            const q4 = new TextInputBuilder().setCustomId('skelly_q4').setLabel("How many are you buying/selling?").setStyle(TextInputStyle.Short).setRequired(true);
            const q5 = new TextInputBuilder().setCustomId('skelly_q5').setLabel("Do you agree with our prices?").setStyle(TextInputStyle.Short).setValue("yes").setRequired(true);

            modal.addComponents(new ActionRowBuilder().addComponents(q1), new ActionRowBuilder().addComponents(q2), new ActionRowBuilder().addComponents(q3), new ActionRowBuilder().addComponents(q4), new ActionRowBuilder().addComponents(q5));
            return interaction.showModal(modal);
        }
        
        if (topic === 'support') {
            const modal = new ModalBuilder().setCustomId('submit_ticket_channel_support').setTitle('General Support Request');
            
            const q1 = new TextInputBuilder().setCustomId('support_q1').setLabel("How can we help you today?").setStyle(TextInputStyle.Paragraph).setPlaceholder("Describe your issue or question in detail...").setRequired(true);

            modal.addComponents(new ActionRowBuilder().addComponents(q1));
            return interaction.showModal(modal);
        }
    }
    
    handleGiveawaySetupComponentsAndClaims(interaction);
}
// ==========================================
// PARTIE 13 : CRÉATION DU TICKET AVEC AFFICHAGE DES RÉPONSES ET ROUTAGE DES PINGS CIBLÉS
// ==========================================

async function handleGiveawaySetupComponentsAndClaims(interaction) {
    if (interaction.isModalSubmit() && interaction.customId.startsWith('submit_ticket_channel_')) {
        const topic = interaction.customId.replace('submit_ticket_channel_', '');
        const guild = interaction.guild;

        await interaction.deferReply({ ephemeral: true });

        let roleToPing = ROLE_TICKET_TEAM; 
        let topicLabel = "Support";
        let fieldsLayout = [];

        if (topic === 'claim') {
            roleToPing = ROLE_TICKET_TEAM; topicLabel = "Giveaway-Claim";
            fieldsLayout = [
                { name: "What's your Minecraft username?", value: interaction.fields.getTextInputValue('claim_q1'), inline: false },
                { name: "How Much Did You Win?", value: interaction.fields.getTextInputValue('claim_q2'), inline: false },
                { name: "Who hosted the giveaway?", value: interaction.fields.getTextInputValue('claim_q3'), inline: false },
                { name: "Confirmation", value: interaction.fields.getTextInputValue('claim_q4'), inline: false }
            ];
        } 
        else if (topic === 'skelly') {
            roleToPing = ROLE_SKELLY; topicLabel = "Skelly-Spawners";
            fieldsLayout = [
                { name: "What's your Minecraft username?", value: interaction.fields.getTextInputValue('skelly_q1'), inline: false },
                { name: "What type of spawner?", value: interaction.fields.getTextInputValue('skelly_q2'), inline: false },
                { name: "Are you buying or selling?", value: interaction.fields.getTextInputValue('skelly_q3'), inline: false },
                { name: "How many are you buying/selling?", value: interaction.fields.getTextInputValue('skelly_q4'), inline: false },
                { name: "Do you agree with our prices?", value: interaction.fields.getTextInputValue('skelly_q5'), inline: false }
            ];
        } 
        else if (topic === 'support') {
            roleToPing = ROLE_TICKET_TEAM; topicLabel = "General-Support";
            fieldsLayout = [
                { name: "Please describe your issue and wait for a response.", value: interaction.fields.getTextInputValue('support_q1'), inline: false }
            ];
        }

        try {
            const channel = await guild.channels.create({
                name: ensureTicketChannelName(`🎫-${topicLabel}-${interaction.user.username}`),
                type: ChannelType.GuildText,
                parent: SECURE_CATEGORY_ID,
                permissionOverwrites: [
                    { id: guild.roles.everyone.id, deny: [PermissionFlagsBits.ViewChannel] },
                    { id: interaction.user.id, allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages, PermissionFlagsBits.ReadMessageHistory, PermissionFlagsBits.AttachFiles] },
                    { id: SECURE_STAFF_ROLE_ID, allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages, PermissionFlagsBits.ReadMessageHistory] },
                    { id: ROLE_TICKET_TEAM, allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages, PermissionFlagsBits.ManageMessages] },
                    { id: ROLE_SKELLY, allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages] }
                ]
            });

            ticketData.set(channel.id, { ownerId: interaction.user.id, createdAt: Date.now() });

            const embed = new EmbedBuilder()
                .setTitle(`🎫 Department: ${topicLabel}`)
                .setDescription(`Welcome ${interaction.user.toString()}, our team has been notified. Please find your summary answers below:`)
                .setColor('#2F3136')
                .addFields(fieldsLayout)
                .setTimestamp()
                .setFooter({ text: "Powered by Waffel Systems" });

            const closeRow = new ActionRowBuilder().addComponents(
                new ButtonBuilder().setCustomId('close_giveaway_ticket').setLabel('Close Ticket 🔴').setStyle(ButtonStyle.Danger)
            );

            await channel.send({ content: `🔔 <@&${roleToPing}> | New custom ticket form submitted by ${interaction.user.toString()}`, embeds: [embed], components: [closeRow] });
            return interaction.editReply({ content: `✅ **Ticket created successfully!** Please go to your salon: ${channel.toString()}` });
        } catch (e) {
            console.error(e);
            return interaction.editReply({ content: "❌ **Configuration Error.** Impossible to generate the room channel. Check structural category parent permissions." });
        }
    }

    if (interaction.isStringSelectMenu() && interaction.customId === 'select_waffel_mode') {
        const mode = interaction.values[0]; 
        const modal = new ModalBuilder().setCustomId("modal_waffel_" + mode).setTitle("Setup: " + mode.toUpperCase());
        const pInput = new TextInputBuilder().setCustomId('input_prize').setLabel("Prize:").setStyle(TextInputStyle.Short).setRequired(true);
        const dInput = new TextInputBuilder().setCustomId('input_duration').setLabel("Duration (e.g. 5h, 10m):").setStyle(TextInputStyle.Short).setRequired(true);
        const wInput = new TextInputBuilder().setCustomId('input_winners').setLabel("Winners count:").setStyle(TextInputStyle.Short).setValue("1").setRequired(true);
        const descInput = new TextInputBuilder().setCustomId('input_description').setLabel("Optional Title:").setStyle(TextInputStyle.Paragraph).setRequired(false);
        
        modal.addComponents(new ActionRowBuilder().addComponents(pInput), new ActionRowBuilder().addComponents(dInput), new ActionRowBuilder().addComponents(wInput), new ActionRowBuilder().addComponents(descInput));
        await interaction.showModal(modal);
    }

    if (interaction.isModalSubmit() && interaction.customId.startsWith('modal_waffel_')) {
        const mode = interaction.customId.replace('modal_waffel_', '');
        let prize = interaction.fields.getTextInputValue('input_prize').replace(/\bwaffle\b/gi, '🧇');
        const durationStr = interaction.fields.getTextInputValue('input_duration');
        const descriptionOpt = interaction.fields.getTextInputValue('input_description') || null;
        let winners = parseInt(interaction.fields.getTextInputValue('input_winners'), 10) || 1;

        const durationMs = parseDuration(durationStr);
        if (!durationMs || durationMs <= 0) return interaction.reply({ content: "❌ Invalid duration format!", ephemeral: true });
        
        await interaction.reply({ content: "✅ Giveaway created!", ephemeral: true });
        startGiveawayEngine(interaction.channel, durationMs, prize, winners, mode, descriptionOpt, interaction.user);
    }

    handleOriginalGiveawayLogicProcessing(interaction);
}
// ==========================================
// PARTIE 14.1 : SÉCURISATION DU ROUTAGE ANTI-CRASH ET GESTIONNAIRE DE BOUTONS
// ==========================================

async function handleOriginalGiveawayLogicProcessing(interaction) {
    if (interaction.isModalSubmit() && interaction.customId.startsWith('modal_claim_ticket_')) {
        const parts = interaction.customId.split('_');
        const winnerId = parts[3];
        const prize = Buffer.from(parts[4], 'base64').toString('utf8');
        const host = Buffer.from(parts[5], 'base64').toString('utf8');
        if (interaction.user.id !== winnerId) return interaction.reply({ content: '❌ This claim form belongs to another winner.', ephemeral: true });
        await interaction.deferReply({ ephemeral: true });
        try {
            const channel = await interaction.guild.channels.create({
                name: ensureTicketChannelName(`claim-${interaction.user.username}`), type: ChannelType.GuildText, parent: SECURE_CATEGORY_ID,
                permissionOverwrites: [
                    { id: interaction.guild.roles.everyone.id, deny: [PermissionFlagsBits.ViewChannel] },
                    { id: interaction.user.id, allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages, PermissionFlagsBits.ReadMessageHistory, PermissionFlagsBits.AttachFiles] },
                    { id: SECURE_STAFF_ROLE_ID, allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages, PermissionFlagsBits.ReadMessageHistory] },
                    { id: ROLE_TICKET_TEAM, allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages, PermissionFlagsBits.ReadMessageHistory] }
                ]
            });
            ticketData.set(channel.id, { ownerId: interaction.user.id, createdAt: Date.now() });
            const embed = new EmbedBuilder().setTitle('🎫 Giveaway Claim')
                .setDescription(`Winner: ${interaction.user}\nIGN: ${interaction.fields.getTextInputValue('claim_ign')}\nPrize: ${prize}\nHosted by: ${host}`).setColor('#F1C40F').setTimestamp();
            const closeRow = new ActionRowBuilder().addComponents(new ButtonBuilder().setCustomId('close_giveaway_ticket').setLabel('Close Ticket 🔴').setStyle(ButtonStyle.Danger));
            await channel.send({ content: `🔔 <@&${ROLE_TICKET_TEAM}> | Giveaway claim from ${interaction.user}`, embeds: [embed], components: [closeRow] });
            return interaction.editReply({ content: `✅ Claim ticket created: ${channel}` });
        } catch (error) {
            console.error('Could not create giveaway claim ticket:', error);
            return interaction.editReply({ content: '❌ Could not create the claim ticket. Check the ticket category and bot permissions.' });
        }
    }
    return handleButtonsEngineProcessing(interaction);
}async function handleButtonsEngineProcessing(interaction) {
    if (interaction.isButton() && interaction.customId.startsWith('claim_gw_')) {
        const parts = interaction.customId.split('_');
        const allowedWinnerId = parts[2]; 
        const rawPrizeB64 = parts[3]; 
        const rawHostB64 = parts[4];      
        if (interaction.user.id !== allowedWinnerId) return interaction.reply({ content: "❌ Access Denied.", ephemeral: true });

        const modal = new ModalBuilder().setCustomId("modal_claim_ticket_" + allowedWinnerId + "_" + rawPrizeB64 + "_" + rawHostB64).setTitle('Claim Reward Menu');
        const ignInput = new TextInputBuilder().setCustomId('claim_ign').setLabel("What is your IGN?").setStyle(TextInputStyle.Short).setRequired(true);
        modal.addComponents(new ActionRowBuilder().addComponents(ignInput));
        await interaction.showModal(modal);
    }

    if (interaction.isButton() && interaction.customId === 'close_giveaway_ticket') {
        const member = interaction.member;
        const isStaff = member.roles.cache.has(SECURE_STAFF_ROLE_ID) || member.roles.cache.has(ROLE_TICKET_TEAM) || member.permissions.has(PermissionFlagsBits.Administrator);
        if (!isStaff) return interaction.reply({ content: "❌ Staff access only.", ephemeral: true });
        
        await interaction.reply({ content: "🔒 Purging channel and removing ticket logs in 5 seconds..." });
        setTimeout(async () => { await interaction.channel.delete().catch(() => null); }, 5000);
        return;
    }
}

async function startGiveawayEngine(channel, durationMs, prize, winnerCount, mode, customTitle, hostUser) {
    const endTime = Date.now() + durationMs;
    const endTimeStamp = Math.floor(endTime / 1000);
    const title = customTitle ? " 🧇 " + customTitle + " 🧇 " : "✨ WAFFEL'S GIVEAWAY ✨";

    let description = "⏳ **Ends:** <t:" + endTimeStamp + ":R>\n👑 **Hosted by:** " + hostUser.toString() + "\n👥 **Entries:** **0**\n🏆 **Winners:** **" + winnerCount + "**\n🎁 **Prize:** **" + prize + "**";
    if (mode === 'clicker') description = "⚡ **CLICKER SPEED GAME** ⚡\n👑 **Hosted by:** " + hostUser.toString() + "\n🎁 **Prize:** **" + prize + "**\n\n🚨 FIRST click wins!";

    const embed = new EmbedBuilder().setTitle(title).setDescription(description).setColor('#F1C40F').setTimestamp();
    const btn = new ButtonBuilder().setCustomId('enter_giveaway').setLabel(mode === 'clicker' ? 'CLICK ME NOW! ⚡' : 'Join! 🎉').setStyle(mode === 'clicker' ? ButtonStyle.Success : ButtonStyle.Primary);
    const msg = await channel.send({ embeds: [embed], components: [new ActionRowBuilder().addComponents(btn)] });

    giveawaysDatabase[msg.id] = { channelId: channel.id, endTime: endTime, prize: prize, winnerCount: winnerCount, mode: mode, title: title, hostUser: hostUser.toString(), participants: [] };
    saveDatabase();
    resumeGiveawayCollector(channel, msg.id, durationMs);
}
// ==========================================
// PARTIE 14.2 : COLLECTEUR LIVE, BLOCAGE STAFF ET PROCÉDURE DE TIRAGE
// ==========================================

function resumeGiveawayCollector(channel, msgId, durationMs) {
    const collector = channel.createMessageComponentCollector({ filter: i => i.message.id === msgId, time: durationMs });

    collector.on('collect', async (btnInt) => {
        const gw = giveawaysDatabase[msgId]; if (!gw) return;

        if (btnInt.customId === 'enter_giveaway') {
            if (btnInt.member.permissions.has(PermissionFlagsBits.ModerateMembers) || btnInt.member.roles.cache.has(SECURE_STAFF_ROLE_ID)) {
                return btnInt.reply({ content: "❌ **Access Denied.** Staff members cannot participate in community giveaways.", ephemeral: true });
            }
            if (blacklistDatabase.has(btnInt.user.id)) return btnInt.reply({ content: "❌ Blacklisted.", ephemeral: true });

            if (gw.mode === 'clicker') {
                gw.participants.push(btnInt.user.id);
                initStats(btnInt.user.id); statsDatabase[btnInt.user.id].entered += 1; saveDatabase();
                await btnInt.reply({ content: "... Speed click recorded! Checking accuracy...", ephemeral: true });
                collector.stop();
            } else {
                if (gw.participants.includes(btnInt.user.id)) {
                    return btnInt.reply({ content: "⚠️ Already registered.", components: [new ActionRowBuilder().addComponents(new ButtonBuilder().setCustomId("leave_gw_" + btnInt.user.id).setLabel('Leave 🚨').setStyle(ButtonStyle.Danger))], ephemeral: true });
                }
                gw.participants.push(btnInt.user.id);
                initStats(btnInt.user.id); statsDatabase[btnInt.user.id].entered += 1; saveDatabase();

                const upEmbed = new EmbedBuilder().setTitle(gw.title).setColor('#F1C40F').setTimestamp()
                    .setDescription("⏳ **Ends:** <t:" + Math.floor(gw.endTime / 1000) + ":R>\n👑 **Hosted by:** " + gw.hostUser + "\n👥 **Entries:** **" + gw.participants.length + "**\n🏆 **Winners:** **" + gw.winnerCount + "**\n🎁 **Prize:** **" + gw.prize + "**");
                await btnInt.update({ embeds: [upEmbed] });
            }
        }
        handleLeaveActionCollector(btnInt, channel, msgId);
    });
    collector.on('end', () => { runGiveawayEnd(channel, msgId); });
}

async function handleLeaveActionCollector(btnInt, channel, msgId) {
    if (btnInt.customId.startsWith('leave_gw_')) {
        if (btnInt.user.id !== btnInt.customId.replace('leave_gw_', '')) return btnInt.reply({ content: "❌ Not your button.", ephemeral: true });
        const gw = giveawaysDatabase[msgId]; const idx = gw.participants.indexOf(btnInt.user.id);
        if (idx > -1) {
            gw.participants.splice(idx, 1);
            if (statsDatabase[btnInt.user.id] && statsDatabase[btnInt.user.id].entered > 0) statsDatabase[btnInt.user.id].entered -= 1;
            
            const upEmbed = new EmbedBuilder().setTitle(gw.title).setColor('#F1C40F').setTimestamp()
                .setDescription("⏳ **Ends:** <t:" + Math.floor(gw.endTime / 1000) + ":R>\n👑 **Hosted by:** " + gw.hostUser + "\n👥 **Entries:** **" + gw.participants.length + "**\n🏆 **Winners:** **" + gw.winnerCount + "**\n🎁 **Prize:** **" + gw.prize + "**");
            
            const originalMsg = await channel.messages.fetch(msgId).catch(() => null);
            if (originalMsg) await originalMsg.edit({ embeds: [upEmbed] });
            await btnInt.update({ content: "👋 Successfully left.", components: [] }); saveDatabase();
        }
    }
}

async function runGiveawayEnd(channel, msgId) {
    const gw = giveawaysDatabase[msgId]; if (!gw) return;
    delete giveawaysDatabase[msgId]; saveDatabase();

    const endMsg = await channel.messages.fetch(msgId).catch(() => null);
    if (endMsg) await endMsg.edit({ components: [new ActionRowBuilder().addComponents(new ButtonBuilder().setCustomId('ended').setDisabled(true).setLabel('Giveaway Closed 🔒').setStyle(ButtonStyle.Secondary))] }).catch(() => null);

    if (gw.participants.length === 0) {
        if (endMsg) await endMsg.edit({ embeds: [new EmbedBuilder().setTitle(gw.title).setDescription("🎉 GIVEAWAY ENDED!\n👑 Winner(s): No participants\n👑 Hosted by: " + gw.hostUser + "\n🎁 Each winner gets: " + gw.prize).setColor('#2ECC71')] });
        return;
    }

    const rawPrizeB64 = Buffer.from(gw.prize).toString('base64');
    const rawHostB64 = Buffer.from(gw.hostUser).toString('base64');

    if (gw.mode === 'clicker') {
        const wId = gw.participants[0]; initStats(wId); statsDatabase[wId].won += 1; saveDatabase();
        const claim = new ButtonBuilder().setCustomId("claim_gw_" + wId + "_" + rawPrizeB64 + "_" + rawHostB64).setLabel('Claim 🟢').setStyle(ButtonStyle.Success);
        if (endMsg) await endMsg.edit({ embeds: [new EmbedBuilder().setTitle(gw.title).setDescription("🎉 GIVEAWAY ENDED!\n👑 Winner(s): <@" + wId + ">\n👑 Hosted by: " + gw.hostUser + "\n🎁 Each winner gets: " + gw.prize).setColor('#2ECC71')] });
        await channel.send({ content: "⚡ 🧇 **WAFFLE CLICKER WINNER!** Congratulations <@" + wId + ">!", components: [new ActionRowBuilder().addComponents(claim)] });
        return;
    }

    const winners = gw.participants.sort(() => 0.5 - Math.random()).slice(0, gw.winnerCount);
    const mentions = winners.map(id => "<@" + id + ">").join(', ');

    if (endMsg) await endMsg.edit({ embeds: [new EmbedBuilder().setTitle(gw.title).setDescription("🎉 GIVEAWAY ENDED!\n👑 Winner(s): " + mentions + "\n👑 Hosted by: " + gw.hostUser + "\n🎁 Each winner gets: " + gw.prize).setColor('#2ECC71')] });

    if (gw.mode === 'normal') {
        winners.forEach(id => {
            initStats(id);
            statsDatabase[id].won += 1;
        });
        saveDatabase();

        for (const winnerId of winners) {
            const claim = new ButtonBuilder()
                .setCustomId("claim_gw_" + winnerId + "_" + rawPrizeB64 + "_" + rawHostB64)
                .setLabel('Claim 🟢')
                .setStyle(ButtonStyle.Success);

            await channel.send({
                content: "🎉 **CONGRATULATIONS** <@" + winnerId + ">! You won **" + gw.prize + "**!",
                components: [new ActionRowBuilder().addComponents(claim)]
            });
        }
    }
    handleMiniGamesArbitration(channel, winners, gw.prize, gw.winnerCount, gw.mode, gw.hostUser, rawPrizeB64, rawHostB64);
}
// ==========================================
// PARTIE 14.31 : DUELS COMPÉTITIFS ET LOGIQUE DU DOUBLE OR KEEP
// ==========================================

async function handleMiniGamesArbitration(channel, winners, prize, winnerCount, mode, originHost, rawPrizeB64, rawHostB64) {
    if (mode === 'clicker' || mode === 'normal') return;
    const claimBtn = new ButtonBuilder().setLabel('Claim 🟢').setStyle(ButtonStyle.Success);

    if (mode === 'dok') {
        const wId = winners[0]; 
        const gameMsg = await channel.send({ content: "📢 <@" + wId + ">, choose: **Double** or **Keep**? 🧇", components: [new ActionRowBuilder().addComponents(new ButtonBuilder().setCustomId('dok_double').setLabel('Double 🟢').setStyle(ButtonStyle.Success), new ButtonBuilder().setCustomId('dok_keep').setLabel('Keep 🔴').setStyle(ButtonStyle.Danger))] });
        const gameColl = gameMsg.createMessageComponentCollector({ componentType: ComponentType.Button, time: 30000 });
        
        gameColl.on('collect', async (gInt) => {
            if (gInt.user.id !== wId) return gInt.reply({ content: "❌ Winner only.", ephemeral: true });
            gameColl.stop();
            if (gInt.customId === 'dok_keep') {
                initStats(wId); statsDatabase[wId].won += 1; saveDatabase();
                await gInt.reply({ content: "🔒 Kept **" + prize + "**!", components: [new ActionRowBuilder().addComponents(claimBtn.setCustomId("claim_gw_" + wId + "_" + rawPrizeB64 + "_" + rawHostB64))] });
            } else {
                let nPrize = prize; const match = prize.match(/\d+/);
                if (match) { const oldN = parseInt(match[0], 10); nPrize = prize.replace(oldN, oldN * 2); } else { nPrize = "2x " + prize; }
                await gInt.reply("🟢 **DOUBLE!** New reward: **" + nPrize + "**! Re-rolling in 5s...");
                setTimeout(() => startGiveawayEngine(channel, 15000, nPrize, winnerCount, 'dok', "DOUBLE OR KEEP", gInt.user), 5000);
            }
        });
    }
    handleAdvancedMiniGamesArbitration(channel, winners, prize, rawPrizeB64, rawHostB64, mode, claimBtn);
}
// ==========================================
// PARTIE 14.32 : LOGIQUE DE DUEL SOS / RPS, SLASH GIVEAWAYS ET AUTHENTIFICATION CLIENT
// ==========================================

async function handleAdvancedMiniGamesArbitration(channel, winners, prize, rawPrizeB64, rawHostB64, mode, claimBtn) {
    if (mode === 'sos' && winners.length >= 2) {
        const p1 = winners[0]; const p2 = winners[1];
        const sosMsg = await channel.send({ content: "⚔️ <@" + p1 + "> vs <@" + p2 + ">! **Split** 🟢 or **Steal** 🔴!", components: [new ActionRowBuilder().addComponents(new ButtonBuilder().setCustomId('sos_split').setLabel('Split').setStyle(ButtonStyle.Success), new ButtonBuilder().setCustomId('sos_steal').setLabel('Steal').setStyle(ButtonStyle.Danger))] });
        const choices = {}; const sosColl = sosMsg.createMessageComponentCollector({ componentType: ComponentType.Button, time: 30000 });

        sosColl.on('collect', async (sInt) => {
            if (sInt.user.id !== p1 && sInt.user.id !== p2) return sInt.reply({ content: "❌ Not a winner.", ephemeral: true });
            if (choices[sInt.user.id]) return sInt.reply({ content: "⚠️ Locked.", ephemeral: true });
            choices[sInt.user.id] = sInt.customId.replace('sos_', ''); await sInt.reply({ content: "✅ Logged.", ephemeral: true });

            if (choices[p1] && choices[p2]) {
                sosColl.stop();
                if (choices[p1] === 'split' && choices[p2] === 'split') {
                    initStats(p1); statsDatabase[p1].won += 1; initStats(p2); statsDatabase[p2].won += 1;
                    await channel.send({ content: "🤝 **SPLIT!** Shared: " + prize, components: [new ActionRowBuilder().addComponents(claimBtn.setCustomId("claim_gw_" + p1 + "_" + rawPrizeB64 + "_" + rawHostB64))] });
                } else if (choices[p1] === 'steal' && choices[p2] === 'steal') { await channel.send("💀 **BOTH STOLE!** No winners."); }
                else { const thief = choices[p1] === 'steal' ? p1 : p2; initStats(thief); statsDatabase[thief].won += 1; await channel.send({ content: "😈 **BETRAYAL!** <@" + thief + "> won everything!", components: [new ActionRowBuilder().addComponents(claimBtn.setCustomId("claim_gw_" + thief + "_" + rawPrizeB64 + "_" + rawHostB64))] }); }
                saveDatabase();
            }
        });
    }

    if (mode === 'rps' && winners.length >= 2) {
        const p1 = winners[0]; const p2 = winners[1];
        const rpsMsg = await channel.send({ content: "🪨📄✂️ <@" + p1 + "> vs <@" + p2 + ">! Battle:", components: [new ActionRowBuilder().addComponents(new ButtonBuilder().setCustomId('rps_rock').setLabel('🪨 Rock').setStyle(ButtonStyle.Secondary), new ButtonBuilder().setCustomId('rps_paper').setLabel('📄 Paper').setStyle(ButtonStyle.Primary), new ButtonBuilder().setCustomId('rps_scissors').setLabel('✂️ Scissors').setStyle(ButtonStyle.Danger))] });
        const rpsChoices = {}; const rpsColl = rpsMsg.createMessageComponentCollector({ componentType: ComponentType.Button, time: 45000 });

        rpsColl.on('collect', async (rInt) => {
            if (rInt.user.id !== p1 && rInt.user.id !== p2) return rInt.reply({ content: "❌ Battle locked.", ephemeral: true });
            if (rpsChoices[rInt.user.id]) return rInt.reply({ content: "⚠️ Locked.", ephemeral: true });
            rpsChoices[rInt.user.id] = rInt.customId.replace('rps_', ''); await rInt.reply({ content: "🔮 Choice locked.", ephemeral: true });

            if (rpsChoices[p1] && rpsChoices[p2]) {
                rpsColl.stop();
                const c1 = rpsChoices[p1]; const c2 = rpsChoices[p2];
                if (c1 === c2) { await channel.send("🤝 **DRAW!** Tie battle!"); }
                else if ((c1 === 'rock' && c2 === 'scissors') || (c1 === 'paper' && c2 === 'rock') || (c1 === 'scissors' && c2 === 'paper')) { initStats(p1); statsDatabase[p1].won += 1; await channel.send({ content: "👑 **VICTORY!** <@" + p1 + "> won!", components: [new ActionRowBuilder().addComponents(claimBtn.setCustomId("claim_gw_" + p1 + "_" + rawPrizeB64 + "_" + rawHostB64))] }); }
                else { initStats(p2); statsDatabase[p2].won += 1; await channel.send({ content: "👑 **VICTORY!** <@" + p2 + "> won!", components: [new ActionRowBuilder().addComponents(claimBtn.setCustomId("claim_gw_" + p2 + "_" + rawPrizeB64 + "_" + rawHostB64))] }); }
                saveDatabase();
            }
        });
    }
}

async function handleGiveawayEngineSlashCommands(interaction) {
    if (interaction.commandName === 'gcreate') {
        const menu = new StringSelectMenuBuilder().setCustomId('select_waffel_mode').setPlaceholder('🎯 Choose a Giveaway Game Mode...')
            .addOptions(
                new StringSelectMenuOptionBuilder().setLabel('Normal Mode').setValue('normal').setEmoji('🎉'),
                new StringSelectMenuOptionBuilder().setLabel('Waffle Clicker').setValue('clicker').setEmoji('⚡'),
                new StringSelectMenuOptionBuilder().setLabel('Double Or Keep (DoK)').setValue('dok').setEmoji('🟢'),
                new StringSelectMenuOptionBuilder().setLabel('Split Or Steal (SoS)').setValue('sos').setEmoji('⚔️'),
                new StringSelectMenuOptionBuilder().setLabel('Rock Paper Scissors (RPS)').setValue('rps').setEmoji('🪨')
            );
        const row = new ActionRowBuilder().addComponents(menu);
        const embed = new EmbedBuilder().setTitle("🧇 Waffel's Giveaway Setup Menu").setDescription('Please select a game mode below.').setColor('#F1C40F');
        return interaction.reply({ embeds: [embed], components: [row], ephemeral: true });
    }

    if (interaction.commandName === 'gend') {
        const msgId = interaction.options.getString('message_id');
        if (giveawaysDatabase[msgId]) {
            await interaction.reply({ content: "🔒 Ending early...", ephemeral: true });
            runGiveawayEnd(interaction.channel, msgId);
        } else { return interaction.reply({ content: "❌ Not found.", ephemeral: true }); }
        return;
    }

    if (interaction.commandName === 'greroll') {
        const msgId = interaction.options.getString('message_id');
        const targetMsg = await interaction.channel.messages.fetch(msgId).catch(() => null);
        if (!targetMsg || targetMsg.embeds.length === 0) return interaction.reply({ content: "❌ Invalid message.", ephemeral: true });
        const originalEmbed = targetMsg.embeds[0];
        const prizeMatch = originalEmbed.description ? originalEmbed.description.match(/🎁 \*\*Prize:\*\* (.+)/) : null;
        let prize = prizeMatch ? prizeMatch[1] : "Unknown Prize";

        let eligiblePool = [];
        if (giveawaysDatabase[msgId] && giveawaysDatabase[msgId].participants.length > 0) {
            eligiblePool = giveawaysDatabase[msgId].participants.filter(id => !blacklistDatabase.has(id));
        } else {
            const allMembers = await interaction.guild.members.fetch();
            eligiblePool = allMembers.filter(m => !m.user.bot && !blacklistDatabase.has(m.id)).map(m => m.id);
        }

        if (eligiblePool.length === 0) return interaction.reply({ content: "❌ No eligible members found.", ephemeral: true });
        const luckyId = eligiblePool[Math.floor(Math.random() * eligiblePool.length)];
        const randomMember = await interaction.guild.members.fetch(luckyId);

        await interaction.reply({ content: "🎲 **Rerolling...**", ephemeral: true });
        const hostMatch = originalEmbed.description ? originalEmbed.description.match(/👑 \*\*Hosted by:\*\* (<@!?\d+>)/) : null;
        const cleanHost = hostMatch ? hostMatch[1] : interaction.user.toString();

        const claimBtn = new ButtonBuilder().setCustomId("claim_gw_" + randomMember.id + "_" + Buffer.from(prize).toString('base64') + "_" + Buffer.from(cleanHost).toString('base64')).setLabel('Claim 🟢').setStyle(ButtonStyle.Success);
        
        initStats(randomMember.id); statsDatabase[randomMember.id].won += 1; saveDatabase();
        await interaction.channel.send({ content: "🎲 **NEW REROLL WINNER!** Congratulations " + randomMember.toString() + ", you won **" + prize + "**!", components: [new ActionRowBuilder().addComponents(claimBtn)] });
        return;
    }

    if (interaction.commandName === 'close') { return processTicketClosure(interaction); }
    handleAdminBlacklistSlashCommands(interaction);
}

// Lancement final sécurisé
if (!process.env.DISCORD_TOKEN) { console.error('❌ Missing DISCORD_TOKEN.'); process.exit(1); }
client.login(process.env.DISCORD_TOKEN).catch(e => console.error(e));
