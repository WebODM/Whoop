const WEBLATE_CREDITS_URL = 'https://hosted.weblate.org/api/projects/webodm/credits/';
const HANGAR_CHANNEL_NAME = 'hangar';
const MAX_MESSAGE_LENGTH = 2000;
let lastPostedPeriodKey = null;

function toIsoDate(value) {
  return value.toISOString().slice(0, 10);
}

function getPreviousMonthPeriod(referenceDate = new Date()) {
  const year = referenceDate.getUTCFullYear();
  const month = referenceDate.getUTCMonth();
  const start = new Date(Date.UTC(year, month - 1, 1));
  const end = new Date(Date.UTC(year, month, 0));
  const label = start.toLocaleString('en-US', {
    month: 'long',
    year: 'numeric',
    timeZone: 'UTC',
  });

  return {
    start,
    end,
    label,
    key: `${start.getUTCFullYear()}-${String(start.getUTCMonth() + 1).padStart(2, '0')}`,
  };
}

function getTranslatorKey(contributor) {
  return contributor.email || contributor.username || contributor.full_name;
}

function getDisplayName(contributor) {
  return contributor.full_name || contributor.username || contributor.email || 'Unknown translator';
}

function normalizeLanguageName(language) {
  return language.replace(/\s*\([^)]*\)/g, '').trim();
}

function getRankAward(position) {
  if (position === 1) {
    return '🏆';
  }

  if (position === 2) {
    return '🥈';
  }

  if (position === 3) {
    return '🥉';
  }

  return '';
}

function padCell(value, width) {
  return value.padEnd(width, ' ');
}

function padNumberCell(value, width) {
  return value.padStart(width, ' ');
}

export function aggregateCredits(credits) {
  const translators = new Map();

  for (const languageEntry of credits) {
    const [language, contributors] = Object.entries(languageEntry)[0] ?? [];
    const normalizedLanguage = normalizeLanguageName(language);

    if (!normalizedLanguage || !Array.isArray(contributors)) {
      continue;
    }

    for (const contributor of contributors) {
      const translatorKey = getTranslatorKey(contributor);

      if (!translatorKey) {
        continue;
      }

      const existing = translators.get(translatorKey) ?? {
        displayName: getDisplayName(contributor),
        changeCount: 0,
        languages: new Set(),
      };

      existing.displayName = existing.displayName || getDisplayName(contributor);
      existing.changeCount += Number(contributor.change_count) || 0;
      existing.languages.add(normalizedLanguage);

      translators.set(translatorKey, existing);
    }
  }

  return [...translators.values()]
    .map((translator) => ({
      displayName: translator.displayName,
      changeCount: translator.changeCount,
      languages: [...translator.languages].sort((left, right) => left.localeCompare(right)),
    }))
    .sort((left, right) => {
      if (right.changeCount !== left.changeCount) {
        return right.changeCount - left.changeCount;
      }

      return left.displayName.localeCompare(right.displayName);
    });
}

