import { ChannelType, PermissionFlagsBits } from 'discord.js';

// Shared by the Move command and the language filter. Both need to re-post a
// message "as" its original author, which is only possible through a webhook.
const RELAY_WEBHOOK_NAME = 'Whoop Move Relay';
const DISCORD_MESSAGE_LIMIT = 2000;

function hasWebhookMethods(channel) {
  return (
    channel &&
    typeof channel.fetchWebhooks === 'function' &&
    typeof channel.createWebhook === 'function'
  );
}

export function getWebhookTarget(channel) {
  if (channel.type === ChannelType.GuildForum) {
    if (!hasWebhookMethods(channel)) {
      throw new Error('Target forum channel does not support webhooks.');
    }

    return { webhookChannel: channel, threadId: undefined };
  }

  if (channel.isThread()) {
    if (!channel.parent || !hasWebhookMethods(channel.parent)) {
      throw new Error('Target thread does not have a webhook-capable parent channel.');
    }

    return { webhookChannel: channel.parent, threadId: channel.id };
  }

  if (!hasWebhookMethods(channel)) {
    throw new Error('Target channel does not support webhooks.');
  }

  return { webhookChannel: channel, threadId: undefined };
}

async function getOrCreateRelayWebhook(clientUserId, channel) {
  const webhooks = await channel.fetchWebhooks();
  const existingWebhook = webhooks.find(
    (webhook) => webhook.owner?.id === clientUserId && webhook.name === RELAY_WEBHOOK_NAME,
  );

  if (existingWebhook) {
    return existingWebhook;
  }

  return channel.createWebhook({
    name: RELAY_WEBHOOK_NAME,
    reason: 'Relay messages on behalf of members',
  });
}

export function canManageMessages(channel, botMember) {
  const permissions = channel.permissionsFor(botMember);

  return (
    permissions?.has([
      PermissionFlagsBits.ViewChannel,
      PermissionFlagsBits.ReadMessageHistory,
      PermissionFlagsBits.ManageMessages,
    ]) ?? false
  );
}

export function canUseWebhook(channel, botMember) {
  let webhookChannel;

  try {
    ({ webhookChannel } = getWebhookTarget(channel));
  } catch {
    return false;
  }

  const permissions = webhookChannel.permissionsFor(botMember);

  return (
    permissions?.has([PermissionFlagsBits.ViewChannel, PermissionFlagsBits.ManageWebhooks]) ??
    false
  );
}

export function createForumThreadName(message) {
  const baseName = message.content.replace(/\s+/g, ' ').trim().slice(0, 90);

  if (baseName.length > 0) {
    return baseName;
  }

  return `Moved message from ${message.author.username}`;
}

function truncateContent(content) {
  if (content.length <= DISCORD_MESSAGE_LIMIT) {
    return content;
  }

  return `${content.slice(0, DISCORD_MESSAGE_LIMIT - 1)}…`;
}

// Re-posts `message` into `targetChannel` through a webhook so the original
// author's display name and avatar are preserved. `content` overrides the text
// that gets sent; attachments and embeds are always carried over.
export async function relayMessage(message, targetChannel, { content = message.content } = {}) {
  const { webhookChannel, threadId } = getWebhookTarget(targetChannel);
  const webhook = await getOrCreateRelayWebhook(message.client.user.id, webhookChannel);
  const files = [...message.attachments.values()].map((attachment) => ({
    attachment: attachment.url,
    name: attachment.name ?? `attachment-${attachment.id}`,
  }));
  const embeds = message.embeds.map((embed) => embed.toJSON());
  const text = truncateContent((content ?? '').trim());

  if (!text && embeds.length === 0 && files.length === 0) {
    throw new Error('This message has no content, embeds, or attachments that can be relayed.');
  }

  return webhook.send({
    content: text || undefined,
    username: message.member?.displayName ?? message.author.globalName ?? message.author.username,
    avatarURL: message.author.displayAvatarURL(),
    embeds,
    files,
    allowedMentions: { parse: [] },
    threadId,
    threadName:
      targetChannel.type === ChannelType.GuildForum ? createForumThreadName(message) : undefined,
  });
}
