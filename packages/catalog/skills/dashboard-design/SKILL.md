---
name: dashboard-design
description: Enterprise Dashboard UI/UX Architecture & Menu Design Guidelines. Use for dashboard layouts, navigation, forms, themes, data grids, and background-task interfaces.
---

Enterprise Dashboard UI/UX Architecture & Menu Design Guidelines
Maintainer / Author: @kalahroudi License: Apache License 2.0 Status: Living Standard / Design Specification Reference Foundations:

nextlevelbuilder/ui-ux-pro-max-skill (Crisp ergonomics & interaction primitives)
leonxlnx/taste-skill (Modern typography, micro-interactions & restrained aesthetics)
---

1. Executive Summary & Core Philosophy
This standard specifies the UI/UX architecture for our high-velocity enterprise dashboard and modular worker app. The core architecture uses a Zero-Page-Refresh, Sheet-Driven Action Engine paired with a High-Density, Sticky Collapsible Nav.

+-----------------------------------------------------------------------------------------+
|                                  TOP APPLICATION BAR                                    |
| [Logo] [Org / Repo Context Switcher]             [Tasks: 2 Running] [Theme Toggle] [Profile] |
+-----------+-------------------------------------------------------------+---------------+
| STICKY    | MAIN PANE (Full-Width Responsive Container)                 | RIGHT OVERLAY |
| LEFT NAV  | Tabs: [ Overview ] [ Metrics ] [ Deployments ] [ Settings ] | SHEET (SLIDE) |
|           |                                                             |               |
| Fixed     | +---------------------------------------------------------+ | [X] Action    |
| Viewport  | | Filter Bar: [ Search 🔍 ] [ Status ⏷ ] [ Batch Acts ⏷ ] | |               |
| No Scroll | +---------------------------------------------------------+ | Form inputs   |
|           | | [ ] Item Name      | Status   | SHA     | Actions      | | Progressive   |
| Collapse  | | [ ] worker-daemon  | Active   | 3f8a9e 📋| [Edit] [Run] | | Disclosure    |
| to Quick- | | [ ] agent-proxy    | Inactive | b71c42 📋| [Edit] [Run] | |               |
| Drops     | +---------------------------------------------------------+ | [Save / Run]  |
|           | | Pagination: [<] Page 1 of 12 [>]  | Per Page: [25 ⏷]    | | (Non-blocking)|
+-----------+-------------------------------------------------------------+---------------+
Core Design Laws:
Never Block, Never Reload: Page refreshes and full-page redirects are forbidden. Actions execute via non-blocking asynchronous jobs. Forms open in slide-over overlays; results reflect instantly on the underlying data table via optimistic updates and reactive cache invalidation.
Deterministic Destructive Actions: Destructive operations (drops, terminations, purges) require explicit string matching typed by the user, assisted by zero-padding mini copy buttons.
Skeleton Loading Over Broken Layouts: No half-baked layouts or shifted content. Pages resolve server/cache state prior to display, masking latency with uniform skeleton frames.
Codebase Symmetry: The architecture is designed as a standalone Admin Dashboard Core. Forking this core with trimmed permission scopes yields the end-user customer dashboard directly without rewriting navigation, state engines, or telemetry pipes.
---

2. Layout Structure & Viewport Strategy
2.1. Viewport Split Specs
Zone	Width	Scrolling	Behavior
Sticky Left Menu	260px (Expanded)<br>64px (Collapsed)	overflow: hidden (Never scrollable)	Stays locked to screen height (100vh). Dismissible via shortcut (Cmd/Ctrl + B) or toggle chevron.
Main Content Pane	calc(100vw - NavWidth)	overflow-y: auto	Uses 100% available viewport width. Responsive grid system inside.
Right Action Sheet	480px (Standard)<br>720px (Complex Forms)	overflow-y: auto	Slides in over the main pane with backdrop blur; closes via Esc, click-away, or save.
2.2. Left Menu Collapse & Quick-Drop Mechanics
When expanded: Shows SVG icon, title, keyboard accelerators, and nested group accordions.
When collapsed (Dismissed to rail):
Nav width shrinks to 64px.
Items transform into Quick-Drop Target Nodes and icon-only tooltips.
Dragging objects (e.g., config files, agent payloads) from the main pane onto nav icons stages tasks directly (e.g., drop payload onto "Deployments" triggers an overlay prompt).
---

