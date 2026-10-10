require('dotenv').config();
const { 
    Client, GatewayIntentBits, EmbedBuilder, ActionRowBuilder, ButtonBuilder, 
    ButtonStyle, ComponentType, REST, Routes, SlashCommandBuilder, 
    StringSelectMenuBuilder, StringSelectMenuOptionBuilder, ModalBuilder, 
    TextInputBuilder, TextInputStyle, PermissionFlagsBits 
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
const giveawayStatsDatabase = new Map(); // Base de données des statistiques en mémoire
const app = express();

// ⚙️ REMPLACEZ ICI PAR L'ID DE VOTRE SALON DE LOGS PRIVÉ
const LOG_CHANNEL_ID = '123456789012345678'; 

// Fonction utilitaire pour initialiser les statistiques d'un joueur
function ensureUserStats(userId) {
    if (!giveawayStatsDatabase.has(userId)) {
        giveawayStatsDatabase.set(userId, { wins: 0, entries: 0, hosts: 0 });
    }
    return giveawayStatsDatabase.get(userId);
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
    new SlashCommandBuilder().setName('gwin').setDescription('View your giveaway wins and entry statistics 🏆')
        .addUserOption(option => option.setName('target').setDescription('The user to inspect (Optional)').setRequired(false)),
    new SlashCommandBuilder().setName('gwhost').setDescription('View the total number of giveaways hosted by a member 👑')
        .addUserOption(option => option.setName('target').setDescription('The user to inspect (Optional)').setRequired(false)),
    new SlashCommandBuilder().setName('gwlb').setDescription('Display the server giveaway leaderboard 📊')
        .addStringOption(option => option.setName('type').setDescription('Select the leaderboard category').setRequired(true)
            .addChoices(
                { name: '🥇 Top Winners', value: 'winners' },
                { name: '👑 Top Hosters', value: 'hosters' }
            )),
    new SlashCommandBuilder().setName('statsreset').setDescription('Completely reset all giveaway statistics of a user 🔄')
        .addUserOption(option => option.setName('target').setDescription('The user to reset').setRequired(true)),
    new SlashCommandBuilder().setName('userinfo').setDescription('Display official profile information about a user 👤')
        .addUserOption(option => option.setName('target').setDescription('The user to view').setRequired(false)),
    new SlashCommandBuilder().setName('serverinfo').setDescription('Display key statistics about this server 📊'),
    new SlashCommandBuilder().setName('avatar').setDescription('Get the full size avatar of a member 🖼️')
        .addUserOption(option => option.setName('target').setDescription('The user to view').setRequired(false)),
    new SlashCommandBuilder().setName('infractions').setDescription('View the moderation history and warnings of a user 📜')
        .addUserOption(option => option.setName('target').setDescription('The user to view').setRequired(false)),
    new SlashCommandBuilder().setName('help').setDescription('Display the list of all available bot commands 📋'),
    new SlashCommandBuilder().setName('wjamal').setDescription('Send a random funny frog GIF 🐸'),
    new SlashCommandBuilder().setName('claimtime').setDescription('Display official giveaway claim times and rules 🕐')
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
        console.log(`📡 KeepAlive received! Bot status: ${client.user.presence.status}`); 
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
        
        const hostStats = ensureUserStats(message.author.id);
        hostStats.hosts += 1;
        
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
        const targetMember = await interaction.guild.members.fetch(targetUser.id).catch(() => null);

        if (interaction.commandName === 'help') {
            const embed = new EmbedBuilder().setTitle('📋 Available Bot Commands Inventory').setColor('#F1C40F').setDescription('Here is a complete list of all the features integrated into this bot:')
                .addFields(
                    { name: '✨ Slash Commands (/)', value: '`/help` - Displays this menu\n`/wjamal` - Sends a random funny frog GIF\n`/claimtime` - Displays official giveaway claim times and rules\n`/gcreate` - Opens the interactive Giveaway setup engine\n`/gend <ID>` - Force ends a giveaway\n`/greroll <ID>` - Rerolls a winner 🎲\n`/gwblacklist <@user>` - Add a user to blacklist 🚫\n`/gwunblacklist <@user>` - Lift a user blacklist entry\n`/gwin [@user]` - Check wins & entries 🏆\n`/gwhost [@user]` - Check hosted giveaways count 👑\n`/gwlb` - Open server metrics leaderboard 📊\n`/statsreset <@user>` - Wipe profile analytics 🔄\n`/userinfo` - Shows profile insights\n`/serverinfo` - Displays key server statistics\n`/avatar` - Fetches profile avatar\n`/infractions` - Displays warning history' },
                    { name: '🛠️ Prefix Commands (?)', value: '`?lock` - Disables message sending\n`?unlock` - Enables message sending again\n`?clear <amount>` - Bulk deletes messages\n`?roleadd @member @role` - Assigns a specific role\n`?to @member <duration>` - Timeout system\n`?rto @member` - Removes an active timeout\n`?warn @member <reason>` - Logs a warning\n`?unwarn @member` - Removes latest warning\n`?kick @member` - Kicks a user\n`?ban @member <duration>` - Bans a user\n`?unban <User_ID>` - Unbans a user via ID' },
                    { name: '🎉 Automation System (!)', value: '`!gstart <minutes> <prize>` - Instantly launches a classic giveaway (Requires Staff privileges).' }
                ).setFooter({ text: `Waffel's Giveaway Utility` });
            return interaction.reply({ embeds: [embed] });
        }

        if (interaction.commandName === 'claimtime') {
            const embed = new EmbedBuilder().setTitle('🎉 Giveaway Info').setColor('#F1C40F').setDescription(
                `🕐 **Giveaway Claim Time**\n🏆 Quickdrops - 30 Minutes\n🎁 Weekly/Daily Giveaways - 24 hours\n🎉 Big Giveaways - 12 hours\n🏮 Stream Quickdrops - 3 Hours\n\n▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬\n\n📕 **Giveaway Rules**\n• You must show proof with a screen shot showing the part where it @s you\n• Don't ping any staff in the ticket or anywhere in the server\n• Only open 1 ticket when claiming a giveaway\n• Make sure to put your ign\n• Faking or alting giveaways with result in **@Giveaway Blacklist**\n\n*Proof Of All Giveaways Can Be Found In* **🟢・proof**`
            ).setTimestamp();
            return interaction.reply({ embeds: [embed] });
        }

        if (interaction.commandName === 'wjamal') {
            const frogGifs = ['https://giphy.com', 'https://giphy.com', 'https://giphy.com', 'https://giphy.com', 'https://giphy.com'];
            const randomFrog = frogGifs[Math.floor(Math.random() * frogGifs.length)];
            const embed = new EmbedBuilder().setTitle('🐸 W JAMAL').setColor('#2ECC71').setImage(randomFrog);
            return interaction.reply({ embeds: [embed] });
        }

        if (interaction.commandName === 'userinfo') {
            const embed = new EmbedBuilder().setTitle(`👤 User Info - ${targetUser.tag}`).setColor('#F1C40F').setThumbnail(targetUser.displayAvatarURL())
                .addFields({ name: '🆔 User ID', value: targetUser.id, inline: true }, { name: '📅 Created Account', value: `<t:${Math.floor(targetUser.createdTimestamp / 1000)}:R>`, inline: true }, { name: '📥 Joined Server', value: targetMember ? `<t:${Math.floor(targetMember.joinedTimestamp / 1000)}:R>` : 'Not in server', inline: true }).setFooter({ text: `Waffel's Giveaway Utility` });
            return interaction.reply({ embeds: [embed] });
        }

        if (interaction.commandName === 'serverinfo') {
            const embed = new EmbedBuilder().setTitle(`📊 Server Info - ${interaction.guild.name}`).setColor('#F1C40F').setThumbnail(interaction.guild.iconURL())
                .addFields({ name: '👑 Owner', value: `<@${interaction.guild.ownerId}>`, inline: true }, { name: '👥 Total Members', value: `${interaction.guild.memberCount}`, inline: true }, { name: '🚀 Boosts', value: `${interaction.guild.premiumSubscriptionCount || 0} Boosts`, inline: true }).setFooter({ text: `Waffel's Giveaway Utility` });
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
            const embed = new EmbedBuilder().setTitle('🧇 Waffel\'s Giveaway Setup Menu').setDescription('Please select a game mode below.').setColor('#F1C40F');
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
            
            const stats = ensureUserStats(randomMember.id);
            stats.wins += 1;

            return interaction.channel.send(`🎲 **NEW REROLL WINNER!** Congratulations \${randomMember}, you won **\${prize}**! 🎁✨`);
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
                        { name: '👤 Target User', value: `target ({target.tag})`, inline: true },
                        { name: '🛡️ Moderator', value: `interaction.user ({interaction.user.tag})`, inline: true },
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
                        { name: '👤 Target User', value: `target ({target.tag})`, inline: true },
                        { name: '🛡️ Moderator', value: `interaction.user ({interaction.user.tag})`, inline: true },
                        { name: '🆔 User ID', value: `\`${target.id}\``, inline: false }
                    )
                    .setTimestamp();
                await logChannel.send({ embeds: [logEmbed] }).catch(() => null);
            }
            return;
        }
        if (interaction.commandName === 'gwin') {
            const user = interaction.options.getUser('target') || interaction.user;
            const stats = ensureUserStats(user.id);

            const embed = new EmbedBuilder()
                .setTitle(`🏆 Giveaway Player Profile - \${user.username}`)
                .setColor('#F1C40F')
                .setThumbnail(user.displayAvatarURL())
                .setDescription(`Here are the giveaway statistics logged for this member on the server:`)
                .addFields(
                    { name: '🎉 Total Wins', value: `🏆 **\${stats.wins}** win(s)`, inline: true },
                    { name: '🎟️ Total Participations', value: `📥 **\${stats.entries}** entry(ies)`, inline: true }
                )
                .setFooter({ text: "Waffel's Giveaway Utility • Realtime Stats" })
                .setTimestamp();

            return interaction.reply({ embeds: [embed] });
        }

        if (interaction.commandName === 'gwhost') {
            const user = interaction.options.getUser('target') || interaction.user;
            const stats = ensureUserStats(user.id);

            const embed = new EmbedBuilder()
                .setTitle(`👑 Giveaway Host Profile - \${user.username}`)
                .setColor('#F1C40F')
                .setThumbnail(user.displayAvatarURL())
                .setDescription(`Tracking the number of management tasks performed by this member:`)
                .addFields(
                    { name: '🧇 Giveaways Hosted', value: `👑 **\${stats.hosts}** giveaway(s) managed via the bot`, inline: false }
                )
                .setFooter({ text: "Waffel's Giveaway Utility • Staff Metrics" })
                .setTimestamp();

            return interaction.reply({ embeds: [embed] });
        }

        if (interaction.commandName === 'gwlb') {
            const lbType = interaction.options.getString('type');
            const sortedArray = Array.from(giveawayStatsDatabase.entries());

            let embedTitle = '';
            let leaderboardDescription = '';

            if (lbType === 'winners') {
                embedTitle = '🥇 GIVEAWAY WINNERS LEADERBOARD 🥇';
                sortedArray.sort((a, b) => b[1].wins - a[1].wins);
                
                const top10 = sortedArray.slice(0, 10);
                if (top10.length === 0) leaderboardDescription = '*No logged data yet.*';
                
                top10.forEach((item, index) => {
                    const medal = index === 0 ? '🥇' : index === 1 ? '🥈' : index === 2 ? '🥉' : '▪️';
                    leaderboardDescription += `\${medal} **#\({index + 1}** <@\){item[0]}> ➜ **\${item[1].wins}** win(s) *(Entries: \${item[1].entries})*\n`;
                });
            } else if (lbType === 'hosters') {
                embedTitle = '👑 GIVEAWAY HOSTERS LEADERBOARD 👑';
                sortedArray.sort((a, b) => b[1].hosts - a[1].hosts);
                
                const top10 = sortedArray.slice(0, 10);
                if (top10.length === 0) leaderboardDescription = '*No logged data yet.*';
                
                top10.forEach((item, index) => {
                    const medal = index === 0 ? '🥇' : index === 1 ? '🥈' : index === 2 ? '🥉' : '▪️';
                    leaderboardDescription += `\${medal} **#\({index + 1}** <@\){item[0]}> ➜ **\${item[1].hosts}** giveaway(s) hosted\n`;
                });
            }

            const embed = new EmbedBuilder()
                .setTitle(embedTitle)
                .setColor('#F1C40F')
                .setDescription(leaderboardDescription)
                .setFooter({ text: "Waffel's Giveaway Leaderboard • Top 10" })
                .setTimestamp();

            return interaction.reply({ embeds: [embed] });
        }

        if (interaction.commandName === 'statsreset') {
            const target = interaction.options.getUser('target');
            giveawayStatsDatabase.set(target.id, { wins: 0, entries: 0, hosts: 0 });

            const logChannel = interaction.guild.channels.cache.get(LOG_CHANNEL_ID);
            if (logChannel) {
                const logEmbed = new EmbedBuilder()
                    .setTitle('🔄 Giveaway Statistics Reset')
                    .setColor('#E67E22')
                    .addFields(
                        { name: '👤 Target Account', value: `target ({target.tag})`, inline: true },
                        { name: '🛡️ Executor Admin', value: `interaction.user ({interaction.user.tag})`, inline: true },
                        { name: '🆔 Account ID', value: `\`${target.id}\``, inline: false }
                    )
                    .setTimestamp();
                await logChannel.send({ embeds: [logEmbed] }).catch(() => null);
            }

            return interaction.reply({ content: `🔄 **Database Flush :** All giveaway stats for ${target} (**${target.tag}**) have been successfully reset to **0**.` });
        }
    }

    if (interaction.isStringSelectMenu() && interaction.customId === 'select_waffel_mode') {
        const mode = interaction.values[0]; 
        const modal = new ModalBuilder().setCustomId(`modal_waffel_${mode}`).setTitle(`Setup: ${mode.toUpperCase()} Mode 🧇`);
        const pInput = new TextInputBuilder().setCustomId('input_prize').setLabel("What is the prize / amount?").setStyle(TextInputStyle.Short).setPlaceholder("e.g., 50m / Waffles").setRequired(true);
        const dInput = new TextInputBuilder().setCustomId('input_duration').setLabel("Duration (e.g., 5h, 45s, 10m):").setStyle(TextInputStyle.Short).setPlaceholder("e.g., 5h or 30s").setRequired(true);
        const wInput = new TextInputBuilder().setCustomId('input_winners').setLabel("Number of winners:").setStyle(TextInputStyle.Short).setRequired(true);
        const descInput = new TextInputBuilder().setCustomId('input_description').setLabel("Optional Title / Description:").setStyle(TextInputStyle.Paragraph).setPlaceholder("e.g., 1B / Flash (Leave blank for none)").setRequired(false);
        
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

        const hostStats = ensureUserStats(interaction.user.id);
        hostStats.hosts += 1;

        startGiveawayEngine(interaction.channel, durationMs, prize, winners, mode, descriptionOpt, interaction.user);
    }
});
async function startGiveawayEngine(channel, durationMs, prize, winnerCount, mode, customTitle, hostUser) {
    const participants = [];
    const buttonLabel = mode === 'clicker' ? 'CLICK ME TO WIN! 🧇⚡' : 'Join the Giveaway! 🎉';
    const buttonStyle = mode === 'clicker' ? ButtonStyle.Success : ButtonStyle.Primary;
    const enterButton = new ButtonBuilder().setCustomId('enter_giveaway').setLabel(buttonLabel).setStyle(buttonStyle);
    const row = new ActionRowBuilder().addComponents(enterButton);
    
    const endTimeStamp = Math.floor((Date.now() + durationMs) / 1000);
    const title = customTitle ? `🧇 ${customTitle} 🧇` : "✨ WAFFEL'S GIVEAWAY ✨";

    let description = `⏳ **Ends:** <t:${endTimeStamp}:R> (<t:${endTimeStamp}:F>)\n👑 **Hosted by:** ${hostUser}\n👥 **Entries:** **0**\n🏆 **Winners:** **${winnerCount}**\n🎁 **Each winner gets:** **${prize}**\n⏱️ **Claim time:** **Do /claimtime**`;
    if (mode === 'clicker') { 
        description = `⚡ **WAFFLE CLICKER (SPEED GAME)** ⚡\n👑 **Hosted by:** ${hostUser}\n🎁 **Each winner gets:** **${prize}**\n\n🚨 The very **FIRST** person to click the green button wins instantly!`; 
    }

    const embed = new EmbedBuilder().setTitle(title).setDescription(description).setColor('#F1C40F').setTimestamp();
    const msg = await channel.send({ embeds: [embed], components: [row] });
    
    const maxEntries = mode === 'clicker' ? 1 : undefined;
    const collector = msg.createMessageComponentCollector({ time: durationMs });

    collector.on('collect', async (btnInt) => {
        if (btnInt.customId === 'enter_giveaway') {
            if (blacklistDatabase.has(btnInt.user.id)) {
                return btnInt.reply({ content: "❌ **Entry Denied.** You have been blacklisted from participating in giveaways by the administration.", ephemeral: true });
            }

            if (mode === 'clicker') {
                participants.push(btnInt.user.id);
                
                const clickerStats = ensureUserStats(btnInt.user.id);
                clickerStats.entries += 1;
                clickerStats.wins += 1;

                await btnInt.reply({ content: "🧇 CRITICAL CLICK! Checking if you were the fastest...", ephemeral: true });
                collector.stop();
            } else {
                if (participants.includes(btnInt.user.id)) {
                    const leaveButton = new ButtonBuilder().setCustomId(`leave_gw_${btnInt.user.id}`).setLabel('🚨 LEAVE THIS GIVEAWAY RIGHT NOW 🚨').setStyle(ButtonStyle.Danger);
                    const leaveRow = new ActionRowBuilder().addComponents(leaveButton);
                    return btnInt.reply({ content: "⚠️ You are already participating!", components: [leaveRow], ephemeral: true });
                }
                participants.push(btnInt.user.id);

                const playerStats = ensureUserStats(btnInt.user.id);
                playerStats.entries += 1;

                let upDescription = `⏳ **Ends:** <t:${endTimeStamp}:R> (<t:${endTimeStamp}:F>)\n👑 **Hosted by:** ${hostUser}\n👥 **Entries:** **${participants.length}**\n🏆 **Winners:** **${winnerCount}**\n🎁 **Each winner gets:** **${prize}**\n⏱️ **Claim time:** **Do /claimtime**`;
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
                
                const playerStats = ensureUserStats(btnInt.user.id);
                if (playerStats.entries > 0) playerStats.entries -= 1;

                let upDescription = `⏳ **Ends:** <t:${endTimeStamp}:R> (<t:${endTimeStamp}:F>)\n👑 **Hosted by:** ${hostUser}\n👥 **Entries:** **${participants.length}**\n🏆 **Winners:** **${winnerCount}**\n🎁 **Each winner gets:** **${prize}**\n⏱️ **Claim time:** **Do /claimtime**`;
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

        if (mode === 'clicker') {
            const winnerId = participants[0];
            const finalEmbed = EmbedBuilder.from(embed).setDescription(`⚡ **CLICKER OVER!**\n👑 **Fastest Clicker:** <@${winnerId}>\n🎁 **Each winner gets:** **${prize}**`).setColor('#2ECC71');
            await endMsg.edit({ embeds: [finalEmbed], components: [disRow] });
            return await channel.send(`⚡ 🧇 **WAFFLE CLICKER WINNER!** Congratulations <@${winnerId}>, you reacted the fastest and won **${prize}**! 🎉🏆`);
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

        if (mode === 'normal') {
            winners.forEach(id => {
                const stats = ensureUserStats(id);
                stats.wins += 1;
            });
        }

        const finalEmbed = EmbedBuilder.from(embed).setDescription(`🎉 **GIVEAWAY ENDED!**\n👑 **Winner(s):** ${winnersMention}\n👑 **Hosted by:** ${hostUser}\n🎁 **Each winner gets:** **${prize}**`).setColor('#2ECC71');
        await endMsg.edit({ embeds: [finalEmbed], components: [disRow] });
        await channel.send(`🎉 🧇 **CONGRATULATIONS** ${winnersMention}! You won **${prize}**! 🎁✨`);

        handleMiniGames(channel, winners, prize, durationMs, winnerCount, mode);
    });
}
async function handleMiniGames(channel, winners, prize, durationMs, winnerCount, mode) {
    if (mode === 'clicker' || mode === 'normal') return;
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
                const wStats = ensureUserStats(winnerId);
                wStats.wins += 1;
                await gInt.reply(`🔒 **Giveaway Ended... KEEP!** <@${winnerId}> kept their **${prize}**! GG! 🧇🎁`); 
            } else {
                let newPrize = prize; const match = prize.match(/\d+/);
                if (match) { const oldN = parseInt(match[0]); newPrize = prize.replace(oldN, oldN * 2); } else { newPrize = `2x ${prize}`; }
                await gInt.reply(`🟢 **DOUBLE ACTIVATED!** New reward: **${newPrize}**! Re-rolling in 5s... 🚀`);
                setTimeout(() => startGiveawayEngine(channel, durationMs, newPrize, winnerCount, 'dok', "DOUBLE OR KEEP", gInt.user), 5000);
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
                    ensureUserStats(p1).wins += 1;
                    ensureUserStats(p2).wins += 1;
                    channel.send(`🤝 **SPLIT!** <@${p1}> and <@${p2}> share the prize: **${prize}**! 🎉`); 
                }
                else if (choices[p1] === 'steal' && choices[p2] === 'steal') { 
                    channel.send(`💀 **STEAL TO STEAL!** Both tried to steal. **NO ONE WINS**! ❌`); 
                }
                else { 
                    const thief = choices[p1] === 'steal' ? p1 : p2; 
                    ensureUserStats(thief).wins += 1;
                    channel.send(`😈 **BETRAYAL!** <@${thief}> stole everything and wins **${prize}**! 🏆`); 
                }
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
                    channel.send(`🤝 **DRAW!** Both chose **${c1}**. Battle ends in a tie (No wins added)! 🧇`); 
                }
                else if ((c1 === 'rock' && c2 === 'scissors') || (c1 === 'paper' && c2 === 'rock') || (c1 === 'scissors' && c2 === 'paper')) { 
                    ensureUserStats(p1).wins += 1;
                    channel.send(`👑 **VICTORY!** <@${p1}> wins **${prize}**! ✨`); 
                }
                else { 
                    ensureUserStats(p2).wins += 1;
                    channel.send(`👑 **VICTORY!** <@${p2}> wins **${prize}**! ✨`); 
                }
            }
        });
    }
}
client.login(process.env.DISCORD_TOKEN);
