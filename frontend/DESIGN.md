# Commons: Product & Design Direction

## Product
A community workspace that brings group chat, a public social timeline, channel discovery, and member discovery into one coherent place. The frontend preview runs locally in the browser; account identity, feeds, voice/video, and cross-device sync are not backed by a server.

## Visual direction
Editorial community software: deep obsidian charcoal surfaces, crisp light ink text, Codex purple accents, Oxanium and serif display typography paired with a clean sans-serif interface face. The interface feels active and personal without relying on glass panels, oversized gradients, nested cards, or decorative dashboard metrics.

## Information architecture
- **Chat:** persistent server/channel navigation, direct messages, message actions, and a contextual member panel.
- **Social:** a Threads/X-inspired timeline with For You, Following, Latest, and Saved views; compose, reply, like, repost, bookmark, share, creator discovery, and topic discovery.
- **Discover / Activity / Settings:** supporting areas, with the same typography, spacing, and interaction language.

## Color direction
Unified Codex International Obsidian Black & Codex Purple palette (synchronized between landing portal and community application):
- Dark: background `#121115`, deep rail `#0A0A0C`, raised surface `#1A191F`, hover surface `#24212B`, border `#2D2936`, strong border `#463E54`, primary text `#F5F4F7`, muted `#B4B0BC`, quiet `#9690A2`, solid CTA fill `#8A30A6` (hover `#9C38BC`, text `#FFFFFF`), foreground purple ink `#D994F2`.
- Light: background `#F7F6F9`, alt surface `#EFEBF3`, raised surface `#FFFFFF`, hover surface `#EAE5F0`, border `#D5CEE0`, strong border `#6E627D`, primary text `#121114`, muted `#4A4352`, quiet `#635B6E`, solid CTA fill `#73268F` (hover `#8A30A6`, text `#FFFFFF`), foreground purple ink `#73268F`.
- Semantic status only: success green `#00BA7C` (dark) / `#008A5C` (light) and danger red `#F4212E` (dark) / `#D91B27` (light).
- Radius: `14px 14px 14px 3px` signature asymmetric corner for primary cards and CTAs; `6px`–`10px` for standard controls.
- Spacing: 4px base rhythm, with 8 / 12 / 16 / 24 / 32px steps.
- Typography: Oxanium display headings, Plus Jakarta Sans / system sans for interface and body copy, Space Mono for technical labels and codes, Georgia for editorial timeline headlines.
- Motion: short state transitions and radial View Transition theme switch; respect reduced-motion preferences.

## Interaction rules
- Every visible control has a real local action or a clear disabled state.
- Social actions update the browser-local timeline and survive reloads.
- The same action has consistent visual feedback across surfaces.
- Focus indicators remain visible; icon-only controls have accessible labels/titles.
- Mobile navigation retains direct access to Chat, Social, Channels, and People.

## Responsive behavior
Use available workspace width, not device labels alone. Keep feed content readable, collapse secondary panels before shrinking the main conversation, and replace desktop navigation with a four-item mobile bar. Long text wraps without horizontal overflow.

## Content principles
Use concrete, believable community content. Avoid fake counters, exaggerated marketing claims, generic filler labels, and repeated decorative cards. The UI should prioritize actual conversations and creator content.