export function buildLeaderboardMessage(periodLabel, leaderboard) {
  if (leaderboard.length === 0) {
    return [`No translation contributions were reported for ${periodLabel}.`];
  }

  const intro = `This month's translator leaderboard for https://hosted.weblate.org/projects/webodm/`;
  const rows = leaderboard.map((translator, index) => ({
    award: getRankAward(index + 1),
    position: `${index + 1}`,
    translator: translator.displayName,
    contributions: `${translator.changeCount}`,
    languages: translator.languages.join(', '),
  }));
  const headers = {
    award: '',
    position: '#',
    translator: 'Translator',
    contributions: 'Changes',
    languages: 'Languages',
  };
  const widths = {
    award: Math.max(headers.award.length, ...rows.map((row) => row.award.length)),
    position: Math.max(headers.position.length, ...rows.map((row) => row.position.length)),
    translator: Math.max(headers.translator.length, ...rows.map((row) => row.translator.length)),
    contributions: Math.max(headers.contributions.length, ...rows.map((row) => row.contributions.length)),
    languages: Math.max(headers.languages.length, ...rows.map((row) => row.languages.length)),
  };
  const formatRow = (row) => [
    padCell(row.award, widths.award),
    padNumberCell(row.position, widths.position),
    padCell(row.translator, widths.translator),
    padNumberCell(row.contributions, widths.contributions),
    row.languages,
  ].join(' | ');
  const separator = [
    '-'.repeat(widths.award),
    '-'.repeat(widths.position),
    '-'.repeat(widths.translator),
    '-'.repeat(widths.contributions),
    '-'.repeat(widths.languages),
  ].join('-+-');
  const headerLines = [formatRow(headers), separator];
  const rowLines = rows.map(formatRow);
  const messages = [];
  let currentBlockLines = [...headerLines];
  let messagePrefix = intro;
  const codeFence = '`'.repeat(3);

  const buildMessage = (prefix, lines) => `${prefix}\n\n${codeFence}\n${lines.join('\n')}\n${codeFence}`;

  for (const rowLine of rowLines) {
    const candidateLines = [...currentBlockLines, rowLine];
    const candidateMessage = buildMessage(messagePrefix, candidateLines);

    if (candidateMessage.length > MAX_MESSAGE_LENGTH && currentBlockLines.length > headerLines.length) {
      messages.push(buildMessage(messagePrefix, currentBlockLines));
      currentBlockLines = [...headerLines, rowLine];
      messagePrefix = 'Translator leaderboard continued:';
      continue;
    }

    currentBlockLines = candidateLines;
  }

  messages.push(buildMessage(messagePrefix, currentBlockLines));
  return messages;
}

export async function fetchCredits(apiKey, referenceDate = new Date()) {
  const period = getPreviousMonthPeriod(referenceDate);
  const params = new URLSearchParams({
    start: toIsoDate(period.start),
    end: toIsoDate(period.end),
  });
  const response = await fetch(`${WEBLATE_CREDITS_URL}?${params}`, {
    headers: {
      Authorization: `Token ${apiKey}`,
      Accept: 'application/json',
    },
  });

  if (!response.ok) {
    const errorBody = await response.text();
    throw new Error(`Weblate credits request failed (${response.status}): ${errorBody}`);
  }

  const credits = await response.json();

  if (!Array.isArray(credits)) {
    throw new Error('Weblate credits response was not an array.');
  }

  return {
    period,
    credits,
    leaderboard: aggregateCredits(credits),
  };
}

function findHangarChannel(guild) {
  return guild.channels.cache.find(
    (channel) => channel.name === HANGAR_CHANNEL_NAME && channel.isTextBased() && typeof channel.send === 'function',
  );
}

export async function postTranslatorLeaderboard(guild, apiKey, referenceDate = new Date()) {
  const hangarChannel = findHangarChannel(guild);

  if (!hangarChannel) {
    throw new Error(`Could not find a #${HANGAR_CHANNEL_NAME} text channel.`);
  }

  const { period, leaderboard } = await fetchCredits(apiKey, referenceDate);
  const messages = buildLeaderboardMessage(period.label, leaderboard);

  for (const message of messages) {
    await hangarChannel.send(message);
  }

  return period;
}

export async function maybePostMonthlyTranslatorLeaderboard(client, apiKey, referenceDate = new Date()) {
  if (referenceDate.getUTCDate() !== 1) {
    return [];
  }

  const period = getPreviousMonthPeriod(referenceDate);

  if (lastPostedPeriodKey === period.key) {
    return [];
  }

  const guild = client.guilds.cache.first();

  if (!guild) {
    return [];
  }

  await postTranslatorLeaderboard(guild, apiKey, referenceDate);
  lastPostedPeriodKey = period.key;

  return [{ guildId: guild.id, periodKey: period.key }];
}