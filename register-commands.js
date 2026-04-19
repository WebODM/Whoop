import 'dotenv/config';
import { REST, Routes, SlashCommandBuilder } from 'discord.js';

const commands = [
  new SlashCommandBuilder()
    .setName('ping')
    .setDescription('Replies with pong!'),
].map((cmd) => cmd.toJSON());

const rest = new REST({ version: '10' }).setToken(process.env.DISCORD_TOKEN);

try {
  console.log('Registering slash commands...');
  await rest.put(Routes.applicationCommands(process.env.APP_ID), {
    body: commands,
  });
  console.log('Slash commands registered successfully.');
} catch (err) {
  console.error('Failed to register commands:', err);
}
