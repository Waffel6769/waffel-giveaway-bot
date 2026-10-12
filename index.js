require('dotenv').config();
const { 
    Client, GatewayIntentBits, EmbedBuilder, ActionRowBuilder, ButtonBuilder, 
    ButtonStyle, ComponentType, REST, Routes, SlashCommandBuilder, 
    StringSelectMenuBuilder, StringSelectMenuOptionBuilder, ModalBuilder, 
    TextInputBuilder, TextInputStyle, PermissionFlagsBits, ChannelType 
} = require('discord.js');
const express = require('express');
const fs = require('fs');

const client = new Client({ 
    intents: [
        GatewayIntentBits.Guilds, 
        GatewayIntentBits.GuildMessages, 
        GatewayIntentBits.MessageContent, 
        GatewayIntentBits.GuildMembers,
        GatewayIntentBits.GuildMessageReactions
    ] 
});
const DATA_FILE = './database.json';
const app = express();

let warnDatabase = {};
let blacklistDatabase = new Set();
let statsDatabase = {};
let giveawaysDatabase = {}; 

try {
    if (fs.existsSync(DATA_FILE)) {
        const rawData = fs.readFileSync(DATA_FILE, 'utf8');
        const parsed = JSON.parse(rawData);
        warnDatabase = parsed.warns || {};
        statsDatabase = parsed.stats || {};
        giveawaysDatabase = parsed.giveaways || {};
        blacklistDatabase = new Set(parsed.blacklist || []);
        console.log("💾 Database loaded successfully from database.json");
    }
} catch (error) {
    console.error("❌ Failed to load database, starting fresh:", error);
}

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
        console.error("❌ Database save error:", error);
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
    const val = parseInt(match[1]);
    const unit = match[2].toLowerCase();
    if (unit === 's' || unit === 'sec') return val * 1000;
    if (unit === 'm') return val * 60 * 1000;
    if (unit === 'h') return val * 60 * 60 * 1000;
    if (unit === 'd') return val * 24 * 60 * 60 * 1000;
    return null;
}

const commands = [
    new SlashCommandBuilder().setName('gcreate').setDescription('Open the menu to create a giveaway 🧇'),
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
        .addUserOption(option => option.setName('target').setDescription('The user whose statistics will be wiped clean').setRequired(true))
].map(cmd => cmd.toJSON());

