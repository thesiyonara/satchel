# Satchel — visual direction

## Intent

A compact desktop instrument for moving work between two machines. The interface should feel deliberately assembled: clear hierarchy, physical spacing, legible text, and very little decoration. Dark is the default, not a theme added at the end.

## Design contract

- **Surfaces:** almost-black canvas `#0e1116`; graphite panels `#15191f`; raised controls `#1b2027`. Use thin cool-gray boundaries, not gradients or glow.
- **Signal:** orange `#ff7952` marks primary actions and the active navigation marker. Keep orange out of large content areas. Connected status uses a separate subdued green.
- **Typography:** local system sans-serif for work; Cascadia/Consolas-style monospace for concise metadata. Headings use tight tracking and medium weight. No decorative serif display text or giant promotional headlines.
- **Geometry:** 6–8 px corners, 1 px borders, consistent icon strokes. Modals can have more space; routine controls stay compact. Shadows belong to floating windows and menus.
- **Content:** files are the focus. Image cards show the actual asset; notes show readable text. Note categories get small, muted color cues rather than brightly colored card backgrounds.
- **Copy:** name the action and show the state. “Add files”, “Connect a computer”, “Other computer offline”. Avoid brand slogans in operational flows.
- **Motion:** restrained hover/focus feedback, no ornamental animation. Honor reduced-motion preferences.
- **Honesty:** never display an invented connected device, sync percentage, or sample item in the real collection. Demo content is confined to test profiles.
- **Vocabulary:** one word per thing, everywhere. The synced folder is the *collection*; machines are *this computer* and *paired computers*; the floating window is *Quick drop* (or *minimal capture*); the canvas is the *pinboard*. No "space", "workspace" or product slogans in operational screens; every heading, subtitle and empty state states a fact or an action.
- **Controls:** anything that looks interactive performs an action. Badges, cards and status rows are buttons that open the relevant screen or they are plain text.

## Reusable design prompt

> Design a Windows/macOS desktop collection app called sync/it. It keeps files, screenshots, and notes on two computers connected over LAN. Make it dark by default, with almost-black canvas, graphite panels, quiet gray borders, and a single restrained orange action color. Use precise system sans-serif typography, narrow monospace metadata, medium-weight headings, and compact 6–8 px geometry. Build a practical left navigation, a calm collection header, an efficient search/view toolbar, content-led file and note cards, a dotted shared pinboard, and a small floating drop panel. Make actual content and connection state the visual anchors. Use strong spacing and alignment rather than gradients, glow, glass effects, decorative blobs, oversized promotional copy, or fake dashboards. Every visible control must perform a real action. Match the density of a well-crafted desktop utility, preserve keyboard focus and contrast, and verify the design using real screenshots at normal window sizes.

## Review checks

Review empty, populated, offline, sync-error, note-conflict, modal, and Quick drop states. Check the design at 860 px minimum dashboard width and 300 px panel width, with system scaling enabled. Keep note bodies readable and prevent action menus from being clipped.
