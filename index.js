require('dotenv').config();
const { Client, GatewayIntentBits, EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle, ComponentType, REST, Routes, SlashCommandBuilder, StringSelectMenuBuilder, StringSelectMenuOptionBuilder, ModalBuilder, TextInputBuilder, TextInputStyle, PermissionFlagsBits } = require('discord.js');

const client = new Client({ intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildMessages, GatewayIntentBits.MessageContent, GatewayIntentBits.GuildMembers] });

const commands = [new SlashCommandBuilder().setName('gcreate').setDescription('Open the interactive menu to create a giveaway 🧇')].map(cmd => cmd.toJSON());

client.once('ready', async () => {
    console.log(`✨ Waffel's Giveaway Bot is logged in as ${client.user.tag}!`);
    const rest = new REST({ version: '10' }).setToken(process.env.DISCORD_TOKEN);
    try {
        await rest.put(Routes.applicationCommands(client.user.id), { body: commands });
        console.log('✅ Successfully reloaded application (/) commands.');
    } catch (error) { console.error(error); }
});

// --- ENGIN DES COMMANDES TEXTUELLES (!gstart et ?modération) ---
client.on('messageCreate', async (message) => {
    if (message.author.bot) return;

    // 1. Ancienne commande de Giveaway
    if (message.content.startsWith('!gstart')) {
        setTimeout(() => message.delete().catch(() => null), 500);
        const args = message.content.slice('!gstart'.length).trim().split(/ +/);
        const duration = parseInt(args[0]);
        const prize = args.slice(1).join(' ');
        if (!duration || !prize) return;
        startGiveawayEngine(message.channel, duration, prize, 1, 'normal');
        return;
    }

    // Sécurité Modération : Seuls les membres avec la permission "BanMembers" ou "ManageChannels" peuvent utiliser le "?"
    if (!message.content.startsWith('?')) return;
    const args = message.content.slice(1).trim().split(/ +/);
    const command = args.shift().toLowerCase();

    // Commande ?lock
    if (command === 'lock') {
        setTimeout(() => message.delete().catch(() => null), 200);
        if (!message.member.permissions.has(PermissionFlagsBits.ManageChannels)) return message.channel.send("❌ You don't have permission to use this command.").then(m => setTimeout(() => m.delete().catch(() => null), 5000));
        await message.channel.permissionOverwrites.edit(message.guild.roles.everyone, { SendMessages: false });
        return message.channel.send("🔒 **This channel has been locked.** Everyone's waffle iron is turned off!");
    }

    // Commande ?unlock
    if (command === 'unlock') {
        setTimeout(() => message.delete().catch(() => null), 200);
        if (!message.member.permissions.has(PermissionFlagsBits.ManageChannels)) return message.channel.send("❌ You don't have permission to use this command.").then(m => setTimeout(() => m.delete().catch(() => null), 5000));
        await message.channel.permissionOverwrites.edit(message.guild.roles.everyone, { SendMessages: true });
        return message.channel.send("🔓 **This channel has been unlocked.** You can now speak and eat waffles again!");
    }

    // Redirection vers le bloc suivant pour ?to, ?kick et ?ban
    handleModCommands(message, command, args);
});

