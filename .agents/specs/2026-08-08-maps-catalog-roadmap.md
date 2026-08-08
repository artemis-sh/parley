---
title: "Maps Catalog Roadmap"
status: accepted
kind: design
created: 2026-08-08T16:47:24+00:00
---

# Maps Catalog Roadmap

## Goals

- Define a portable A2UI vocabulary for presenting supplied geospatial data
  and capturing user interaction with it.
- Keep rendering native, bounded, accessible, and controlled by the host.
- Enable future workflows such as nearby-place results, itineraries, incident
  maps, service coverage, logistics, and geographic analytics without coupling
  the catalog to a search, geocoding, routing, or tile provider.
- Add the smallest coherent primitives justified by concrete use cases rather
  than attempting to expose every feature of the host map library.
- Preserve graceful fallback through summaries and tabular representations.
- Freeze exact catalog contracts before external adoption and prove semantics
  independently of Parley's MapLibre implementation.

## Non-goals

- Acquiring browser or device location.
- Searching for places or points of interest.
- Geocoding or reverse geocoding addresses.
- Calculating distances, routes, travel times, or live traffic.
- Managing map-provider credentials or data freshness.
- Accepting producer-supplied tile URLs, renderer-native map styles, HTML,
  JavaScript, SVG, arbitrary GeoJSON, or executable styling expressions.
- Turning the catalog into a general geospatial API. Agents and authorized
  tools obtain and transform data; the catalog presents supplied results.

## Design

### Boundary

The governing rule is:

> The Maps catalog renders and captures interaction with supplied geospatial
> data. It does not discover, infer, geocode, route, or fetch that data.

The producer controls bounded records, field mappings, narrowly typed source
coordinates or geometry, semantic variants, approved theme tokens, and
data-model bindings. The host controls the renderer, basemap, tile provider,
attribution, network policy, projection, clipping, tessellation, display
simplification, styling, limits, accessibility, and visual implementation.
Producer data never includes renderer-native sources, styles, expressions,
scripts, markup, fonts, images, or network locations.

For example, a future "nearest museum" workflow is decomposed as follows:

1. A host permission control or explicit user input supplies a reference
   location.
2. An authorized places tool searches for museums.
3. The tool or agent supplies distances and result records.
4. The Maps catalog renders the reference location and museum markers.
5. A routing tool supplies a path if the user requests directions.

### Versioning and negotiation

The current `maps/v1` schema is an experimental, pre-release contract jointly
developed with its only host. Its GitHub `blob/main` catalog ID is mutable and
must not be presented as a stable external compatibility promise.

Before external adoption:

- Freeze the current experiment or replace it with a new immutable release ID.
- Publish immutable catalog documents at release- or content-addressed URLs.
- Negotiate exact catalog IDs. A host supports the complete semantics of an ID,
  not an undocumented subset.
- Give every protocol capability addition a new catalog ID, even when its JSON
  shape is additive or optional. Renderer fixes may retain an ID only when wire
  semantics and observable behavior remain unchanged.
- Maintain valid, invalid, fallback, and version-transition fixtures. Unknown
  IDs fail closed. Producers must provide an adjacent Basic Catalog or canonical
  text summary for hosts that cannot render the custom catalog; do not assume
  A2UI guarantees one custom-resource fallback field.

### Experimental baseline

The experimental Maps v1 currently extends the A2UI Basic Catalog with one
point-centric `Map` leaf that supports:

- Point markers and value-sized bubbles over bound records.
- WGS84 coordinate validation and bounded record counts.
- Optional stable IDs, labels, formatted values, and host theme tokens.
- Automatic fitting or an explicit initial viewport.
- Point selection through two-way data binding. The current index/copy payload
  is experimental and not the target interoperable selection contract.
- Curved, value-scaled schematic connections derived by the host from supplied endpoint
  coordinates.
- Optional directional flow animation that respects reduced-motion
  preferences.
- Connection selection through a separate two-way binding.
- Nonvisual point and connection summaries and an optional point data table.
- A host-owned MapLibre renderer and fixed attributed basemap; resources cannot
  inject map infrastructure or executable content.