client.once('ready', async () => {
    console.log(`✨ Waffel's Giveaway Bot is logged in as ${client.user.tag}!`);
    const rest = new REST({ version: '10' }).setToken(process.env.DISCORD_TOKEN);
    try {
        await rest.put(Routes.applicationCommands(client.user.id), { body: commands });
        console.log('✅ Successfully reloaded application (/) commands.');
    } catch (error) { 
        console.error(error); 
    }

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

app.get('/', (req, res) => {
    if (client && client.user) { 
        console.log(`0014 KeepAlive received! Bot status: ${client.user.presence.status}`); 
    }
    res.send("Waffel's Giveaway is perfectly awake and running 24/7!");
});
app.listen(process.env.PORT || 3000);

client.on('messageCreate', async (message) => {
    if (message.author.bot) return;

    if (message.content.startsWith('!gstart')) {
        if (!message.member.permissions.has(PermissionFlagsBits.ModerateMembers)) {
            return message.channel.send("❌ You need to be a **Staff Member** (with Timeout permissions) to start a giveaway.")
                .then(m => setTimeout(() => m.delete().catch(() => null), 5000));
        }
        setTimeout(() => message.delete().catch(() => null), 500);
        const args = message.content.slice('!gstartTemplate'.length).trim().split(/ +/);
        const durationStr = args[0];
        const prize = args.slice(1).join(' ');
        if (!durationStr || !prize) return;

        const durationMs = parseDuration(durationStr) || (parseInt(durationStr) * 60 * 1000);
        if (!durationMs) return;
        
        startGiveawayEngine(message.channel, durationMs, prize, 1, 'normal', null, message.author);
        return;
    }

    if (!message.content.startsWith('?')) return;
    const args = message.content.slice(1).trim().split(/ +/);
    const command = args.shift().toLowerCase();

    if (command === 'lock') {
        setTimeout(() => message.delete().catch(() => null), 200);
        if (!message.member.permissions.has(PermissionFlagsBits.ManageChannels)) return message.channel.send("❌ You don't have permission to use this command.").then(m => setTimeout(() => m.delete().catch(() => null), 5000));
        await message.channel.permissionOverwrites.edit(message.guild.roles.everyone, { SendMessages: false });
        return message.channel.send("🔒 **This channel has been locked.** Everyone's waffle iron is turned off!");
    }

    if (command === 'unlock') {
        setTimeout(() => message.delete().catch(() => null), 200);
        if (!message.member.permissions.has(PermissionFlagsBits.ManageChannels)) return message.channel.send("❌ You don't have permission to use this command.").then(m => setTimeout(() => m.delete().catch(() => null), 5000));
        await message.channel.permissionOverwrites.edit(message.guild.roles.everyone, { SendMessages: true });
        return message.channel.send("🔓 **This channel has been unlocked.** You can now speak and eat waffles again!");
    }

    handleModCommands(message, command, args);
});

async function handleModCommands(message, command, args) {
    const manageMessagesPerm = message.member.permissions.has(PermissionFlagsBits.ManageMessages);
    const banPerm = message.member.permissions.has(PermissionFlagsBits.BanMembers);
    const manageRolesPerm = message.member.permissions.has(PermissionFlagsBits.ManageRoles);

    if (command === 'clear') {
        if (!manageMessagesPerm) return message.channel.send("❌ Permission denied.").then(m => setTimeout(() => m.delete().catch(() => null), 5000));
        const amount = parseInt(args[0]);
        if (isNaN(amount) || amount < 1 || amount > 100) return message.channel.send("⚠️ Please provide a number between 1 and 100.").then(m => setTimeout(() => m.delete().catch(() => null), 5000));
        await message.channel.bulkDelete(amount + 1, true).catch(() => null);
        return message.channel.send("🧹 Deleted messages.").then(m => setTimeout(() => m.delete().catch(() => null), 4000));
    }

    if (command === 'roleadd') {
        setTimeout(() => message.delete().catch(() => null), 200);
        if (!manageRolesPerm) return message.channel.send("❌ You don't have permission to manage roles.").then(m => setTimeout(() => m.delete().catch(() => null), 5000));
        const target = message.mentions.members.first();
        const role = message.mentions.roles.first();
        if (!target || !role) return message.channel.send("⚠️ Usage: `?roleadd @member @role`").then(m => setTimeout(() => m.delete().catch(() => null), 5000));
        try { 
            await target.roles.add(role); 
            return message.channel.send(`✅ The role **${role.name}** has been successfully added to **${target.user.tag}**.`); 
        } catch (e) { 
            return message.channel.send("❌ Unable to add role. Check role hierarchy.").then(m => setTimeout(() => m.delete().catch(() => null), 5000)); 
        }
    }

    if (command === 'unwarn') {
        setTimeout(() => message.delete().catch(() => null), 200);
        if (!banPerm) return message.channel.send("❌ Permission denied.").then(m => setTimeout(() => m.delete().catch(() => null), 5000));
        const target = message.mentions.members.first() || message.guild.members.cache.get(args[0]);
        if (!target) return message.channel.send("❌ Please mention a valid user or provide their ID.").then(m => setTimeout(() => m.delete().catch(() => null), 5000));
        if (!warnDatabase[target.id] || warnDatabase[target.id].length === 0) { return message.channel.send(`✅ **${target.user.tag}** has no active warnings to remove.`); }
        warnDatabase[target.id].pop();
        saveDatabase();
        return message.channel.send(`🧹 Removed the latest warning from **${target.user.tag}** (Remaining: ${warnDatabase[target.id].length}).`);
    }

    if (command === 'to') {
        setTimeout(() => message.delete().catch(() => null), 200);
        if (!message.member.permissions.has(PermissionFlagsBits.ModerateMembers)) {
            return message.channel.send("❌ Permission denied.").then(m => setTimeout(() => m.delete().catch(() => null), 5000));
        }
        const target = message.mentions.members.first() || message.guild.members.cache.get(args[0]);
        if (!target) return message.channel.send("❌ Please mention a valid member. Usage: `?to @member [duration] [reason]`").then(m => setTimeout(() => m.delete().catch(() => null), 5000));

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
            return message.channel.send(`🔇 ${target} has been timed out.\n\n⏱️ **Duration:** **${timeArg || '1m'}**\n📄 **Reason:** *${reason}*`);
        } catch (err) {
            return message.channel.send("❌ Unable to target this user. Verify hierarchical permissions.");
        }
    }
}

client.on('interactionCreate', async (interaction) => {
    if (interaction.isChatInputCommand() && ['gcreate', 'gend', 'greroll'].includes(interaction.commandName)) {
        if (!interaction.member.permissions.has(PermissionFlagsBits.ModerateMembers)) {
            return interaction.reply({ content: "❌ You must be a **Staff Member** (with Timeout permissions) to manage giveaways.", ephemeral: true });
        }
    }

    if (interaction.isChatInputCommand() && ['gwblacklist', 'gwunblacklist', 'statsreset'].includes(interaction.commandName)) {
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

        if (interaction.commandName === 'stats') {
            initStats(targetUser.id);
            const userStats = statsDatabase[targetUser.id];
            const winRate = userStats.entered > 0 ? ((userStats.won / userStats.entered) * 100).toFixed(1) : '0.0';

            const statsEmbed = new EmbedBuilder()
                .setTitle(`📊 Giveaway Statistics - \${targetUser.username}`)
                .setColor('#F1C40F')
                .setThumbnail(targetUser.displayAvatarURL())
                .addFields(
                    { name: '📥 Giveaways Entered', value: `\`${userStats.entered}\` times`, inline: true },
                    { name: '🏆 Giveaways Won', value: `\`${userStats.won}\` times`, inline: true },
                    { name: '📈 Win Rate Percentage', value: `\`${winRate}%\``, inline: false }
                )
                .setFooter({ text: "Waffel's Analytical System" })
                .setTimestamp();

            return interaction.reply({ embeds: [statsEmbed] });
        }

        if (interaction.commandName === 'statsreset') {
            const target = interaction.options.getUser('target');
            statsDatabase[target.id] = { entered: 0, won: 0 };
            saveDatabase();

            const resetEmbed = new EmbedBuilder()
                .setTitle('🔄 Statistics Successfully Reset')
                .setColor('#E74C3C')
                .setDescription(`All giveaway statistics (entries, wins, and win rate) for ${target} have been completely wiped.`)
                .setFooter({ text: "Waffel's Database Management" })
                .setTimestamp();

            return interaction.reply({ embeds: [resetEmbed] });
        }

        if (interaction.commandName === 'help') {
            const embed = new EmbedBuilder().setTitle('📋 Available Bot Commands Inventory').setColor('#F1C40F').setDescription('Here is a complete list of all the features integrated into this bot:\n\n').addFields(
                    { name: '✨ Slash Commands (/)', value: '`/help` - Displays this menu\n`/wjamal` - Sends a random funny frog GIF\n`/claimtime` - Displays official giveaway claim times and rules\n`/userinfo` - Shows profile information\n`/serverinfo` - Displays server stats\n`/avatar` - Displays member avatar\n`/infractions` - Shows warnings\n`/gcreate` - Opens the giveaway setup menu\n`/gend` - Ends a giveaway manually\n`/greroll` - Rerolls a giveaway winner\n`/gwblacklist` - Blacklists a user from giveaways\n`/gwunblacklist` - Removes a user from the blacklist\n`/winnerinfo` - Displays the summary of the last giveaway\n`/faq` - Display the server FAQ guide\n`/stats` - Display your giveaway stats and win rate\n`/statsreset` - Reset a user\'s statistics' },
                    { name: '🛠️ Prefix Commands (?)', value: '`?lock` - Disables message sending\n`?unlock` - Enables message sending again\n`?clear <amount>` - Bulk deletes messages\n`?roleadd @member @role` - Adds a role\n`?unwarn @member` - Removes the latest warning\n`?warn @member <reason>` - Warns a member\n`?to @member <duration> <reason>` - Times out a user\n`?rto @member` - Removes timeout\n`?kick @member` - Kicks a member\n`?ban @member` - Bans a member' },
                    { name: '🎉 Automation System (!)', value: '`!gstart <minutes> <prize>` - Instantly launches a classic giveaway (Requires Staff privileges).' }
                ).setFooter({ text: `Waffel's Giveaway Utility` });
            return interaction.reply({ embeds: [embed] });
        }

        if (interaction.commandName === 'claimtime') {
            const embed = new EmbedBuilder().setTitle('🎉 Giveaway Info').setColor('#F1C40F').setDescription(
                `¼ **Giveaway Claim Time**\n🏆 Quickdrops - 30 Minutes\n🎁 Weekly/Daily Giveaways - 24 hours\n🎉 Big Giveaways - 12 hours\n🏮 Stream Quickdrops - 3 Hours\n\n▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬` 
            ).setTimestamp();
            return interaction.reply({ embeds: [embed] });
        }

        if (interaction.commandName === 'wjamal') {
            const frogGifs = ['https://giphy.com'];
            const randomFrog = frogGifs[Math.floor(Math.random() * frogGifs.length)];
            const embed = new EmbedBuilder().setTitle('🐸 W JAMAL').setColor('#2ECC71').setImage(randomFrog);
            return interaction.reply({ embeds: [embed] });
        }

        if (interaction.commandName === 'userinfo') {
            const embed = new EmbedBuilder().setTitle(`👤 User Info - ${targetUser.tag}`).setColor('#F1C40F').setThumbnail(targetUser.displayAvatarURL())
                .addFields({ name: '🆔 User ID', value: targetUser.id, inline: true }, { name: '📅 Created Account', value: `<t:${Math.floor(targetUser.createdTimestamp / 1000)}:R>`, inline: true }, { name: '🤖 Bot?', value: targetUser.bot ? 'Yes' : 'No', inline: true });
            return interaction.reply({ embeds: [embed] });
        }

        if (interaction.commandName === 'serverinfo') {
            const embed = new EmbedBuilder().setTitle(`📊 Server Info - ${interaction.guild.name}`).setColor('#F1C40F').setThumbnail(interaction.guild.iconURL())
                .addFields({ name: '👑 Owner', value: `<@${interaction.guild.ownerId}>`, inline: true }, { name: '👥 Total Members', value: `${interaction.guild.memberCount}`, inline: true }, { name: '📁 Channel Count', value: `${interaction.guild.channels.cache.size}`, inline: true });
            return interaction.reply({ embeds: [embed] });
        }

        if (interaction.commandName === 'avatar') {
            const embed = new EmbedBuilder().setTitle(`🖼️ Avatar of ${targetUser.tag}`).setColor('#F1C40F').setImage(targetUser.displayAvatarURL({ size: 1024 })).setFooter({ text: `Waffel's Giveaway Utility` });
            return interaction.reply({ embeds: [embed] });
        }

        if (interaction.commandName === 'infractions') {
            const warns = warnDatabase[targetUser.id] || [];
            const embed = new EmbedBuilder().setTitle(`📜 Moderation History for ${targetUser.username}`).setColor(warns.length > 0 ? '#E74C3C' : '#2ECC71');
            if (warns.length === 0) { embed.setDescription(`✅ This user has a perfectly clean record. No infractions found!`); } 
            else { embed.setDescription(`⚠️ Total Warnings: **${warns.length}**`); warns.forEach((warn, index) => { embed.addFields({ name: `Warning #${index + 1} (${warn.date})`, value: `**Reason:** ${warn.reason}\n**Moderator:** ${warn.moderator}` }); }); }
            return interaction.reply({ embeds: [embed] });
        }

        if (interaction.commandName === 'gcreate') {
            const menu = new StringSelectMenuBuilder().setCustomId('select_waffel_mode').setPlaceholder('🎯 Choose a Giveaway Game Mode...')
                .addOptions(
                    new StringSelectMenuOptionBuilder().setLabel('Normal Mode').setDescription('Classic giveaway.').setValue('normal').setEmoji('🎉'),
                    new StringSelectMenuOptionBuilder().setLabel('Waffle Clicker').setDescription('First one to click the button wins instantly! 🧇').setValue('clicker').setEmoji('⚡'),
                    new StringSelectMenuOptionBuilder().setLabel('Double Or Keep (DoK)').setDescription('Keep or double and reroll!').setValue('dok').setEmoji('🟢'),
                    new StringSelectMenuOptionBuilder().setLabel('Split Or Steal (SoS)').setDescription('Share or betray?').setValue('sos').setEmoji('⚔️'),
                    new StringSelectMenuOptionBuilder().setLabel('Rock Paper Scissors (RPS)').setDescription('RPS Battle!').setValue('rps').setEmoji('🪨')
                );
            const row = new ActionRowBuilder().addComponents(menu);
            const embed = new EmbedBuilder().setTitle("🧇 Waffel's Giveaway Setup Menu").setDescription('Please select a game mode below.').setColor('#F1C40F');
            return interaction.reply({ embeds: [embed], components: [row], ephemeral: true });
        }

        if (interaction.commandName === 'gend') {
            const msgId = interaction.options.getString('message_id');
            const targetMsg = await interaction.channel.messages.fetch(msgId).catch(() => null);
            if (!targetMsg) return interaction.reply({ content: "❌ Giveaway message not found in this channel.", ephemeral: true });
            await interaction.reply({ content: "🔒 Ending the giveaway early...", ephemeral: true });
            
            if (giveawaysDatabase[msgId]) {
                runGiveawayEnd(interaction.channel, msgId);
            } else {
                return targetMsg.edit({ components: targetMsg.components }).catch(() => null);
            }
            return;
        }

        if (interaction.commandName === 'greroll') {
            const msgId = interaction.options.getString('message_id');
            const targetMsg = await interaction.channel.messages.fetch(msgId).catch(() => null);
            if (!targetMsg || targetMsg.embeds.length === 0) return interaction.reply({ content: "❌ Valid giveaway message not found.", ephemeral: true });
            const originalEmbed = targetMsg.embeds[0];
            const prizeMatch = originalEmbed.description ? originalEmbed.description.match(/🎁 \*\*Each winner gets:\*\* (.+)/) : null;
            const prize = prizeMatch ? prizeMatch[1] : "Unknown Prize";

            let eligiblePool = [];
            if (giveawaysDatabase[msgId] && giveawaysDatabase[msgId].participants.length > 0) {
                eligiblePool = giveawaysDatabase[msgId].participants.filter(id => !blacklistDatabase.has(id));
            } else {
                const allMembers = await interaction.guild.members.fetch();
                eligiblePool = allMembers.filter(m => !m.user.bot && !blacklistDatabase.has(m.id) && !m.permissions.has(PermissionFlagsBits.ModerateMembers)).map(m => m.id);
            }

            if (eligiblePool.length === 0) return interaction.reply({ content: "❌ Could not find eligible participants to reroll.", ephemeral: true });
            const luckyId = eligiblePool[Math.floor(Math.random() * eligiblePool.length)];
            const randomMember = await interaction.guild.members.fetch(luckyId);

            await interaction.reply({ content: "🎲 **Rerolling a new winner...**", ephemeral: true });
            const hostMatch = originalEmbed.description ? originalEmbed.description.match(/👑 \*\*Hosted by:\*\* (<@!?\d+>)/) : null;
            const cleanHost = hostMatch ? hostMatch[1] : `${interaction.user}`;

            const rawPrizeB64 = Buffer.from(prize).toString('base64');
            const rawHostB64 = Buffer.from(cleanHost).toString('base64');

            const claimBtn = new ButtonBuilder().setCustomId(`claim_gw_${randomMember.id}_${rawPrizeB64}_${rawHostB64}`).setLabel('Claim 🟢').setStyle(ButtonStyle.Success);
            const claimRow = new ActionRowBuilder().addComponents(claimBtn);

            initStats(randomMember.id);
            statsDatabase[randomMember.id].won += 1;
            saveDatabase();

            await interaction.channel.send({ 
                content: `🎲 **NEW REROLL WINNER!** Congratulations ${randomMember}, you won **${prize}**! 🎁✨\nClick the button below to claim your prize!`,
                components: [claimRow]
            });
            return;
        }

        if (interaction.commandName === 'gwblacklist') {
            const target = interaction.options.getUser('target');
            if (blacklistDatabase.has(target.id)) return interaction.reply({ content: `⚠️ \${target.username} is already on the giveaway blacklist.`, ephemeral: true });
            
            blacklistDatabase.add(target.id);
            saveDatabase();
            await interaction.reply({ content: `🚫 Successfully added \${target} to the **@Giveaway Blacklist**.` });

            const logChannel = interaction.guild.channels.cache.get(process.env.LOG_CHANNEL_ID);
            if (logChannel) {
                const logEmbed = new EmbedBuilder()
                    .setTitle('🚫 User Blacklisted from Giveaways')
                    .setColor('#E74C3C')
                    .addFields(
                        { name: '👤 Target User', value: `\${target.tag}`, inline: true },
                        { name: '🛡️ Moderator', value: `\${interaction.user.tag}`, inline: true },
                        { name: '🆔 User ID', value: `\`${target.id}\``, inline: false }
                    )
                    .setTimestamp();
                await logChannel.send({ embeds: [logEmbed] }).catch(() => null);
            }
            return;
        }

        if (interaction.commandName === 'gwunblacklist') {
            const target = interaction.options.getUser('target');
            if (!blacklistDatabase.has(target.id)) return interaction.reply({ content: `⚠️ \${target.username} is not currently blacklisted.`, ephemeral: true });
            
            blacklistDatabase.delete(target.id);
            saveDatabase();
            await interaction.reply({ content: `✅ Successfully removed \${target} from the giveaway blacklist.` });

            const logChannel = interaction.guild.channels.cache.get(process.env.LOG_CHANNEL_ID);
            if (logChannel) {
                const logEmbed = new EmbedBuilder()
                    .setTitle('✅ User Unblacklisted from Giveaways')
                    .setColor('#2ECC71')
                    .addFields(
                        { name: '👤 Target User', value: `\${target.tag}`, inline: true },
                        { name: '🛡️ Moderator', value: `\${interaction.user.tag}`, inline: true },
                        { name: '🆔 User ID', value: `\`${target.id}\``, inline: false }
                    )
                    .setTimestamp();
                await logChannel.send({ embeds: [logEmbed] }).catch(() => null);
            }
            return;
        }

        if (interaction.commandName === 'winnerinfo') {
            await interaction.deferReply({ ephemeral: true });

            const cachedMessages = await interaction.channel.messages.fetch({ limit: 100 }).catch(() => null);
            if (!cachedMessages || cachedMessages.size === 0) {
                return interaction.editReply({ content: "❌ Unable to read the text history of this channel." });
            }

            const lastGiveaway = cachedMessages.find(msg => 
                msg.author.id === client.user.id && 
                msg.embeds.length > 0 && 
                msg.embeds[0].description && 
                (msg.embeds[0].description.includes('GIVEAWAY ENDED!') || msg.embeds[0].description.includes('CLICKER OVER!'))
            );

            if (!lastGiveaway) {
                return interaction.editReply({ content: "❌ No recently finished giveaway found in the last 100 messages of this channel." });
            }

            const description = lastGiveaway.embeds[0]?.description || '';
            const normalizeValue = (value) => (value || '').replace(/\*\*/g, '').replace(/<@!?\d+>/g, '').replace(/\s+/g, ' ').trim();

            let winnersInfo = 'Unknown Winner';
            let prizeInfo = 'Unknown Prize';

            for (const line of description.split('\n')) {
                const winnerLine = line.match(/(?:👑|🏆)?\s*(?:\*\*)?Winners(?:\*\*)?:\s*(.+)/i) ||
                    line.match(/(?:👑|🏆)?\s*(?:\*\*)?Fastest Clicker(?:\*\*)?:\s*(.+)/i);
                if (winnerLine && winnersInfo === 'Unknown Winner') {
                    winnersInfo = normalizeValue(winnerLine[1]);
                }

                const prizeLine = line.match(/🎁\s*(?:\*\*)?Each winner gets:(?:\*\*)?\s*(.+)/i);
                if (prizeLine && prizeInfo === 'Unknown Prize') {
                    prizeInfo = normalizeValue(prizeLine[1]);
                }
            }

            const jumpButton = new ButtonBuilder().setLabel('Jump to Giveaway Message 🧇').setStyle(ButtonStyle.Link).setURL(lastGiveaway.url);
            const row = new ActionRowBuilder().addComponents(jumpButton);

            const summaryEmbed = new EmbedBuilder()
                .setTitle('🏆 Last Finished Giveaway Insights')
                .setColor('#F1C40F')
                .setThumbnail(interaction.guild.iconURL())
                .setDescription('Here is a snapshot summary of the most recently processed giveaway recorded in this channel:')
                .addFields(
                    { name: '🎁 Prize Handed Out', value: `**\${prizeInfo}**`, inline: false },
                    { name: '👑 Registered Winner(s)', value: winnersInfo, inline: false },
                    { name: '🆔 Message Reference ID', value: `\`${lastGiveaway.id}\``, inline: true }
                )
                .setFooter({ text: "Waffel's Historical Inspector" })
                .setTimestamp();

            return interaction.editReply({ embeds: [summaryEmbed], components: [row] });
        }

        if (interaction.commandName === 'faq') {
            const faqText = `📖 Waffel's Menu FAQ\n❓ General\nQ: When does Waffel go live?\nA: He goes live at 22:30 (not everyday)\n\nQ: What does Waffel go live on?\nA: He goes live on Twitch\n---\n🎉 Giveaways\nQ: How do I join?\nA: Check instructions channels and chat everyday.\n\nQ: How do I claim my prize?\nA: Make a ticket within 24 Hours (30 Minutes if quickdrop).\n\n💡 Still Have Questions?\nMake a ticket here.`;

            const faqEmbed = new EmbedBuilder()
                .setTitle("📖 Waffel's Knowledge Base")
                .setColor('#F1C40F')
                .setDescription(faqText)
                .setFooter({ text: "Waffel's Giveaway Utility" })
                .setTimestamp();

            return interaction.reply({ embeds: [faqEmbed] });
        }
    }

    if (interaction.isStringSelectMenu() && interaction.customId === 'select_waffel_mode') {
        const mode = interaction.values[0]; 
        const modal = new ModalBuilder().setCustomId(`modal_waffel_${mode}`).setTitle(`Setup: ${mode.toUpperCase()} Mode 🧇`);
        const pInput = new TextInputBuilder().setCustomId('input_prize').setLabel("What is the prize / amount?").setStyle(TextInputStyle.Short).setPlaceholder("e.g., 50m / Waffles").setRequired(true);
        const dInput = new TextInputBuilder().setCustomId('input_duration').setLabel("Duration (e.g., 5h, 45s, 10m):").setStyle(TextInputStyle.Short).setPlaceholder("e.g., 5h or 30s").setRequired(true);
        const wInput = new TextInputBuilder().setCustomId('input_winners').setLabel("Number of winners:").setStyle(TextInputStyle.Short).setRequired(true);
        const descInput = new TextInputBuilder().setCustomId('input_description').setLabel("Optional Title / Description:").setStyle(TextInputStyle.Paragraph).setPlaceholder("e.g., 1B / Flash (Leave blank for default)").setRequired(false);
        
        if (mode === 'sos' || mode === 'rps') { wInput.setPlaceholder("Must be 2").setValue("2"); } 
        else if (mode === 'clicker') { wInput.setPlaceholder("Must be 1").setValue("1").setRequired(false); }
        else { wInput.setPlaceholder("e.g., 1").setValue("1"); }
        
        modal.addComponents(new ActionRowBuilder().addComponents(pInput), new ActionRowBuilder().addComponents(dInput), new ActionRowBuilder().addComponents(wInput), new ActionRowBuilder().addComponents(descInput));
        await interaction.showModal(modal);
    }

    if (interaction.isModalSubmit() && interaction.customId.startsWith('modal_waffel_')) {
        const mode = interaction.customId.replace('modal_waffel_', '');
        const prize = interaction.fields.getTextInputValue('input_prize');
        const durationStr = interaction.fields.getTextInputValue('input_duration');
        const descriptionOpt = interaction.fields.getTextInputValue('input_description') || null;
        let winners = parseInt(interaction.fields.getTextInputValue('input_winners'));

        const durationMs = parseDuration(durationStr);
        if (!durationMs || durationMs <= 0) return interaction.reply({ content: "❌ Invalid duration format! Use formats like `45s`, `10m` or `5h`.", ephemeral: true });
        if (isNaN(winners) || winners <= 0) winners = 1;
        if ((mode === 'sos' || mode === 'rps') && winners !== 2) return interaction.reply({ content: "❌ Requires exactly 2 winners.", ephemeral: true });
        if (mode === 'clicker') winners = 1;
        
        await interaction.reply({ content: `✅ Successfully created your ${mode.toUpperCase()} giveaway!`, ephemeral: true });
        startGiveawayEngine(interaction.channel, durationMs, prize, winners, mode, descriptionOpt, interaction.user);
    }

    if (interaction.isModalSubmit() && interaction.customId.startsWith('modal_claim_ticket_')) {
        const customIdParts = interaction.customId.split('_');
        const prizeAmount = Buffer.from(customIdParts[3], 'base64').toString('utf8');
        const hostName = Buffer.from(customIdParts[4], 'base64').toString('utf8');
        const ignName = interaction.fields.getTextInputValue('claim_ign');

        await interaction.deferReply({ ephemeral: true });

        try {
            const SECURE_CATEGORY_ID = "1443450226647240796"; 
            const SECURE_STAFF_ROLE_ID = "1423749610395930707";   

            const channelOptions = {
                name: `🎫-${interaction.user.username}`,
                type: ChannelType.GuildText,
                parent: SECURE_CATEGORY_ID, 
                permissionOverwrites: [
                    {
                        id: interaction.guild.roles.everyone.id,
                        deny: [PermissionFlagsBits.ViewChannel],
                    },
                    {
                        id: interaction.user.id,
                        allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages, PermissionFlagsBits.ReadMessageHistory],
                    },
                    {
                        id: SECURE_STAFF_ROLE_ID,
                        allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages, PermissionFlagsBits.ReadMessageHistory],
                    }
                ],
            };

            const ticketChannel = await interaction.guild.channels.create(channelOptions);
            const closeBtn = new ButtonBuilder().setCustomId('close_giveaway_ticket').setLabel('Close Ticket 🔴').setStyle(ButtonStyle.Danger);
            const closeRow = new ActionRowBuilder().addComponents(closeBtn);

            const ticketEmbed = new EmbedBuilder()
                .setTitle('📥 New Giveaway Claim Ticket Opened')
                .setColor('#2ECC71')
                .setDescription(`Welcome ${interaction.user}, our support team will handle your reward transaction shortly!\n\n*Staff members can click the red button below to close and delete this channel.*`)
                .addFields(
                    { name: '🎁 Prize Handed Out', value: prizeAmount, inline: true },
                    { name: '🎮 In-Game Name (IGN)', value: ignName, inline: true },
                    { name: '👑 Giveaway Host', value: hostName, inline: true }
                )
                .setFooter({ text: "Waffel's Automated Tickets" })
                .setTimestamp();

            await ticketChannel.send({ 
                content: `🔔 <@&${SECURE_STAFF_ROLE_ID}> | New claim request from ${interaction.user}`, 
                embeds: [ticketEmbed],
                components: [closeRow]
            });
            
            await interaction.editReply({ content: `✅ Your ticket channel has been created successfully: ${ticketChannel}` });
        } catch (error) {
            console.error("❌ ERROR CREATING TICKET CHANNEL:", error);
            await interaction.editReply({ content: "❌ An error occurred while auto-generating your private ticket channel. Make sure the bot has the **Manage Channels** permission and the IDs in the code are correct." });
        }
    }

    if (interaction.isButton() && interaction.customId.startsWith('claim_gw_')) {
        const parts = interaction.customId.split('_');
        const allowedWinnerId = parts[2]; 
        const rawPrizeB64 = parts[3];     
        const rawHostB64 = parts[4];      

        if (interaction.user.id !== allowedWinnerId) {
            return interaction.reply({ content: "❌ **Access Denied.** You are not the registered winner of this giveaway.", ephemeral: true });
        }

        const modal = new ModalBuilder()
            .setCustomId(`modal_claim_ticket_${allowedWinnerId}_${rawPrizeB64}_${rawHostB64}`)
            .setTitle('Claim Giveaway Reward Menu 🏆');
            
        const ignInput = new TextInputBuilder()
            .setCustomId('claim_ign')
            .setLabel("What is your In-Game Name (IGN)?")
            .setStyle(TextInputStyle.Short)
            .setPlaceholder("e.g., WaffelPlayer99")
            .setRequired(true);
            
        modal.addComponents(new ActionRowBuilder().addComponents(ignInput));
        await interaction.showModal(modal);
    }

    if (interaction.isButton() && interaction.customId === 'close_giveaway_ticket') {
        const SECURE_STAFF_ROLE_ID = "1423749610395930707"; 

        if (!interaction.member.roles.cache.has(SECURE_STAFF_ROLE_ID) && !interaction.member.permissions.has(PermissionFlagsBits.Administrator)) {
            return interaction.reply({ content: "❌ Only Staff Members are authorized to close giveaway claim tickets.", ephemeral: true });
        }
        await interaction.reply({ content: "🔒 **Closing ticket...** This channel will be deleted in 5 seconds." });
        setTimeout(async () => { await interaction.channel.delete().catch(() => null); }, 5000);
        return;
    }
});

