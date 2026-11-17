# Commons — Product & Design Direction

## Product
A community workspace that brings group chat, a public social timeline, channel discovery, and member discovery into one coherent place. The frontend preview runs locally in the browser; account identity, feeds, voice/video, and cross-device sync are not backed by a server.

## Visual direction
Editorial community software: warm ink surfaces, pale mineral text, restrained leaf-green accents, serif display typography paired with a neutral sans-serif interface face. The interface should feel active and personal without relying on glass panels, oversized gradients, nested cards, or decorative dashboard metrics.

## Information architecture
- **Chat:** persistent server/channel navigation, direct messages, message actions, and a contextual member panel.
- **Social:** a Threads/X-inspired timeline with For You, Following, Latest, and Saved views; compose, reply, like, repost, bookmark, share, creator discovery, and topic discovery.
- **Discover / Activity / Settings:** supporting areas, with the same typography, spacing, and interaction language.

## Color direction
X-inspired neutral palette; Commons keeps its own layout, components, naming, and brand mark.
- Dark / Lights Out: background #000000, raised surface #16181C, hover surface #202327, border #2F3336, text #E7E9EA, muted #AAB0B6.
- Light / Default: background #FFFFFF, surface #F7F9F9, hover surface #EFF3F4, border #CFD9DE, text #0F1419, muted #536471.
- Shared accent: X blue #1D9BF0 with a subtle blue-tinted selection surface. Keep success green #00BA7C and danger red #F4212E only for semantic status.
- Radius: 9–15px for controls and interactive surfaces; asymmetric 5px corner only as a quiet signature.
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
