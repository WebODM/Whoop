import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { PermissionFlagsBits } from 'discord.js';

const DATA_DIRECTORY = fileURLToPath(new URL('./data/', import.meta.url));
const BLOCKS_FILE = `${DATA_DIRECTORY}mention-blocks.json`;
const BLOCKS_TEMP_FILE = `${BLOCKS_FILE}.tmp`;

// guildId -> (userId -> { blockedBy, blockedAt })
const mentionBlocks = new Map();
let pendingSave = Promise.resolve();

function serializeMentionBlocks() {
  const serialized = {};

  for (const [guildId, blockedUsers] of mentionBlocks) {
    if (blockedUsers.size === 0) {
      continue;
    }

    serialized[guildId] = Object.fromEntries(blockedUsers);
  }

  return JSON.stringify(serialized, null, 2);
}

async function writeMentionBlocks() {
  const contents = serializeMentionBlocks();

  await mkdir(DATA_DIRECTORY, { recursive: true });
  await writeFile(BLOCKS_TEMP_FILE, contents, 'utf8');
  await rename(BLOCKS_TEMP_FILE, BLOCKS_FILE);
}

function saveMentionBlocks() {
  pendingSave = pendingSave
    .then(() => writeMentionBlocks())
    .catch((error) => {
      console.error('Failed to save mention blocks:', error.message);
    });

  return pendingSave;
}

export async function loadMentionBlocks() {
  mentionBlocks.clear();

  let contents;

  try {
    contents = await readFile(BLOCKS_FILE, 'utf8');
  } catch (error) {
    if (error.code !== 'ENOENT') {
      console.error('Could not read mention blocks:', error.message);
    }

    return mentionBlocks;
  }

  let parsed;

  try {
    parsed = JSON.parse(contents);
  } catch (error) {
    console.error('Mention blocks file is not valid JSON, starting empty:', error.message);
    return mentionBlocks;
  }

  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    console.error('Mention blocks file has an unexpected shape, starting empty.');
    return mentionBlocks;
  }

  for (const [guildId, blockedUsers] of Object.entries(parsed)) {
    if (!blockedUsers || typeof blockedUsers !== 'object' || Array.isArray(blockedUsers)) {
      continue;
    }

    mentionBlocks.set(guildId, new Map(Object.entries(blockedUsers)));
  }

  return mentionBlocks;
}

export function isMentionBlocked(guildId, userId) {
  return mentionBlocks.get(guildId)?.has(userId) ?? false;
}

export async function blockUser(guildId, userId, moderatorId) {
  if (isMentionBlocked(guildId, userId)) {
    return false;
  }

  const blockedUsers = mentionBlocks.get(guildId) ?? new Map();

  blockedUsers.set(userId, {
    blockedBy: moderatorId,
    blockedAt: new Date().toISOString(),
  });
  mentionBlocks.set(guildId, blockedUsers);

  await saveMentionBlocks();

  return true;
}

export async function unblockUser(guildId, userId) {
  const blockedUsers = mentionBlocks.get(guildId);

  if (!blockedUsers?.delete(userId)) {
    return false;
  }

  if (blockedUsers.size === 0) {
    mentionBlocks.delete(guildId);
  }

  await saveMentionBlocks();

  return true;
}

export function listBlockedUsers(guildId) {
  const blockedUsers = mentionBlocks.get(guildId);

  if (!blockedUsers) {
    return [];
  }

  return [...blockedUsers.entries()]
    .map(([userId, entry]) => ({ userId, ...entry }))
    .sort((left, right) => (left.blockedAt ?? '').localeCompare(right.blockedAt ?? ''));
}

export function hasMention(message) {
  if (message.mentions.everyone || message.mentions.roles.size > 0) {
    return true;
  }

  const mentionedUserIds = [...message.mentions.users.keys()];

  if (mentionedUserIds.length === 0) {
    return false;
  }

  // Replying with the ping toggle on adds the replied-to author to the mention
  // list. That is not a deliberate @ mention, so it does not count on its own.
  const repliedUserId = message.mentions.repliedUser?.id;

  return mentionedUserIds.some((userId) => userId !== repliedUserId);
}

function canDeleteMessages(channel, botMember) {
  return channel.permissionsFor(botMember)?.has(PermissionFlagsBits.ManageMessages) ?? false;
}

function buildWarningMessage(message) {
  return (
    `Hi ${message.author.username}, your message in <#${message.channelId}> was removed because it ` +
    `used an @ mention. Please do not @ mention people directly. ` +
    `You are welcome to post the message again without the mention.`
  );
}

export async function enforceMentionPolicy(message) {
  if (message.partial) {
    message = await message.fetch();
  }

  if (!message.inGuild() || message.author?.bot) {
    return false;
  }

  if (!isMentionBlocked(message.guildId, message.author.id)) {
    return false;
  }

  if (!hasMention(message)) {
    return false;
  }

  const botMember = message.guild.members.me;

  if (!botMember || !canDeleteMessages(message.channel, botMember)) {
    console.warn(
      `Cannot remove mention from ${message.author.tag}: missing Manage Messages in #${message.channel.name}.`,
    );
    return false;
  }

  try {
    await message.delete();
  } catch (error) {
    console.error(`Could not delete mention message from ${message.author.tag}:`, error.message);
    return false;
  }

  try {
    await message.author.send(buildWarningMessage(message));
  } catch (error) {
    console.error(`Could not DM ${message.author.tag}:`, error.message);
  }

  console.log(`Removed a mention message from ${message.author.tag}`);

  return true;
}