async function startGiveawayEngine(channel, durationMs, prize, winnerCount, mode, customTitle, hostUser) {
    const endTime = Date.now() + durationMs;
    const endTimeStamp = Math.floor(endTime / 1000);
    const title = customTitle ? ` 🧇 ${customTitle} 🧇 ` : "✨ WAFFEL'S GIVEAWAY ✨";

    let description = `⏳ **Ends:** <t:${endTimeStamp}:R> (<t:${endTimeStamp}:F>)\n👑 **Hosted by:** ${hostUser}\n👥 **Entries:** **0**\n🏆 **Winners:** **${winnerCount}**\n🎁 **Each winner gets:** **${prize}**`;
    if (mode === 'clicker') { 
        description = `⚡ **WAFFLE CLICKER (SPEED GAME)** ⚡\n👑 **Hosted by:** ${hostUser}\n🎁 **Each winner gets:** **${prize}**\n\n🚨 The very **FIRST** person to click the green button wins!`;
    }

    const embed = new EmbedBuilder().setTitle(title).setDescription(description).setColor('#F1C40F').setTimestamp();
    const enterButton = new ButtonBuilder().setCustomId('enter_giveaway').setLabel(mode === 'clicker' ? 'CLICK ME TO WIN! 🔒⚡' : 'Join the Giveaway! 🎉').setStyle(mode === 'clicker' ? ButtonStyle.Success : ButtonStyle.Primary);
    const row = new ActionRowBuilder().addComponents(enterButton);
    const msg = await channel.send({ embeds: [embed], components: [row] });

    giveawaysDatabase[msg.id] = {
        channelId: channel.id,
        endTime: endTime,
        prize: prize,
        winnerCount: winnerCount,
        mode: mode,
        title: title,
        hostUser: hostUser.toString(),
        participants: []
    };
    saveDatabase();

    resumeGiveawayCollector(channel, msg.id, durationMs);
}

