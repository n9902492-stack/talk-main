---
name: Talk Pre-Join Experience
colors:
  surface: '#f9f9fb'
  surface-dim: '#d9dadc'
  surface-bright: '#f9f9fb'
  surface-container-lowest: '#ffffff'
  surface-container-low: '#f3f3f5'
  surface-container: '#eeeef0'
  surface-container-high: '#e8e8ea'
  surface-container-highest: '#e2e2e4'
  on-surface: '#1a1c1d'
  on-surface-variant: '#4f4535'
  inverse-surface: '#2f3132'
  inverse-on-surface: '#f0f0f2'
  outline: '#817563'
  outline-variant: '#d3c4af'
  surface-tint: '#7b5800'
  primary: '#785600'
  on-primary: '#ffffff'
  primary-container: '#986d00'
  on-primary-container: '#fffbff'
  inverse-primary: '#f7bd48'
  secondary: '#5f5e5e'
  on-secondary: '#ffffff'
  secondary-container: '#e2dfde'
  on-secondary-container: '#636262'
  tertiary: '#555c6a'
  on-tertiary: '#ffffff'
  tertiary-container: '#6e7583'
  on-tertiary-container: '#fefcff'
  error: '#ba1a1a'
  on-error: '#ffffff'
  error-container: '#ffdad6'
  on-error-container: '#93000a'
  primary-fixed: '#ffdea6'
  primary-fixed-dim: '#f7bd48'
  on-primary-fixed: '#271900'
  on-primary-fixed-variant: '#5d4200'
  secondary-fixed: '#e5e2e1'
  secondary-fixed-dim: '#c8c6c5'
  on-secondary-fixed: '#1c1b1b'
  on-secondary-fixed-variant: '#474746'
  tertiary-fixed: '#dce2f3'
  tertiary-fixed-dim: '#c0c7d6'
  on-tertiary-fixed: '#151c27'
  on-tertiary-fixed-variant: '#404754'
  background: '#f9f9fb'
  on-background: '#1a1c1d'
  surface-variant: '#e2e2e4'
typography:
  headline-xl:
    fontFamily: Inter
    fontSize: 32px
    fontWeight: '600'
    lineHeight: 40px
    letterSpacing: -0.025em
  headline-xl-mobile:
    fontFamily: Inter
    fontSize: 26px
    fontWeight: '600'
    lineHeight: 34px
    letterSpacing: -0.02em
  headline-lg:
    fontFamily: Inter
    fontSize: 24px
    fontWeight: '600'
    lineHeight: 32px
    letterSpacing: -0.02em
  headline-md:
    fontFamily: Inter
    fontSize: 20px
    fontWeight: '500'
    lineHeight: 28px
    letterSpacing: -0.015em
  body-lg:
    fontFamily: Inter
    fontSize: 16px
    fontWeight: '400'
    lineHeight: 24px
    letterSpacing: -0.011em
  body-md:
    fontFamily: Inter
    fontSize: 14px
    fontWeight: '400'
    lineHeight: 20px
    letterSpacing: -0.006em
  body-sm:
    fontFamily: Inter
    fontSize: 13px
    fontWeight: '400'
    lineHeight: 18px
    letterSpacing: 0em
  label-lg:
    fontFamily: Inter
    fontSize: 14px
    fontWeight: '500'
    lineHeight: 20px
    letterSpacing: -0.006em
  label-md:
    fontFamily: Inter
    fontSize: 12px
    fontWeight: '500'
    lineHeight: 16px
    letterSpacing: 0.01em
  label-sm:
    fontFamily: Inter
    fontSize: 11px
    fontWeight: '600'
    lineHeight: 14px
    letterSpacing: 0.04em
rounded:
  sm: 0.25rem
  DEFAULT: 0.5rem
  md: 0.75rem
  lg: 1rem
  xl: 1.5rem
  full: 9999px
spacing:
  gutter: 1.5rem
  gutter-mobile: 1rem
  margin: 2rem
  margin-mobile: 1rem
  space-xs: 0.25rem
  space-sm: 0.5rem
  space-md: 0.75rem
  space-lg: 1.25rem
  space-xl: 2rem
---

## Brand & Style

The design system projects focused composure, modern executive utility, and quiet tactile luxury. Designed specifically for video collaboration pre-flight staging, the interface eliminates pre-meeting anxiety by offering clarity, deliberate visual balance, and instantaneous confirmation of hardware and environment states.

