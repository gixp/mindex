---
name: Mindex
description: A calm, local-first knowledge workspace rendered as a precise operational map.
colors:
  clay-orange: "hsl(16 72% 64%)"
  clay-orange-light: "hsl(15 63% 57%)"
  clay-selection: "hsl(16 72% 64% / 0.07)"
  graphite-canvas: "hsl(210 4% 10.2%)"
  graphite-card: "hsl(210 4% 12.95%)"
  graphite-selection: "hsl(240 2% 19.75%)"
  graphite-divider: "hsl(240 2% 15.5%)"
  graphite-divider-strong: "hsl(240 2% 22%)"
  warm-white: "hsl(0 0% 98%)"
  quiet-text: "hsl(240 5% 64.9%)"
  paper-canvas: "hsl(0 0% 94%)"
  paper-card: "hsl(0 0% 100%)"
  ink: "hsl(240 10% 3.9%)"
  status-fresh: "rgb(52 211 153)"
  status-attention: "rgb(251 191 36)"
  status-danger: "rgb(248 113 113)"
  utility-link: "rgb(96 165 250)"
typography:
  display:
    fontFamily: "Regola Pro, Inter, system-ui, -apple-system, sans-serif"
    fontSize: "30px"
    fontWeight: 700
    lineHeight: 1.12
    letterSpacing: "-0.035em"
  headline:
    fontFamily: "Regola Pro, Inter, system-ui, -apple-system, sans-serif"
    fontSize: "28px"
    fontWeight: 700
    lineHeight: 1.2
    letterSpacing: "-0.03em"
  title:
    fontFamily: "Regola Pro, Inter, system-ui, -apple-system, sans-serif"
    fontSize: "20px"
    fontWeight: 700
    lineHeight: 1.25
    letterSpacing: "-0.025em"
  section:
    fontFamily: "Regola Pro, Inter, system-ui, -apple-system, sans-serif"
    fontSize: "23px"
    fontWeight: 700
    lineHeight: 1.2
    letterSpacing: "-0.03em"
  metric:
    fontFamily: "Regola Pro, Inter, system-ui, -apple-system, sans-serif"
    fontSize: "24px"
    fontWeight: 700
    lineHeight: 1.2
    letterSpacing: "-0.03em"
  stat:
    fontFamily: "Regola Pro, Inter, system-ui, -apple-system, sans-serif"
    fontSize: "19px"
    fontWeight: 700
    lineHeight: 1.25
  rail-title:
    fontFamily: "Regola Pro, Inter, system-ui, -apple-system, sans-serif"
    fontSize: "17px"
    fontWeight: 700
    lineHeight: 1.25
  compact-stat:
    fontFamily: "Regola Pro, Inter, system-ui, -apple-system, sans-serif"
    fontSize: "16px"
    fontWeight: 700
    lineHeight: 1.25
  body:
    fontFamily: "BaselineColon, Inter, system-ui, -apple-system, sans-serif"
    fontSize: "13px"
    fontWeight: 400
    lineHeight: 1.5
  small-body:
    fontFamily: "BaselineColon, Inter, system-ui, -apple-system, sans-serif"
    fontSize: "12px"
    fontWeight: 400
    lineHeight: 1.5
  label:
    fontFamily: "BaselineColon, Inter, system-ui, -apple-system, sans-serif"
    fontSize: "11px"
    fontWeight: 500
    lineHeight: 1.35
    letterSpacing: "0.035em"
  caption:
    fontFamily: "BaselineColon, Inter, system-ui, -apple-system, sans-serif"
    fontSize: "10px"
    fontWeight: 400
    lineHeight: 1.4
  mono:
    fontFamily: "JetBrains Mono, Geist Mono, ui-monospace, monospace"
    fontSize: "9px"
    fontWeight: 400
    lineHeight: 1.4
  micro:
    fontFamily: "JetBrains Mono, Geist Mono, ui-monospace, monospace"
    fontSize: "8px"
    fontWeight: 400
    lineHeight: 1.4
rounded:
  xs: "5px"
  base: "6px"
  md: "8px"
  control: "10px"
  lg: "12px"
  panel: "14px"
  modal: "15px"
  xl: "16px"
  feature: "20px"
  pill: "9999px"