function resumeGiveawayCollector(channel, msgId, durationMs) {
    const collector = channel.createMessageComponentCollector({ 
        filter: i => i.message.id === msgId,
        time: durationMs 
    });

    collector.on('collect', async (btnInt) => {
        const gw = giveawaysDatabase[msgId];
        if (!gw) return;

        if (btnInt.customId === 'enter_giveaway') {
            if (blacklistDatabase.has(btnInt.user.id)) {
                return btnInt.reply({ content: "❌ **Entry Denied.** You have been blacklisted.", ephemeral: true });
            }

            if (gw.mode === 'clicker') {
                gw.participants.push(btnInt.user.id);
                initStats(btnInt.user.id);
                statsDatabase[btnInt.user.id].entered += 1;
                saveDatabase();
                await btnInt.reply({ content: " 🧇 CRITICAL CLICK! Checking if you were the fastest...", ephemeral: true });
                collector.stop();
            } else {
                if (gw.participants.includes(btnInt.user.id)) {
                    const leaveButton = new ButtonBuilder().setCustomId(`leave_gw_${btnInt.user.id}`).setLabel('🚨 LEAVE THIS GIVEAWAY RIGHT NOW 🚨').setStyle(ButtonStyle.Danger);
                    return btnInt.reply({ content: "⚠️ You are already participating!", components: [new ActionRowBuilder().addComponents(leaveButton)], ephemeral: true });
                }
                gw.participants.push(btnInt.user.id);
                initStats(btnInt.user.id);
                statsDatabase[btnInt.user.id].entered += 1;
                saveDatabase();

                const endTimeStamp = Math.floor(gw.endTime / 1000);
                let upDescription = `⏳ **Ends:** <t:${endTimeStamp}:R> (<t:${endTimeStamp}:F>)\n👑 **Hosted by:** ${gw.hostUser}\n👥 **Entries:** **${gw.participants.length}**\n🏆 **Winners:** **${gw.winnerCount}**\n🎁 **Each winner gets:** **${gw.prize}**`;
                const upEmbed = new EmbedBuilder().setTitle(gw.title).setDescription(upDescription).setColor('#F1C40F').setTimestamp();
                
                await btnInt.update({ embeds: [upEmbed] });
                await btnInt.followUp({ content: "✅ Successfully entered the giveaway!", ephemeral: true });
            }
        }
        
        if (btnInt.customId.startsWith('leave_gw_')) {
            const allowedUserId = btnInt.customId.replace('leave_gw_', '');
            if (btnInt.user.id !== allowedUserId) return btnInt.reply({ content: "❌ This button isn't for you.", ephemeral: true });
            
            const gw = giveawaysDatabase[msgId];
            const index = gw.participants.indexOf(btnInt.user.id);
            if (index > -1) {
                gw.participants.splice(index, 1);
                if (statsDatabase[btnInt.user.id] && statsDatabase[btnInt.user.id].entered > 0) {
                    statsDatabase[btnInt.user.id].entered -= 1;
                }

                const endTimeStamp = Math.floor(gw.endTime / 1000);
                let upDescription = `⏳ **Ends:** <t:${endTimeStamp}:R> (<t:${endTimeStamp}:F>)\n👑 **Hosted by:** ${gw.hostUser}\n👥 **Entries:** **${gw.participants.length}**\n🏆 **Winners:** **${gw.winnerCount}**\n🎁 **Each winner gets:** **${gw.prize}**`;
                const upEmbed = new EmbedBuilder().setTitle(gw.title).setDescription(upDescription).setColor('#F1C40F').setTimestamp();
                
                const originalMsg = await channel.messages.fetch(msgId).catch(() => null);
                if (originalMsg) await originalMsg.edit({ embeds: [upEmbed] });
                
                await btnInt.update({ content: "👋 You have successfully left this giveaway.", components: [] });
                saveDatabase();
            } else { 
                await btnInt.reply({ content: "❌ You are no longer in this giveaway.", ephemeral: true }); 
            }
        }
    });

    collector.on('end', () => {
        runGiveawayEnd(channel, msgId);
    });
}