This baseline has known structural limits: points are mandatory, schematic
connections are nested under the point component, selection identity is not
stable enough for map/list synchronization, non-map interaction does not yet
have keyboard parity, and Parley's current overflow behavior silently truncates
records. Stabilization must address these before adding more layer families.

### Roadmap

#### 1. Core contract gate

Design a new immutable catalog ID around an ordered, bounded collection of
typed layers. Any supported layer can independently create a valid map; points
are not an admission requirement for connections or paths. The initial layer
vocabulary should remain narrow:

- Point layer.
- Schematic connection layer derived from endpoint pairs.
- Supplied path layer only after its geometry contract is complete.

Every layer has a stable bounded string `layerId`; producer array order is the
normative back-to-front semantic order. Hosts may add accessibility overlays and
controls but cannot silently reorder or omit a valid within-limit layer. Layers
validate atomically: an invalid or over-capacity layer renders a visible and
nonvisual validation fallback while other independently valid layers remain.
Each layer explicitly opts into initial fitting. Legend specifications belong to
layers and the host composes their presentation. The contract also defines
hit-test precedence across overlapping layers. Regions remain outside this core
design.

Require stable bounded string feature IDs unique within a layer. A feature
reference is `{layerId, featureId}`. Persistent selection is `null`, one feature
reference, or a bounded ordered array of unique feature references as explicitly
declared by the layer. It never copies labels, coordinates, values, or source
indices. Map/list synchronization uses the same typed feature reference. Define
deselection, duplicate and unknown IDs, data refresh, producer-originated
selection, ordering, maximum multi-selection size, disabled state, and invalid
binding paths. Transient activation context uses the standard A2UI action/event
path when available; it is not persisted as selected state.

Define one mandatory minimum capacity per released ID and layer type. Content at
or below that capacity behaves consistently across hosts; hosts may support more.
Exceeding a host's declared capacity atomically rejects that layer with its
visible and nonvisual validation fallback. Hosts never truncate, aggregate, or
retain arbitrary first-N records. Producer-supplied aggregates are separate
schema-valid input, not host overflow behavior. Limits cover records, layers,
labels, vertices, segments, selection payloads, and update rate. Measurable
initialization and interaction budgets belong to a conformance profile with
specified hardware and conditions rather than the wire schema.

For quantitative encodings, define nonnegative magnitude semantics, handling of
missing, zero, negative, and nonfinite values, explicit or deterministic scale
domains, area-proportional bubble sizing, connection-width semantics, mandatory
legends, and nonvisual exposure of every encoded value. Theme tokens preserve
semantic emphasis, not exact cross-host color identity.

#### 2. Trust and privacy gate

A conforming host may use an offline, blank, self-hosted, or privacy-preserving
basemap. Core feature rendering and fallback must not require third-party
network access. Hosts own network policy, credentials, attribution, caching,
referrer behavior, and telemetry.

Treat exact points, paths, selections, and viewed areas as potentially sensitive.
Writable bindings are explicitly declared by the resource and confined to its
authorized surface data-model subtree. Require bounded writes, coordinate
precision guidance, purpose-limited retention and onward disclosure, and no
interaction telemetry by default as catalog conformance requirements. Host
policy may impose stricter network, retention, or privacy controls but cannot
weaken these requirements. Threat model malformed field names and paths,
oversized labels/arrays, rapid update floods, sensitive tracks, and renderer
cleanup under replacement.

Use WGS84 latitude/longitude in decimal degrees with explicit axis naming,
finite-number handling, longitude normalization, shortest-wrap fitting,
antimeridian crossing, pole behavior, and projection-independent semantics.
Hosts own display projection; WGS84 input does not mandate Web Mercator.

#### 3. Accessibility and equivalence gate

Every selectable feature type requires a keyboard- and assistive-technology
operable non-map representation with visible focus, announced selected state,
labels independent of shape/color/motion, and no silent truncation of actionable
features. Interactive analytical layers cannot make that equivalent optional.

Conformance covers keyboard-only use, screen readers, high contrast, 200% zoom,
touch targets, localization, responsive layouts, reduced motion, and no-network
fallback. Persistent animation must be avoidable and pausable when it conveys
ongoing state.

