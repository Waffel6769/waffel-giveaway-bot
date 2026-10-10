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
const giveawayStatsDatabase = new Map();
const app = express();

const LOG_CHANNEL_ID = '123456789012345678'; 

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
    res.send("Waffel's Giveaway is perfectly awake and running 24/7!");
});
app.listen(process.env.PORT || 3000);
client.on('messageCreate', async (message) => {
    if (message.author.bot) return;

    if (message.content.startsWith('!gstart')) {
        if (!message.member.permissions.has(PermissionFlagsBits.ModerateMembers)) {
            return message.channel.send("❌ You need to be a **Staff Member** to start a giveaway.")
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
        if (!message.member.permissions.has(PermissionFlagsBits.ManageChannels)) return message.channel.send("❌ Permission denied.").then(m => setTimeout(() => m.delete().catch(() => null), 5000));
        await message.channel.permissionOverwrites.edit(message.guild.roles.everyone, { SendMessages: false });
        return message.channel.send("🔒 **This channel has been locked.**");
    }

    if (command === 'unlock') {
        setTimeout(() => message.delete().catch(() => null), 200);
        if (!message.member.permissions.has(PermissionFlagsBits.ManageChannels)) return message.channel.send("❌ Permission denied.").then(m => setTimeout(() => m.delete().catch(() => null), 5000));
        await message.channel.permissionOverwrites.edit(message.guild.roles.everyone, { SendMessages: true });
        return message.channel.send("🔓 **This channel has been unlocked.**");
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
        if (isNaN(amount) || amount < 1 || amount > 100) return message.channel.send("⚠️ Provide a number between 1 and 100.").then(m => setTimeout(() => m.delete().catch(() => null), 5000));
        await message.channel.bulkDelete(amount + 1, true).catch(() => null);
        return message.channel.send("🧹 Deleted messages.").then(m => setTimeout(() => m.delete().catch(() => null), 4000));
    }

    if (command === 'roleadd') {
        setTimeout(() => message.delete().catch(() => null), 200);
        if (!manageRolesPerm) return message.channel.send("❌ Permission denied.").then(m => setTimeout(() => m.delete().catch(() => null), 5000));
        const target = message.mentions.members.first();
        const role = message.mentions.roles.first();
        if (!target || !role) return message.channel.send("⚠️ Usage: `?roleadd @member @role`").then(m => setTimeout(() => m.delete().catch(() => null), 5000));
        try { 
            await target.roles.add(role); 
            return message.channel.send(`✅ Added role **${role.name}** to **${target.user.tag}**.`); 
        } catch (e) { 
            return message.channel.send("❌ Unable to add role.").then(m => setTimeout(() => m.delete().catch(() => null), 5000)); 
        }
    }

    if (command === 'unwarn') {
        setTimeout(() => message.delete().catch(() => null), 200);
        if (!banPerm) return message.channel.send("❌ Permission denied.").then(m => setTimeout(() => m.delete().catch(() => null), 5000));
        const target = message.mentions.members.first() || message.guild.members.cache.get(args[0]);
        if (!target) return message.channel.send("❌ Mention a valid user.").then(m => setTimeout(() => m.delete().catch(() => null), 5000));
        if (!warnDatabase[target.id] || warnDatabase[target.id].length === 0) { return message.channel.send(`✅ **${target.user.tag}** has no active warnings.`); }
        warnDatabase[target.id].pop();
        return message.channel.send(`🧹 Removed warning from **${target.user.tag}** (Remaining: ${warnDatabase[target.id].length}).`);
    }
    if (!['to', 'rto', 'kick', 'ban', 'unban', 'warn'].includes(command)) return;
    setTimeout(() => message.delete().catch(() => null), 200);
    if (!banPerm) return message.channel.send("❌ Permission denied.").then(m => setTimeout(() => m.delete().catch(() => null), 5000));

    if (command === 'unban') {
        const userId = args[0];
        if (!userId) return message.channel.send("❌ Provide a valid User ID.").then(m => setTimeout(() => m.delete().catch(() => null), 5000));
        try { await message.guild.members.unban(userId); return message.channel.send(`🔓 **User ID (${userId})** unbanned.`); } 
        catch (e) { return message.channel.send("❌ User not found.").then(m => setTimeout(() => m.delete().catch(() => null), 5000)); }
    }
    const target = message.mentions.members.first();
    if (!target) return message.channel.send(`❌ Mention a valid user.`).then(m => setTimeout(() => m.delete().catch(() => null), 5000));
    
    if (command === 'warn') {
        const reason = args.slice(1).join(' ') || "No reason provided";
        if (!warnDatabase[target.id]) warnDatabase[target.id] = [];
        warnDatabase[target.id].push({ reason, moderator: message.author.tag, date: new Date().toLocaleDateString() });
        await target.send(`⚠️ **Warning from ${message.guild.name}**\nReason: ${reason}`).catch(() => null);
        return message.channel.send(`⚠️ **${target.user.tag}** warned. Reason: ${reason}`);
    }

    if (!target.moderatable) return message.channel.send("❌ I cannot moderate this user.").then(m => setTimeout(() => m.delete().catch(() => null), 5000));

    function parseDuration(str) {
        if (!str) return null; const match = str.match(/^(\d+)(sec|s|m|h|d|w|y)/i); if (!match) return null;
        const val = parseInt(match[1]); const unit = match[2].toLowerCase();
        if (unit === 's' || unit === 'sec') return val * 1000; if (unit === 'm') return val * 60 * 1000;
        if (unit === 'h') return val * 60 * 60 * 1000; if (unit === 'd') return val * 24 * 60 * 60 * 1000;
        return null;
    }

    if (command === 'rto') { await target.timeout(null); return message.channel.send(`🗣️ **${target.user.tag}** timeout removed!`); }

    if (command === 'to') {
        let timeArg = args[0]; let durationMs = parseDuration(timeArg);
        let reason = durationMs ? args.slice(1).join(' ') : args.join(' ') || "No reason provided";
        let finalDuration = durationMs || (60 * 1000);
        if (finalDuration > 28 * 24 * 60 * 60 * 1000) { finalDuration = 28 * 24 * 60 * 60 * 1000; timeArg = "28d"; }
        await target.timeout(finalDuration, reason);
        return message.channel.send(`🔇 **${target.user.tag}** timed out for **${timeArg || '1m'}**. Reason: ${reason}`);
    }

    if (command === 'kick') { const reason = args.slice(1).join(' ') || "No reason provided"; await target.kick(reason); return message.channel.send(`👢 **${target.user.tag}** kicked. Reason: ${reason}`); }

    if (command === 'ban') {
        let timeArg = args[0]; let durationMs = parseDuration(timeArg);
        let reason = durationMs ? args.slice(1).join(' ') : args.join(' ') || "No reason provided";
        await target.ban({ reason }); message.channel.send(`🔨 **${target.user.tag}** banned. Reason: ${reason}`);
    }
}
client.on('interactionCreate', async (interaction) => {
    if (interaction.isChatInputCommand() && ['gcreate', 'gend', 'greroll'].includes(interaction.commandName)) {
        if (!interaction.member.permissions.has(PermissionFlagsBits.ModerateMembers)) {
            return interaction.reply({ content: "❌ Restricted to Staff Members.", ephemeral: true });
        }
    }

    if (interaction.isChatInputCommand() && ['gwblacklist', 'gwunblacklist', 'statsreset'].includes(interaction.commandName)) {
        if (!interaction.member.permissions.has(PermissionFlagsBits.Administrator)) {
            return interaction.reply({ content: "❌ Restricted to Administrators.", ephemeral: true });
        }
    }

    if (interaction.isStringSelectMenu() && interaction.customId === 'select_waffel_mode') {
        if (!interaction.member.permissions.has(PermissionFlagsBits.ModerateMembers)) {
            return interaction.reply({ content: "❌ Restricted to Staff Members.", ephemeral: true });
        }
    }

    if (interaction.isModalSubmit() && interaction.customId.startsWith('modal_waffel_')) {
        if (!interaction.member.permissions.has(PermissionFlagsBits.ModerateMembers)) {
            return interaction.reply({ content: "❌ Restricted to Staff Members.", ephemeral: true });
        }
    }
    if (interaction.isChatInputCommand()) {
        const targetUser = interaction.options.getUser('target') || interaction.user;
        const targetMember = await interaction.guild.members.fetch(targetUser.id).catch(() => null);

        if (interaction.commandName === 'help') {
            const embed = new EmbedBuilder().setTitle('📋 Commands Inventory').setColor('#F1C40F')
                .addFields(
                    { name: '✨ Slash Commands (/)', value: '`/help`, `/wjamal`, `/claimtime`, `/gcreate`, `/gend`, `/greroll`, `/gwblacklist`, `/gwunblacklist`, `/gwin`, `/gwhost`, `/gwlb`, `/statsreset`, `/userinfo`, `/serverinfo`, `/avatar`, `/infractions`' },
                    { name: '🛠️ Prefix Commands (?)', value: '`?lock`, `?unlock`, `?clear`, `?roleadd`, `?to`, `?rto`, `?warn`, `?unwarn`, `?kick`, `?ban`, `?unban`' }
                );
            return interaction.reply({ embeds: [embed] });
        }

        if (interaction.commandName === 'claimtime') {
            const embed = new EmbedBuilder().setTitle('🎉 Giveaway Info').setColor('#F1C40F').setDescription(
                `🏆 Quickdrops - 30 Minutes\n🎁 Weekly/Daily - 24 hours\n🎉 Big Giveaways - 12 hours\n\n*Proof Can Be Found In* **🟢・proof**`
            );
            return interaction.reply({ embeds: [embed] });
        }

        if (interaction.commandName === 'wjamal') {
            const embed = new EmbedBuilder().setTitle('🐸 W JAMAL').setColor('#2ECC71').setImage('https://giphy.com');
            return interaction.reply({ embeds: [embed] });
        }

        if (interaction.commandName === 'userinfo') {
            const embed = new EmbedBuilder().setTitle(`👤 User Info - ${targetUser.username}`).setColor('#F1C40F')
                .addFields({ name: '🆔 User ID', value: targetUser.id });
            return interaction.reply({ embeds: [embed] });
        }

        if (interaction.commandName === 'serverinfo') {
            const embed = new EmbedBuilder().setTitle(`📊 Server Info - ${interaction.guild.name}`).setColor('#F1C40F')
                .addFields({ name: '👥 Total Members', value: `${interaction.guild.memberCount}` });
            return interaction.reply({ embeds: [embed] });
        }

        if (interaction.commandName === 'avatar') {
            const embed = new EmbedBuilder().setTitle(`🖼️ Avatar of ${targetUser.username}`).setColor('#F1C40F').setImage(targetUser.displayAvatarURL({ size: 1024 }));
            return interaction.reply({ embeds: [embed] });
        }

        if (interaction.commandName === 'infractions') {
            const warns = warnDatabase[targetUser.id] || [];
            const embed = new EmbedBuilder().setTitle(`📜 Warnings for ${targetUser.username}`).setColor('#F1C40F')
                .setDescription(`Total Warnings: **${warns.length}**`);
            return interaction.reply({ embeds: [embed] });
        }
        if (interaction.commandName === 'gcreate') {
            const menu = new StringSelectMenuBuilder().setCustomId('select_waffel_mode').setPlaceholder('🎯 Choose a Game Mode...')
                .addOptions(
                    new StringSelectMenuOptionBuilder().setLabel('Normal Mode').setValue('normal').setEmoji('🎉'),
                    new StringSelectMenuOptionBuilder().setLabel('Waffle Clicker').setValue('clicker').setEmoji('⚡'),
                    new StringSelectMenuOptionBuilder().setLabel('Double Or Keep').setValue('dok').setEmoji('🟢'),
                    new StringSelectMenuOptionBuilder().setLabel('Split Or Steal').setValue('sos').setEmoji('⚔️'),
                    new StringSelectMenuOptionBuilder().setLabel('Rock Paper Scissors').setValue('rps').setEmoji('🪨')
                );
            const row = new ActionRowBuilder().addComponents(menu);
            const embed = new EmbedBuilder().setTitle('🧇 Giveaway Setup').setDescription('Select a game mode.').setColor('#F1C40F');
            return interaction.reply({ embeds: [embed], components: [row], ephemeral: true });
        }

        if (interaction.commandName === 'gend') {
            const msgId = interaction.options.getString('message_id');
            const targetMsg = await interaction.channel.messages.fetch(msgId).catch(() => null);
            if (!targetMsg) return interaction.reply({ content: "❌ Message not found.", ephemeral: true });
            await interaction.reply({ content: "🔒 Ending giveaway...", ephemeral: true });
            return targetMsg.edit({ components: targetMsg.components }).catch(() => null);
        }

        if (interaction.commandName === 'greroll') {
            const msgId = interaction.options.getString('message_id');
            const targetMsg = await interaction.channel.messages.fetch(msgId).catch(() => null);
            if (!targetMsg) return interaction.reply({ content: "❌ Message not found.", ephemeral: true });
            await interaction.reply({ content: "🎲 Rerolling winner...", ephemeral: true });
            const randomMember = interaction.guild.members.cache.filter(m => !m.user.bot && !blacklistDatabase.has(m.id)).random();
            if (!randomMember) return interaction.followUp({ content: "❌ No eligible participants found.", ephemeral: true });
            
            ensureUserStats(randomMember.id).wins += 1;
            return interaction.channel.send(`🎲 **NEW REROLL WINNER!** Congratulations ${randomMember}! 🎁✨`);
        }

        if (interaction.commandName === 'gwblacklist') {
            const target = interaction.options.getUser('target');
            if (blacklistDatabase.has(target.id)) return interaction.reply({ content: "⚠️ User already blacklisted.", ephemeral: true });
            blacklistDatabase.add(target.id);
            await interaction.reply({ content: `🚫 Added ${target.username} to Blacklist.` });
            return;
        }

        if (interaction.commandName === 'gwunblacklist') {
            const target = interaction.options.getUser('target');
            if (!blacklistDatabase.has(target.id)) return interaction.reply({ content: "⚠️ User not blacklisted.", ephemeral: true });
            blacklistDatabase.delete(target.id);
            await interaction.reply({ content: `✅ Removed ${target.username} from Blacklist.` });
            return;
        }

        if (interaction.commandName === 'gwin') {
            const user = interaction.options.getUser('target') || interaction.user;
            const stats = ensureUserStats(user.id);
            const embed = new EmbedBuilder().setTitle(`🏆 Profile - ${user.username}`).setColor('#F1C40F')
                .addFields({ name: '🎉 Wins', value: `${stats.wins}`, inline: true }, { name: '🎟️ Entries', value: `${stats.entries}`, inline: true });
            return interaction.reply({ embeds: [embed] });
        }

        if (interaction.commandName === 'gwhost') {
            const user = interaction.options.getUser('target') || interaction.user;
            const stats = ensureUserStats(user.id);
            const embed = new EmbedBuilder().setTitle(`👑 Host Profile - ${user.username}`).setColor('#F1C40F')
                .addFields({ name: 'Hosted', value: `${stats.hosts}`, inline: false });
            return interaction.reply({ embeds: [embed] });
        }

        if (interaction.commandName === 'gwlb') {
            const lbType = interaction.options.getString('type');
            const sorted = Array.from(giveawayStatsDatabase.entries());
            let desc = '';
            if (lbType === 'winners') {
                sorted.sort((a, b) => b[1].wins - a[1].wins);
                sorted.slice(0, 10).forEach((item, i) => { desc += `#${i + 1} <@${item[0]}> - ${item[1].wins} wins\n`; });
            } else {
                sorted.sort((a, b) => b[1].hosts - a[1].hosts);
                sorted.slice(0, 10).forEach((item, i) => { desc += `#${i + 1} <@${item[0]}> - ${item[1].hosts} hosted\n`; });
            }
            const embed = new EmbedBuilder().setTitle('📊 Leaderboard').setDescription(desc || 'No data').setColor('#F1C40F');
            return interaction.reply({ embeds: [embed] });
        }

        if (interaction.commandName === 'statsreset') {
            const target = interaction.options.getUser('target');
            giveawayStatsDatabase.set(target.id, { wins: 0, entries: 0, hosts: 0 });
            return interaction.reply({ content: `🔄 Reset stats for ${target.username}.` });
        }
    }

    if (interaction.isStringSelectMenu() && interaction.customId === 'select_waffel_mode') {
        const mode = interaction.values[0]; 
        const modal = new ModalBuilder().setCustomId(`modal_waffel_${mode}`).setTitle(`Setup Mode`);
        const pInput = new TextInputBuilder().setCustomId('input_prize').setLabel("Prize:").setStyle(TextInputStyle.Short).setRequired(true);
        const dInput = new TextInputBuilder().setCustomId('input_duration').setLabel("Duration (eg. 5h, 30s):").setStyle(TextInputStyle.Short).setRequired(true);
        const wInput = new TextInputBuilder().setCustomId('input_winners').setLabel("Winners:").setStyle(TextInputStyle.Short).setValue("1").setRequired(true);
        const descInput = new TextInputBuilder().setCustomId('input_description').setLabel("Description:").setStyle(TextInputStyle.Paragraph).setRequired(false);
        
        modal.addComponents(new ActionRowBuilder().addComponents(pInput), new ActionRowBuilder().addComponents(dInput), new ActionRowBuilder().addComponents(wInput), new ActionRowBuilder().addComponents(descInput));
        await interaction.showModal(modal);
    }

    if (interaction.isModalSubmit() && interaction.customId.startsWith('modal_waffel_')) {
        const mode = interaction.customId.replace('modal_waffel_', '');
        const prize = interaction.fields.getTextInputValue('input_prize');
        const durationStr = interaction.fields.getTextInputValue('input_duration');
        const descriptionOpt = interaction.fields.getTextInputValue('input_description') || null;
        let winners = parseInt(interaction.fields.getTextInputValue('input_winners')) || 1;
        
        function parseGiveawayDuration(str) {
            if (!str) return null; const match = str.match(/^(\d+)(sec|s|m|h|d)/i); if (!match) return null;
            const val = parseInt(match[1]); const unit = match[2].toLowerCase();
            if (unit === 's' || unit === 'sec') return val * 1000; if (unit === 'm') return val * 60 * 1000;
            if (unit === 'h') return val * 60 * 60 * 1000; if (unit === 'd') return val * 24 * 60 * 60 * 1000;
            return null;
        }

        const durationMs = parseGiveawayDuration(durationStr);
        if (!durationMs) return interaction.reply({ content: "❌ Invalid duration.", ephemeral: true });
        
        await interaction.reply({ content: `✅ Created!`, ephemeral: true });
        ensureUserStats(interaction.user.id).hosts += 1;
        startGiveawayEngine(interaction.channel, durationMs, prize, winners, mode, descriptionOpt, interaction.user);
    }
});
async function startGiveawayEngine(channel, durationMs, prize, winnerCount, mode, customTitle, hostUser) {
    const participants = [];
    const buttonLabel = mode === 'clicker' ? 'CLICK ME TO WIN!  waffle:⚡' : 'Join the Giveaway! 🎉';
    const enterButton = new ButtonBuilder().setCustomId('enter_giveaway').setLabel(buttonLabel).setStyle(mode === 'clicker' ? ButtonStyle.Success : ButtonStyle.Primary);
    const row = new ActionRowBuilder().addComponents(enterButton);
    const endTimeStamp = Math.floor((Date.now() + durationMs) / 1000);
    const title = customTitle ? ` waffle: ${customTitle}  waffle:` : "✨ WAFFEL'S GIVEAWAY ✨";

    let description = `⏳ **Ends:** <t:${endTimeStamp}:R>\n👑 **Hosted by:** ${hostUser}\n👥 **Entries:** **0**\n🏆 **Winners:** **${winnerCount}**\n🎁 **Each winner gets:** **${prize}**\n⏱️ **Claim time:** **Do /claimtime**`;
    if (mode === 'clicker') description = `⚡ **WAFFLE CLICKER** ⚡\n👑 **Hosted by:** ${hostUser}\n🎁 **Each winner gets:** **${prize}**`;

    const embed = new EmbedBuilder().setTitle(title).setDescription(description).setColor('#F1C40F').setTimestamp();
    const msg = await channel.send({ embeds: [embed], components: [row] });
    const collector = msg.createMessageComponentCollector({ time: durationMs });

    collector.on('collect', async (btnInt) => {
        if (btnInt.customId === 'enter_giveaway') {
            if (blacklistDatabase.has(btnInt.user.id)) return btnInt.reply({ content: "❌ Blacklisted.", ephemeral: true });
            if (mode === 'clicker') {
                participants.push(btnInt.user.id);
                ensureUserStats(btnInt.user.id).entries += 1;
                ensureUserStats(btnInt.user.id).wins += 1;
                await btnInt.reply({ content: " waffle: Checking click...", ephemeral: true });
                collector.stop();
            } else {
                if (participants.includes(btnInt.user.id)) return btnInt.reply({ content: "⚠️ Already joined.", ephemeral: true });
                participants.push(btnInt.user.id);
                ensureUserStats(btnInt.user.id).entries += 1;
                let upDesc = `⏳ **Ends:** <t:${endTimeStamp}:R>\n👑 **Hosted by:** ${hostUser}\n👥 **Entries:** **${participants.length}**\n🏆 **Winners:** **${winnerCount}**\n🎁 **Each winner gets:** **${prize}**\n⏱️ **Claim time:** **Do /claimtime**`;
                await btnInt.update({ embeds: [EmbedBuilder.from(embed).setDescription(upDesc)] });
            }
        }
    });

    collector.on('end', async () => {
        enterButton.setDisabled(true);
        const disRow = new ActionRowBuilder().addComponents(enterButton);
        const endMsg = await channel.messages.fetch(msg.id).catch(() => null);
        if (!endMsg) return;

        if (participants.length === 0) {
            return await endMsg.edit({ embeds: [EmbedBuilder.from(embed).setDescription(`❌ No one joined.`)], components: [disRow] });
        }

        if (mode === 'clicker') {
            return await endMsg.edit({ embeds: [EmbedBuilder.from(embed).setDescription(`🏆 Winner: <@${participants[0]}>`)], components: [disRow] });
        }

        const valid = participants.filter(id => !blacklistDatabase.has(id));
        const winners = valid.sort(() => 0.5 - Math.random()).slice(0, winnerCount);
        const mentions = winners.map(id => `<@${id}>`).join(', ');

        if (mode === 'normal') { winners.forEach(id => { ensureUserStats(id).wins += 1; }); }

        await endMsg.edit({ embeds: [EmbedBuilder.from(embed).setDescription(`🎉 **GIVEAWAY ENDED!**\n👑 **Winner(s):** ${mentions}`)], components: [disRow] });
        await channel.send(`🎉  waffle: **CONGRATULATIONS** ${mentions}! You won **${prize}**! 🎁✨`);
    });
}
client.login(process.env.DISCORD_TOKEN);