async function runGiveawayEnd(channel, msgId) {
    const gw = giveawaysDatabase[msgId];
    if (!gw) return;

    const endMsg = await channel.messages.fetch(msgId).catch(() => null);
    const disButton = new ButtonBuilder().setCustomId('ended').setDisabled(true).setLabel(gw.mode === 'clicker' ? 'Waffle Clicked! 🔒' : 'Giveaway Closed 🔒').setStyle(ButtonStyle.Secondary);
    
    if (endMsg) await endMsg.edit({ components: [new ActionRowBuilder().addComponents(disButton)] }).catch(() => null);

    if (gw.participants.length === 0) {
        const finalEmbed = new EmbedBuilder().setTitle(gw.title).setDescription(`❌ **Giveaway Ended:** No one joined.\n👑 **Hosted by:** ${gw.hostUser}\n🎁 **Each winner gets:** **${gw.prize}**`).setColor('#E74C3C');
        if (endMsg) await endMsg.edit({ embeds: [finalEmbed] });
        delete giveawaysDatabase[msgId];
        saveDatabase();
        return;
    }

    const rawPrizeB64 = Buffer.from(gw.prize).toString('base64');
    const rawHostB64 = Buffer.from(`${gw.hostUser}`).toString('base64');

    if (gw.mode === 'clicker') {
        const winnerId = gw.participants[0];
        initStats(winnerId);
        statsDatabase[winnerId].won += 1;
        saveDatabase();

        const secureClaimBtn = new ButtonBuilder().setCustomId(`claim_gw_${winnerId}_${rawPrizeB64}_${rawHostB64}`).setLabel('Claim 🟢').setStyle(ButtonStyle.Success);
        const finalEmbed = new EmbedBuilder().setTitle(gw.title).setDescription(`⚡ **CLICKER OVER!**\n👑 **Fastest Clicker:** <@${winnerId}>\n🎁 **Each winner gets:** **${gw.prize}**`).setColor('#2ECC71');
        
        if (endMsg) await endMsg.edit({ embeds: [finalEmbed] });
        await channel.send({
            content: `⚡ 🧇 **WAFFLE CLICKER WINNER!** Congratulations <@${winnerId}>, you reacted the fastest and won **${gw.prize}**! 🎉🏆\nClick the button below to claim your prize!`,
            components: [new ActionRowBuilder().addComponents(secureClaimBtn)]
        });
        delete giveawaysDatabase[msgId];
        saveDatabase();
        return;
    }

    const validParticipants = gw.participants.filter(id => !blacklistDatabase.has(id));

    if ((gw.mode === 'sos' || gw.mode === 'rps') && validParticipants.length === 1) { 
        validParticipants.push(validParticipants[0]); 
    }
    
    if (validParticipants.length < gw.winnerCount) {
        const finalEmbed = new EmbedBuilder().setTitle(gw.title).setDescription(`❌ **Giveaway Ended:** Not enough eligible participants.\n👑 **Hosted by:** ${gw.hostUser}`).setColor('#E74C3C');
        if (endMsg) await endMsg.edit({ embeds: [finalEmbed] });
        delete giveawaysDatabase[msgId];
        saveDatabase();
        return;
    }

    const shuffled = validParticipants.sort(() => 0.5 - Math.random());
    const winners = shuffled.slice(0, gw.winnerCount);
    const winnersMention = winners.map(id => `<@${id}>`).join(', ');

    const finalEmbed = new EmbedBuilder().setTitle(gw.title).setDescription(`🎉 **GIVEAWAY ENDED!**\n👑 **Winner(s):** ${winnersMention}\n👑 **Hosted by:** ${gw.hostUser}\n🎁 **Each winner gets:** **${gw.prize}**`).setColor('#2ECC71');
    if (endMsg) await endMsg.edit({ embeds: [finalEmbed] });

    if (gw.mode === 'normal') {
        winners.forEach(wId => {
            initStats(wId);
            statsDatabase[wId].won += 1;
        });
        saveDatabase();

        const primaryWinnerId = winners[0];
        const secureClaimBtn = new ButtonBuilder().setCustomId(`claim_gw_${primaryWinnerId}_${rawPrizeB64}_${rawHostB64}`).setLabel('Claim 🟢').setStyle(ButtonStyle.Success);

        await channel.send({
            content: `🎉 🧇 **CONGRATULATIONS** ${winnersMention}! You won **${gw.prize}**! 🎁✨\nClick the button below to open your ticket!`,
            components: [new ActionRowBuilder().addComponents(secureClaimBtn)]
        });
    }

    handleMiniGames(channel, winners, gw.prize, (gw.endTime - Date.now()), gw.winnerCount, gw.mode, gw.hostUser);
    
    delete giveawaysDatabase[msgId];
    saveDatabase();
}