spacing:
  xs: "4px"
  sm: "8px"
  md: "12px"
  lg: "16px"
  xl: "24px"
  2xl: "32px"
  3xl: "40px"
components:
  dialog-shell:
    backgroundColor: "{colors.graphite-card}"
    textColor: "{colors.warm-white}"
    rounded: "{rounded.modal}"
    width: "min(1160px, 96vw)"
    height: "min(740px, 92vh)"
  button-primary:
    backgroundColor: "{colors.clay-orange}"
    textColor: "{colors.warm-white}"
    typography: "{typography.label}"
    rounded: "{rounded.md}"
    padding: "4px 10px"
  button-secondary:
    backgroundColor: "transparent"
    textColor: "{colors.warm-white}"
    typography: "{typography.label}"
    rounded: "{rounded.md}"
    padding: "4px 10px"
  input:
    backgroundColor: "transparent"
    textColor: "{colors.warm-white}"
    typography: "{typography.body}"
    rounded: "{rounded.base}"
    padding: "4px 10px"
    height: "32px"
  rail-item-active:
    backgroundColor: "{colors.graphite-card}"
    textColor: "{colors.warm-white}"
    typography: "{typography.label}"
    rounded: "{rounded.control}"
    padding: "10px 12px"
  tree-node:
    backgroundColor: "{colors.graphite-canvas}"
    textColor: "{colors.warm-white}"
    typography: "{typography.label}"
    rounded: "{rounded.control}"
    padding: "0 12px"
    width: "360px"
    height: "48px"
  tree-node-selected:
    backgroundColor: "{colors.clay-selection}"
    textColor: "{colors.warm-white}"
    typography: "{typography.label}"
    rounded: "{rounded.control}"
    padding: "0 12px"
    width: "360px"
    height: "48px"
  status-badge:
    backgroundColor: "{colors.graphite-selection}"
    textColor: "{colors.quiet-text}"
    typography: "{typography.mono}"
    rounded: "{rounded.pill}"
    padding: "2px 8px"
---

# Design System: Mindex

## Overview

**Creative North Star: "The Living Index"**

Mindex should feel like a calm, trustworthy instrument for operating a local knowledge vault. Its visual hierarchy is restrained and information-led: dark graphite planes, warm white type, thin dividers, modest corners, and a rare clay-orange signal. The interface should make the AI's working context inspectable without making the product feel like an analytics dashboard or novelty chat surface.

The system is dense enough for keyboard-first desktop work, but never cramped. Identity comes from precise typography, quiet tonal layering, and meaningful state cues rather than decoration. Light and system themes are supported, while dark is the default visual truth.

**Key Characteristics:**

- Operational, local, and legible rather than promotional.
- Flat graphite layers separated by tone and one-pixel boundaries.
- Regola Pro for hierarchy; compact sans and mono for work data.
- Clay orange reserved for selection, primary actions, and Context identity.
- Status is semantic, labeled, and never communicated by color alone.

## Colors

The palette is neutral-first. The semantic CSS roles (`background`, `card`, `accent`, `border`, `foreground`, and `muted-foreground`) must remain the implementation source of truth; the frontmatter records their default dark values and the corresponding light foundations.

### Primary

- **Clay Orange:** use for primary actions, active path connectors, selected outlines, progress, and the Context icon. Use its darker light-theme counterpart when contrast requires it.

### Secondary

- **Fresh Emerald:** in-sync, completed, and saved states.
- **Attention Amber:** stale, queued, and needs-update states.
- **Danger Red:** errors, destructive actions, and contradictions.
- **Utility Blue:** links, selection utilities, and system affordances outside the core Context identity.

### Neutral

- **Graphite Canvas:** the desktop ground and recessed work areas.
- **Graphite Card:** the primary panel, modal, inspector, and elevated content surface.
- **Graphite Selection:** neutral hover and selected navigation fill when clay would be too loud.
- **Graphite Dividers:** use the regular divider for structure and the stronger divider for hover, active paths, or denser nested boundaries.
- **Warm White / Quiet Text:** warm white carries headings and primary content; quiet text carries captions, metadata, and inactive controls.
- **Paper Canvas / Paper Card / Ink:** the equivalent light-theme foundation. Preserve semantic roles instead of copying dark literal values into light mode.