Split conformance evidence into renderer-independent protocol fixtures and host
behavior tests. A static SVG or simplified reference renderer may prove fitting,
wrapping, layer order, labels, legends, and fallback. At least one independent
interactive harness or non-Parley host must additionally exercise selection,
actions, focus, and state synchronization. Do not count a static renderer as
evidence for interactions it cannot implement.

#### 4. Semantic point roles and marker hints

Add bounded marker intent for discrete locations where circles do not convey
the right meaning:

- Semantic role may include neutral meanings such as `place`, `reference`,
  `origin`, `destination`, or `waypoint` when the role changes accessible text.
- A separate optional glyph hint may include `circle`, `pin`, or `dot`.

The host owns the SVG or DOM shape, contrast, focus state, sizing, and
accessibility and may substitute a platform-native representation. Producers
cannot supply marker images or arbitrary SVG. Producers cannot assert
host-verified "your location" or "current location" provenance. Origin and
destination roles are meaningful only in relation to supplied path semantics.
Value scaling remains primarily a circle/bubble behavior; semantic markers use
a constrained size range.

#### 5. Supplied point uncertainty

An ordinary supplied reference location is a point with role `reference`, not a
separate primitive, and does not imply it came from the user. A later concrete
workflow may add bounded `uncertaintyRadiusMeters` and distinguish
measurement, approximation, or privacy uncertainty; these are not interchangeable
with generic "accuracy." Define geodesic meter interpretation, latitude behavior,
radius limits, and accessible wording. This enables "near me" results without
granting the resource permission to acquire or verify location.

#### 6. Shared map/list selection

Use the stable ID contract from the core gate so map features and Basic Catalog
lists bind to the same selected ID. Require fixtures that select in both
directions, refresh data, remove the selected record, and reject duplicate or
unknown IDs without requiring a custom map container.

#### 7. Explicit viewport snapshot

Render a host-owned map-local "Use this area" control only when the resource
declares an explicit writable snapshot binding. On activation, the host writes
one normalized bounds snapshot to that binding. Merely panning or zooming does
not persist or disclose viewed areas; initial fit and programmatic camera changes
never write. The first payload contains:

- South and north latitude.
- One longitude interval, or two intervals when the view crosses the
  antimeridian. Intervals are normalized to `[-180, 180]` and ordered west to
  east without using ambiguous `west > east` encoding.

Separate `initialViewport` from snapshot state. Omit renderer-relative zoom from
the first portable payload. Define coordinate precision reduction and a
capability fallback for hosts that cannot report exact bounds. Snapshots remain
surface-local until the user invokes a separate A2UI action that explicitly
includes the declared binding; activation alone does not call a tool or agent.

#### 8. Narrow supplied paths

Render bounded tool-supplied paths. The catalog never calculates or snaps them.
Start with one representation: bound coordinate records with explicit latitude
and longitude field mappings, stable path ID, at least two valid coordinates per
segment, explicit multi-segment gaps, and maximum segment/vertex counts.

The initial supplied-geometry release supports only neutral `path`. Represent
multiple segments as a bounded array of segments, each containing at least two
bound coordinate records; gaps occur only between segments. A `connection`
remains a schematic endpoint relation and must never be labeled or described as
a traversable route.

Defer `route` until traversability claims, direction, supplied distance/duration,
and optional instructions are specified. Defer `track` until observed ordering,
segments/gaps, and timestamps are specified. These future semantics use new
catalog IDs.

Hosts may simplify display geometry without changing source data or stable
identity. Initially exclude altitude, timestamps, snapping, turn instructions,
and per-vertex styling. Define dateline crossing, clipping, direction, endpoint
relationships, and non-map interaction parity.

#### 9. Host-local clustering

Add clustering only as host-local visual decluttering. Cluster membership, IDs,
and boundaries are transient renderer artifacts and never become persistent or
cross-host selection identity. Activating a cluster reveals or zooms locally.
Initially aggregate count only unless exact declarative reducers are standardized.
Define coincident points, maximum zoom, invalid/truncated records, and keyboard
access to contained source features.

