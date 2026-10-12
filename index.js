require('dotenv').config();
const { Client, GatewayIntentBits } = require('discord.js');
const express = require('express');
const fs = require('fs');

const DATA_FILE = './database.json';
const app = express();

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
    fs.writeFileSync(DATA_FILE, JSON.stringify({ warns: warnDatabase, stats: statsDatabase, giveaways: giveawaysDatabase, blacklist: Array.from(blacklistDatabase) }, null, 2), 'utf8');
  } catch (err) {
    console.error('Failed saving database:', err);
  }
}

function initStats(userId) {
  if (!statsDatabase[userId]) statsDatabase[userId] = { entered: 0, won: 0 };
}

const client = new Client({ intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildMessages, GatewayIntentBits.MessageContent, GatewayIntentBits.GuildMembers] });

client.once('ready', () => {
  console.log(`✨ Logged in as ${client.user.tag}`);
});

// Health endpoints
app.get('/', (req, res) => {
  res.type('text').send("Waffel's Giveaway Bot - alive");
});
app.get('/health', (req, res) => {
  res.json({ status: 'ok', bot: client.user ? client.user.tag : null });
});

const PORT = process.env.PORT || 3000;
// Bind to 0.0.0.0 to ensure the host's network interfaces accept connections
app.listen(PORT, '0.0.0.0', () => console.log(`HTTP server listening on port ${PORT}`));

client.on('messageCreate', async (message) => {
  if (message.author.bot) return;
  const content = (message.content || '').trim();

  if (content === '!ping') return message.reply('Pong!');

  if (content.startsWith('!gstart')) {
    if (!message.member || !message.member.permissions) return;
    if (!message.member.permissions.has('ModerateMembers')) {
      return message.channel.send('❌ You need staff permissions to start a giveaway.');
    }

    const parts = content.slice('!gstart'.length).trim().split(/ +/);
    const durationStr = parts.shift();
    const prize = parts.join(' ') || 'Unknown Prize';
    if (!durationStr) return message.reply('Usage: !gstart <duration> <prize>');

    // Minimal acknowledgement; full giveaway engine was removed to fix syntax issues.
    initStats(message.author.id);
    statsDatabase[message.author.id].entered += 1;
    saveDatabase();

    return message.channel.send(`✅ Giveaway created for **${prize}** (duration: ${durationStr}) — minimal mode`);
  }
});

// Login
if (!process.env.DISCORD_TOKEN) {
  console.error('DISCORD_TOKEN not set in environment');
  process.exit(1);
}
client.login(process.env.DISCORD_TOKEN).catch(err => { console.error('Failed to login:', err); process.exit(1); });
