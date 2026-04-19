import 'dotenv/config';
import { Client, GatewayIntentBits, Events } from 'discord.js';

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMembers,
  ],
});

client.once(Events.ClientReady, (c) => {
  console.log(`Logged in as ${c.user.tag}`);
});

// Greet new members via DM
client.on(Events.GuildMemberAdd, async (member) => {
  // Find channels by name
  const introductions = member.guild.channels.cache.find(
    (ch) => ch.name.indexOf('introductions') !== -1,
  );
  const help = member.guild.channels.cache.find(
    (ch) => ch.name.indexOf('help') !== -1,
  );

  const introLink = introductions ? `<#${introductions.id}>` : 'introductions';
  const helpLink = help ? `<#${help.id}>` : '#help';

  const message =
    `Hey ${member.user.username} :wave: welcome to the WebODM Community! If you want to connect with others, how about some ${introLink}? ` +
    `Feel free to just look around. If you need help, open a topic in ${helpLink}. Be polite, respect others. Have fun! `;

  try {
    await member.send(message);
    console.log(`Greeted ${member.user.tag}`);
  } catch (err) {
    console.error(`Could not DM ${member.user.tag}:`, err.message);
  }
});

// Handle /ping slash command
client.on(Events.InteractionCreate, async (interaction) => {
  if (!interaction.isChatInputCommand()) return;

  if (interaction.commandName === 'ping') {
    await interaction.reply('pong!');
  }
});

client.login(process.env.DISCORD_TOKEN);
