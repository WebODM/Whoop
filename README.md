# Whoop

Friendly Discord bot for the WebODM community.

## Getting Started

Requirements:

- Node.js 18+
- A Discord bot token
- A Discord application ID

Install dependencies:

```sh
npm install
```

Create a `.env` file:

```env
DISCORD_TOKEN=your_bot_token
APP_ID=your_application_id
MODERATOR_ROLE_NAME=Moderator
```

`MODERATOR_ROLE_NAME` is optional and defaults to `Moderator`.

Register slash commands:

```sh
npm run register
```

Start the bot:

```sh
npm start
```

For development:

```sh
npm run dev
```

## Move Command

The bot includes a `Move` message context-menu command. When a moderator or administrator right-clicks a message and chooses `Apps` -> `Move`, the bot replies with an ephemeral channel/thread dropdown, replays the message through a webhook so the original author's display name and avatar are preserved, and deletes the original message after the replay succeeds.

Required bot permissions:

- `Manage Webhooks` in the destination channel, or in the parent channel when moving into a thread
- `Manage Messages`, `View Channel`, and `Read Message History` in the source channel

The command is registered with Discord's `Manage Messages` default permission so it is hidden from most members. Runtime access is still restricted to administrators or members with the configured moderator role name.

## Mention Block

Moderators can revoke a member's ability to @ mention people without muting or banning them:

- `/mentionblock add user:@someone` - blocks the user from @ mentioning
- `/mentionblock remove user:@someone` - allows them to @ mention again
- `/mentionblock list` - shows who is currently blocked

When a blocked user posts (or edits) a message containing a mention in any channel, the bot deletes
the message and sends the user a DM asking them not to @ mention people. The command uses the same
access rules as `Move`: hidden behind Discord's `Manage Messages` default permission, and re-checked
at runtime against administrators and the moderator role.

The blacklist is stored in `data/mention-blocks.json` and survives restarts. That directory is
gitignored.

Required bot permissions: `Manage Messages` in every channel that should be policed. The bot
silently skips channels where it cannot delete, and logs a warning.

Notes:

- Detection covers real Discord mentions only: `@user`, `@role`, and `@everyone`/`@here`. Plain
  text like `@bob` that Discord does not turn into a mention is **not** detected, by design - that
  would require the privileged Message Content intent.
- Replying with the ping toggle on does not count as a mention on its own.
- The bot needs the `Server Messages` (`GuildMessages`) gateway intent, which is **not** privileged.
  Nothing needs to be enabled in the Discord Developer Portal beyond what the bot already uses.

## License

Licensed under AGPLv3. See the `LICENSE` file.
