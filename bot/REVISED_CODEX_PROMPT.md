# Revised Codex Prompt (Discord Bot System)

**Goal:** Build a production-ready Discord bot system (Discord.js v14) with **three separate bots**—**Economy Bot**, **Backup Bot**, and **Verification Bot**—plus an **Express web dashboard** backed by **MongoDB (Mongoose)**. The dashboard must be **responsive** (mobile-friendly) and stable.

Use this repo file as the detailed blueprint/reference: `omplete_bot_flow_with_webhooks.txt`.

---

## Non‑Negotiables (Quality + “No Bugs” mindset)

1. **No placeholders**: implement real, working logic for every required feature. If something is **impossible due to Discord/API limits**, clearly explain it in `README.md` and implement the closest safe alternative.
2. **Atomic economy operations**: protect against race conditions/exploits using MongoDB atomic updates (`$inc`, conditional updates) and/or transactions where needed (bets, deposits, purchases).
3. **Validation everywhere**: validate slash command inputs, API inputs, and dashboard forms; return user-friendly errors.
4. **Rate limiting + cooldown safety**: prevent spam/abuse (commands and API).
5. **Structured logging**: consistent logs to console + optional Discord webhooks (verification/backup/economy webhooks).
6. **Permissions enforced**: every admin action must require proper Discord permissions + dashboard admin authentication.
7. **Crash‑safe jobs**: cron jobs must survive restarts (store schedules in DB and reschedule on boot).
8. **Security basics**: Helmet, session security, CSRF for dashboard POSTs (or same-site protections), input sanitization, no secrets committed.

---

## Tech Stack (Required)

- Node.js (LTS recommended)
- Discord.js v14 (slash commands + components)
- Express (web dashboard + API)
- MongoDB + Mongoose
- Frontend: **EJS** templates + **Bootstrap 5** (preferred for fast responsive UI).  
  - If you use React, keep it minimal and integrate cleanly (no half-finished hybrid).
- `node-cron` for scheduled tasks
- OAuth2 login via Discord for **verification pages** (Passport Discord or equivalent)
- Dashboard admin auth via **email/password** (owner can add more admin accounts)

---

## Project Deliverables

1. A runnable Node app that starts:
   - the **3 Discord bot clients** (Economy/Backup/Verification; separate tokens)
   - the Express web server (dashboard + API)
2. A clean project structure (modular, readable).
3. `README.md` with:
   - setup steps
   - required permissions/intents
   - known Discord limitations (message restore, webhook tokens, etc.)
4. `.env.example` with all environment variables (no real tokens).
5. Scripts:
   - register slash commands
   - optional seed script for items/shop (so economy works immediately)

---

## High-Level Architecture (Must Follow)

- **Three bots**, shared database + shared config:
  - separate tokens + slash-command registration per bot
  - shared MongoDB models/services (economy, backup, verification)
- Separate concerns:
  - `src/bots/economy/` for Economy bot commands/events/components
  - `src/bots/backup/` for Backup bot commands/events
  - `src/bots/verification/` for Verification bot commands/events (join gate + logs)
  - `src/web/` for Express routes, views, auth
  - `src/db/` for Mongoose models
  - `src/services/` for reusable business logic (economy, gambling, backup, verification)
  - `src/jobs/` for cron tasks (bank interest, backups, cleanup)
- Add a **GuildConfig** model so settings are per-server (IDs for log channels, roles, toggles, webhook URLs, etc.).

---

## ECONOMY MODULE (Required Features)

### Core
- Daily coins with **24h cooldown** stored in MongoDB
- Bank system:
  - deposit/withdraw
  - max bank capacity (configurable)
  - **interest job every 12 hours** (cron)
- Shop system:
  - items stored in MongoDB
  - buy/sell
  - stock support (unlimited or limited)
- Inventory:
  - stored on user document as an array (itemId, quantity, refinement 0–10)

### Gambling (Required Games)
- Blackjack
- Coin Flip
- Slots
- Dice Roll
- Crash Game  
All gambling must:
- validate bet amounts
- atomically update balances
- log transactions
- optionally factor **LUCK** into RNG in a transparent, non-exploitable way

### RPG Features
- Mob hunting (random encounters)
- Item loots (weighted drops)
- Rarity system (Common → Mythic; keep naming consistent)

### Progression & Stats
- Leveling EXP formula: `requiredExp = level^2 * 100`
- Stats: STR, AGI, VIT, LUCK, CRIT
- Each level gives **+3 stat points** to allocate

### Combat / Social
- PVP combat (turn-based, uses stats, has timeouts/AFK handling)
- Marriage system:
  - requires “ring” item
  - both accept via buttons
  - store `marriedTo` + `marriedSince`
- Social profile:
  - customizable bio/title
  - profile wallpaper (buy from shop and equip)

