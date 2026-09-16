import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { canManageMessages, canUseWebhook, relayMessage } from './webhook-relay.js';

const WORDS_FILE = fileURLToPath(new URL('./swear-words.txt', import.meta.url));

// Backslash-escaped so Discord renders literal asterisks instead of markdown.
const CENSOR_MASK = '\\*\\*\\*\\*';

// Common endings so "shitty", "fucking", "assholes" etc. are caught by the
// base word alone.
const SUFFIXES = "(?:ings?|in'?|ers?|es|ed|s|y|ies|iest|ier)?";

// Cheap leet-speak coverage: "sh1t", "a$$", "fvck" style spellings.
const LEET = {
  a: '[a4@]',
  e: '[e3]',
  i: '[i1!|]',
  o: '[o0]',
  s: '[s5$]',
  t: '[t7]',
  u: '[uv]',
};

let matcher = null;
let loadedWords = [];

function escapeRegExp(text) {
  return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function wordToPattern(word) {
  let pattern = '';

  for (const char of word) {
    if (char === ' ') {
      pattern += '\\s+';
      continue;
    }

    // Allow stretched spellings such as "fuuuck".
    pattern += `${LEET[char] ?? escapeRegExp(char)}+`;
  }

  return pattern;
}

export function buildMatcher(words) {
  if (words.length === 0) {
    return null;
  }

  const alternatives = [...words]
    .sort((left, right) => right.length - left.length)
    .map(wordToPattern)
    .join('|');

  // Whole-word matching, unicode aware, so "class" and "assess" are left alone.
  return new RegExp(`(?<![\\p{L}\\p{N}_])(?:${alternatives})${SUFFIXES}(?![\\p{L}\\p{N}_])`, 'giu');
}

export function parseWordList(contents) {
  const words = contents
    .split(/\r?\n/)
    .map((line) => line.replace(/#.*$/, '').trim().toLowerCase())
    .filter(Boolean);

  return [...new Set(words)];
}

export async function loadSwearWords() {
  let contents;

  try {
    contents = await readFile(WORDS_FILE, 'utf8');
  } catch (error) {
    if (error.code === 'ENOENT') {
      console.warn('No swear-words.txt found, language filter is disabled.');
    } else {
      console.error('Could not read swear-words.txt, language filter is disabled:', error.message);
    }

    matcher = null;
    loadedWords = [];
    return 0;
  }

  loadedWords = parseWordList(contents);
  matcher = buildMatcher(loadedWords);

  console.log(`Language filter loaded ${loadedWords.length} blacklisted words.`);

  return loadedWords.length;
}

export function getSwearWords() {
  return [...loadedWords];
}

// Returns the censored text and how many words were replaced.
export function censorText(text) {
  if (!matcher || !text) {
    return { text: text ?? '', count: 0 };
  }

  let count = 0;
  const censored = text.replace(matcher, () => {
    count += 1;
    return CENSOR_MASK;
  });

  return { text: censored, count };
}

export function containsSwearWords(text) {
  return censorText(text).count > 0;
}

function buildReminderMessage(message, censoredCopy) {
  let reminder =
    `Hi ${message.author.username}, your message in <#${message.channelId}> contained language ` +
    `we don't allow in the WebODM community, so the offending word(s) were replaced with ` +
    `${CENSOR_MASK}. Please keep the conversation civil and friendly. Thanks for understanding!`;

  if (censoredCopy) {
    reminder +=
      `\n\nThe bot could not re-post a censored copy in that channel, so your message was ` +
      `removed. Feel free to post it again without the offending words. Here is a censored copy:\n` +
      `>>> ${censoredCopy}`;
  }

  return reminder;
}

export async function enforceLanguagePolicy(message) {
  if (!matcher) {
    return false;
  }

  if (message.partial) {
    message = await message.fetch();
  }

  if (!message.inGuild() || message.author?.bot || message.webhookId) {
    return false;
  }

  const { text: censored, count } = censorText(message.content);

  if (count === 0) {
    return false;
  }

  const botMember = message.guild.members.me;

  if (!botMember || !canManageMessages(message.channel, botMember)) {
    console.warn(
      `Cannot censor message from ${message.author.tag}: missing Manage Messages in #${message.channel.name}.`,
    );
    return false;
  }

  let reposted = false;

  if (canUseWebhook(message.channel, botMember)) {
    try {
      await relayMessage(message, message.channel, { content: censored });
      reposted = true;
    } catch (error) {
      console.error(`Could not re-post censored message from ${message.author.tag}:`, error.message);
    }
  } else {
    console.warn(
      `Cannot re-post censored message in #${message.channel.name}: missing Manage Webhooks. Deleting instead.`,
    );
  }

  try {
    await message.delete();
  } catch (error) {
    console.error(`Could not delete message from ${message.author.tag}:`, error.message);

    if (reposted) {
      console.error('A censored copy was already posted, the channel may now show both versions.');
    }

    return false;
  }

  try {
    await message.author.send(buildReminderMessage(message, reposted ? null : censored.slice(0, 1500)));
  } catch (error) {
    console.error(`Could not DM ${message.author.tag}:`, error.message);
  }

  console.log(
    `Censored ${count} word(s) in a message from ${message.author.tag} in #${message.channel.name}` +
      (reposted ? '' : ' (deleted, no webhook access)'),
  );

  return true;
}