client.on('interactionCreate', async (interaction) => {
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
});
async function handleModCommands(message, command, args) {
    if (!['to', 'kick', 'ban'].includes(command)) return;
    setTimeout(() => message.delete().catch(() => null), 200);

    if (!message.member.permissions.has(PermissionFlagsBits.BanMembers)) {
        return message.channel.send("❌ You don't have permission to use moderation commands.").then(m => setTimeout(() => m.delete().catch(() => null), 5000));
    }

    const target = message.mentions.members.first() || message.guild.members.cache.get(args[0]);
    if (!target) return message.channel.send("❌ Please mention a valid user or provide their ID.").then(m => setTimeout(() => m.delete().catch(() => null), 5000));
    if (!target.moderatable) return message.channel.send("❌ I cannot moderate this user. They might have a higher role than me.").then(m => setTimeout(() => m.delete().catch(() => null), 5000));

    // Fonction pour calculer le temps (1d, 1h, 30m)
    function parseDuration(str) {
        if (!str) return null;
        const match = str.match(/^(\d+)(m|h|d)\$/);
        if (!match) return null;
        const value = parseInt(match[1]);
        const unit = match[2];
        if (unit === 'm') return value * 60 * 1000;
        if (unit === 'h') return value * 60 * 60 * 1000;
        if (unit === 'd') return value * 24 * 60 * 60 * 1000;
        return null;
    }

    // --- COMMANDE ?to (Timeout / Mute) ---
    if (command === 'to') {
        const durationMs = parseDuration(args[1]);
        const reason = durationMs ? args.slice(2).join(' ') : args.slice(1).join(' ') || "No reason provided";
        const finalDuration = durationMs || (28 * 24 * 60 * 60 * 1000); // 28 jours max par défaut si non spécifié

        await target.timeout(finalDuration, reason);
        return message.channel.send(`🤫 **${target.user.tag}** has been timed out for **${args[1] || '28 days'}**. Reason: ${reason}`);
    }

    // --- COMMANDE ?kick ---
    if (command === 'kick') {
        const reason = args.slice(1).join(' ') || "No reason provided";
        await target.kick(reason);
        return message.channel.send(`👢 **${target.user.tag}** has been kicked from the server. Reason: ${reason}`);
    }

    // --- COMMANDE ?ban ---
    if (command === 'ban') {
        const durationMs = parseDuration(args[1]);
        const reason = durationMs ? args.slice(2).join(' ') : args.slice(1).join(' ') || "No reason provided";

        await target.ban({ reason: reason });
        message.channel.send(`🔨 **${target.user.tag}** has been banned. Reason: ${reason}`);

        // Si c'est un ban temporaire, on programme le déban automatique
        if (durationMs) {
            setTimeout(async () => {
                await message.guild.members.unban(target.id, "Temporary ban expired").catch(() => null);
                channel.send(`🔓 **${target.user.tag}** has been automatically unbanned (Temporary ban expired).`);
            }, durationMs);
        }
    }
}

client.on('interactionCreate', async (interaction) => {
    if (!interaction.isModalSubmit() || !interaction.customId.startsWith('modal_waffel_')) return;
    const mode = interaction.customId.replace('modal_waffel_', '');
    const prize = interaction.fields.getTextInputValue('input_prize');
    const duration = parseInt(interaction.fields.getTextInputValue('input_duration'));
    let winners = parseInt(interaction.fields.getTextInputValue('input_winners'));
    if (isNaN(duration) || duration <= 0) return interaction.reply({ content: "❌ Invalid duration.", ephemeral: true });
    if (isNaN(winners) || winners <= 0) winners = 1;
    if ((mode === 'sos' || mode === 'rps') && winners !== 2) return interaction.reply({ content: "❌ Requires exactly 2 winners.", ephemeral: true });
    await interaction.reply({ content: `✅ Successfully created your ${mode.toUpperCase()} giveaway!`, ephemeral: true });
    startGiveawayEngine(interaction.channel, duration, prize, winners, mode);
});
async function startGiveawayEngine(channel, duration, prize, winnerCount, mode) {
    const participants = [];
    const enterButton = new ButtonBuilder().setCustomId('enter_giveaway').setLabel('Join the Giveaway! 🎉').setStyle(ButtonStyle.Primary);
    const row = new ActionRowBuilder().addComponents(enterButton);
    let title = "WAFFEL'S GIVEAWAY";
    if (mode === 'dok') title = "WAFFEL'S GIVEAWAY (DOUBLE OR KEEP 🟢)";
    if (mode === 'sos') title = "WAFFEL'S GIVEAWAY (SPLIT OR STEAL ⚔️)";
    if (mode === 'rps') title = "WAFFEL'S GIVEAWAY (ROCK PAPER SCISSORS 🪨)";

    const embed = new EmbedBuilder().setTitle(`✨ 🧇 ${title} 🧇 ✨`)
        .setDescription(`🎁 **Prize:** ${prize}\n👑 **Winners:** ${winnerCount}\n\n📢 **How to enter:** Click the button below to join!\n⏳ **Time Remaining:** <t:${Math.floor((Date.now() + duration * 60 * 1000) / 1000)}:R>`)
        .setColor('#F39C12').setFooter({ text: `👥 Participants: 0 | 🌟 Mode: ${mode.toUpperCase()}` }).setTimestamp();

    const msg = await channel.send({ embeds: [embed], components: [row] });
    const collector = msg.createMessageComponentCollector({ componentType: ComponentType.Button, time: duration * 60 * 1000 });

    collector.on('collect', async (btnInt) => {
        if (btnInt.customId !== 'enter_giveaway') return;
        if (participants.includes(btnInt.user.id)) return btnInt.reply({ content: "⚠️ Already in!", ephemeral: true });
        participants.push(btnInt.user.id);
        const upEmbed = EmbedBuilder.from(embed).setFooter({ text: `👥 Participants: ${participants.length} | 🌟 Mode: ${mode.toUpperCase()}` });
        await btnInt.update({ embeds: [upEmbed] });
        await btnInt.followUp({ content: "✅ Successfully entered!", ephemeral: true });
    });

    collector.on('end', async () => {
        enterButton.setDisabled(true).setLabel('Giveaway Closed 🔒').setStyle(ButtonStyle.Secondary);
        const disRow = new ActionRowBuilder().addComponents(enterButton);
        const endMsg = await channel.messages.fetch(msg.id).catch(() => null);
        if (!endMsg) return;

        if (participants.length === 0) { participants.push('266277684074217472'); }
        if ((mode === 'sos' || mode === 'rps') && participants.length === 1) { participants.push(participants); }

        if (participants.length < winnerCount) {
            const finalEmbed = EmbedBuilder.from(embed).setDescription(`🎁 **Prize:** ${prize}\n\n❌ **Giveaway Ended:** Not enough participants.`);
            return await endMsg.edit({ embeds: [finalEmbed], components: [disRow] });
        }

        const shuffled = participants.sort(() => 0.5 - Math.random());
        const winners = shuffled.slice(0, winnerCount);
        const winnersMention = winners.map(id => `<@${id}>`).join(', ');

        const finalEmbed = EmbedBuilder.from(embed).setDescription(`🎁 **Prize:** ${prize}\n\n🎉 **GIVEAWAY ENDED!**\n👑 **Winner(s):** ${winnersMention}`);
        await endMsg.edit({ embeds: [finalEmbed], components: [disRow] });
        await channel.send(`🎉 🧇 **CONGRATULATIONS** ${winnersMention}! You won **${prize}**! 🎁✨`);

        handleMiniGames(channel, winners, prize, duration, winnerCount, mode);
    });
}