### Item Refinement
- Refinement +1 to +10 with these success rates:
  - +1 100%
  - +2 90%
  - +3 80%
  - +4 70%
  - +5 50%
  - +6 40%
  - +7 30%
  - +8 20%
  - +9 10%
  - +10 5%
- Clearly define what happens on failure (consume material, keep level, etc.) and implement it consistently.

### Gacha
- Gacha boxes with pity system:
  - guaranteed **Legendary at 50 pulls**
  - store pity counters in MongoDB per user per box

---

## SERVER BACKUP MODULE (Required Features)

### What to Backup
- Channels (including types, topics, nsfw, slowmode, permission overwrites)
- Roles (permissions, color, hoist, mentionable, position)
- Threads (active + archived where possible)
- Forum posts (title/content/tags where possible)
- Webhooks (name + URL/token only if Discord API provides; document limitations)
- Last **1000 messages per channel** (store content + attachments + embeds where possible)
- Ban list (user + reason)
- Nicknames (per member)
- Server templates export/import as JSON

### Scheduler
- Auto backup schedules with `node-cron`:
  - hourly/daily/weekly presets
  - custom cron intervals per guild
- 24/7 scheduler: on startup, load schedules from DB and schedule them again.
- Webhook announcer for backup status (started/progress/success/fail).

### Restore
- One-click restore from dashboard
- Slash command restore with **danger confirmation**
- Support selective restore (at least channels/roles) if feasible
- Document Discord limitations:
  - cannot truly “restore” messages as original authors; best effort repost as bot/webhook
  - rate limits and permission requirements

---

## VERIFICATION MODULE (Required Features)

### Verification Flow
- Join gate:
  - assign temp role on join
  - remove temp role + assign verified role on success
- Verification page (dashboard):
  - OAuth2 verification with Discord (ID, username, email if scope allows)
  - security questions form (**2 required, 1 optional**)
  - browser geolocation API capture (with explicit user consent)
  - automatic IP capture on page visit (store in DB)

### Logging & Moderation Tools
- Message logs:
  - deletes, edits
  - joins, leaves
  - bans
- Configurable log channel (per guild)
- IP logs viewer in dashboard
- Duplicate/multiple account detection:
  - same IP → flag users
  - show flagged users in dashboard

### Privacy/Safety Requirements (Must)
- Show a clear notice on the verification page that IP + optional location are collected.
- Restrict IP log viewing to dashboard admins only.

---

## Slash Commands (Must Implement)

Implement all slash commands described in `omplete_bot_flow_with_webhooks.txt` and enforce permissions:
- Economy commands: user-level (no admin needed) except any admin-only economy config.
- Backup commands: admin-only (Manage Guild / Administrator recommended).
- Verification config commands: admin-only.

Use consistent command naming, subcommands, and reply style (embeds + ephemeral where appropriate).

---

## Web Dashboard (Express + EJS, Responsive)

### Pages (Minimum)
- Admin login (email/password) + owner setup
- Server approvals (approve/reject guilds before bots work)
- Admin accounts (owner can add/remove/disable accounts)
- Dashboard home (stats + module status)
- Economy admin (shop/item management, economy settings)
- Backup admin (list backups, view details, download, restore, schedules)
- Verification admin (settings, roles, log channel, IP logs, flagged users)

### UI Requirements
- Responsive layout (Bootstrap grid)
- Clean navigation, mobile friendly
- Toggle switches for settings
- Confirmation modals for destructive actions (restore/delete)

---

## Environment Variables

Create `.env.example` including:
- bot tokens:
  - `ECONOMY_DISCORD_TOKEN`
  - `BACKUP_DISCORD_TOKEN`
  - `VERIFICATION_DISCORD_TOKEN`
- bot application IDs (for command registration scripts):
  - `ECONOMY_CLIENT_ID`
  - `BACKUP_CLIENT_ID`
  - `VERIFICATION_CLIENT_ID`
- `CLIENT_ID`, `CLIENT_SECRET`, `CALLBACK_URL`
- `MONGODB_URI`
- `SESSION_SECRET`
- `PORT`, `NODE_ENV`
- Optional webhook URLs:
  - `VERIFICATION_WEBHOOK_URL`
  - `BACKUP_WEBHOOK_URL`
  - `ECONOMY_WEBHOOK_URL`

---

## Done Definition (Acceptance Checklist)

- `npm install` then `npm run dev` starts bot + web server without crashing
- Slash commands register successfully and run without unhandled rejections
- Daily cooldown works across restarts
- Bank interest job runs every 12h and is idempotent per run
- Shop buy/sell updates inventory and balance atomically
- Backup creation produces a usable backup artifact and shows in dashboard list
- Verification flow assigns roles correctly and logs IP + flags duplicates
- Dashboard pages are readable and usable on mobile widths