Drawing inspiration from Linear's geometric rigor and Calendly's legibility, the design movement balances **Minimalism** with subtle **Tactile Precision**:
- High-clarity information hierarchies where secondary technical settings never crowd the primary intent.
- Warm, grounded neutrals that prevent clinical eye strain while remaining undeniably professional.
- Deliberate restraint in accents: deep mustard and ochre provide high-contrast attention anchors without the aggressive alarmism of standard reds and yellows.
- Quiet micro-states that validate user action through precise border shifts, smooth mechanical toggles, and live, low-latency audio telemetry.

## Colors

The palette relies on warm, architectural neutrals paired with an authoritative deep mustard accent. 

### Canvas & Surfaces
- **Canvas Base**: `#F5F5F7` provides a soft, low-glare surface that feels organic and paper-like.
- **Card Surface**: `#FFFFFF` creates distinct containment layers over the canvas.
- **Sub-surface / Inset**: `#FAFAFA` acts as the recessed background for device controls, waveform containers, and inactive preview backdrops.
- **Preview Viewport**: Deep cinematic black `#0A0A0B` preserves true camera contrast and edge acuity during preview checks.

### Typography & Icons
- **Primary Ink**: `#171717` — crisp, near-black for primary headlines, active device labels, and user initials.
- **Secondary Ink**: `#6B7280` — neutral slate gray for system telemetry, inactive states, hints, and secondary tabs.
- **Tertiary Ink / Muted**: `#9CA3AF` — placeholders, divider stamps, and disabled icon states.

### Accents & Semantic Color
- **Primary Accent (Deep Mustard)**: `#B8860B` (resting) and `#C99717` (hover/interactive fill). Used for the primary "Join Meeting" CTA, active toggle states, focused device dropdowns, and key interactive highlights.
- **Accent On-State Contrast**: Pure white `#FFFFFF` or dark ink `#171717` depending on contrast ratios (e.g., `#FFFFFF` on `#B8860B`).
- **Telemetry Active (Audio Waveform)**: `#B8860B` transitions dynamically to `#10B981` (calm emerald) on peak input, offering immediate visual assurance of microphone pickup.
- **Muted / Off-State (Destructive/Disabled)**: `#EF4444` reserved strictly for unmuted hardware warnings or explicit "Leave/Cancel" triggers; `#E5E7EB` handles default neutral off-states.
- **Structural Borders**: `#E5E7EB` defines subtle card boundaries, dropdown menus, and toggle tracks.

## Typography

Typography relies entirely on **Inter** to ensure maximum digital clarity, tight horizontal metric cohesion, and exceptional readability under dense parameter displays.

- **Headlines (`headline-xl`, `headline-lg`, `headline-md`)**: Feature subtle negative tracking to convey density and editorial precision. Reserved for meeting titles, host greetings, and primary modal headers.
- **Body (`body-lg`, `body-md`, `body-sm`)**: Set with balanced line heights to make device troubleshooting instructions, participant listings, and connectivity diagnostics effortless to scan.
- **Labels & Overlays (`label-lg`, `label-md`, `label-sm`)**: Used for quick-scan UI elements, tab bars, floating preview chips, audio status bars, and hardware dropdown triggers. Small labels utilize slight positive letter-spacing (`0.01em` to `0.04em`) to maintain legibility when rendered in all-caps or inside pill counters.

## Layout & Spacing

The stage layout operates on an asymmetric 2-column workspace model designed to balance the visual feed with interactive device readiness.

### Grid & Composition
- **Desktop (>= 1024px)**: Dual-pane stage. Left pane accommodates the 16:9 video preview card (spanning ~60% of available viewport width), floating floating media controls, and effect tabs. Right pane (~40% width, max 440px) contains meeting context, audio test meters, device pickers, and the primary join actions.
- **Tablet (768px - 1023px)**: Single column with stacked modules. The video viewport anchors the top of the interface with compact floating controls; setup controls, participant list, and CTA stack cleanly underneath with a consistent `gutter` of `1.5rem`.
- **Mobile (< 768px)**: Unified vertical stack. Video preview adapts to a 4:3 or responsive 16:9 height-constrained card. Device selectors condense into segmented rows, and the primary "Join" bar anchors persistently to the viewport bottom.

### Rhythm & Alignment
Spacing adheres to a strict 4px sub-grid with primary jumps defined by:
- Micro margins (`space-xs`: 4px, `space-sm`: 8px) for icon-to-label grouping and live status dot margins.
- Component-interior spacing (`space-md`: 12px, `space-lg`: 20px) for inner card padding, dropdown trigger surfaces, and pill buttons.
- Structural separation (`space-xl`: 32px, `margin`: 32px) separating diagnostic panels from primary call-to-action blocks.

## Elevation & Depth

Visual hierarchy is constructed via architectural surface layering, razor-thin perimeter boundaries, and whisper-quiet diffused drop shadows.