3. UI Ergonomics & Component Patterns
3.1. Inline Tabs Navigation (Main Pane)
Every high-level route houses sub-navigation inside cohesive main-pane tabs:

Style: Segmented flat tabs with subtle highlight borders; zero vertical shift between transitions.
Preservation: Deep link tracking using URL hashes or search parameters (?tab=telemetry) without server roundtrips.
3.2. Form Progressive Disclosure & Noise Reduction
Complex forms in the right action sheet must avoid overwhelming the user:

Primary Fields: Visible by default (Required parameters, Names, Target Repos).
Advanced Configurations: Wrapped in clean <details> / custom accordion toggles labeled:
*"Advanced Runtime Overrides (Timeout, Concurrency, Memory Limits)"*
Group Controls: Include Select All / Deselect All checkboxes with tri-state indicators (indeterminate state [-]).
3.3. Micro-Interaction Primitives
Zero-Padding Copy Icon (📋):
Placed directly next to commit hashes, API tokens, webhook URLs, and IDs.
Size: 14px × 14px SVG.
Padding: 0; Margin: ml-1.5 inline-flex items-center align-middle.
Visual feedback: Switches to a green checkmark (✓) for 1200ms upon click.
External Entity Links (↗):
When validating third-party references (GitHub commits, external API logs, raw JSON schemas), render a dual-action control:
Click target opens a right-side reader overlay for safe context previews.
Hold Cmd/Ctrl + click opens direct in a new tab (target="_blank" rel="noopener noreferrer").
---

4. Theme System: Light & Dark Control
Adheres to modern system color palettes (zinc / slate neutrality with electric indigo accents).

/* Color Palette Token Map */
:root[data-theme="light"] {
  --bg-primary: #ffffff;
  --bg-secondary: #f8fafc;
  --bg-surface: #ffffff;
  --border-subtle: #e2e8f0;
  --text-main: #0f172a;
  --text-muted: #64748b;
  --accent: #4f46e5;
  --danger: #ef4444;
}

:root[data-theme="dark"] {
  --bg-primary: #09090b;
  --bg-secondary: #121215;
  --bg-surface: #18181b;
  --border-subtle: #27272a;
  --text-main: #f4f4f5;
  --text-muted: #a1a1aa;
  --accent: #6366f1;
  --danger: #f87171;
}
Toggle Placement: Header right corner, persisted in localStorage and synced with system preference (prefers-color-scheme).
Icons: Strict, lightweight monochrome SVGs (sun.svg / moon.svg).
---

5. Destructive Confirmations & Modal Protocol
To prevent catastrophic mistakes without introducing sluggish workflow traps:

+-----------------------------------------------------------+
| ⚠️ Terminate Production Cluster                          |
+-----------------------------------------------------------+
| This action cannot be undone. All active jobs will abort. |
|                                                           |
| Type cluster name to confirm:                             |
| [ production-worker-eu-1 ] [📋]                           |
|                                                           |
| Input: [ production-worker-eu-1                         ] |
+-----------------------------------------------------------+
|                     [ Cancel ]  [ Destroy Cluster (Red) ] |
+-----------------------------------------------------------+
Catastrophic Actions (Data Loss, Repo Disconnect, Deletions):
Must present the targeted resource name wrapped in a badge with an attached zero-padding copy button.
Primary action button is hard-disabled (disabled aria-disabled="true") until the input value strictly equals the exact resource identifier.
Standard High-Impact Actions (Restarts, Drain nodes, Deployments):
Standard accessible confirm/cancel dialog with keyboard shortcuts (Esc = cancel, Enter = confirm).
---

