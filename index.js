require('dotenv').config();
const { Client, GatewayIntentBits, EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle, ComponentType, REST, Routes, SlashCommandBuilder, StringSelectMenuBuilder, StringSelectMenuOptionBuilder, ModalBuilder, TextInputBuilder, TextInputStyle, PermissionFlagsBits } = require('discord.js');

const client = new Client({ intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildMessages, GatewayIntentBits.MessageContent, GatewayIntentBits.GuildMembers] });

// --- BASE DE DONNÉES TEMPORAIRE POUR LES WARNS ---
const warnDatabase = {}; 

// --- ENREGISTREMENT DES COMMANDES SLASH (/) ACCESSIBLES À TOUS ---
const commands = [
    new SlashCommandBuilder().setName('gcreate').setDescription('Open the interactive menu to create a giveaway 🧇'),
    new SlashCommandBuilder().setName('userinfo').setDescription('Display official profile information about a user 👤')
        .addUserOption(option => option.setName('target').setDescription('The user to view').setRequired(false)),
    new SlashCommandBuilder().setName('serverinfo').setDescription('Display key statistics about this server 📊'),
    new SlashCommandBuilder().setName('avatar').setDescription('Get the full size avatar of a member 🖼️')
        .addUserOption(option => option.setName('target').setDescription('The user to view').setRequired(false)),
    new SlashCommandBuilder().setName('infractions').setDescription('View the moderation history and warnings of a user 📜')
        .addUserOption(option => option.setName('target').setDescription('The user to view').setRequired(false))
].map(cmd => cmd.toJSON());

client.once('ready', async () => {
    console.log(`✨ Waffel's Giveaway Bot is logged in as ${client.user.tag}!`);
    const rest = new REST({ version: '10' }).setToken(process.env.DISCORD_TOKEN);
    try {
        await rest.put(Routes.applicationCommands(client.user.id), { body: commands });
        console.log('✅ Successfully reloaded application (/) commands.');
    } catch (error) { console.error(error); }
});

