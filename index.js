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

// Configurations globales et sécurités
const SECURE_CATEGORY_ID = process.env.TICKET_CATEGORY_ID || "1443450226647240796"; 
const SECURE_STAFF_ROLE_ID = process.env.SECURE_STAFF_ROLE_ID || "1423749610395930707";   
const GUILD_ID = process.env.GUILD_ID || null;

let warnDatabase = {};
let blacklistDatabase = new Set();
let statsDatabase = {};
let giveawaysDatabase = {}; 
const ticketData = new Map();

// 💾 CHARGEMENT DE LA BASE DE DONNÉES JSON
try {
  if (fs.existsSync(DATA_FILE)) {
    const rawData = fs.readFileSync(DATA_FILE, 'utf8');
    const parsed = JSON.parse(rawData);
    warnDatabase = parsed.warns || {};
    statsDatabase = parsed.stats || {};
    giveawaysDatabase = parsed.giveaways || {};
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
// ==========================================
// PARTIE 2 : INITIALISATION DU CLIENT ET DE L'HEBERGEMENT WEB
// ==========================================

const client = new Client({ 
  intents: [
    GatewayIntentBits.Guilds, 
    GatewayIntentBits.GuildMessages, 
    GatewayIntentBits.MessageContent, 
    GatewayIntentBits.GuildMembers,
    GatewayIntentBits.GuildMessageReactions
  ] 
});

// 🌐 SERVEUR HTTP WEB (EXPRESS KEEPALIVE)
app.get('/', (req, res) => {
  res.send("Waffel's Engine is awake and running 24/7!");
});

app.get('/health', (req, res) => {
  res.json({ status: 'ok', bot: client.user ? client.user.tag : null });
});

app.listen(port, '0.0.0.0', () => {
  console.log(`🌐 HTTP KeepAlive Server running on port ${port}`);
});
// ==========================================
// PARTIE 3 : DECLARATION ET RECHARGEMENT DES COMMANDES SLASH
// ==========================================

const commands = [
  new SlashCommandBuilder().setName('ticket').setDescription('Open a support ticket'),
  new SlashCommandBuilder().setName('close').setDescription('Close the current ticket'),
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
    .addStringOption(option => option.setName('name').setDescription('New channel name strip').setRequired(true))
].map(cmd => cmd.toJSON());

client.once('ready', async () => {
  console.log("✨ Waffel's Complete Bot is logged in as " + client.user.tag + "!");
  const rest = new REST({ version: '10' }).setToken(process.env.DISCORD_TOKEN);
  try {
    if (GUILD_ID) {
      await rest.put(Routes.applicationGuildCommands(client.user.id, GUILD_ID), { body: commands });
      console.log('✅ Application (/) commands loaded for the designated Guild.');
    } else {
      await rest.put(Routes.applicationCommands(client.user.id), { body: commands });
      console.log('✅ Application (/) commands loaded globally.');
    }
  } catch (error) { 
    console.error(error); 
  }

  // Relance les giveaways restants actifs dans la base de données
  for (const msgId in giveawaysDatabase) {
    const gw = giveawaysDatabase[msgId];
    const timeLeft = gw.endTime - Date.now();
    const channel = await client.channels.fetch(gw.channelId).catch(() => null);
    
    if (!channel) {
      delete giveawaysDatabase[msgId];
      saveDatabase();
      continue;
    }

    if (timeLeft <= 0) {
      runGiveawayEnd(channel, msgId);
    } else {
      resumeGiveawayCollector(channel, msgId, timeLeft);
    }
  }
});
// ==========================================
// PARTIE 4.1 : INTERCEPTION DES MESSAGES, PING ET GSTART REPOIS
// ==========================================

client.on('messageCreate', async (message) => {
    if (!message.guild || message.author.bot) return;

    // Commande rapide de ping
    if (message.content === '!ping') {
        return message.reply('Pong!');
    }

    // Lancement instantané de giveaway classique via message textuel
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

    // Verrouillage de salon public (?lock)
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
// PARTIE 4.2 : ROUTINES DE MODÉRATION STANDARDS (?unlock, ?clear, ?roleadd, ?unwarn)
// ==========================================

async function handleCoreModCommands(message, command, args) {
    // Déverrouillage de salon public (?unlock)
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

    // Nettoyage de messages (?clear)
    if (command === 'clear') {
        if (!manageMessagesPerm) return message.channel.send({ embeds: [createPrefixEmbed('Error Status', "❌ Permission denied.")] }).then(m => setTimeout(() => m.delete().catch(() => null), 5000));
        const amount = parseInt(args[0], 10);
        if (isNaN(amount) || amount < 1 || amount > 100) return message.channel.send({ embeds: [createPrefixEmbed('Warning', "⚠️ Please provide a number between 1 and 100.")] }).then(m => setTimeout(() => m.delete().catch(() => null), 5000));
        await message.channel.bulkDelete(amount + 1, true).catch(() => null);
        
        const logEmbed = createPrefixEmbed('Bulk Clear Operation Executed', 'Message cleanup loop complete.', [
            { name: '🗑️ Cleared Count', value: amount + ' Messages', inline: true },
            { name: '🛡️ Responsible Exec', value: message.author.toString(), inline: true }
        ]);
        return message.channel.send({ embeds: [logEmbed] }).then(m => setTimeout(() => m.delete().catch(() => null), 4000));
    }

    // Ajout de rôle (?roleadd)
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

async function handleAdvancedModCommands(message, command, args, banPerm, moderateMembersPerm) {
    // Retrait du dernier avertissement (?unwarn)
    if (command === 'unwarn') {
        setTimeout(() => message.delete().catch(() => null), 200);
        if (!banPerm) return message.channel.send({ embeds: [createPrefixEmbed('Error Status', "❌ Permission denied.")] }).then(m => setTimeout(() => m.delete().catch(() => null), 5000));
        const target = message.mentions.members.first() || message.guild.members.cache.get(args[0]);
        if (!target) return message.channel.send({ embeds: [createPrefixEmbed('Error Status', "❌ Please mention a valid user or provide their ID.")] }).then(m => setTimeout(() => m.delete().catch(() => null), 5000));
        if (!warnDatabase[target.id] || warnDatabase[target.id].length === 0) { 
            return message.channel.send({ embeds: [createPrefixEmbed('Action Aborted', "✅ " + target.user.tag + " has no active warnings to remove.")] }); 
        }
        warnDatabase[target.id].pop();
        saveDatabase();
        
        const logEmbed = createPrefixEmbed('Infraction Warnings Reset', 'Cleared internal history violations for target profile.', [
            { name: '👤 Target Member', value: target.toString(), inline: true },
            { name: '🛡️ Responsible Exec', value: message.author.toString(), inline: true }
        ]);
        return message.channel.send({ embeds: [logEmbed] });
    }
// ==========================================
// PARTIE 4.3 : ACTIONS DE MODÉRATION AVANCÉES (?warn, ?to, ?rto, ?ban, ?unban)
// ==========================================

    // Attribution d'un avertissement (?warn)
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

    // Exclusion temporelle standard (?to) ou retrait d'exclusion (?rto)
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

    // Bannissement définitif (?ban)
    if (command === 'ban') {
        setTimeout(() => message.delete().catch(() => null), 200);
        if (!banPerm) return message.channel.send({ embeds: [createPrefixEmbed('Error Status', "❌ Permission denied.")] }).then(m => setTimeout(() => m.delete().catch(() => null), 5000));
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

    // Annulation de bannissement (?unban)
    if (command === 'unban') {
        setTimeout(() => message.delete().catch(() => null), 200);
        if (!banPerm) return message.channel.send({ embeds: [createPrefixEmbed('Error Status', "❌ Permission denied.")] }).then(m => setTimeout(() => m.delete().catch(() => null), 5000));
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
// PARTIE 5.1 : VÉRIFICATIONS DES DROITS ET COMMANDE /RENAME UNIVERSELLE
// ==========================================

client.on('interactionCreate', async (interaction) => {
    // Vérification des droits giveaways (Staff uniquement)
    if (interaction.isChatInputCommand() && ['gcreate', 'gend', 'greroll'].includes(interaction.commandName)) {
        if (!interaction.member.permissions.has(PermissionFlagsBits.ModerateMembers)) {
            return interaction.reply({ content: "❌ You must be a **Staff Member** (with Timeout permissions) to manage giveaways.", ephemeral: true });
        }
    }

    // Vérification des droits administrateurs (Admins uniquement)
    if (interaction.isChatInputCommand() && ['gwblacklist', 'gwunblacklist', 'statsreset'].includes(interaction.commandName)) {
        if (!interaction.member.permissions.has(PermissionFlagsBits.Administrator)) {
            return interaction.reply({ content: "❌ This command is strictly restricted to **Server Administrators**.", ephemeral: true });
        }
    }

    // Vérifications sur le menu de sélection de mode de giveaway
    if (interaction.isStringSelectMenu() && interaction.customId === 'select_waffel_mode') {
        if (!interaction.member.permissions.has(PermissionFlagsBits.ModerateMembers)) {
            return interaction.reply({ content: "❌ You don't have Staff permissions to interact with this setup menu.", ephemeral: true });
        }
    }

    // Vérifications sur la soumission des formulaires de giveaway
    if (interaction.isModalSubmit() && interaction.customId.startsWith('modal_waffel_')) {
        if (!interaction.member.permissions.has(PermissionFlagsBits.ModerateMembers)) {
            return interaction.reply({ content: "❌ Permission denied. This action is restricted to Staff.", ephemeral: true });
        }
    }

    if (interaction.isChatInputCommand()) {
        const targetUser = interaction.options.getUser('target') || interaction.user;

        // Commande /rename universelle : modifiable à l'infini (soumis aux Rate Limits de Discord)
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
                return interaction.reply({ content: 'Successfully changed channel identity state to: **' + newName + '**', ephemeral: true });
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
        
        // La suite de la détection ChatInput est envoyée dans la Partie 5.2
        handleStatsAndRestOfSlashCommands(interaction, targetUser);
    }
    
    handleComponentInteractions(interaction);
});
// ==========================================
// PARTIE 5.2 : COMMANDE SLASHS D'AFFICHAGE DES STATISTIQUES
// ==========================================

async function handleStatsAndRestOfSlashCommands(interaction, targetUser) {
    // Commande /stats
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
    
    // Redirection automatique vers les commandes utilitaires globales
    handleUtilitySlashCommands(interaction, targetUser);
}
// ==========================================
// PARTIE 6.1 : COMMANDES UTILITAIRES ET DOCUMENTATION SLASHS
// ==========================================

async function handleUtilitySlashCommands(interaction, targetUser) {
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
                { name: '✨ Slash Commands (/)', value: '`/ticket` - Opens a support ticket\n`/close` - Closes active ticket channel\n`/help` - Displays this menu\n`/wjamal` - Sends frog GIF\n`/claimtime` - Displays rules\n`/userinfo` - Shows info\n`/serverinfo` - Displays server metrics\n`/avatar` - Avatar view\n`/infractions` - Warnings ledger\n`/gcreate` - Giveaway setup\n`/gend` - Force close\n`/greroll` - Re-roll winner\n`/gwblacklist` - Blacklist user\n`/gwunblacklist` - Unblacklist user\n`/stats` - Giveaway stats\n`/statsreset` - Wipe stats\n`/rename` - Renames channel' },
                { name: '🛠️ Prefix Commands (?)', value: '`?warn` - Warn user\n`?to` - Timeout member\n`?rto` - Remove timeout\n`?ban` - Ban user\n`?unban` - Unban profile\n`?lock` - Lock stream\n`?unlock` - Unlock channel\n`?clear <count>` - Purge messages\n`?roleadd @user @role` - Add role\n`?unwarn @user` - Pop warning' },
                { name: '🎉 Automation System (!)', value: '`!gstart <minutes> <prize>` - Instantly launches a classic giveaway.' }
            ).setFooter({ text: "Waffel's Giveaway Utility" });
        return interaction.reply({ embeds: [embed] });
    }

    if (interaction.commandName === 'claimtime') {
        const embed = new EmbedBuilder().setTitle('🎉 Giveaway Info').setColor('#F1C40F').setDescription(
            "⏰ **Giveaway Claim Time**\n🏆 Quickdrops - 30 Minutes\n🎁 Weekly/Daily Giveaways - 24 hours\n🎉 Big Giveaways - 12 hours\n🏮 Stream Quickdrops - 3 Hours" 
        ).setTimestamp();
        return interaction.reply({ embeds: [embed] });
    }
    
    handleRestOfUtilitySlashCommands(interaction, targetUser);
}
// ==========================================
// PARTIE 6.2 : COMMANDES UTREILS ET GESTION DES TICKETS D'OUVERTURE
// ==========================================

async function handleRestOfUtilitySlashCommands(interaction, targetUser) {
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
        return interaction.reply({ embeds: [warns.length > 0 ? { embeds: [embed] } : { embeds: [embed] }] });
    }

    if (interaction.commandName === 'faq') {
        const embed = new EmbedBuilder().setTitle('📖 FAQ').setColor('#F1C40F').setDescription('Q: How do I join?\nA: Follow server channels.\n\nQ: How do I claim rewards?\nA: Click claim and complete support forms.');
        return interaction.reply({ embeds: [embed] });
    }

    if (interaction.commandName === 'ticket') {
        const guild = interaction.guild;
        const member = interaction.member;
        if (!guild || !member) return interaction.reply({ content: 'This command can only be used in a server.', ephemeral: true });

        const userId = member.user.id;
        const ticketName = ensureTicketChannelName(`ticket-${member.user.username}-${Date.now().toString().slice(-4)}`);
        const category = guild.channels.cache.get(SECURE_CATEGORY_ID) || undefined;

        const channel = await guild.channels.create({
            name: ticketName,
            type: ChannelType.GuildText,
            parent: category ? category.id : undefined,
            permissionOverwrites: [
                { id: guild.roles.everyone.id, deny: [PermissionFlagsBits.ViewChannel] },
                { id: userId, allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages, PermissionFlagsBits.ReadMessageHistory, PermissionFlagsBits.AttachFiles] },
                { id: SECURE_STAFF_ROLE_ID, allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages, PermissionFlagsBits.ReadMessageHistory, PermissionFlagsBits.ManageChannels, PermissionFlagsBits.ManageMessages] }
            ]
        });

        ticketData.set(channel.id, { ownerId: userId, createdAt: Date.now() });

        const embed = new EmbedBuilder().setColor('#00aaff').setTitle('🎫 Ticket Opened').setDescription(`Hello ${member.user}, your ticket has been created.`)
            .addFields({ name: 'Support Staff', value: 'A staff member will assist you shortly.', inline: false }, { name: 'Channel', value: `<#${channel.id}>`, inline: false }).setTimestamp();

        const row = new ActionRowBuilder().addComponents(new ButtonBuilder().setCustomId(`ticket-close-${channel.id}`).setLabel('Close Ticket 🔴').setStyle(ButtonStyle.Danger));
        await channel.send({ embeds: [embed], components: [row] });
        return interaction.reply({ content: `✅ Your ticket has been created: <#${channel.id}>`, ephemeral: true });
    }

    handleGiveawayEngineSlashCommands(interaction);
}
// ==========================================
// PARTIE 6.3 : FORMULAIRES DE CONFIGURATION ET ATTRIBUTION BLACKLIST
// ==========================================

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
            await interaction.reply({ content: "🔒 Ending the giveaway early...", ephemeral: true });
            runGiveawayEnd(interaction.channel, msgId);
        } else {
            return interaction.reply({ content: "❌ Giveaway active entry not found.", ephemeral: true });
        }
        return;
    }

    if (interaction.commandName === 'greroll') {
        const msgId = interaction.options.getString('message_id');
        const targetMsg = await interaction.channel.messages.fetch(msgId).catch(() => null);
        if (!targetMsg || targetMsg.embeds.length === 0) return interaction.reply({ content: "❌ Valid giveaway message not found.", ephemeral: true });
        const originalEmbed = targetMsg.embeds[0];
        const prizeMatch = originalEmbed.description ? originalEmbed.description.match(/🎁 \*\*Each winner gets:\*\* (.+)/) : null;
        let prize = prizeMatch ? prizeMatch[1] : "Unknown Prize";

        let eligiblePool = [];
        if (giveawaysDatabase[msgId] && giveawaysDatabase[msgId].participants.length > 0) {
            eligiblePool = giveawaysDatabase[msgId].participants.filter(id => !blacklistDatabase.has(id));
        } else {
            const allMembers = await interaction.guild.members.fetch();
            eligiblePool = allMembers.filter(m => !m.user.bot && !blacklistDatabase.has(m.id)).map(m => m.id);
        }

        if (eligiblePool.length === 0) return interaction.reply({ content: "❌ Could not find eligible participants.", ephemeral: true });
        const luckyId = eligiblePool[Math.floor(Math.random() * eligiblePool.length)];
        const randomMember = await interaction.guild.members.fetch(luckyId);

        await interaction.reply({ content: "🎲 **Rerolling a new winner...**", ephemeral: true });
        const hostMatch = originalEmbed.description ? originalEmbed.description.match(/👑 \*\*Hosted by:\*\* (<@!?\d+>)/) : null;
        const cleanHost = hostMatch ? hostMatch[1] : interaction.user.toString();

        const claimBtn = new ButtonBuilder().setCustomId("claim_gw_" + randomMember.id + "_" + Buffer.from(prize).toString('base64') + "_" + Buffer.from(cleanHost).toString('base64')).setLabel('Claim 🟢').setStyle(ButtonStyle.Success);

        initStats(randomMember.id); statsDatabase[randomMember.id].won += 1; saveDatabase();
        await interaction.channel.send({ content: "🎲 **NEW REROLL WINNER!** Congratulations " + randomMember.toString() + ", you won **" + prize + "**!\nClick the button to claim!", components: [new ActionRowBuilder().addComponents(claimBtn)] });
        return;
    }

    if (interaction.commandName === 'close') {
        return processTicketClosure(interaction);
    }
    handleAdminBlacklistSlashCommands(interaction);
}