6. Asynchronous Background Engine & Task Notifications
Long-running jobs (GitHub syncs, container builds, agent onboarding runs) must never stall interaction.

[Trigger Action] ──> [Optimistic UI Update] ──> [Sheet Auto-Dismisses]
                                                        │
                   [Async Worker Thread / WebSocket] <──┘
                                │
                    [Status: "Processing..."] (Header Tray)
                                │
                    [Completion Event Dispatched]
                                │
    ┌───────────────────────────┴───────────────────────────┐
    ▼                                                       ▼
[Toast: Success / Fail]                 [Invalidate React-Query Cache]
                                                            │
                                                [Auto-Refreshes Row]
Notification Hub: An indicator sits in the sticky app bar displaying active task count (e.g., Tasks: 2 Running ⟳).
Instant Sheet Dismissal: When a user initiates a task from the overlay sheet, the form immediately dismisses, emitting a job ID.
Live Invalidation: When the async worker announces status RESOLVED, the cache invalidator triggers a targeted re-fetch for that resource row, preserving scrolling and cursor position.
---

7. Data Grid Architecture: Pagination, Filtering & Search
Golden Rule: Under no circumstances are unbounded datasets rendered to the DOM.

+-----------------------------------------------------------------------------------------+
| [ Search workers by name, tag, IP... 🔍 ]   [ Status: All ⏷ ] [ Sort: Recent ⏷ ]  [Reset]|
+-----------------------------------------------------------------------------------------+
| [✓] Worker Node           Status        Version       Last Ping           Actions       |
| [ ] node-us-east-4        🟢 Active     v2.4.0        2s ago              [Edit] [···]  |
| [ ] node-eu-west-1        🟡 Draining   v2.3.9        45s ago             [Edit] [···]  |
+-----------------------------------------------------------------------------------------+
| Showing 1 - 25 of 1,420 items              [|<] [<] Page 1 of 57 [>] [>|]  Limit: [25 ⏷]|
+-----------------------------------------------------------------------------------------+
Search & Filter Protocol:
Text search is client-debounced (300ms) and mapped to URL params.
Reset button clears filters back to defaults in a single click.
Server-Side Pagination:
Cursor or page-based controls with limits: [25, 50, 100].
Cache & Invalidation Layer:
Use structured query keys: ['agents', { orgId, repoId, page, filters }].
Stale time: 10s default.
Auto-purge cache keys on manual sheet actions.
Anti-Flicker Skeleton Guard:
Never render empty screens or jumping elements while fetching.
Display bone-white/slate animated SVGs with identical component height and width dimensions before painting final data.
---

8. Automated Setup & Agent Onboarding
Onboarding new agents and connecting GitHub accounts must operate with minimal manual typing:

Step 1: Link Provider  ──>  Step 2: Select Scope  ──>  Step 3: Verification
[ Connect GitHub ]         [ Select Repositories ]     [ One-Click Test ]
(OAuth Webhook Flow)       (Auto-Populate Monorepos)   (Agent Heartbeat Auto-Check)
GitHub Connection: Triggered via OAuth App / GitHub App flow directly inside the Right Overlay Sheet.
Repository Discovery: Repositories are fetched on-the-fly and rendered as searchable select chips.
Automated Agent Install Command:
Generates a one-line setup command with embedded zero-padding copy button:
```bash
curl -fsSL https://dash.local/install.sh | AGENT_KEY=ag_live_98a7c1 bash
```
Continuous Polling / WS Handshake:
The onboarding UI listens for the initial agent heartbeat and displays a green indicator (Agent Online ✓) the moment the node connects.
---

9. Comprehensive Glossary & Context Help Framework
Every high-level view includes an integrated collapsible Help & Concepts shelf anchored at the bottom of the main pane.

