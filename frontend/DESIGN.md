# Commons: Product & Design Direction

## Product
A community workspace that brings group chat, a public social timeline, channel discovery, and member discovery into one coherent place. The frontend preview runs locally in the browser; account identity, feeds, voice/video, and cross-device sync are not backed by a server.

## Visual direction
Editorial community software: warm ink surfaces, pale mineral text, restrained leaf-green accents, serif display typography paired with a neutral sans-serif interface face. The interface should feel active and personal without relying on glass panels, oversized gradients, nested cards, or decorative dashboard metrics.

## Information architecture
- **Chat:** persistent server/channel navigation, direct messages, message actions, and a contextual member panel.
- **Social:** a Threads/X-inspired timeline with For You, Following, Latest, and Saved views; compose, reply, like, repost, bookmark, share, creator discovery, and topic discovery.
- **Discover / Activity / Settings:** supporting areas, with the same typography, spacing, and interaction language.

## Color direction
Unified Codex International Slate-Navy tonal palette (synchronized between landing portal and community application):
- Dark: background `#111522`, deep rail `#0B0E18`, raised surface `#1E263B`, hover surface `#26314A`, border `#303D59`, strong border `#536684`, primary text `#DCE3EF`, muted `#98A9C4`, high-contrast CTA `#DCE3EF` (text `#111522`), signal accent `#6BC2FF` / `#3898EC`.
- Light: background `#EEF2F8`, alt surface `#DCE3EF`, raised surface `#FFFFFF`, border `#C2CEE0`, strong border `#536684`, primary text `#111522`, muted `#303D59`, high-contrast CTA `#111522` (text `#FFFFFF`), signal accent `#1659A8`.
- Semantic status only: success green `#00BA7C` (dark) / `#008A5C` (light) and danger red `#F4212E` (dark) / `#D91B27` (light).
- Radius: `14px 14px 14px 3px` signature asymmetric corner for primary cards and CTAs; `6px`–`10px` for standard controls.
- Spacing: 4px base rhythm, with 8 / 12 / 16 / 24 / 32px steps.
- Typography: system sans for interface and body copy; Georgia for editorial display headlines.
- Motion: short state transitions; respect reduced-motion preferences.

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