async function handleAdminBlacklistSlashCommands(interaction) {
    if (interaction.commandName === 'gwblacklist') {
        const target = interaction.options.getUser('target');
        blacklistDatabase.add(target.id); saveDatabase();
        return interaction.reply({ content: "🚫 Successfully blacklisted " + target.toString() });
    }
    if (interaction.commandName === 'gwunblacklist') {
        const target = interaction.options.getUser('target');
        blacklistDatabase.delete(target.id); saveDatabase();
        return interaction.reply({ content: "✅ Successfully unblacklisted " + target.toString() });
    }
}

async function handleComponentInteractions(interaction) {
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
        let prize = interaction.fields.getTextInputValue('input_prize').replace(/\bwaffle\b/gi, '👑');
        const durationStr = interaction.fields.getTextInputValue('input_duration');
        const descriptionOpt = interaction.fields.getTextInputValue('input_description') || null;
        let winners = parseInt(interaction.fields.getTextInputValue('input_winners'), 10) || 1;

        const durationMs = parseDuration(durationStr);
        if (!durationMs || durationMs <= 0) return interaction.reply({ content: "❌ Invalid duration format!", ephemeral: true });

        await interaction.reply({ content: "✅ Giveaway created!", ephemeral: true });
        startGiveawayEngine(interaction.channel, durationMs, prize, winners, mode, descriptionOpt, interaction.user);
    }

    if (interaction.isModalSubmit() && interaction.customId.startsWith('modal_claim_ticket_')) {
        const customIdParts = interaction.customId.split('_');
        const prizeAmount = Buffer.from(customIdParts[3], 'base64').toString('utf8');
        const hostName = Buffer.from(customIdParts[4], 'base64').toString('utf8');
        const ignName = interaction.fields.getTextInputValue('claim_ign');

        await interaction.deferReply({ ephemeral: true });
        try {
            const ticketChannel = await interaction.guild.channels.create({
                name: "🎫-" + interaction.user.username,
                type: ChannelType.GuildText,
                parent: SECURE_CATEGORY_ID,
                permissionOverwrites: [
                    { id: interaction.guild.roles.everyone.id, deny: [PermissionFlagsBits.ViewChannel] },
                    { id: interaction.user.id, allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages] },
                    { id: SECURE_STAFF_ROLE_ID, allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages] }
                ],
            });

            ticketData.set(ticketChannel.id, { ownerId: interaction.user.id, createdAt: Date.now() });
            const embed = new EmbedBuilder().setTitle('📥 Claim Ticket').setColor('#2ECC71')
                .addFields({ name: 'Winner', value: interaction.user.toString(), inline: true }, { name: '🎁 Prize', value: prizeAmount, inline: true }, { name: '🎮 IGN', value: ignName, inline: true }, { name: '👑 Host', value: hostName, inline: true });

            await ticketChannel.send({ content: "🔔 <@&" + SECURE_STAFF_ROLE_ID + ">", embeds: [embed], components: [new ActionRowBuilder().addComponents(new ButtonBuilder().setCustomId('close_giveaway_ticket').setLabel('Close Ticket 🔴').setStyle(ButtonStyle.Danger))] });
            await interaction.editReply({ content: "✅ Ticket created: " + ticketChannel.toString() });
        } catch (e) {
            await interaction.editReply({ content: "❌ Auto-generation error." });
        }
    }
    handleButtonsEngineProcessing(interaction);
}
// ==========================================
// PARTIE 7.1 : BLOCAGE SÉCURISÉ DU STAFF SUR L'INSCRIPTION ET APPEL DU MOTEUR
// ==========================================

