# DESIGN.md - Prompter

## Visual thesis

Cool ink **product tool** (not a marketing page): a dense dual-pane workshop that feels like Linear meets a monospace editor. One signature: **electric mint accent** on near-black cool neutrals.

## Color (restrained)

| Token | Hex | Role |
|-------|-----|------|
| bg | `#0b0d10` | App ground |
| rail | `#0f1217` | Sidebar |
| surface | `#14181f` | Panels / editors |
| ink | `#e8ecf2` | Primary text |
| muted | `#8b939f` | Secondary |
| accent | `#34f5c5` | Primary action / selection only |

No warm amber/cream "AI workshop" palette. No purple gradients.

## Typography

- **UI:** system-ui stack (no Google Fonts / no network fonts)
- **Editors:** ui-monospace (SF Mono / Menlo / Consolas)

## Layout

- Left rail navigation (Workshop / Library / Patterns)
- Cardless: borders + surface shifts, not shadow stacks
- Dual editor with 1px split (before → after)

## Motion

- 150-250ms ease on tabs/toasts
- `prefers-reduced-motion` respected

## Anti-patterns rejected

- Grain / feTurbulence textures
- Border + heavy drop-shadow chrome
- Amber/gold gradient CTAs
- Pill-tab marketing header
- Decorative colored dots on every chip
