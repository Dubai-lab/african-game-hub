# Design V2.0: glass

Since 16 October 2026 the player site is drawn as frosted glass on a night ground. Every new
screen and every change follows these rules. The tokens live in `src/index.css`; nothing else
defines colours.

## The ground

The page is night indigo (`surface`, #0b1036), lit from its corners by the palette's own
colours (indigo, hibiscus, palm, maize). It is one fixed layer behind the page (`body::after`);
pages do not paint their own background.

## Colours: one job per name

| Use | Names |
| --- | --- |
| Text | `text-fg` (main), `text-muted` (secondary), `text-accent` (headings, numbers, links), `text-alert` (errors, losses), `text-good` (wins, gains), `text-brand-ink` (on Maize), `text-white` (on Hibiscus or Palm) |
| Fills | `bg-surface` (the ground), `bg-panel` (a glass card), `bg-ink` (deepest), `bg-primary` (indigo), `bg-brand` (Maize: the main action and the player's own clock only), `bg-hibiscus`, `bg-palm` |
| Borders | `border-line` (a glass edge), `border-edge` (something that can be picked) |

Never use a fill name for text or a text name for a fill. The old light names (`text-ink`,
`text-primary`, `text-surface`, `border-ink`) are gone; do not bring them back.

## Shapes

- Nothing is a square box. Cards and anything with a border all round get soft corners on their
  own (`--radius-card`, 1.25rem); small marks (Live now, Won, Lost) get small ones. Name a corner
  only when it must differ, for example `rounded-full` for an avatar.
- Borders are 1px (`border`), never `border-2` or thicker.
- A section that runs the full width of the screen says `rounded-none`.

## Glass

- A card on the page: `border border-line bg-panel` (see-through, with a sheen; no blur).
- Something that floats over the page (a bar, a sheet, a dialog, a toast): add `glass`, which
  blurs what is behind. Only these get the blur: it costs a budget phone real work. In data-saver
  mode, and for players who ask for less see-through, `glass` turns solid by itself.
- A full-screen layer (`fixed inset-0`) must never sit inside a `glass` element: the blur holds
  it inside that element. Render it through a portal to `document.body` (see `NotificationBell`).

## Buttons

- `Button` / `buttonClass('primary')`: Maize with a glow under it (`glow-brand`). One per screen,
  for the main thing to do.
- `buttonClass('ghost')`: a pane of glass. Everything else.
- A choice among several (time control, level, stake): glass when not chosen, Maize when chosen.

## Tabs and icons

The tabs carry the hub's own line icons (`src/core/ui/icons.tsx`): 24px, 1.8 stroke, round
ends, in the colour of the text. The chosen tab is Maize with a soft glow. New icons are drawn
the same way; no icon set is copied in.

## Checking a change

`npx playwright test e2e/accessibility.spec.ts` checks contrast and labels on every page.
Light text on the night ground must keep passing it.