async function handleButtonsEngineProcessing(interaction) {
    if (interaction.isButton() && interaction.customId.startsWith('claim_gw_')) {
        const parts = interaction.customId.split('_');
        const allowedWinnerId = parts[2]; const rawPrizeB64 = parts[3]; const rawHostB64 = parts[4];      
        if (interaction.user.id !== allowedWinnerId) return interaction.reply({ content: "❌ Access Denied.", ephemeral: true });

        const modal = new ModalBuilder().setCustomId("modal_claim_ticket_" + allowedWinnerId + "_" + rawPrizeB64 + "_" + rawHostB64).setTitle('Claim Reward Menu');
        const ignInput = new TextInputBuilder().setCustomId('claim_ign').setLabel("What is your IGN?").setStyle(TextInputStyle.Short).setRequired(true);
        modal.addComponents(new ActionRowBuilder().addComponents(ignInput));
        await interaction.showModal(modal);
    }

    if (interaction.isButton() && interaction.customId === 'close_giveaway_ticket') {
        if (!interaction.member.roles.cache.has(SECURE_STAFF_ROLE_ID) && !interaction.member.permissions.has(PermissionFlagsBits.Administrator)) {
            return interaction.reply({ content: "❌ Staff access only.", ephemeral: true });
        }
        await interaction.reply({ content: "🔒 Purging channel in 5 seconds..." });
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
    const btn = new ButtonBuilder().setCustomId('enter_giveaway').setLabel(mode === 'clicker' ? 'CLICK ME NOW! ⚡' : 'Join! 🎉').setStyle(ButtonStyle.Primary);
    const msg = await channel.send({ embeds: [embed], components: [new ActionRowBuilder().addComponents(btn)] });

    giveawaysDatabase[msg.id] = { channelId: channel.id, endTime: endTime, prize: prize, winnerCount: winnerCount, mode: mode, title: title, hostUser: hostUser.toString(), participants: [] };
    saveDatabase();
    resumeGiveawayCollector(channel, msg.id, durationMs);
}
// ==========================================
// PARTIE 7.2 : MISE À JOUR LIVE DES EMBEDS ET CALCUL DES GAGNANTS SANS ERREUR
// ==========================================

function resumeGiveawayCollector(channel, msgId, durationMs) {
    const collector = channel.createMessageComponentCollector({ filter: i => i.message.id === msgId, time: durationMs });

    collector.on('collect', async (btnInt) => {
        const gw = giveawaysDatabase[msgId]; if (!gw) return;

        if (btnInt.customId === 'enter_giveaway') {
            // SÉCURITÉ CORRECTIVE : Le Staff est purement bloqué au clic du bouton de participation
            if (btnInt.member.permissions.has(PermissionFlagsBits.ModerateMembers) || btnInt.member.roles.cache.has(SECURE_STAFF_ROLE_ID)) {
                return btnInt.reply({ content: "❌ **Access Denied.** Staff members are strictly barred from joining giveaways.", ephemeral: true });
            }
            if (blacklistDatabase.has(btnInt.user.id)) return btnInt.reply({ content: "❌ Blacklisted.", ephemeral: true });

            if (gw.mode === 'clicker') {
                gw.participants.push(btnInt.user.id);
                initStats(btnInt.user.id); statsDatabase[btnInt.user.id].entered += 1; saveDatabase();
                await btnInt.reply({ content: "🧇 Speed click recorded!", ephemeral: true });
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
            await btnInt.update({ content: "👋 Successfully left.", components: [] }); saveDatabase();
        }
    }
}

async function runGiveawayEnd(channel, msgId) {
    const gw = giveawaysDatabase[msgId]; if (!gw) return;
    delete giveawaysDatabase[msgId]; saveDatabase();

    const endMsg = await channel.messages.fetch(msgId).catch(() => null);
    if (endMsg) await endMsg.edit({ components: [new ActionRowBuilder().addComponents(new ButtonBuilder().setCustomId('ended').setDisabled(true).setLabel('Closed 🔒').setStyle(ButtonStyle.Secondary))] }).catch(() => null);

    if (gw.participants.length === 0) {
        if (endMsg) await endMsg.edit({ embeds: [new EmbedBuilder().setTitle(gw.title).setDescription("❌ Ended: No participants.").setColor('#E74C3C')] });
        return;
    }

    const rawPrizeB64 = Buffer.from(gw.prize).toString('base64');
    const rawHostB64 = Buffer.from(gw.hostUser).toString('base64');

    if (gw.mode === 'clicker') {
        const wId = gw.participants[0]; initStats(wId); statsDatabase[wId].won += 1; saveDatabase();
        const claim = new ButtonBuilder().setCustomId("claim_gw_" + wId + "_" + rawPrizeB64 + "_" + rawHostB64).setLabel('Claim 🟢').setStyle(ButtonStyle.Success);
        if (endMsg) await endMsg.edit({ embeds: [new EmbedBuilder().setTitle(gw.title).setDescription("⚡ Winner: <@" + wId + ">\n🎁 Prize: " + gw.prize).setColor('#2ECC71')] });
        await channel.send({ content: "⚡ 🧇 **CLICKER WINNER!** Congratulations <@" + wId + ">!", components: [new ActionRowBuilder().addComponents(claim)] });
        return;
    }

    // Le staff ayant été filtré en amont au clic du bouton, tous les inscrits sont d'office réguliers et valides
    const winners = gw.participants.sort(() => 0.5 - Math.random()).slice(0, gw.winnerCount);
    const mentions = winners.map(id => "<@" + id + ">").join(', ');

    if (endMsg) await endMsg.edit({ embeds: [new EmbedBuilder().setTitle(gw.title).setDescription("🎉 Winners: " + mentions + "\n🎁 Prize: " + gw.prize).setColor('#2ECC71')] });

    if (gw.mode === 'normal') {
        winners.forEach(id => { initStats(id); statsDatabase[id].won += 1; }); saveDatabase();
        const claim = new ButtonBuilder().setCustomId("claim_gw_" + winners[0] + "_" + rawPrizeB64 + "_" + rawHostB64).setLabel('Claim 🟢').setStyle(ButtonStyle.Success);
        await channel.send({ content: "🎉 **CONGRATULATIONS** " + mentions + "! You won **" + gw.prize + "**!", components: [new ActionRowBuilder().addComponents(claim)] });
    }
    handleMiniGamesArbitration(channel, winners, gw.prize, gw.winnerCount, gw.mode, gw.hostUser, rawPrizeB64, rawHostB64);
}
// ==========================================
// PARTIE 7.3 : CALCULATEUR DES MODES DUELS (DOK, SOS, RPS) ET CONNEXION FINALE
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
                await gInt.reply({ content: "🔒 kept **" + prize + "**!", components: [new ActionRowBuilder().addComponents(claimBtn.setCustomId("claim_gw_" + wId + "_" + rawPrizeB64 + "_" + rawHostB64))] });
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
                if (c1 === c2) { await channel.send("🤝 **DRAW!** Re-roll battle manually."); }
                else if ((c1 === 'rock' && c2 === 'scissors') || (c1 === 'paper' && c2 === 'rock') || (c1 === 'scissors' && c2 === 'paper')) { initStats(p1); statsDatabase[p1].won += 1; await channel.send({ content: "👑 **VICTORY!** <@" + p1 + "> won!", components: [new ActionRowBuilder().addComponents(claimBtn.setCustomId("claim_gw_" + p1 + "_" + rawPrizeB64 + "_" + rawHostB64))] }); }
                else { initStats(p2); statsDatabase[p2].won += 1; await channel.send({ content: "👑 **VICTORY!** <@" + p2 + "> won!", components: [new ActionRowBuilder().addComponents(claimBtn.setCustomId("claim_gw_" + p2 + "_" + rawPrizeB64 + "_" + rawHostB64))] }); }
                saveDatabase();
            }
        });
    }
}

async function processTicketClosure(interaction) {
    const channel = interaction.channel; if (!channel) return;
    await interaction.reply({ content: '🔒 **Ticket Scheduled for Deletion.** Purging in 10 seconds...' });
    setTimeout(async () => { await channel.delete().catch(() => null); }, 10000);
}

// Lancement final sécurisé du client Discord
if (!process.env.DISCORD_TOKEN) { console.error('❌ Missing DISCORD_TOKEN.'); process.exit(1); }
client.login(process.env.DISCORD_TOKEN).catch(e => console.error(e));