#### 10. Qualitative density maps

Treat host-defined heatmaps as qualitative density views, not portable analytical
results. Producers must not make precise comparative claims from rendered
intensity or select a computed hotspot. Define finite nonnegative weights,
missing values, stable domain options, legend semantics, point limits, and an
accessible binned or tabular summary. A future analytical density contract would
need standardized kernel, ground/screen units, normalization, clipping, and
viewport comparability under a separate ID.

#### 11. Evaluate regions separately

Consider a separate Regions catalog or independently negotiated capability.
ISO codes identify entities, not boundary geometry. A geography collection ID
must identify provider/authority, edition/date, resolution, worldview policy,
license, and host-installed asset support. Define retired/alias IDs, subdivisions,
unmatched and one-to-many mappings, disputed territories, no-data values,
classification/domain/legend semantics, and accessible entity/value tables.
Producer-supplied arbitrary polygons remain out of scope until a concrete need
justifies them.

### Delivery order

1. Document the experimental baseline and define its freeze/migration plan.
2. Complete the core contract, trust/privacy, and accessibility/equivalence
   gates with independent conformance fixtures.
3. Publish the layer-oriented design under a new immutable catalog ID.
4. Add semantic point roles, marker hints, and stable shared selection using a
   concrete discrete-place workflow.
5. Add the reference point role, optional point uncertainty, and explicit
   viewport snapshot actions.
6. Add neutral supplied paths; add route or track claims only in later IDs when
   their distinct semantics are justified.
7. Add host-local clustering when real datasets establish useful limits.
8. Add qualitative density maps only after their non-analytical scope and
   accessible fallback are accepted.
9. Evaluate region layers as a separate capability.

Each released capability requires a normative schema, formally schema-defined
interaction state, valid and invalid fixtures, minimum capacities and overflow
behavior, privacy review, no-network behavior, antimeridian cases, refresh and
stale-selection cases, responsive and localized output, keyboard/screen-reader/
touch/high-contrast/reduced-motion coverage, deterministic unsupported fallback,
and evidence from two materially independent renderers. Every protocol change
uses a new immutable catalog ID.

## Alternatives considered

- **General `Visualizations` catalog:** rejected. Maps have distinct data,
  dependency, privacy, attribution, viewport, and interaction semantics and
  should be negotiated independently from Charts or Diagrams.
- **Expose MapLibre directly:** rejected. Renderer-specific styles, expressions,
  sources, and layers are not portable and would weaken the trust boundary.
- **Accept arbitrary GeoJSON immediately:** deferred. It is expressive but
  expands geometry, styling, validation, performance, and accessibility surface
  area before concrete workflows establish portable semantics.
- **Put search, geolocation, and routing in the catalog:** rejected. These are
  permissioned, provider-specific data operations rather than UI primitives.
- **Add every primitive up front:** rejected. A broad speculative contract is
  difficult to stabilize and forces hosts to claim support for semantics they
  may not implement correctly.

## Risks

- Map primitives can become a miscellaneous geospatial API unless the
  presentation-only boundary is enforced during review.
- Basemap requests disclose network and viewed-area information to the tile
  provider; catalogs must work with no third-party network and deployments need
  explicit provider and privacy policy.
- Large datasets can degrade rendering and interaction. Every layer type needs
  documented host limits and graceful aggregation or fallback behavior.
- Marker area, connection width, heat intensity, and choropleth color can mislead.
  Defaults and authoring guidance must favor interpretable encodings.
- Animation can distract or impair accessibility. Motion must be optional,
  pausable when persistent, and disabled under reduced-motion preferences.
- Geographic boundaries and region identifiers carry versioning and
  geopolitical implications that point coordinates do not.
- Shared map/list selection and viewport updates can create feedback loops if
  bindings are not settled and event semantics are not explicit.
- Renderer-specific zoom, bounds, clustering, density, projection, and wrapping
  behavior can leak into observable semantics unless constrained by fixtures.
- Quantitative size, width, intensity, and color encodings require explicit
  treatment of missing, zero, negative, nonfinite, and domain values plus legends.
