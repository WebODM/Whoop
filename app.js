import 'dotenv/config';
import {
  ActionRowBuilder,
  ChannelSelectMenuBuilder,
  ChannelType,
  Client,
  Events,
  GatewayIntentBits,
  PermissionFlagsBits,
  MessageFlags,
  Message
} from 'discord.js';


const MOVE_WEBHOOK_NAME = 'Whoop Move Relay';
const MOVE_TARGET_CHANNEL_TYPES = [
  ChannelType.GuildText,
  ChannelType.GuildAnnouncement,
  ChannelType.PublicThread,
  ChannelType.PrivateThread,
  ChannelType.AnnouncementThread,
];

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMembers,
  ],
});

client.once(Events.ClientReady, (c) => {
  console.log(`Logged in as ${c.user.tag}`);
});

function hasMoveAccess(member) {
  return (
    member.permissions.has(PermissionFlagsBits.Administrator) ||
    member.roles.cache.some((role) => role.name.toLowerCase() === 'moderator')
  );
}

function createMoveCustomId(userId, sourceChannelId, messageId) {
  return `move:${userId}:${sourceChannelId}:${messageId}`;
}

function parseMoveCustomId(customId) {
  const [action, userId, sourceChannelId, messageId] = customId.split(':');

  if (action !== 'move' || !userId || !sourceChannelId || !messageId) {
    return null;
  }

  return { userId, sourceChannelId, messageId };
}

function isGuildTextMessageChannel(channel) {
  return channel?.isTextBased() && 'messages' in channel && channel.guild;
}

function isSupportedMoveTarget(channel) {
  return channel?.guild && MOVE_TARGET_CHANNEL_TYPES.includes(channel.type);
}

function getWebhookTarget(channel) {
  if (channel.isThread()) {
    if (!channel.parent || !channel.parent.isTextBased() || !('fetchWebhooks' in channel.parent)) {
      throw new Error('Target thread does not have a webhook-capable parent channel.');
    }

    return {
      webhookChannel: channel.parent,
      threadId: channel.id,
    };
  }

  if (!channel.isTextBased() || !('fetchWebhooks' in channel)) {
    throw new Error('Target channel does not support webhooks.');
  }

  return {
    webhookChannel: channel,
    threadId: undefined,
  };
}

async function getOrCreateMoveWebhook(clientUserId, channel) {
  const webhooks = await channel.fetchWebhooks();
  const existingWebhook = webhooks.find(
    (webhook) => webhook.owner?.id === clientUserId && webhook.name === MOVE_WEBHOOK_NAME,
  );

  if (existingWebhook) {
    return existingWebhook;
  }

  return channel.createWebhook({
    name: MOVE_WEBHOOK_NAME,
    reason: 'Relay messages for the Move context command',
  });
}

async function replayMessageWithWebhook(message, targetChannel) {
  const { webhookChannel, threadId } = getWebhookTarget(targetChannel);
  const webhook = await getOrCreateMoveWebhook(message.client.user.id, webhookChannel);
  const files = [...message.attachments.values()].map((attachment) => ({
    attachment: attachment.url,
    name: attachment.name ?? `attachment-${attachment.id}`,
  }));
  const embeds = message.embeds.map((embed) => embed.toJSON());
  const content = message.content.trim();

  if (!content && embeds.length === 0 && files.length === 0) {
    throw new Error('This message has no content, embeds, or attachments that can be moved.');
  }

  return webhook.send({
    content: content || undefined,
    username: message.member?.displayName ?? message.author.globalName ?? message.author.username,
    avatarURL: message.author.displayAvatarURL(),
    embeds,
    files,
    allowedMentions: { parse: [] },
    threadId,
  });
}

function canManageSourceMessage(channel, botMember) {
  const permissions = channel.permissionsFor(botMember);

  return permissions?.has([
    PermissionFlagsBits.ViewChannel,
    PermissionFlagsBits.ReadMessageHistory,
    PermissionFlagsBits.ManageMessages,
  ]);
}

function canUseTargetWebhook(channel, botMember) {
  const { webhookChannel } = getWebhookTarget(channel);
  const permissions = webhookChannel.permissionsFor(botMember);

  return permissions?.has([
    PermissionFlagsBits.ViewChannel,
    PermissionFlagsBits.ManageWebhooks,
  ]);
}

