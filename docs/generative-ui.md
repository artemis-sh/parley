# Generative UI roadmap

Parley aims to support richer agent workflows without taking ownership of an
agent's tools. Open Responses remains the conversation protocol, while agents
continue to select, execute, and authorize their tools internally.

The UI strategy is standards-first and progressive. Parley should consume
typed, user-visible resources produced by tools rather than introduce a
Parley-specific UI protocol.

## Architecture

The preferred flow follows the A2UI-over-MCP resource model:

```text
MCP server
  returns a typed UI resource in a tool result
        |
        v
Agent
  executes the tool and preserves its typed result
        |
        v
Open Responses
  carries the tool result to Parley
        |
        v
Parley
  dispatches the resource to a compatible renderer
```

In this model, UI resources are normally constructed deterministically by the
tool or MCP server, just like the rest of the tool result. They do not require
the model to emit JSON inside a text response. Agents may still generate UI
dynamically when their runtime provides schema-constrained generation and
validation, but that is an agent implementation concern rather than a Parley
requirement.

Parley remains responsible for safe rendering, user interaction, and host
policy. The agent remains responsible for tool execution and for routing UI
actions back to the service that owns the workflow.

## Progressive support

### Level 1: Official A2UI Basic Catalog (implemented)

Parley supports the official A2UI Basic Catalog and renders
`application/a2ui+json` resources using native Parley components.

This is the portable baseline. Tool providers can describe layouts, forms,
lists, media, and actions using a shared catalog without depending on
Parley-specific components. Different hosts may render the same resource in
their own visual language while preserving its structure and behavior.

Parley advertises only the A2UI protocol versions it fully supports
(`A2UI_SUPPORTED_VERSIONS` in `src/lib/a2ui.ts`) and renders only catalog
IDs that are both installed in the build (`A2UI_INSTALLED_CATALOG_IDS`) and
enabled by a deployment administrator. Tool providers should include a
useful textual fallback for clients that cannot render the resource.

How it works today:

- Detection: Parley scans `function_call_output` items for A2UI resources
  encoded per the A2UI-over-MCP convention — an MCP embedded resource
  (`{type: "resource", resource: {mimeType: "application/a2ui+json",
  text}}`) among the output content parts, or a JSON string of an MCP
  `CallToolResult`. A bare A2UI message array is also accepted. Nothing
  else is sniffed (`extractA2uiResources` in `src/lib/a2ui.ts`).