async function handleMiniGames(channel, winners, prize, duration, winnerCount, mode) {
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
            if (gInt.customId === 'dok_keep') { await gInt.reply(`🔒 **Giveaway Ended... KEEP!** <@${winnerId}> kept their **${prize}**! GG! 🧇🎁`); } else {
                let newPrize = prize; const match = prize.match(/\d+/);
                if (match) { const oldN = parseInt(match); newPrize = prize.replace(oldN, oldN * 2); } else { newPrize = `2x ${prize}`; }
                await gInt.reply(`🟢 **DOUBLE ACTIVATED!** New reward: **${newPrize}**! Re-rolling in 5s... 🚀`);
                setTimeout(() => startGiveawayEngine(channel, duration, newPrize, winnerCount, 'dok'), 5000);
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
                if (choices[p1] === 'split' && choices[p2] === 'split') { channel.send(`🤝 **SPLIT!** <@${p1}> and <@${p2}> share the prize: **${prize}**! 🎉`); }
                else if (choices[p1] === 'steal' && choices[p2] === 'steal') { channel.send(`💀 **STEAL TO STEAL!** Both tried to steal. **NO ONE WINS**! ❌`); }
                else { const thief = choices[p1] === 'steal' ? p1 : p2; channel.send(`😈 **BETRAYAL!** <@${thief}> stole everything and wins **${prize}**! 🏆`); }
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
                if (c1 === c2) { channel.send(`🤝 **DRAW!** Both chose **${c1}**. Battle ends in a tie! 🧇`); }
                else if ((c1 === 'rock' && c2 === 'scissors') || (c1 === 'paper' && c2 === 'rock') || (c1 === 'scissors' && c2 === 'paper')) { channel.send(`👑 **VICTORY!** <@${p1}> wins **${prize}**! ✨`); }
                else { channel.send(`👑 **VICTORY!** <@${p2}> wins **${prize}**! ✨`); }
            }
        });
    }
}

const express = require('express');
const app = express();
app.get('/', (req, res) => {
    if (client && client.user) { console.log(`📡 KeepAlive received! Bot status: ${client.user.presence.status}`); }
    res.send('Waffel\'s Giveaway is perfectly awake and running 24/7!');
});
app.listen(process.env.PORT || 3000);
client.login(process.env.DISCORD_TOKEN);