async function handleMoveCommand(interaction) {
  if (!interaction.inGuild()) {
    await interaction.reply({
      content: 'The Move command can only be used inside a server.',
      messageFlags: MessageFlags.Ephemeral
    });
    return;
  }

  const member = await interaction.guild.members.fetch(interaction.user.id);

  if (!hasMoveAccess(member)) {
    await interaction.reply({
      content: 'Only moderators or administrators can move messages.',
      messageFlags: MessageFlags.Ephemeral
    });
    return;
  }

  if (!isGuildTextMessageChannel(interaction.targetMessage.channel)) {
    await interaction.reply({
      content: 'That message is not in a supported source channel.',
      messageFlags: MessageFlags.Ephemeral
    });
    return;
  }

  const selector = new ChannelSelectMenuBuilder()
    .setCustomId(
      createMoveCustomId(
        interaction.user.id,
        interaction.targetMessage.channelId,
        interaction.targetMessage.id,
      ),
    )
    .setPlaceholder('Choose a destination channel or thread')
    .setMinValues(1)
    .setMaxValues(1)
    .addChannelTypes(...MOVE_TARGET_CHANNEL_TYPES);

  const row = new ActionRowBuilder().addComponents(selector);

  await interaction.reply({
    content: ``,
    components: [row],
    messageFlags: MessageFlags.Ephemeral
  });
}

async function handleMoveSelection(interaction) {
  const moveContext = parseMoveCustomId(interaction.customId);

  if (!moveContext) {
    await interaction.reply({
      content: 'That move request is invalid.',
      messageFlags: MessageFlags.Ephemeral
    });
    return;
  }

  if (moveContext.userId !== interaction.user.id) {
    await interaction.reply({
      content: 'Only the moderator who opened this move menu can use it.',
      messageFlags: MessageFlags.Ephemeral
    });
    return;
  }

  await interaction.deferUpdate();

  const member = await interaction.guild.members.fetch(interaction.user.id);

  if (!hasMoveAccess(member)) {
    await interaction.editReply({
      content: 'You no longer have permission to move messages.',
      components: [],
    });
    return;
  }

  const sourceChannel = await interaction.client.channels.fetch(moveContext.sourceChannelId);

  if (!isGuildTextMessageChannel(sourceChannel)) {
    await interaction.editReply({
      content: 'The original channel is no longer available.',
      components: [],
    });
    return;
  }

  const targetChannel = await interaction.client.channels.fetch(interaction.values[0]);

  if (!isSupportedMoveTarget(targetChannel)) {
    await interaction.editReply({
      content: 'Please choose a text channel or thread in this server.',
      components: [],
    });
    return;
  }

  if (targetChannel.guildId !== interaction.guildId) {
    await interaction.editReply({
      content: 'The destination must be in the same server.',
      components: [],
    });
    return;
  }

  if (sourceChannel.id === targetChannel.id) {
    await interaction.editReply({
      content: 'The destination must be different from the source channel.',
      components: [],
    });
    return;
  }

  const botMember = interaction.guild.members.me;

  if (!botMember) {
    await interaction.editReply({
      content: 'The bot member could not be resolved in this server.',
      components: [],
    });
    return;
  }

  if (!canManageSourceMessage(sourceChannel, botMember)) {
    await interaction.editReply({
      content: 'The bot needs View Channel, Read Message History, and Manage Messages in the source channel.',
      components: [],
    });
    return;
  }

  if (!canUseTargetWebhook(targetChannel, botMember)) {
    await interaction.editReply({
      content: 'The bot needs View Channel and Manage Webhooks in the destination channel or its parent channel.',
      components: [],
    });
    return;
  }

  let sourceMessage;

  try {
    sourceMessage = await sourceChannel.messages.fetch(moveContext.messageId);
  } catch {
    await interaction.editReply({
      content: 'The original message could not be found. It may already be deleted.',
      components: [],
    });
    return;
  }

  try {
    await replayMessageWithWebhook(sourceMessage, targetChannel);
    await sourceMessage.delete();

    await interaction.deleteReply();
  } catch (error) {
    console.error('Failed to move message:', error);

    await interaction.editReply({
      content: `Move failed: ${error.message}`,
      components: [],
    });
  }
}

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
  try {
    if (interaction.isChatInputCommand() && interaction.commandName === 'ping') {
      await interaction.reply('pong!');
      return;
    }

    if (interaction.isMessageContextMenuCommand() && interaction.commandName === 'Move') {
      await handleMoveCommand(interaction);
      return;
    }

    if (interaction.isChannelSelectMenu() && interaction.customId.startsWith('move:')) {
      await handleMoveSelection(interaction);
    }
  } catch (error) {
    console.error('Interaction handling failed:', error);

    const replyPayload = {
      content: 'Something went wrong while handling that interaction.',
      messageFlags: MessageFlags.Ephemeral
    };

    if (interaction.deferred || interaction.replied) {
      await interaction.followUp(replyPayload).catch(() => null);
      return;
    }

    await interaction.reply(replyPayload).catch(() => null);
  }
});

client.login(process.env.DISCORD_TOKEN);
