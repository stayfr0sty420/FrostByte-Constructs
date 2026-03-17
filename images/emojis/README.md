Place your economy emoji image files here to enable auto-seeding.

Recommended filenames (root of this folder):
- `RodstarkianCredit.(png/gif/webp/jpg)`
- `RodstarkG.(png/gif/webp/jpg)` (optional, brand icon for footers)
- `Heads.(png/gif/webp/jpg)`
- `Tails.(png/gif/webp/jpg)`
- `CoinSpin.(gif/png/...)` (optional, animated)
- Optional dedicated subfolder for coinflip media:
  - `images/emojis/coinflip/CoinSpin.(gif/png/...)`
  - `images/emojis/coinflip/Heads.(png/webp/...)`
  - `images/emojis/coinflip/Tails.(png/webp/...)`
- Dice faces (optional, for `/dice`):
  - Preferred: `One..Six.(png/gif/webp/jpg)`
  - Back-compat: `RodDice1..RodDice6` and `Dice1..Dice6` are also accepted.
  - If dice assets are missing, the bot can auto-generate themed dice face PNGs (still requires Manage Guild Expressions permission).
- Slot symbols (optional, for `/slots`):
  - `SlotCoin.(png/webp/...)`
    - Aliases accepted: `Gold.(png/...)`, `Coin.(png/...)`, `Coins.(png/...)`
  - `SlotCherry.(png/webp/...)`
    - Alias accepted: `Cherry.(png/...)`
  - `SlotBell.(png/webp/...)`
    - Alias accepted: `Bell.(png/...)`
  - `SlotBar.(png/webp/...)`
    - Aliases accepted: `Bar.(png/...)`, `BAR.(png/...)`
  - `Slot777.(png/webp/...)`
    - Aliases accepted: `777.(png/...)`, `Seven.(png/...)`
  - `SlotDiamond.(png/webp/...)`
    - Alias accepted: `Diamond.(png/...)`
  - If slot assets are missing, the bot can auto-generate themed slot symbol PNGs (still requires Manage Guild Expressions permission).
- Blackjack action buttons (optional, for `/blackjack`):
  - `Hit.(png/webp/...)`
  - `Stand.(png/webp/...)`
  - `Double.(png/webp/...)`
  - If action assets are missing, the bot can auto-generate themed button-style PNGs (still requires Manage Guild Expressions permission).

Notes:
- The bot will also scan subfolders and try to auto-match filenames (e.g. `Rodstarkian_Credit_Opti.webp`, `Heads_Opti.png`, etc.).
- Discord custom emoji files must be within Discord's size limits (commonly 256 KB).

Emoji seeding is enabled by default, but you can disable it by setting `ECONOMY_SEED_EMOJIS=false`.
