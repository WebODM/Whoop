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
WEBLATE_KEY=your_weblate_api_key
```

`MODERATOR_ROLE_NAME` is optional and defaults to `Moderator`.
`WEBLATE_KEY` is required for the monthly translator leaderboard.

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

## Translator Leaderboard

On the first day of each month, the bot fetches the previous month's credits from Weblate and posts a translator leaderboard in the `#hangar` channel.

Administrators can also trigger the same post manually with `/testleaderboard`. The command is hidden from non-admin members by default and also checked again at runtime.

## Move Command

The bot includes a `Move` message context-menu command. When a moderator or administrator right-clicks a message and chooses `Apps` -> `Move`, the bot replies with an ephemeral channel/thread dropdown, replays the message through a webhook so the original author's display name and avatar are preserved, and deletes the original message after the replay succeeds.

Required bot permissions:

- `Manage Webhooks` in the destination channel, or in the parent channel when moving into a thread
- `Manage Messages`, `View Channel`, and `Read Message History` in the source channel

The command is registered with Discord's `Manage Messages` default permission so it is hidden from most members. Runtime access is still restricted to administrators or members with the configured moderator role name.

## License

Licensed under AGPLv3. See the `LICENSE` file.