**The Sparse Accent Rule.** Clay orange marks action, selection, or identity; it is not a general surface color.

**The Labeled Status Rule.** Pair every semantic dot or tint with a short text label or accessible name.

## Typography

**Display Font:** Regola Pro, with Inter and system UI fallbacks  
**Body Font:** Inter, with system UI fallbacks  
**Label/Mono Font:** JetBrains Mono, then Geist Mono and the platform monospace

**Character:** Regola Pro gives headings a warm, editorial confidence without making the desktop feel ornamental. The body face stays neutral and compact; mono is limited to paths, token counts, ages, and tabular values.

### Hierarchy

- **Display:** large, rare section statements such as Root briefing introductions.
- **Headline:** folder and settings titles; keep them short and tightly tracked.
- **Title:** modal and pane titles.
- **Body:** explanatory copy and note content; reading views stay near 62 characters wide.
- **Label:** controls, metric names, and compact navigation.
- **Mono:** file paths, counts, timestamps, and machine-adjacent metadata. Use tabular numerals for changing metrics.

**The Two-Voice Rule.** Regola Pro establishes hierarchy; the sans/mono layer carries operations. Do not set long prose or dense navigation in the display face.

**The Microcopy Rule.** Text below 11px is metadata only, never the sole carrier of an instruction or critical state.

## Layout

Mindex is a desktop, resizable-pane application. Major panes use flexible widths with optional separators; content shells are centered and capped rather than stretched edge to edge. Reusable reading content caps near 760px, wider operational sections near 900px, and primary section padding is 32px. The spacing rhythm is built from 4px increments, with 8–16px inside controls, 24px between related groups, and 32–40px at major boundaries.

Dialogs center in the viewport and cap at 96vw by 92vh. Keep scrolling inside the relevant pane rather than letting a modal grow beyond the window. The Context shell is 1160 by 740px at full size, with a fixed 248px rail, a 76px header, and a flexible main pane.

**The Bounded Workspace Rule.** Preserve stable rails, inspectors, and headers; let the working canvas scroll. Do not solve dense desktop data by expanding the whole modal.

## Elevation & Depth

Mindex is flat by default. Depth comes primarily from adjacent graphite tones, thin dividers, and inset one-pixel outlines such as `inset 0 0 0 1px hsl(var(--border) / 0.8)`. Context nodes and cards may gain a low, dark ambient shadow on selection or hover (`0 7px 18px` or `0 10px 24px`) but should not float at rest. Modal backdrops use a 40% black veil; menus and onboarding are the few surfaces allowed stronger conventional shadows.

**The Tonal Depth Rule.** Use surface tone and boundary first, shadow second. Decorative gradients do not belong on work surfaces; gradient light is reserved for stateful effects such as the voice orb.

## Shapes

Corners are modest and nested by scale: 6–8px for fields and small controls, 10–12px for navigation and tree nodes, 14–16px for panels and dialogs, and 20px only for feature-level shells. Fully rounded shapes are reserved for progress tracks, switches, dots, and status pills. Hairline borders and inset outlines define most silhouettes; dashed borders indicate missing or not-yet-generated content.

**The Nested Radius Rule.** Inner controls must be visibly tighter than the panel that contains them.

## Components

### Buttons

- **Primary:** clay fill, warm white label and icon, compact 8px corner, and 4px by 10px padding for dense desktop actions.
- **Secondary:** transparent or lightly tinted, with a semantic one-pixel border. Context actions may use a 9% clay wash and 30–45% clay border.
- **Hover / Active:** state changes are subtle—brightness or a small tonal fill on hover, then a 0.98–0.99 scale on press. Standard transitions are 150–200ms; avoid springy motion.
- **Focus / Disabled:** every interactive control supplies its own visible focus treatment because the global outline is reset. Use a 2px clay ring at roughly 60% opacity in Context. Disabled controls retain their label, reduce opacity to 50%, and use the default cursor.
- **Icon-only:** provide an `aria-label` and keep the hit target at least 28–32px even when the icon is smaller.

