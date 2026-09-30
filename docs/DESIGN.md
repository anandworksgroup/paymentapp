# Design language

The product owner supplied reference shots of a finance app and asked that **every surface** (merchant
web, admin console, hosted checkout, customer portal, mobile app) keep that UI, colour and font as its base.

## What the reference looks like

- **Canvas:** misty off-white with a faint sage-green wash (top-left) and a pale lemon wash (right).
- **Cards:** pure white, very rounded (~28px), soft long shadows, generous padding. Nested panels are a
  slightly grey off-white (`surface-2`) with ~20px radius. Some hero cards are frosted glass or a soft
  sage→mint gradient (the stacked payment-card visual).
- **Type:** Inter. Headings are regular weight, large and tight (`-0.03em`), never bold. Labels are small
  and grey. Money is shown as a **large light numeral with a small grey currency code** after it:
  `€8,499 EUR`, `$5,240 USD`.
- **Accents:**
  - Pastel lemon pill chips for highlights and deltas (`+1.6%`, `Custom ▾`).
  - Sage/mint for positive or success states and for the chart bars.
  - Peach for the highlighted or attention bar or state.
  - Charcoal (`#2D2E30`) for primary pill buttons and the active item in the bottom nav (`Wallet`).
- **Charts:**
  - "Weekly Rate": tall pill-shaped bars with vertical gradients (sage, lemon, peach) fading to
    transparent, a smooth charcoal line running across them, and a white value bubble (`€840`) on the
    highlighted bar.
  - Below the chart, a horizontal day scrubber sits in a sage pill track.
- **Lists:** transaction rows show a small grey label ("Travel Costs"), a large light amount + currency
  code, a mini **barcode sparkline** (thin grey bars, last bar charcoal), and circular country-flag
  avatars on a hairline.
- **Navigation (mobile):** floating white bottom bar with a charcoal pill for the active tab (icon + label)
  and plain icons for the others.

## Tokens

| Token | Value | Use |
|---|---|---|
| `bg` | `#EEF1EC` | page canvas (+ radial `#DCEBD4` / `#F6F2D6` washes) |
| `surface` / `surface-2` / `surface-3` | `#FFFFFF` / `#F6F7F4` / `#EEF0EC` | cards / inner panels / tracks |
| `line` | `#E6E9E4` | hairlines |
| `text` / `text-2` / `muted` / `faint` | `#1D1F1E` / `#4B504C` / `#8B918C` / `#B9BEB9` | copy hierarchy |
| `sage-100/300/500/700` | `#DFEFD8` / `#A9D59E` / `#7DBB78` / `#4E8F55` | success, bars, focus |
| `lemon` / `lemon-soft` / `lemon-ink` | `#F2E35A` / `#F8F1B8` / `#5F5410` | accent chips |
| `peach` / `peach-soft` / `peach-ink` | `#F6C79A` / `#FBE6D2` / `#8A4A1C` | highlight, warnings |
| `rose-soft` / `rose-ink` | `#FBE1DA` / `#8E2F1C` | failures, destructive |
| `ink` | `#2D2E30` | primary buttons, active nav, chart line |
| radius | card 28, inner 20, field 14, pill 999 | |
| shadow | `0 1px 2px rgba(20,30,20,.04), 0 12px 32px rgba(30,40,30,.06)` | cards |
| font | Inter 300/400/500/600 | everything |

The web implementation lives in `web/app/globals.css` and `web/components/ui.tsx`.
The Flutter implementation lives in `mobile/lib/theme/`.
Reuse those instead of introducing new colours.

## Tone of product copy

Plain, calm and specific. Compliance and risk states use neutral wording ("requires additional review"),
never accusations. Test mode is always visibly labelled.
