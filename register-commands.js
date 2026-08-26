import 'dotenv/config';
import {
  ApplicationCommandType,
  ContextMenuCommandBuilder,
  PermissionFlagsBits,
  REST,
  Routes,
  SlashCommandBuilder,
} from 'discord.js';

const commands = [
  new SlashCommandBuilder()
    .setName('ping')
    .setDescription('Replies with pong!'),
  new SlashCommandBuilder()
    .setName('mentionblock')
    .setDescription('Manage users who are not allowed to @ mention others.')
    .setDMPermission(false)
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageMessages)
    .addSubcommand((subcommand) =>
      subcommand
        .setName('add')
        .setDescription('Block a user from @ mentioning others.')
        .addUserOption((option) =>
          option.setName('user').setDescription('The user to block.').setRequired(true),
        ),
    )
    .addSubcommand((subcommand) =>
      subcommand
        .setName('remove')
        .setDescription('Allow a user to @ mention others again.')
        .addUserOption((option) =>
          option.setName('user').setDescription('The user to unblock.').setRequired(true),
        ),
    )
    .addSubcommand((subcommand) =>
      subcommand.setName('list').setDescription('Show who is blocked from @ mentioning.'),
    ),
  new ContextMenuCommandBuilder()
    .setName('Move')
    .setType(ApplicationCommandType.Message)
    .setDMPermission(false)
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageMessages),
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