### Cards / Containers

- **Style:** use translucent semantic surfaces and an inset one-pixel boundary. Cards are information containers, not decorative tiles.
- **Hover:** clickable cards may lift by one pixel and add a low ambient shadow; static containers remain flat.
- **Content order:** identity and purpose lead; freshness, size, and token cost remain quiet metadata.

### Inputs / Fields

- **Style:** 32px high by default, transparent against the owning surface, with a semantic input border, 6px corners, 14px text, and muted placeholder copy.
- **Focus:** shift the border or apply the surface's explicit focus-visible ring. Never rely on the removed browser outline.
- **Error / Disabled:** pair error color with message text; disabled fields use reduced opacity and retain a readable value.

### Navigation

- **Application chrome:** top-toolbar actions stay flat with square corners and change text/icon color on hover; they should read as window chrome, not a row of filled buttons.
- **Rails:** navigation items use 10–11px corners, compact icon wells, a primary label plus muted caption, and `aria-current="page"` for the active destination.
- **Selection:** selected rail items use a card-tone fill and inset boundary; clay is confined to the icon, progress, or a meaningful attention badge.

### Statuses

- **Fresh / In sync:** emerald dot or icon plus “In sync” or equivalent text.
- **Behind / Needs update:** amber dot or sync icon plus action-oriented copy.
- **Missing / No context:** muted dot, open-folder/slash icon, or dashed boundary plus explicit missing-state copy.
- **Danger / Conflict:** red icon and text, reserved for errors, destructive actions, or contradictory facts.

### Context Workspace

Context Overview is an operational map of what the AI knows, not a gallery of folder cards. The first viewport keeps the existing Context rail on the left, a compact five-column metric strip at the top, then a top-anchored, indented folder tree with a selected-folder inspector to its right. Root briefing remains a separate rail destination and is not folded into the tree inspector.

- **Tree canvas:** use an internal scroll region with a minimum 440px canvas. Nodes are 360 by 48px and nest through a 16px branch offset plus 24px connector gutter, so a real 95-folder vault stays traceable.
- **Ordering:** sort branches that need attention first (`behind`, then `missing`, then `fresh`), then alphabetically. The Workspace root is structural and non-interactive.
- **Selection:** a selected folder receives a restrained clay wash, clay outline, and continuous clay ancestor connectors. Ancestors may receive only a faint outline; never fill the full branch.
- **Inspector:** keep it fixed at 250px within the flow surface. Show folder identity and path, freshness explanation, purpose, note/context/freshness/child metrics, then Open and Generate/Regenerate actions anchored at the bottom.
- **Behavior:** selection updates the inspector in place. Opening a briefing is a separate explicit action. Long trees scroll; they do not collapse into a card grid or paginate by arbitrary batches.
- **Accessibility:** each node is a semantic button with an explicit selected state. Status color is redundant with text, icon-only actions are named, modal focus remains trapped, and Escape/Close behavior remains available.

**The Map-Before-Detail Rule.** Users scan coverage and inheritance, select one folder, inspect purpose/freshness/cost, and only then open or regenerate its context.

## Do's and Don'ts

### Do:

- **Do** use semantic theme roles so dark, light, and system modes stay coherent.
- **Do** keep the clay accent rare and attached to a clear action, selection, or Context identity.
- **Do** preserve quiet one-pixel boundaries, compact metadata, explicit empty/loading/error states, and internal scrolling.
- **Do** pair focus rings, ARIA state, labels, and readable status copy with every interactive or semantic cue.
- **Do** design Context against a real 95-folder vault, including long paths and nested branches.

### Don't:

- **Don't** turn operational hierarchy into a gallery of oversized folder cards.
- **Don't** communicate freshness, selection, or error through color alone.
- **Don't** use large radii, heavy shadows, gradients, or saturated fills as default work-surface decoration.
- **Don't** let tiny metadata become the only instruction, action label, or critical state message.
- **Don't** merge Root briefing into the folder inspector or imply unimplemented belief/privacy controls are established product behavior.