async function handleMiniGames(channel, winners, prize, durationMs, winnerCount, mode, originHost) {
    if (mode === 'clicker' || mode === 'normal') return;
    
    const rawPrizeB64 = Buffer.from(prize).toString('base64');
    const rawHostB64 = Buffer.from(`${originHost}`).toString('base64');
    const claimBtn = new ButtonBuilder().setLabel('Claim 🟢').setStyle(ButtonStyle.Success);
    const claimRow = new ActionRowBuilder().addComponents(claimBtn);

    if (mode === 'dok') {
        const winnerId = winners[0];
        const doubleBtn = new ButtonBuilder().setCustomId('dok_double').setLabel('Double 🟢').setStyle(ButtonStyle.Success);
        const keepBtn = new ButtonBuilder().setCustomId('dok_keep').setLabel('Keep 🔴').setStyle(ButtonStyle.Danger);
        const gameRow = new ActionRowBuilder().addComponents(doubleBtn, keepBtn);
        const gameMsg = await channel.send({ content: `📢 <@${winnerId}>, choose your destiny! **Double** or **Keep**? 🧇`, components: [gameRow] });
        const gameColl = gameMsg.createMessageComponentCollector({ componentType: ComponentType.Button, time: 30000 });
        
        gameColl.on('collect', async (gInt) => {
            if (gInt.user.id !== winnerId) return gInt.reply({ content: "❌ Only the winner can choose!", ephemeral: true });
            gameColl.stop(); doubleBtn.setDisabled(true); keepBtn.setDisabled(true);
            await gameMsg.edit({ components: [new ActionRowBuilder().addComponents(doubleBtn, keepBtn)] });
            
            if (gInt.customId === 'dok_keep') { 
                initStats(winnerId);
                statsDatabase[winnerId].won += 1;
                saveDatabase();

                claimBtn.setCustomId(`claim_gw_${winnerId}_${rawPrizeB64}_${rawHostB64}`);
                await gInt.reply({ content: `🔒 **Giveaway Ended... KEEP!** <@${winnerId}> kept their **${prize}**! GG! 🧇🎁`, components: [claimRow] }); 
            } else {
                let newPrize = prize; const match = prize.match(/\d+/);
                if (match) { const oldN = parseInt(match[0]); newPrize = prize.replace(oldN, oldN * 2); } else { newPrize = `2x ${prize}`; }
                await gInt.reply(`🟢 **DOUBLE ACTIVATED!** New reward: **${newPrize}**! Re-rolling in 5s... 🚀`);
                setTimeout(() => startGiveawayEngine(channel, 15000, newPrize, winnerCount, 'dok', "DOUBLE OR KEEP", gInt.user), 5000);
            }
        });
    }

    if (mode === 'sos') {
        const p1 = winners[0]; const p2 = winners[1];
        const splitBtn = new ButtonBuilder().setCustomId('sos_split').setLabel('Split 🟢').setStyle(ButtonStyle.Success);
        const stealBtn = new ButtonBuilder().setCustomId('sos_steal').setLabel('Steal 🔴').setStyle(ButtonStyle.Danger);
        const sosRow = new ActionRowBuilder().addComponents(splitBtn, stealBtn);
        const sosMsg = await channel.send({ content: `⚔️ <@${p1}> and <@${p2}>! You both won! Choose **Split** 🟢 or **Steal** 🔴!`, components: [sosRow] });
        const choices = {}; const sosColl = sosMsg.createMessageComponentCollector({ componentType: ComponentType.Button, time: 30000 });

        sosColl.on('collect', async (sInt) => {
            if (sInt.user.id !== p1 && sInt.user.id !== p2) return sInt.reply({ content: "❌ You are not a winner!", ephemeral: true });
            if (choices[sInt.user.id]) return sInt.reply({ content: "⚠️ You already chose!", ephemeral: true });
            choices[sInt.user.id] = sInt.customId.replace('sos_', ''); await sInt.reply({ content: `✅ Choice registered!`, ephemeral: true });
            
            if (choices[p1] && choices[p2]) {
                sosColl.stop(); splitBtn.setDisabled(true); stealBtn.setDisabled(true);
                await sosMsg.edit({ components: [new ActionRowBuilder().addComponents(splitBtn, stealBtn)] });
                
                if (choices[p1] === 'split' && choices[p2] === 'split') { 
                    initStats(p1); statsDatabase[p1].won += 1;
                    initStats(p2); statsDatabase[p2].won += 1;
                    
                    claimBtn.setCustomId(`claim_gw_${p1}_${rawPrizeB64}_${rawHostB64}`);
                    await channel.send({ content: `🤝 **SPLIT!** <@${p1}> and <@${p2}> share the prize: **${prize}**! 🎉`, components: [claimRow] }); 
                }
                else if (choices[p1] === 'steal' && choices[p2] === 'steal') { 
                    await channel.send(`💀 **STEAL TO STEAL!** Both tried to steal. **NO ONE WINS**! ❌`); 
                }
                else { 
                    const thief = choices[p1] === 'steal' ? p1 : p2; 
                    initStats(thief); statsDatabase[thief].won += 1;
                    
                    claimBtn.setCustomId(`claim_gw_${thief}_${rawPrizeB64}_${rawHostB64}`);
                    await channel.send({ content: `😈 **BETRAYAL!** <@${thief}> stole everything and wins **${prize}**! 🏆`, components: [claimRow] }); 
                }
                saveDatabase();
            }
        });
    }

    if (mode === 'rps') {
        const p1 = winners[0]; const p2 = winners[1];
        const rBtn = new ButtonBuilder().setCustomId('rps_rock').setLabel('🪨 Rock').setStyle(ButtonStyle.Secondary);
        const pBtn = new ButtonBuilder().setCustomId('rps_paper').setLabel('📄 Paper').setStyle(ButtonStyle.Primary);
        const sBtn = new ButtonBuilder().setCustomId('rps_scissors').setLabel('✂️ Scissors').setStyle(ButtonStyle.Danger);
        const rpsRow = new ActionRowBuilder().addComponents(rBtn, pBtn, sBtn);
        const rpsMsg = await channel.send({ content: `🪨📄✂️ <@${p1}> vs <@${p2}>! Battle for **${prize}**! Make your choice:`, components: [rpsRow] });
        const rpsChoices = {}; const rpsColl = rpsMsg.createMessageComponentCollector({ componentType: ComponentType.Button, time: 45000 });

        rpsColl.on('collect', async (rInt) => {
            if (rInt.user.id !== p1 && rInt.user.id !== p2) return rInt.reply({ content: "❌ You are not in this battle!", ephemeral: true });
            if (rpsChoices[rInt.user.id]) return rInt.reply({ content: "⚠️ Choice already locked!", ephemeral: true });
            rpsChoices[rInt.user.id] = rInt.customId.replace('rps_', ''); await rInt.reply({ content: `🔮 Choice locked!`, ephemeral: true });
            
            if (rpsChoices[p1] && rpsChoices[p2]) {
                rpsColl.stop(); rBtn.setDisabled(true); pBtn.setDisabled(true); sBtn.setDisabled(true);
                await rpsMsg.edit({ components: [new ActionRowBuilder().addComponents(rBtn, pBtn, sBtn)] });
                const c1 = rpsChoices[p1]; const c2 = rpsChoices[p2];
                
                if (c1 === c2) { 
                    await channel.send(`🤝 **DRAW!** Both chose **${c1}**. Battle ends in a tie (No wins added)! 🧇`); 
                }
                else if ((c1 === 'rock' && c2 === 'scissors') || (c1 === 'paper' && c2 === 'rock') || (c1 === 'scissors' && c2 === 'paper')) { 
                    initStats(p1); statsDatabase[p1].won += 1;
                    claimBtn.setCustomId(`claim_gw_${p1}_${rawPrizeB64}_${rawHostB64}`);
                    await channel.send({ content: `👑 **VICTORY!** <@${p1}> wins **${prize}**! ✨`, components: [claimRow] }); 
                }
                else { 
                    initStats(p2); statsDatabase[p2].won += 1;
                    claimBtn.setCustomId(`claim_gw_${p2}_${rawPrizeB64}_${rawHostB64}`);
                    await channel.send({ content: `👑 **VICTORY!** <@${p2}> wins **${prize}**! ✨`, components: [claimRow] }); 
                }
                saveDatabase();
            }
        });
    }
}

client.login(process.env.DISCORD_TOKEN);

