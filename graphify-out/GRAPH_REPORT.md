# Graph Report - .  (2026-08-02)

## Corpus Check
- Corpus is ~16,261 words - fits in a single context window. You may not need a graph.

## Summary
- 401 nodes · 759 edges · 21 communities (18 shown, 3 thin omitted)
- Extraction: 99% EXTRACTED · 1% INFERRED · 0% AMBIGUOUS · INFERRED: 5 edges (avg confidence: 0.95)
- Token cost: 0 input · 0 output

## Community Hubs (Navigation)
- Bubble UI Components
- Sidebar & Navigation
- Chat View & Sessions
- Project Configuration
- External UI Libraries
- User & Theme Controls
- TypeScript Config & DOM
- App Shell & Agent View
- Application Icons
- shadcn Component Registry
- Input & Form Components
- Tauri Core Integration
- Vite Build Config
- Tauri Rust Backend
- Tauri Brand Assets
- Vite Brand Assets
- React Brand Assets

## God Nodes (most connected - your core abstractions)
1. `cn()` - 146 edges
2. `compilerOptions` - 18 edges
3. `useSidebar()` - 10 edges
4. `Button()` - 9 edges
5. `SidebarMenuButton()` - 8 edges
6. `README.md (Tauri + React + TypeScript template)` - 7 edges
7. `tailwind` - 6 edges
8. `aliases` - 6 edges
9. `react` - 6 edges
10. `icon` - 6 edges

## Surprising Connections (you probably didn't know these)
- `ChatUI project` --conceptually_related_to--> `react`  [INFERRED]
  index.html → package.json
- `ChatUI project` --conceptually_related_to--> `typescript`  [INFERRED]
  index.html → package.json
- `ChatUI project` --conceptually_related_to--> `vite`  [INFERRED]
  index.html → package.json
- `README.md (Tauri + React + TypeScript template)` --cites--> `react`  [EXTRACTED]
  README.md → package.json
- `README.md (Tauri + React + TypeScript template)` --cites--> `typescript`  [EXTRACTED]
  README.md → package.json

## Import Cycles
- None detected.

## Hyperedges (group relationships)
- **ChatUI tech stack** — tauri, react, typescript, vite [INFERRED 0.95]
- **** — public_tauri_tauri_logo, public_vite_vite_logo, src_assets_react_react_logo, src_tau_i_app_icon [INFERRED 0.95]

## Communities (21 total, 3 thin omitted)

### Community 0 - "Bubble UI Components"
Cohesion: 0.06
Nodes (47): Bubble(), BubbleContent(), BubbleGroup(), BubbleReactions(), bubbleReactionsVariants, bubbleVariants, Card(), CardAction() (+39 more)

### Community 1 - "Sidebar & Navigation"
Cohesion: 0.07
Nodes (44): react, AppSidebar(), data, Tab, NavChats(), NavUser(), Collapsible(), CollapsibleContent() (+36 more)

### Community 2 - "Chat View & Sessions"
Cohesion: 0.07
Nodes (41): ChatView(), formatBytes(), generateId(), initialAgentSessions, initialProjects, initialSessions, SKILLS, WELCOME_PROMPTS (+33 more)

### Community 3 - "Project Configuration"
Cohesion: 0.06
Nodes (36): ChatUI project, index.html (entry point), src/main.tsx, devDependencies, playwright-core, @tauri-apps/cli, @types/node, @types/react (+28 more)

### Community 4 - "External UI Libraries"
Cohesion: 0.06
Nodes (33): class-variance-authority, clsx, @fontsource-variable/inter, lucide-react, next-themes, dependencies, class-variance-authority, clsx (+25 more)

### Community 5 - "User & Theme Controls"
Cohesion: 0.12
Nodes (19): Avatar(), AvatarBadge(), AvatarFallback(), AvatarGroup(), AvatarGroupCount(), AvatarImage(), DropdownMenu(), DropdownMenuCheckboxItem() (+11 more)

### Community 6 - "TypeScript Config & DOM"
Cohesion: 0.08
Nodes (24): DOM, DOM.Iterable, ES2020, src, compilerOptions, allowImportingTsExtensions, baseUrl, isolatedModules (+16 more)

### Community 7 - "App Shell & Agent View"
Cohesion: 0.13
Nodes (17): App(), Tab, AgentView(), Badge(), badgeVariants, Empty(), EmptyContent(), EmptyDescription() (+9 more)

### Community 8 - "Application Icons"
Cohesion: 0.09
Nodes (22): icons/128x128@2x.png, icons/128x128.png, icons/32x32.png, icons/icon.icns, icons/icon.ico, app, security, windows (+14 more)

### Community 9 - "shadcn Component Registry"
Cohesion: 0.11
Nodes (17): aliases, components, hooks, lib, ui, utils, iconLibrary, rsc (+9 more)

### Community 10 - "Input & Form Components"
Cohesion: 0.21
Nodes (10): InputGroup(), InputGroupAddon(), inputGroupAddonVariants, InputGroupButton(), inputGroupButtonVariants, InputGroupInput(), InputGroupText(), InputGroupTextarea() (+2 more)

### Community 11 - "Tauri Core Integration"
Cohesion: 0.20
Nodes (9): core:default, core:window:allow-start-dragging, main, opener:default, description, identifier, permissions, $schema (+1 more)

### Community 12 - "Vite Build Config"
Cohesion: 0.22
Nodes (8): vite.config.ts, compilerOptions, allowSyntheticDefaultImports, composite, module, moduleResolution, skipLibCheck, include

### Community 14 - "Tauri Brand Assets"
Cohesion: 0.67
Nodes (3): Tauri Logo, App PNG Icons, Tauri

## Knowledge Gaps
- **119 isolated node(s):** `$schema`, `style`, `rsc`, `tsx`, `config` (+114 more)
  These have ≤1 connection - possible missing edges or undocumented components.
- **3 thin communities (<3 nodes) omitted from report** — run `graphify query` to explore isolated nodes.

## Suggested Questions
_Questions this graph is uniquely positioned to answer:_

- **Why does `cn()` connect `Bubble UI Components` to `Sidebar & Navigation`, `Chat View & Sessions`, `User & Theme Controls`, `App Shell & Agent View`, `Input & Form Components`?**
  _High betweenness centrality (0.274) - this node is a cross-community bridge._
- **Why does `react` connect `Sidebar & Navigation` to `Project Configuration`, `External UI Libraries`?**
  _High betweenness centrality (0.205) - this node is a cross-community bridge._
- **Why does `dependencies` connect `External UI Libraries` to `Sidebar & Navigation`, `Project Configuration`?**
  _High betweenness centrality (0.181) - this node is a cross-community bridge._
- **What connects `$schema`, `style`, `rsc` to the rest of the system?**
  _119 weakly-connected nodes found - possible documentation gaps or missing edges._
- **Should `Bubble UI Components` be split into smaller, more focused modules?**
  _Cohesion score 0.059395801331285206 - nodes in this community are weakly interconnected._
- **Should `Sidebar & Navigation` be split into smaller, more focused modules?**
  _Cohesion score 0.07239819004524888 - nodes in this community are weakly interconnected._
- **Should `Chat View & Sessions` be split into smaller, more focused modules?**
  _Cohesion score 0.06588235294117648 - nodes in this community are weakly interconnected._