### Elevation Tiers
1. **Canvas Tier (Ground Level - `0dp`)**: The `#F5F5F7` backdrop remains non-reflective and motionless.
2. **Surface Tier 1 (Card Level - `1dp`)**: Main configuration cards and video feed containers sit on pure `#FFFFFF` with a 1px border (`#E5E7EB`) and an ultra-subtle ambient shadow: `box-shadow: 0 1px 3px 0 rgba(0, 0, 0, 0.03), 0 1px 2px -1px rgba(0, 0, 0, 0.03)`.
3. **Floating Overlays Tier (`2dp`)**: Camera/Mic floating control pills, floating status badges, and hover tooltips hover directly above the live video stream. Structured with `rgba(23, 23, 23, 0.75)` backdrop blur (`12px blur`) or crisp `#FFFFFF` with `box-shadow: 0 4px 6px -1px rgba(0, 0, 0, 0.05), 0 2px 4px -2px rgba(0, 0, 0, 0.04)` and a 1px perimeter ring of `rgba(255, 255, 255, 0.15)`.
4. **Dropdown Popovers & Menus Tier (`3dp`)**: Hardware selection menus (Camera/Mic/Speaker selection lists) float cleanly above interface components with `box-shadow: 0 10px 15px -3px rgba(0, 0, 0, 0.06), 0 4px 6px -4px rgba(0, 0, 0, 0.03)` and a solid 1px `#E5E7EB` border.

## Shapes

The design uses a refined curvature profile (`roundedness: 2`) that introduces generous, inviting card radiuses balanced by structured interior elements.

- **Primary Outer Containers & Video Feed**: Use `rounded-2xl` (1.5rem / 24px) for the large camera preview viewport and main device settings card, softening large technical viewports.
- **Inner Modules, Inputs & Dropdowns**: Use `rounded-lg` (0.75rem / 12px) for structured, reliable clickable areas.
- **Pills, Badges & Toggles**: Use fully rounded pill geometry (`rounded-full` / 9999px) for control toggles (Camera On/Off, Mic On/Off), active status chips, effect filter selectors, and audio testing controls.

## Components

### Buttons & Join Triggers
- **Primary Action ("Join Meeting")**: High-contrast, full-width or substantial button styled with background `#B8860B`, text `#FFFFFF`, font `label-lg`, and radius `rounded-lg`. Hover brings subtle brightness shift to `#C99717`, transitioning over `150ms ease`.
- **Secondary Action ("Test Audio & Video", "Share Link")**: White background `#FFFFFF`, border 1px solid `#E5E7EB`, text `#171717`. Hover triggers `#FAFAFA` with border tint `#D1D5DB`.
- **Floating Video Action Pills**: Circular or capsule-shaped (`rounded-full`) controls overlaid centered at the bottom of the video preview. An active microphone button features a pure white fill `#FFFFFF` with `#171717` icon; an inactive (muted) button features a soft, prominent red tint `#FEE2E2` with `#DC2626` icon, communicating mute state without ambiguity.

### Device Dropdown Selectors
- Two-part container housing icon (mic, video, output speaker), current device label in `label-md` (`#171717`), secondary descriptor in `body-sm` (`#6B7280`), and a chevron indicator.
- Enclosed in a 1px `#E5E7EB` bordered box with `rounded-lg`, shifting to a 1px `#B8860B` ring on focus or menu open.

### Audio Waveform & Test Indicators
- **Live Waveform Visualizer**: A sequence of 12-16 dynamic rounded vertical bars (width: 3px, gap: 2px, radius: 2px). Idle state renders in `#E5E7EB`; voice input modulates height dynamically with bars illuminated in `#B8860B`.
- **"Test Speaker" Interactive Chip**: A subtle pill-shaped button (`rounded-full`) containing a play icon and label. When clicked, plays sample tone, pulses the waveform, and shifts label to "Playing tone..." in real-time.

### Video Effects Tabs
- Horizontal segmented rail with `rounded-full` encapsulation in `#F5F5F7` background.
- Tabs ("None", "Blur", "Virtual Background", "Lighting") render as pill elements. Active pill is elevated with `#FFFFFF`, subtle shadow, and `#171717` text. Inactive options display `#6B7280` with seamless hover states.

### Status Indicators & Participant Avatars
- **Participant Preview Rail**: Compact overlapping avatar bubbles (`rounded-full`, 28px diameter) with a `+X others waiting` chip in `label-sm` slate text, offering meeting context prior to entering.
- **Connection Health Badge**: Positioned top-left or top-right of the video frame. A capsule badge with a pulsating 6px green dot (`#10B981`) and `label-sm` ("HD Stable" or "Poor Signal").