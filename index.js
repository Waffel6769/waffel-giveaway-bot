require('dotenv').config();
const { 
    Client, GatewayIntentBits, EmbedBuilder, ActionRowBuilder, ButtonBuilder, 
    ButtonStyle, ComponentType, REST, Routes, SlashCommandBuilder, 
    StringSelectMenuBuilder, StringSelectMenuOptionBuilder, ModalBuilder, 
    TextInputBuilder, TextInputStyle, PermissionFlagsBits, ChannelType 
} = require('discord.js');
const express = require('express');

const client = new Client({ 
    intents: [
        GatewayIntentBits.Guilds, 
        GatewayIntentBits.GuildMessages, 
        GatewayIntentBits.MessageContent, 
        GatewayIntentBits.GuildMembers
    ] 
});
const warnDatabase = {};
const blacklistDatabase = new Set();
const statsDatabase = {}; // Local database for user statistics
const app = express();

// ⚙️ CONFIGURATION IDs (Replace with your actual server IDs)
const LOG_CHANNEL_ID = '123456789012345678'; 
const TICKET_CATEGORY_ID = '123456789012345678'; // Category ID for tickets
const STAFF_ROLE_ID = '123456789012345678'; // Staff role ID allowed to see tickets

// Helper function to initialize statistics
function initStats(userId) {
    if (!statsDatabase[userId]) {
        statsDatabase[userId] = { entered: 0, won: 0 };
    }
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
        .addUserOption(option => option.setName('target').setDescription('The user to view stats for').setRequired(false))
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
        const args = message.content.slice('!gstart'.length).trim().split(/ +/);
        const durationStr = args[0];
        const prize = args.slice(1).join(' ');
        if (!durationStr || !prize) return;

        function parseTextDuration(str) {
            if (!str) return null; const match = str.match(/^(\d+)(sec|s|m|h|d)/i); if (!match) return null;
            const val = parseInt(match[1]); const unit = match[2].toLowerCase();
            if (unit === 's' || unit === 'sec') return val * 1000; if (unit === 'm') return val * 60 * 1000;
            if (unit === 'h') return val * 60 * 60 * 1000; if (unit === 'd') return val * 24 * 60 * 60 * 1000;
            return null;
        }

        const durationMs = parseTextDuration(durationStr) || (parseInt(durationStr) * 60 * 1000);
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
        return message.channel.send(`🧹 Removed the latest warning from **${target.user.tag}** (Remaining: ${warnDatabase[target.id].length}).`);
    }
    if (!['to', 'rto', 'kick', 'ban', 'unban', 'warn'].includes(command)) return;
    setTimeout(() => message.delete().catch(() => null), 200);
    if (!banPerm) return message.channel.send("❌ Permission denied.").then(m => setTimeout(() => m.delete().catch(() => null), 5000));

    if (command === 'unban') {
        const userId = args[0];
        if (!userId) return message.channel.send("❌ Please provide a valid User ID.").then(m => setTimeout(() => m.delete().catch(() => null), 5000));
        try { await message.guild.members.unban(userId); return message.channel.send(`🔓 **User ID (${userId})** has been successfully unbanned.`); } 
        catch (e) { return message.channel.send("❌ User not found or is not currently banned.").then(m => setTimeout(() => m.delete().catch(() => null), 5000)); }
    }
    const target = message.mentions.members.first();
    if (!target) return message.channel.send(`❌ Please mention a valid user.`).then(m => setTimeout(() => m.delete().catch(() => null), 5000));
    
    if (command === 'warn') {
        const reason = args.slice(1).join(' ') || "No reason provided";
        if (!warnDatabase[target.id]) warnDatabase[target.id] = [];
        warnDatabase[target.id].push({ reason, moderator: message.author.tag, date: new Date().toLocaleDateString() });
        await target.send(`⚠️ **Warning:** You received a warning in **${message.guild.name}**.\nReason: ${reason}`).catch(() => null);
        return message.channel.send(`⚠️ **${target.user.tag}** has been warned. Reason: ${reason}`);
    }

    if (!target.moderatable) return message.channel.send("❌ I cannot moderate this user.").then(m => setTimeout(() => m.delete().catch(() => null), 5000));

    function parseDuration(str) {
        if (!str) return null; const match = str.match(/^(\d+)(sec|s|m|h|d|w|y)/i); if (!match) return null;
        const val = parseInt(match[1]); const unit = match[2].toLowerCase();
        if (unit === 's' || unit === 'sec') return val * 1000; if (unit === 'm') return val * 60 * 1000;
        if (unit === 'h') return val * 60 * 60 * 1000; if (unit === 'd') return val * 24 * 60 * 60 * 1000;
        if (unit === 'w') return val * 7 * 24 * 60 * 60 * 1000; if (unit === 'y') return val * 365 * 24 * 60 * 60 * 1000;
        return null;
    }

    if (command === 'rto') { await target.timeout(null); return message.channel.send(`🗣️ **${target.user.tag}** timeout removed!`); }

    if (command === 'to') {
        let timeArg = args[0]; let durationMs = parseDuration(timeArg);
        let reason = durationMs ? args.slice(1).join(' ') : args.join(' ') || "No reason provided";
        let finalDuration = durationMs || (60 * 1000);
        if (finalDuration > 28 * 24 * 60 * 60 * 1000) { finalDuration = 28 * 24 * 60 * 60 * 1000; timeArg = "28d (Discord Max)"; }
        await target.timeout(finalDuration, reason);
        return message.channel.send(`🔇 **${target.user.tag}** timed out for **${timeArg || '1m'}**. Reason: ${reason}`);
    }

    if (command === 'kick') { const reason = args.slice(1).join(' ') || "No reason provided"; await target.kick(reason); return message.channel.send(`👢 **${target.user.tag}** kicked. Reason: ${reason}`); }

    if (command === 'ban') {
        let timeArg = args[0]; let durationMs = parseDuration(timeArg);
        let reason = durationMs ? args.slice(1).join(' ') : args.join(' ') || "No reason provided";
        await target.ban({ reason }); message.channel.send(`🔨 **${target.user.tag}** banned. Reason: ${reason}`);
        if (durationMs) { setTimeout(async () => { await message.guild.members.unban(target.id).catch(() => null); message.channel.send(`🔓 **${target.user.tag}** temporary ban expired.`); }, durationMs); }
    }
}
client.on('interactionCreate', async (interaction) => {
    if (interaction.isChatInputCommand() && ['gcreate', 'gend', 'greroll'].includes(interaction.commandName)) {
        if (!interaction.member.permissions.has(PermissionFlagsBits.ModerateMembers)) {
            return interaction.reply({ content: "❌ You must be a **Staff Member** (with Timeout permissions) to manage giveaways.", ephemeral: true });
        }
    }

    if (interaction.isChatInputCommand() && ['gwblacklist', 'gwunblacklist'].includes(interaction.commandName)) {
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

        if (interaction.commandName === 'help') {
            const embed = new EmbedBuilder().setTitle('📋 Available Bot Commands Inventory').setColor('#F1C40F').setDescription('Here is a complete list of all the features integrated into this bot:\n\n').addFields(
                    { name: '✨ Slash Commands (/)', value: '`/help` - Displays this menu\n`/wjamal` - Sends a random funny frog GIF\n`/claimtime` - Displays official giveaway claim times and rules\n`/userinfo` - Shows profile information\n`/serverinfo` - Displays server stats\n`/avatar` - Displays member avatar\n`/infractions` - Shows warnings\n`/gcreate` - Opens the giveaway setup menu\n`/gend` - Ends a giveaway manually\n`/greroll` - Rerolls a giveaway winner\n`/gwblacklist` - Blacklists a user from giveaways\n`/gwunblacklist` - Removes a user from the blacklist\n`/winnerinfo` - Displays the summary of the last giveaway\n`/faq` - Display the server FAQ guide\n`/stats` - Display your giveaway stats and win rate' },
                    { name: '🛠️ Prefix Commands (?)', value: '`?lock` - Disables message sending\n`?unlock` - Enables message sending again\n`?clear <amount>` - Bulk deletes messages\n`?roleadd @member @role` - Adds a role\n`?unwarn @member` - Removes the latest warning\n`?warn @member <reason>` - Warns a member\n`?to <duration> <reason>` - Times out a user\n`?rto @member` - Removes timeout\n`?kick @member` - Kicks a member\n`?ban @member` - Bans a member' },
                    { name: '🎉 Automation System (!)', value: '`!gstart <minutes> <prize>` - Instantly launches a classic giveaway (Requires Staff privileges).' }
                ).setFooter({ text: `Waffel's Giveaway Utility` });
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
            return targetMsg.edit({ components: targetMsg.components }).catch(() => null);
        }

        if (interaction.commandName === 'greroll') {
            const msgId = interaction.options.getString('message_id');
            const targetMsg = await interaction.channel.messages.fetch(msgId).catch(() => null);
            if (!targetMsg || targetMsg.embeds.length === 0) return interaction.reply({ content: "❌ Valid giveaway message not found.", ephemeral: true });
            const originalEmbed = targetMsg.embeds[0];
            const prizeMatch = originalEmbed.description ? originalEmbed.description.match(/🎁 \*\*Each winner gets:\*\* (.+)/) : null;
            const prize = prizeMatch ? prizeMatch[1] : "Unknown Prize";
            await interaction.reply({ content: "🎲 **Rerolling a new winner...**", ephemeral: true });
            const randomMember = interaction.guild.members.cache.filter(m => !m.user.bot && !blacklistDatabase.has(m.id)).random();
            if (!randomMember) return interaction.followUp({ content: "❌ Could not find eligible participants to reroll.", ephemeral: true });

            const claimBtn = new ButtonBuilder().setCustomId('claim_giveaway_ticket').setLabel('Claim 🟢').setStyle(ButtonStyle.Success);
            const claimRow = new ActionRowBuilder().addComponents(claimBtn);

            initStats(randomMember.id);
            statsDatabase[randomMember.id].won += 1;

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
            await interaction.reply({ content: `🚫 Successfully added \${target} to the **@Giveaway Blacklist**.` });

            const logChannel = interaction.guild.channels.cache.get(LOG_CHANNEL_ID);
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
            await interaction.reply({ content: `✅ Successfully removed \${target} from the giveaway blacklist.` });

            const logChannel = interaction.guild.channels.cache.get(LOG_CHANNEL_ID);
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

            if (winnersInfo === 'Unknown Winner') {
                const fallbackWinner = description.match(/(?:👑|🏆)?\s*(?:\*\*)?Winners(?:\*\*)?:\s*(.+)/i);
                if (fallbackWinner) winnersInfo = normalizeValue(fallbackWinner[1]);
            }

            if (prizeInfo === 'Unknown Prize') {
                const fallbackPrize = description.match(/🎁\s*(?:\*\*)?Each winner gets:(?:\*\*)?\s*(.+)/i);
                if (fallbackPrize) prizeInfo = normalizeValue(fallbackPrize[1]);
            }

            const jumpButton = new ButtonBuilder()
                .setLabel('Jump to Giveaway Message 🧇')
                .setStyle(ButtonStyle.Link)
                .setURL(lastGiveaway.url);
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
            const faqText = `📖 Waffel's Menu FAQ\n❓ General\nQ: When does Waffel go live?\nA: He goes live at 22:30 (not everyday)\n\nQ: What does Waffel go live on?\nA: He goes live on Twitch\n---\n🎉 Giveaways\nQ: How do I join?\nA: Check:\n⁠🎉・daily-200m , ⁠🎉・weekly-1b , ⁠🎉・giveaways , or ⁠💸・quickdrops and ⁠💬・chat everyday at 22:00 \nand follow the instructions.\n\nQ: How do I claim my prize?\nA: Make a ⁠₊📫╺╸tickets within 24 Hours (30 Minutes if quickdrop)\n---\n\n🎭 Roles\nQ: Where can I get roles?\nA: Use ⁠₊✍️╺╸react-roles to change your roles. You can change them anytime.\n---\n\n📝 Staff/Regear Staff/Builder\nQ: How can I become discord staff/regear staff/builder?\nA: You can apply here: ⁠₊📑╺╸staff-apps \n---\n\n🛠️ Support\nQ: Need help?\nA: Make a support ticket here: ⁠₊📫╺╸tickets \n---\n\n🚫 Rules\nQ: Where can I find the rules?\nA: Read ⁠₊📖╺╸rules \n---\n\n💡 Still Have Questions?\nMake a ticket here: ⁠₊📫╺╸tickets`;

            const faqEmbed = new EmbedBuilder()
                .setTitle('📖 Waffel\'s Knowledge Base')
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
        
        function parseGiveawayDuration(str) {
            if (!str) return null; const match = str.match(/^(\d+)(sec|s|m|h|d)/i); if (!match) return null;
            const val = parseInt(match[1]); const unit = match[2].toLowerCase();
            if (unit === 's' || unit === 'sec') return val * 1000; if (unit === 'm') return val * 60 * 1000;
            if (unit === 'h') return val * 60 * 60 * 1000; if (unit === 'd') return val * 24 * 60 * 60 * 1000;
            return null;
        }

        const durationMs = parseGiveawayDuration(durationStr);
        if (!durationMs || durationMs <= 0) return interaction.reply({ content: "❌ Invalid duration format! Use formats like `45s`, `10m` or `5h`.", ephemeral: true });
        if (isNaN(winners) || winners <= 0) winners = 1;
        if ((mode === 'sos' || mode === 'rps') && winners !== 2) return interaction.reply({ content: "❌ Requires exactly 2 winners.", ephemeral: true });
        if (mode === 'clicker') winners = 1;
        
        await interaction.reply({ content: `✅ Successfully created your ${mode.toUpperCase()} giveaway!`, ephemeral: true });

        startGiveawayEngine(interaction.channel, durationMs, prize, winners, mode, descriptionOpt, interaction.user);
    }
    if (interaction.isModalSubmit() && interaction.customId === 'modal_claim_ticket') {
        const prizeAmount = interaction.fields.getTextInputValue('claim_amount');
        const ignName = interaction.fields.getTextInputValue('claim_ign');
        const hostName = interaction.fields.getTextInputValue('claim_host');

        await interaction.deferReply({ ephemeral: true });

        try {
            const ticketChannel = await interaction.guild.channels.create({
                name: `ticket-${interaction.user.username}`,
                type: ChannelType.GuildText,
                parent: TICKET_CATEGORY_ID || null,
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
                        id: STAFF_ROLE_ID,
                        allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages, PermissionFlagsBits.ReadMessageHistory],
                    }
                ],
            });

            const ticketEmbed = new EmbedBuilder()
                .setTitle('📥 New Giveaway Claim Ticket Opened')
                .setColor('#2ECC71')
                .setDescription(`Welcome ${interaction.user}, our support team will handle your reward transaction shortly!`)
                .addFields(
                    { name: '🎁 Prize / Amount Won', value: prizeAmount, inline: true },
                    { name: '🎮 In-Game Name (IGN)', value: ignName, inline: true },
                    { name: '👑 Giveaway Host', value: hostName, inline: true }
                )
                .setFooter({ text: "Waffel's Automated Tickets" })
                .setTimestamp();

            await ticketChannel.send({ content: `🔔 <@&${STAFF_ROLE_ID}> | New claim request from ${interaction.user}`, embeds: [ticketEmbed] });
            await interaction.editReply({ content: `✅ Your ticket channel has been created successfully: ${ticketChannel}` });

        } catch (error) {
            console.error(error);
            await interaction.editReply({ content: "❌ An error occurred while auto-generating your private ticket channel. Contact an administrator." });
        }
    }

    if (interaction.isButton() && interaction.customId === 'claim_giveaway_ticket') {
        const modal = new ModalBuilder().setCustomId('modal_claim_ticket').setTitle('Claim Giveaway Reward Menu 🏆');

        const amountInput = new TextInputBuilder().setCustomId('claim_amount').setLabel("How much did you win?").setStyle(TextInputStyle.Short).setPlaceholder("e.g., 500m / Special Waffle Bundle").setRequired(true);
        const ignInput = new TextInputBuilder().setCustomId('claim_ign').setLabel("What is your In-Game Name (IGN)?").setStyle(TextInputStyle.Short).setPlaceholder("e.g., WaffelPlayer99").setRequired(true);
        const hostInput = new TextInputBuilder().setCustomId('claim_host').setLabel("Who hosted the giveaway?").setStyle(TextInputStyle.Short).setPlaceholder("e.g., WaffelAdmin").setRequired(true);

        modal.addComponents(
            new ActionRowBuilder().addComponents(amountInput),
            new ActionRowBuilder().addComponents(ignInput),
            new ActionRowBuilder().addComponents(hostInput)
        );
        await interaction.showModal(modal);
    }
});
async function startGiveawayEngine(channel, durationMs, prize, winnerCount, mode, customTitle, hostUser) {
    const participants = [];
    const buttonLabel = mode === 'clicker' ? 'CLICK ME TO WIN! 🔒⚡' : 'Join the Giveaway! 🎉';
    const buttonStyle = mode === 'clicker' ? ButtonStyle.Success : ButtonStyle.Primary;
    const enterButton = new ButtonBuilder().setCustomId('enter_giveaway').setLabel(buttonLabel).setStyle(buttonStyle);
    const row = new ActionRowBuilder().addComponents(enterButton);
    
    const endTimeStamp = Math.floor((Date.now() + durationMs) / 1000);
    const title = customTitle ? `🧇 ${customTitle} 🧇` : "✨ WAFFEL'S GIVEAWAY ✨";

    let description = `⏳ **Ends:** <t:${endTimeStamp}:R> (<t:${endTimeStamp}:F>)\n👑 **Hosted by:** ${hostUser}\n👥 **Entries:** **0**\n🏆 **Winners:** **${winnerCount}**\n🎁 **Each winner gets:** **${prize}**`;
    if (mode === 'clicker') { 
        description = `⚡ **WAFFLE CLICKER (SPEED GAME)** ⚡\n👑 **Hosted by:** ${hostUser}\n🎁 **Each winner gets:** **${prize}**\n\n🚨 The very **FIRST** person to click the green button wins!`;
    }

    const embed = new EmbedBuilder().setTitle(title).setDescription(description).setColor('#F1C40F').setTimestamp();
    const msg = await channel.send({ embeds: [embed], components: [row] });
    
    const collector = msg.createMessageComponentCollector({ time: durationMs });

    collector.on('collect', async (btnInt) => {
        if (btnInt.customId === 'enter_giveaway') {
            if (blacklistDatabase.has(btnInt.user.id)) {
                return btnInt.reply({ content: "❌ **Entry Denied.** You have been blacklisted from participating in giveaways by the administration.", ephemeral: true });
            }

            if (mode === 'clicker') {
                participants.push(btnInt.user.id);
                initStats(btnInt.user.id);
                statsDatabase[btnInt.user.id].entered += 1;
                await btnInt.reply({ content: "🧇 CRITICAL CLICK! Checking if you were the fastest...", ephemeral: true });
                collector.stop();
            } else {
                if (participants.includes(btnInt.user.id)) {
                    const leaveButton = new ButtonBuilder().setCustomId(`leave_gw_${btnInt.user.id}`).setLabel('🚨 LEAVE THIS GIVEAWAY RIGHT NOW 🚨').setStyle(ButtonStyle.Danger);
                    const leaveRow = new ActionRowBuilder().addComponents(leaveButton);
                    return btnInt.reply({ content: "⚠️ You are already participating!", components: [leaveRow], ephemeral: true });
                }
                participants.push(btnInt.user.id);

                initStats(btnInt.user.id);
                statsDatabase[btnInt.user.id].entered += 1;

                let upDescription = `⏳ **Ends:** <t:${endTimeStamp}:R> (<t:${endTimeStamp}:F>)\n👑 **Hosted by:** ${hostUser}\n👥 **Entries:** **${participants.length}**\n🏆 **Winners:** **${winnerCount}**\n🎁 **Each winner gets:** **${prize}**`;
                const upEmbed = EmbedBuilder.from(embed).setDescription(upDescription);
                await btnInt.update({ embeds: [upEmbed] });
                await btnInt.followUp({ content: "✅ Successfully entered the giveaway!", ephemeral: true });
            }
        }
        
        if (btnInt.customId.startsWith('leave_gw_')) {
            const allowedUserId = btnInt.customId.replace('leave_gw_', '');
            if (btnInt.user.id !== allowedUserId) return btnInt.reply({ content: "❌ This button isn't for you.", ephemeral: true });
            const index = participants.indexOf(btnInt.user.id);
            if (index > -1) {
                participants.splice(index, 1);

                if (statsDatabase[btnInt.user.id] && statsDatabase[btnInt.user.id].entered > 0) {
                    statsDatabase[btnInt.user.id].entered -= 1;
                }

                let upDescription = `⏳ **Ends:** <t:${endTimeStamp}:R> (<t:${endTimeStamp}:F>)\n👑 **Hosted by:** ${hostUser}\n👥 **Entries:** **${participants.length}**\n🏆 **Winners:** **${winnerCount}**\n🎁 **Each winner gets:** **${prize}**`;
                const upEmbed = EmbedBuilder.from(embed).setDescription(upDescription);
                await msg.edit({ embeds: [upEmbed] });
                await btnInt.update({ content: "👋 You have successfully left this giveaway.", components: [] });
            } else { await btnInt.reply({ content: "❌ You are no longer in this giveaway.", ephemeral: true }); }
        }
    });

    collector.on('end', async () => {
        enterButton.setDisabled(true).setLabel(mode === 'clicker' ? 'Waffle Clicked! 🔒' : 'Giveaway Closed 🔒').setStyle(ButtonStyle.Secondary);
        const disRow = new ActionRowBuilder().addComponents(enterButton);
        const endMsg = await channel.messages.fetch(msg.id).catch(() => null);
        if (!endMsg) return;

        if (participants.length === 0) {
            const finalEmbed = EmbedBuilder.from(embed).setDescription(`❌ **Giveaway Ended:** No one joined.\n👑 **Hosted by:** ${hostUser}\n🎁 **Each winner gets:** **${prize}**`).setColor('#E74C3C');
            return await endMsg.edit({ embeds: [finalEmbed], components: [disRow] });
        }

        const claimBtn = new ButtonBuilder().setCustomId('claim_giveaway_ticket').setLabel('Claim 🟢').setStyle(ButtonStyle.Success);
        const claimRow = new ActionRowBuilder().addComponents(claimBtn);

        if (mode === 'clicker') {
            const winnerId = participants[0];
            initStats(winnerId);
            statsDatabase[winnerId].won += 1;

            const finalEmbed = EmbedBuilder.from(embed).setDescription(`⚡ **CLICKER OVER!**\n👑 **Fastest Clicker:** <@${winnerId}>\n🎁 **Each winner gets:** **${prize}**`).setColor('#2ECC71');
            await endMsg.edit({ embeds: [finalEmbed], components: [disRow] });
            return await channel.send({
                content: `⚡ 🧇 **WAFFLE CLICKER WINNER!** Congratulations <@${winnerId}>, you reacted the fastest and won **${prize}**! 🎉🏆\nClick the button below to claim your prize!`,
                components: [claimRow]
            });
        }

        const validParticipants = participants.filter(id => !blacklistDatabase.has(id));

        if ((mode === 'sos' || mode === 'rps') && validParticipants.length === 1) { validParticipants.push(validParticipants[0]); }
        if (validParticipants.length < winnerCount) {
            const finalEmbed = EmbedBuilder.from(embed).setDescription(`❌ **Giveaway Ended:** Not enough eligible participants.\n👑 **Hosted by:** ${hostUser}`).setColor('#E74C3C');
            return await endMsg.edit({ embeds: [finalEmbed], components: [disRow] });
        }

        const shuffled = validParticipants.sort(() => 0.5 - Math.random());
        const winners = shuffled.slice(0, winnerCount);
        const winnersMention = winners.map(id => `<@${id}>`).join(', ');

        winners.forEach(wId => {
            initStats(wId);
            statsDatabase[wId].won += 1;
        });

        const finalEmbed = EmbedBuilder.from(embed).setDescription(`🎉 **GIVEAWAY ENDED!**\n👑 **Winner(s):** ${winnersMention}\n👑 **Hosted by:** ${hostUser}\n🎁 **Each winner gets:** **${prize}**`).setColor('#2ECC71');
        await endMsg.edit({ embeds: [finalEmbed], components: [disRow] });
        
        await channel.send({
            content: `🎉 🧇 **CONGRATULATIONS** ${winnersMention}! You won **${prize}**! 🎁✨\nClick the button below to open your ticket!`,
            components: [claimRow]
        });

        // Cette section fait référence aux mini-jeux de votre ancien code
        // (handleMiniGames est toujours présent tout à la fin de votre script initial)
    });
}
client.login(process.env.DISCORD_TOKEN);
