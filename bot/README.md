# Discord Bot System (Economy + Backup + Verification)

Node.js + Discord.js v14 **3-bot system** (separate tokens) with an Express + EJS dashboard and MongoDB (Mongoose).

## Setup

1. Install dependencies:
   - `npm install`
2. Create `.env` (don’t commit it):
   - copy `.env.example` to `.env`
   - fill in required values (3 bot tokens + OAuth + MongoDB)
3. Create 3 Discord applications/bots (Economy, Backup, Verification) and invite them to your server.
4. Register slash commands:
   - `npm run register` (registers all 3 bots)
   - or per bot: `npm run register:economy`, `npm run register:backup`, `npm run register:verification`
   - (Tip) set `DEV_GUILD_ID` for instant dev updates
5. (Optional) Seed starter items/shop:
   - `npm run seed` (needs only `MONGODB_URI`; optional `SEED_GUILD_ID` to seed shop listings)
6. Run:
   - `npm run dev`
7. First-time dashboard setup:
   - open `http://localhost:3000/admin/setup` to create the **owner** account
   - login at `http://localhost:3000/admin/login`
   - approve servers at `http://localhost:3000/admin/servers` (**bots won’t work until approved**)

Tip: set `PUBLIC_BASE_URL` in `.env` so the dashboard shows the correct public verification link (not `localhost`).

## View the database

- MongoDB Compass: connect using your `MONGODB_URI` (from your local `.env`).
- Quick check (prints DB name + collections): `npm run db:info`

## Required intents / permissions

- Backup + Verification bots need privileged intents enabled in the Developer Portal:
  - **Message Content Intent** (for message logs / message backup)
  - **Server Members Intent** (for nickname backup / join gate)
- Backup/restore also requires the bot to have the right server permissions (Manage Channels/Roles/Webhooks, View Channels, Read Message History, etc.).

## Slash commands (overview)

- Economy bot: `/daily`, `/balance`, `/deposit`, `/withdraw`, `/shop`, `/buy`, `/sell`, `/inventory`, `/use`, `/equip`, `/coinflip`, `/slots`, `/dice`, `/blackjack`, `/crash`, `/hunt`, `/stats`, `/levelup`, `/refine`, `/gacha`, `/profile`, `/marry`, `/divorce`, `/pvp`, `/help`.
- Backup bot: `/backup (create|list|info|restore|delete)`, `/schedule (add|list|remove)`, `/template (save|list|apply)`, `/help`.
- Verification bot: `/verify`, `/config (show|log-channel|verification-log-channel|temp-role|verified-role|verification-questions|toggle-log|verification-enable)`, `/help`.

## Discord limitations (important)

- **Message restore** cannot re-send messages as the original authors. Restore is best-effort (bot/webhook repost with attribution).
- **Webhook tokens/URLs** are not always retrievable from the Discord API after creation; backup stores what Discord provides.
- **Role/channel positions** can only be set below the bot’s highest role.

## Reference blueprint

See `omplete_bot_flow_with_webhooks.txt` and `REVISED_CODEX_PROMPT.md`.