- Presentation sidecars: providers may alternatively emit an
  [`ajac-zero:a2ui`](https://github.com/ajac-zero/openresponses-extensions)
  output item linked to the canonical `function_call` / `function_call_output`
  pair by `call_id`. The sidecar is optional presentation metadata: Parley
  keeps the canonical tool result unchanged, excludes the sidecar from
  provider replay, and reduces its A2UI messages at the linked call. If both
  forms describe the same surface, the explicit presentation sidecar takes
  precedence.
- `call_id` uniqueness scope: Open Responses calls `call_id` unique but does
  not explicitly define that uniqueness scope. Parley therefore treats it as
  unique within the single turn (response) that produced it.
  `function_call` <-> `function_call_output` <-> presentation-sidecar
  linkage, and tool-call ↔ output pairing in the thread, are all scoped by
  `(turn, call_id)`, never by `call_id` alone.
  Reusing the same `call_id` string in a later, unrelated turn is expected
  and supported: agents and MCP servers commonly assign short or
  sequential ids, and requiring conversation-wide uniqueness would be an
  unreasonable, unenforceable burden on tool authors. `surfaceId` is the
  one identifier that *is* conversation-wide (surfaces persist and can be
  updated across turns by design — see "Surface lifecycle" below); do not
  conflate the two scopes. Within a turn, a scoped id is linkable only when
  exactly one canonical `function_call` and one `function_call_output` use it.
  Duplicate calls or outputs are ambiguous: the thread pairs no output and
  A2UI ignores canonical content and sidecars for that scoped id rather than
  combining potentially unrelated results.
- Rendering: surfaces are reduced from the standard `createSurface` /
  `updateComponents` / `updateDataModel` / `deleteSurface` messages and
  rendered with native components (`src/components/a2ui/`). Data binding is
  local and two-way; unsupported catalogs or protocol versions degrade to
  the tool's text fallback without executing anything.
- Surface lifecycle: surfaces are conversation-wide state
  (`reduceA2uiOutputs` in `src/lib/a2ui.ts`). Every tool output is reduced
  in order, so a later tool result can update or delete a surface created
  by an earlier call — this is how an agent reflects an action's outcome by
  morphing the original UI in place rather than rendering a new surface.
  Each surface renders anchored at the call whose `createSurface` produced
  it; server data-model updates that arrive after the user has started
  editing merge into the local model instead of clobbering it.
- Placement: where a surface renders is host policy, not protocol — A2UI
  carries no placement hints and tools cannot request one. By default
  surfaces render inline at their anchor; the user may pin a surface to a
  side canvas to keep interacting with it while the conversation continues
  (agent-driven updates keep landing on it there). Pinning is a client-side
  preference, moves are lossless for local edits, and on viewports too
  narrow for the canvas pins lie dormant and surfaces render inline.
- Actions: a user action becomes a new user turn whose text is a readable
  summary, plus an `a2ui` content part carrying the standard A2UI
  client -> server messages verbatim (the Open Responses analog of A2A's
  DataPart binding). The agent owns routing the action back to the tool
  that produced the surface; the standalone demo agent shows the loop
  (ask it to "book a table" — submitting the form updates it in place
  into a confirmation).
- Message emptiness: a user message needs non-blank text, an attachment, or
  an `a2ui` payload — never all three empty. This applies identically to the
  first turn of a conversation and to every later turn, so an A2UI-only
  message (built-in surface actions with no readable text, or a direct API
  client submitting one) is valid in both places. Starting a conversation
  with an A2UI-only message uses the `New chat` fallback title.

### Built-in charts catalog (implemented)

Custom catalogs are the A2UI-sanctioned path for domains that need more
specialized native components than the Basic Catalog provides. A custom
catalog is a contract (a standalone JSON Schema) plus trusted renderer
implementations on the host; receiving an unknown catalog must not cause
Parley to download or execute anything.

Parley ships a renderer for the independently owned
[Artemis Charts v1 catalog](https://github.com/artemis-sh/a2ui-catalogs/blob/main/catalogs/charts/v1/catalog.json),
which composes the official Basic Catalog v0.9.1 with five leaf components:
`Chart` supports Cartesian, composed, pie, donut, scatter, and bubble charts;
`Stat`, `Sparkline`, `Progress`, and `Gauge` provide metric and compact
quantitative displays. The components support capabilities including selection,
reference marks, normalization, legend bindings, dual axes, and accessible data
tables. Because every extension is a leaf, every Basic Catalog resource remains
valid under the charts catalog unchanged; adding a new container component
would be a breaking change and require a new versioned catalog ID.

How it works today:

- Contract: the external schema's `$id` is the catalog ID
  (`A2UI_CHARTS_CATALOG_ID` in `src/lib/a2ui.ts`). Catalog IDs are opaque,
  versioned identifiers agreed out-of-band — never fetched at runtime; the
  independently published file documents the contract for tool authors.
- Rendering: a registry in `src/components/a2ui/catalog.tsx` maps each
  supported `catalogId` to its component views. The charts views
  (`src/components/a2ui/charts.tsx`) lazy-load so the charting library
  stays out of the main bundle until a chart actually renders. Series
  colors are restricted to the host theme's chart tokens and series keys
  are validated, so resources cannot inject styles or colors. An unknown
  component type within a supported catalog renders a labeled, inert
  placeholder (per spec); unknown catalogs still degrade to the tool's
  text fallback.
- Negotiation: A2A advertises supported catalogs via
  `metadata.a2uiClientCapabilities.supportedCatalogIds`; Open Responses has
  no equivalent yet, so catalog support is agreed out-of-band (this repo's
  supported IDs are the contract). The standalone demo agent shows both
  selection loops: ask for a "revenue chart" and click a bar (point
  selection), or a "traffic trend" and drag across the chart (range
  selection) — either way the analysis lands on the same surface in place.

The charts catalog is built in and enabled by default, but participates in the
same Level 2 registration and enablement system described below. The official
Basic Catalog stays the preferred option whenever it is sufficient; custom
catalogs trade some portability for richer native integration.

### Built-in maps catalog (implemented)

Parley ships renderers for the experimental
[Artemis Maps v1 catalog](https://github.com/artemis-sh/a2ui-catalogs/blob/main/catalogs/maps/v1/catalog.json)
and the immutable
[Artemis Maps v2 catalog](https://github.com/artemis-sh/a2ui-catalogs/blob/maps-v2.0.0/catalogs/maps/v2/catalog.json).
V2 replaces v1's point-centric shape with ordered independent point and
schematic connection layers. Every v2 feature has a stable `{layerId,
featureId}` identity, and map selection writes that identity only, never a
source index or copied record. Its visible keyboard-operable feature list is the
required accessible equivalent for map interaction.

The resource controls geographic data and semantic presentation only. Parley
owns the MapLibre renderer and a fixed OpenStreetMap raster source, including
visible attribution; resources cannot supply tile URLs, styles, HTML markers,
images, or executable expressions. Loading a map sends tile requests to
OpenStreetMap, so deployments should account for its usage and privacy policy.
The renderer lazy-loads and limits each v2 layer to 2,000 valid WGS84 points or
500 valid schematic connections. Capacity overflows render a validation fallback
rather than silently truncating data. The mutable `maps/v1` catalog ID remains
pre-release only; new integrations should use the tagged v2 contract.

### Level 2: Custom catalog plugins (implemented)

Parley supports installed catalog plugins for domains that need more specialized
native components, such as charts, diagrams, code review, or infrastructure
visualizations.

A plugin must provide both the catalog contract and trusted renderer
implementations. Catalogs are explicitly installed and negotiated; receiving
an unknown catalog must not cause Parley to download or execute arbitrary code.

Built-in catalogs, including the official Basic Catalog and Parley's charts and
maps catalogs, use the same registration system as externally installed catalogs.
They are enabled by default, and deployment administrators can disable them or
enable other installed catalog plugins.

Installation and enablement are separate trust boundaries. Plugins are trusted
code installed at build time through the static manifest and renderer registries;
catalog IDs never cause Parley to fetch or execute code. Runtime settings store
only the enabled plugin keys. The effective catalog IDs are the intersection of
those settings and the plugins installed in the current build, and are supplied
to both server-side and browser rendering through the root app configuration.

The initial installed plugins are `basic`, `charts`, and `maps`. Self-hosters can add a
trusted plugin module to the build-time registries, rebuild Parley, and then let
an administrator enable it from the Catalogs tab. A future packaging API can
make that installation seam more convenient without changing the runtime trust
model.

### Level 3: MCP Apps

When a workflow cannot reasonably be expressed through a shared declarative
catalog, Parley may host standards-compliant MCP Apps in a sandboxed
environment.

MCP Apps provide the escape hatch for arbitrary, highly specialized
interfaces. They remain isolated from Parley's authenticated application and
interact with their owning MCP server through the standard host bridge and
explicitly granted capabilities.

This level favors application portability and expressiveness over native
component rendering. It must not turn Parley into the owner of agent tool
selection or domain authorization.

## Selection order

Tool and agent authors should choose the least privileged interoperable level
that satisfies the workflow:

1. Use the official A2UI Basic Catalog when possible.
2. Use a mutually supported custom catalog when specialized native components
   are needed.
3. Use an MCP App when the workflow requires an arbitrary application.

Parley should degrade gracefully when it cannot render a resource: show its
text fallback when available, preserve the tool result, and avoid executing
unknown content.

## Protocol boundaries

This roadmap deliberately avoids defining a new Parley wire protocol. Before
each level is implemented, its integration should be checked against the
current Open Responses, MCP, A2UI, and MCP Apps specifications and SDKs.

One interoperability boundary requires particular attention: an agent that
executes tools internally must preserve typed MCP resources when exposing tool
results through Open Responses. Likewise, actions from a rendered resource
must be routed back through the agent to the originating tool service without
moving tool ownership into Parley. Where the standards do not yet define this
bridge, Parley should prefer contributing a narrow upstream convention over
creating a broader proprietary protocol.

Detailed transport, persistence, rendering, sandboxing, and action-routing
decisions are intentionally deferred until work begins on each level.