+-----------------------------------------------------------------------------------------+
| 💡 System Context & Operation Guide                                           [Collapse] |
+-----------------------------------------------------------------------------------------+
| Term                 Definition & Best Practice                                         |
| ──────────────────── ────────────────────────────────────────────────────────────────── |
| Agent Heartbeat      A 15-second telemetry pulse transmitted by the agent daemon. If no |
|                      pulse is registered for 60 seconds, the agent transitions to Dead. |
|                                                                                         |
| Ephemeral Worker     A container instance created strictly for running a short-lived    |
|                      job, terminated immediately after task execution to reduce cost.   |
|                                                                                         |
| Right Action Sheet   The non-blocking drawer used to edit state without losing table    |
|                      scroll position or active filter queries.                          |
+-----------------------------------------------------------------------------------------+
Purpose of Standardized Help:
The "What": Clear definition of technical terms (e.g., *Webhook Invalidation*, *Ephemeral Worker*, *Hot Cache*).
The "Why": Concrete architectural reasoning explaining system constraints (e.g., *"Why must agent names be unique across clusters?"*).
---

10. Open Source Forking & Reusability Strategy
To satisfy Apache 2.0 modularity and allow easy downstream forks:

                        ┌────────────────────────────────────────┐
                        │   @kalahroudi/dashboard-core (Apache)  │
                        └───────────────────┬────────────────────┘
                                            │
                    ┌───────────────────────┴───────────────────────┐
                    ▼                                               ▼
       ┌────────────────────────┐                      ┌────────────────────────┐
       │   admin-dash-worker    │                      │   customer-portal-app  │
       │   (Internal Ops Node)  │                      │   (Scoped End-User)    │
       ├────────────────────────┤                      ├────────────────────────┤
       │ - Full access          │                      │ - Read/Write Own Repos │
       │ - Cluster teardown     │                      │ - Restricted Deletes   │
       │ - Worker orchestrator  │                      │ - Scoped API Keys      │
       └────────────────────────┘                      └────────────────────────┘
Implementation Guidelines for Portability:
Decoupled Business Logic: All UI states, tabs, pagination hooks, and sheet managers are written as headless hooks (useSheetAction, useDataGrid, useThemeSwitcher).
Environment-Driven Configuration: Provide a root configuration object dashboard.config.ts:
```typescript
export const dashboardConfig = {
appName: "Agent Dispatch Worker",
license: "Apache-2.0",
author: "kalahroudi",
features: {
enableDestructiveTypeGuard: true,
enableTaskQueueCenter: true,
enableGithubAutomatedSetup: true,
},
navigation: [
{ id: "dashboard", label: "Overview", icon: "LayoutDashboardIcon" },
{ id: "agents", label: "Agents & Nodes", icon: "CpuIcon" },
{ id: "tasks", label: "Task Pipelines", icon: "GitBranchIcon" },
{ id: "settings", label: "System Setup", icon: "WrenchIcon" },
]
};
```
Separation of Scopes: Forking the repository to build a tenant-facing app only requires swapping navigation entries and setting enableDestructiveTypeGuard: false where tenant permissions are restricted.
---

11. Pull Request Checklist (For @kalahroudi)
Before opening a PR for layout, feature, or route additions, verify that the following criteria are met:

☐ Sticky left navigation stays fixed during vertical scrolling.
☐ Left navigation collapses cleanly into an icon rail with active state intact.
☐ Form submissions and long operations trigger through the right sheet overlay without standard full-page reloads.
☐ Long tasks report state asynchronously to the top status bar.
☐ Every destructive button triggers the exact name-matching dialog with a zero-padding copy button.
☐ All table interfaces implement pagination, debounced search, and clean filters.
☐ Skeleton loaders match the dimensions of incoming data views.
☐ Light and dark color tokens resolve cleanly without flash of unstyled content (FOUC).
☐ Dedicated Help & Concepts section is updated with all new domain terminology.