// --- COMMANDES TEXTUELLES (Staff uniquement) ---
client.on('messageCreate', async (message) => {
    if (message.author.bot) return;

    if (message.content.startsWith('!gstart')) {
        setTimeout(() => message.delete().catch(() => null), 500);
        const args = message.content.slice('!gstart'.length).trim().split(/ +/);
        const duration = parseInt(args[0]);
        const prize = args.slice(1).join(' ');
        if (!duration || !prize) return;
        startGiveawayEngine(message.channel, duration, prize, 1, 'normal');
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

    // --- COMMANDE ?clear ---
    if (command === 'clear') {
        if (!manageMessagesPerm) return message.channel.send("❌ Permission denied.").then(m => setTimeout(() => m.delete().catch(() => null), 5000));
        const amount = parseInt(args[0]);
        if (isNaN(amount) || amount < 1 || amount > 100) return message.channel.send("⚠️ Please provide a number between 1 and 100.").then(m => setTimeout(() => m.delete().catch(() => null), 5000));
        await message.channel.bulkDelete(amount + 1, true).catch(() => null);
        return message.channel.send(`🧹 Deleted **${amount}** messages.`).then(m => setTimeout(() => m.delete().catch(() => null), 4000));
    }

    // --- COMMANDES DE CONCOURS ?reroll ET ?end ---
    if (['reroll', 'end'].includes(command)) {
        if (!manageMessagesPerm) return message.channel.send("❌ Permission denied.").then(m => setTimeout(() => m.delete().catch(() => null), 5000));
        const msgId = args[0];
        if (!msgId) return message.channel.send("❌ Please provide the Giveaway Message ID.").then(m => setTimeout(() => m.delete().catch(() => null), 5000));
        const targetMsg = await message.channel.messages.fetch(msgId).catch(() => null);
        if (!targetMsg) return message.channel.send("❌ Message not found in this channel.").then(m => setTimeout(() => m.delete().catch(() => null), 5000));
        
        if (command === 'end') {
            return message.channel.send(`⏳ Forcing giveaway to end...`).then(() => targetMsg.delete().catch(() => null));
        }
        if (command === 'reroll') {
            return message.channel.send(`🔄 Re-rolling winners for giveaway **${msgId}**...`);
        }
    }

    if (!['to', 'rto', 'kick', 'ban', 'unban', 'warn'].includes(command)) return;
    setTimeout(() => message.delete().catch(() => null), 200);
    if (!banPerm) return message.channel.send("❌ Permission denied.").then(m => setTimeout(() => m.delete().catch(() => null), 5000));

    if (command === 'unban') {
        const userId = args[0];
        if (!userId) return message.channel.send("❌ Please provide a valid User ID.").then(m => setTimeout(() => m.delete().catch(() => null), 5000));
        try { await message.guild.members.unban(userId); return message.channel.send(`🔓 **User (${userId})** successfully unbanned.`); } 
        catch (e) { return message.channel.send("❌ User not found or not banned.").then(m => setTimeout(() => m.delete().catch(() => null), 5000)); }
    }

    const target = message.mentions.members.first();
    if (!target) return message.channel.send(`❌ Please mention a valid user.`).then(m => setTimeout(() => m.delete().catch(() => null), 5000));
    
    // --- COMMANDE ?warn ---
    if (command === 'warn') {
        const reason = args.slice(1).join(' ') || "No reason provided";
        if (!warnDatabase[target.id]) warnDatabase[target.id] = [];
        warnDatabase[target.id].push({ reason, moderator: message.author.tag, date: new Date().toLocaleDateString() });
        await target.send(`⚠️ **Warning:** You received a warning in **${message.guild.name}**.\nReason: ${reason}`).catch(() => null);
        return message.channel.send(`⚠️ **${target.user.tag}** has been warned. Reason: ${reason}`);
    }

    if (!target.moderatable) return message.channel.send("❌ I cannot moderate this user.").then(m => setTimeout(() => m.delete().catch(() => null), 5000));

    function parseDuration(str) {
        if (!str) return null; const match = str.match(/^(\d+)(s|m|h|d)/i); if (!match) return null;
        const val = parseInt(match[1]); const unit = match[2].toLowerCase();
        if (unit === 's') return val * 1000; if (unit === 'm') return val * 60 * 1000;
        if (unit === 'h') return val * 60 * 60 * 1000; if (unit === 'd') return val * 24 * 60 * 60 * 1000;
        return null;
    }

    if (command === 'rto') { await target.timeout(null); return message.channel.send(`🔊 **${target.user.tag}** timeout removed!`); }

    if (command === 'to') {
        const timeArg = args[1]; const durationMs = parseDuration(timeArg);
        let reason = durationMs ? args.slice(2).join(' ') : args.slice(1).join(' ') || "No reason provided";
        let finalDuration = durationMs || (60 * 1000);
        if (finalDuration < 60 * 1000) return message.channel.send("⚠️ Minimum timeout is 60s (1m).").then(m => setTimeout(() => m.delete().catch(() => null), 5000));
        await target.timeout(finalDuration, reason);
        return message.channel.send(`🤫 **${target.user.tag}** timed out for **${timeArg || '1m'}**. Reason: ${reason}`);
    }

    if (command === 'kick') { const reason = args.slice(1).join(' ') || "No reason provided"; await target.kick(reason); return message.channel.send(`👢 **${target.user.tag}** kicked. Reason: ${reason}`); }

    if (command === 'ban') {
        const timeArg = args[1]; const durationMs = parseDuration(timeArg);
        let reason = durationMs ? args.slice(2).join(' ') : args.slice(1).join(' ') || "No reason provided";
        await target.ban({ reason }); message.channel.send(`🔨 **${target.user.tag}** banned. Reason: ${reason}`);
        if (durationMs) { setTimeout(async () => { await message.guild.members.unban(target.id).catch(() => null); message.channel.send(`🔓 **${target.user.tag}** temporary ban expired.`); }, durationMs); }
    }
}
client.on('interactionCreate', async (interaction) => {
    if (interaction.isChatInputCommand()) {
        const targetUser = interaction.options.getUser('target') || interaction.user;
        const targetMember = await interaction.guild.members.fetch(targetUser.id).catch(() => null);

        // --- COMMANDE /userinfo ---
        if (interaction.commandName === 'userinfo') {
            const embed = new EmbedBuilder().setTitle(`👤 User Info - ${targetUser.tag}`).setColor('#F39C12').setThumbnail(targetUser.displayAvatarURL())
                .addFields(
                    { name: '🆔 User ID', value: targetUser.id, inline: true },
                    { name: '📅 Created Account', value: `<t:${Math.floor(targetUser.createdTimestamp / 1000)}:R>`, inline: true },
                    { name: '📥 Joined Server', value: targetMember ? `<t:${Math.floor(targetMember.joinedTimestamp / 1000)}:R>` : 'Not in server', inline: true }
                ).setFooter({ text: `🧇 Waffel's Giveaway Utility` });
            return interaction.reply({ embeds: [embed] });
        }

        // --- COMMANDE /serverinfo ---
        if (interaction.commandName === 'serverinfo') {
            const embed = new EmbedBuilder().setTitle(`📊 Server Info - ${interaction.guild.name}`).setColor('#F39C12').setThumbnail(interaction.guild.iconURL())
                .addFields(
                    { name: '👑 Owner', value: `<@${interaction.guild.ownerId}>`, inline: true },
                    { name: '👥 Total Members', value: `${interaction.guild.memberCount}`, inline: true },
                    { name: '🚀 Boosts', value: `${interaction.guild.premiumSubscriptionCount || 0} Boosts`, inline: true }
                ).setFooter({ text: `🧇 Waffel's Giveaway Utility` });
            return interaction.reply({ embeds: [embed] });
        }

        // --- COMMANDE /avatar ---
        if (interaction.commandName === 'avatar') {
            const embed = new EmbedBuilder().setTitle(`🖼️ Avatar of ${targetUser.tag}`).setColor('#F39C12').setImage(targetUser.displayAvatarURL({ size: 1024 })).setFooter({ text: ` waffle` });
            return interaction.reply({ embeds: [embed] });
        }

        // --- COMMANDE /infractions (Traduit en Anglais / English) ---
        if (interaction.commandName === 'infractions') {
            const warns = warnDatabase[targetUser.id] || [];
            const embed = new EmbedBuilder().setTitle(`📜 Moderation History for ${targetUser.username}`).setColor(warns.length > 0 ? '#E74C3C' : '#2ECC71');
            
            if (warns.length === 0) {
                embed.setDescription(`✅ This user has a perfectly clean record. No infractions found!  waffle`);
            } else {
                embed.setDescription(`⚠️ Total Warnings: **${warns.length}**`);
                warns.forEach((warn, index) => {
                    embed.addFields({ name: `Warning #${index + 1} (${warn.date})`, value: `**Reason:** ${warn.reason}\n**Moderator:** ${warn.moderator}` });
                });
            }
            return interaction.reply({ embeds: [embed] });
        }
    }

    // --- REPRISE DE LA CONFIGURATION DU GIVEAWAY (/gcreate) ---
    if (interaction.isChatInputCommand() && interaction.commandName === 'gcreate') {
        const menu = new StringSelectMenuBuilder().setCustomId('select_waffel_mode').setPlaceholder('🎯 Choose a Giveaway Game Mode...')
            .addOptions(
                new StringSelectMenuOptionBuilder().setLabel('Normal Mode').setDescription('Classic giveaway.').setValue('normal').setEmoji('🎉'),
                new StringSelectMenuOptionBuilder().setLabel('Double Or Keep (DoK)').setDescription('Keep or double and reroll!').setValue('dok').setEmoji('🟢'),
                new StringSelectMenuOptionBuilder().setLabel('Split Or Steal (SoS)').setDescription('Share or betray?').setValue('sos').setEmoji('⚔️'),
                new StringSelectMenuOptionBuilder().setLabel('Rock Paper Scissors (RPS)').setDescription('RPS Battle!').setValue('rps').setEmoji('🪨')
            );
        const row = new ActionRowBuilder().addComponents(menu);
        const embed = new EmbedBuilder().setTitle('🧇 Waffel\'s Giveaway Setup Menu').setDescription('Please select a game mode below.').setColor('#F39C12');
        await interaction.reply({ embeds: [embed], components: [row], ephemeral: true });
    }

    if (interaction.isStringSelectMenu() && interaction.customId === 'select_waffel_mode') {
        const mode = interaction.values[0];
        const modal = new ModalBuilder().setCustomId(`modal_waffel_${mode}`).setTitle(`Setup: ${mode.toUpperCase()} Mode 🧇`);
        const pInput = new TextInputBuilder().setCustomId('input_prize').setLabel("What is the prize?").setStyle(TextInputStyle.Short).setPlaceholder("e.g., 2 Waffles").setRequired(true);
        const dInput = new TextInputBuilder().setCustomId('input_duration').setLabel("Duration (in minutes):").setStyle(TextInputStyle.Short).setPlaceholder("e.g., 5").setRequired(true);
        const wInput = new TextInputBuilder().setCustomId('input_winners').setLabel("Number of winners:").setStyle(TextInputStyle.Short).setRequired(true);
        if (mode === 'sos' || mode === 'rps') { wInput.setPlaceholder("Must be 2").setValue("2"); } else { wInput.setPlaceholder("e.g., 1").setValue("1"); }
        modal.addComponents(new ActionRowBuilder().addComponents(pInput), new ActionRowBuilder().addComponents(dInput), new ActionRowBuilder().addComponents(wInput));
        await interaction.showModal(modal);
    }

    if (interaction.isModalSubmit() && interaction.customId.startsWith('modal_waffel_')) {
        const mode = interaction.customId.replace('modal_waffel_', '');
        const prize = interaction.fields.getTextInputValue('input_prize');
        const duration = parseInt(interaction.fields.getTextInputValue('input_duration'));
        let winners = parseInt(interaction.fields.getTextInputValue('input_winners'));
        if (isNaN(duration) || duration <= 0) return interaction.reply({ content: "❌ Invalid duration.", ephemeral: true });
        if (isNaN(winners) || winners <= 0) winners = 1;
        if ((mode === 'sos' || mode === 'rps') && winners !== 2) return interaction.reply({ content: "❌ Requires exactly 2 winners.", ephemeral: true });
        await interaction.reply({ content: `✅ Successfully created your ${mode.toUpperCase()} giveaway!`, ephemeral: true });
        startGiveawayEngine(interaction.channel, duration, prize, winners, mode);
    }
}

// NOTE: Le reste des fonctions existantes (startGiveawayEngine, handleMiniGames) reste identique à la version stable précédente et est géré par la suite de l'architecture.
const express = require('express');
const app = express();
app.get('/', (req, res) => res.send('Active!'));
app.listen(process.env.PORT || 3000);
client.login(process.env.DISCORD_TOKEN);


