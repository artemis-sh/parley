---
title: "Independent critique and revision loop for the Maps Catalog Roadmap"
kind: thread
created: 2026-08-08T16:52:28+00:00
---

# Independent critique and revision loop for the Maps Catalog Roadmap

_Append-only. Use the `append_thread` tool to add turns._

---

**OpenCode** — 2026-08-08T16:52:37+00:00

## Review request

Please critique `.agents/specs/2026-08-08-maps-catalog-roadmap.md` as a proposed portable A2UI custom catalog roadmap.

Focus on:

- Whether the presentation-only boundary is coherent and enforceable.
- Catalog cohesion and whether any primitives belong in separate catalogs.
- Contract portability across web, native mobile, and alternative renderers.
- Security, privacy, accessibility, performance, and versioning omissions.
- Whether implemented points/bubbles/flows are overfitted to Parley or MapLibre.
- Roadmap sequencing and missing concrete acceptance criteria.
- Any semantic problems with location, viewport, routes, clustering, heat maps, or regions.

Return findings ordered by severity, concrete revisions, and explicit points of agreement/disagreement. Do not edit files.

---

**Protocol reviewer (subagent), round 1** — 2026-08-08T16:57:16+00:00

## Findings

### Critical

1. Published catalog documents and exact negotiated IDs must be immutable. Optional additions are still capability changes. A `blob/main` ID is mutable and unsuitable after release. Define the pre-release freeze point, exact-ID negotiation, and version transition behavior.
2. The current `Map` is structurally point-centric: `data`, `latitude`, and `longitude` are required, while flows are subordinate. Flow-only maps cannot render. Do not append paths, heatmaps, and regions to this shape; choose a typed ordered layer model under a new catalog ID or split components.
3. Selection is not portable. Array indices are unstable, IDs are optional, copied payloads become stale, and map/list synchronization is not formally defined. Require stable identity and schema persistent selected state separately from transient events.
4. Endpoint-derived curves are schematic connections/flows, not routes. Reserve route/track/path semantics for supplied geometry and define them separately.
5. Persistent viewport binding is privacy-sensitive and renderer-dependent. Prefer a host-mediated, explicit snapshot action; distinguish initial viewport from controlled/user state and specify antimeridian behavior.

### High

6. Clarify that producers may provide narrowly typed geographic source geometry while hosts own projection, tessellation, clipping, styling, and executable rendering behavior.
7. Baseline accessibility is overstated: pointer-selectable SVG flows plus truncated hidden summaries are not keyboard/AT interaction parity. Require a non-map interactive equivalent and announced selection/focus.
8. Separate marker semantic role from visual glyph hints. Never let producer data claim host-certified current location.
9. Distinguish measurement uncertainty, approximation, and privacy radius; do not call all of them accuracy.
10. Keep clustering host-local; cluster IDs and memberships are not portable persistent selections.
11. Host-defined heatmaps are qualitative decoration, not portable analytics, unless kernel/domain/normalization semantics are tightly specified.
12. Silent first-N truncation is nonportable and unsafe. Define minimum capacities, deterministic overflow, visible/accessible indication, and no silent loss.
13. Convert security/privacy risks into normative conformance requirements, including no-network fallback, scoped writes, precision minimization, and hostile input limits.

### Medium

14. ISO region codes do not identify boundary geometry; region layers may deserve a separate catalog with versioned geography assets and worldview policy.
15. Specify dateline wrapping, projection independence, poles, and world repetition.
16. Start supplied paths with one narrow coordinate representation, stable IDs, explicit segments/gaps, and vertex limits.
17. Define quantitative scale domains, missing/negative values, legends, and cross-host interpretation.
18. Sequence protocol/conformance gates before feature work and require evidence from two materially independent renderers.
19. Replace deliverable lists with acceptance criteria covering schema fixtures, interoperability, capacity, accessibility, motion, no-network fallback, dateline behavior, refresh/stale selection, and privacy.

## Agreements

The presentation-only boundary, separation from search/geocoding/routing/location acquisition, independent Maps negotiation, rejection of renderer-native injection and arbitrary GeoJSON, incremental delivery, reduced-motion handling, and separate treatment of regions are all directionally correct.

## Disagreements

Do not evolve a released exact catalog ID additively; do not describe current flow selection as fully accessible; do not call generated curves routes; do not grow the current point-required shape; do not expose portable cluster selection from host-defined clusters; do not claim host-defined heatmaps are analytical; do not conflate glyph and role; do not treat settled viewport writes as inherently safe; and do not treat one Parley implementation as interoperability evidence.

---

**OpenCode** — 2026-08-08T16:57:28+00:00

## Round 1 response

I agree with the major structural findings and will revise the roadmap accordingly:

- Treat the current schema as explicitly pre-release and mutable only until a freeze. After publication, exact catalog IDs and documents are immutable; every capability addition gets a new ID.
- Add a protocol gate before feature work and require a typed ordered layer model for the next version so points are not mandatory for connections or paths.
- Replace index/copied-object persistent selection with required stable string feature IDs; separate persistent selected identity from transient interaction context.
- Rename generated endpoint curves to schematic `connections`; reserve `path`, `route`, and `track` for supplied geometry with distinct claims.
- Prefer explicit host-mediated viewport snapshots over continuous persistent bindings.
- Separate semantic point role from optional host-controlled glyph hint and prohibit producer claims of verified current location.
- Make overflow visible and deterministic; no silent first-N truncation in the conformance contract.
- Recast host-defined heatmaps as qualitative only unless analytical parameters are standardized.
- Strengthen accessibility requirements to interaction parity through a non-map representation.
- Add normative privacy/no-network, antimeridian, capacity, geometry, quantitative encoding, and acceptance criteria.
- Move regions to a separate evaluation because host-installed geography assets and worldview policy exceed ordinary map rendering.

One nuance: the current `blob/main` ID and in-place additions are acceptable only because both repositories and the catalog are explicitly pre-release with no compatibility promise. The roadmap must state the freeze trigger and migration to immutable release IDs before external adoption; it should not retroactively describe the current draft as stable.

I will revise the spec, then request a second critique focused on unresolved contradictions and whether the revised gates are actionable.

---

**Protocol reviewer (subagent), round 2** — 2026-08-08T16:59:23+00:00

## Prior critical status

- Immutable exact IDs: resolved.
- Point-centric growth: resolved by the future ordered typed-layer model.
- Selection portability: partially resolved; exact identity namespace and state shape remain open.
- Connection/path/route semantics: partially resolved; baseline still says "flow routes."
- Viewport privacy: partially resolved; activation mechanism and payload remain open.

## Remaining high findings

1. Decide feature identity now. Prefer typed references such as `{layerId, featureId}` with stable layer IDs; define null/single/multiple state and transient activation transport.
2. Make viewport snapshot implementable: choose a map-local host control or explicit action linkage, normalized bounds payload, destination, authorization, and no disclosure before activation.
3. Choose one normative overflow result per released ID/layer. Producer aggregate input is not host overflow behavior.
4. Correct baseline "flow routes" to schematic connections.
5. Split renderer-independent protocol fixtures from host behavior tests; a static renderer cannot prove interaction parity.
6. Clarify normative hierarchy: hosts may exceed minimum limits or apply stricter privacy/network policy but may not weaken catalog requirements; define writable binding scope and retention.

## Remaining medium findings

- Decide normative layer order, per-layer validation/failure, fit participation, legend ownership, and no silent omission.
- Fold ordinary reference location into point roles; defer only uncertainty semantics.
- Initial supplied geometry should support neutral paths only; defer route/track kinds.
- Put magnitude encoding semantics and legends in the core gate.
- Identify the exact fallback mechanism rather than assuming a guaranteed resource text fallback.

## Recommendation

Revise again. The architecture is now sound, but feature references, viewport activation, deterministic overflow, and fallback remain prerequisite wire-level decisions.

---

**OpenCode** — 2026-08-08T16:59:34+00:00

## Round 2 response

I agree and will close the remaining roadmap-level decisions as follows:

- Require stable string `layerId` and `featureId`; persistent selection is `null`, one `{layerId, featureId}`, or a bounded ordered array of those references. Map/list synchronization uses the same typed reference.
- Use a host-rendered map-local "Use this area" control. On explicit activation it writes one normalized bounds snapshot to an explicitly declared writable binding; no passive writes, no initial/programmatic camera writes, and no zoom in the first payload.
- Exceeding mandatory per-layer capacity atomically rejects that layer with a visible and nonvisual validation fallback; other independently valid layers remain. No host aggregation or silent truncation.
- Producer layer order is normative z-order; valid layers cannot be omitted; fit participation is explicit per layer; legends are layer-owned specifications composed by the host.
- A Basic Catalog or canonical text summary adjacent to the custom resource is the fallback requirement; avoid claiming A2UI itself guarantees one field.
- Core values define nonnegative magnitude, missing/negative handling, domains, area/width semantics, legends, and nonvisual values.
- Basic reference points are just point roles; uncertainty is deferred. Initial supplied geometry is neutral `path`; route and track semantics are deferred.
- Static rendering proves presentation semantics only; at least one independent interactive harness/host must prove selection and actions.

I will incorporate these and request a final verdict.

---

**Protocol reviewer (subagent), final** — 2026-08-08T17:00:48+00:00

## Final verdict

No substantive roadmap-level blockers remain. Round-2 issues are sufficiently closed:

- Typed layer/feature identity and persistent selection shape are defined.
- Viewport capture has an explicit host-local control, bounded payload, writable binding, and privacy boundary.
- Overflow is deterministic and atomic with no truncation or host aggregation.
- Endpoint geometry is correctly described as schematic connections.
- Interactive conformance evidence is separate from static rendering evidence.
- Host discretion cannot weaken minimum conformance or privacy requirements.
- Layer order, validation isolation, fit participation, omission rules, and legend ownership are decided.
- Reference locations are ordinary points with a `reference` role.
- Initial supplied geometry is neutral `path`; route and track semantics are deferred.
- Quantitative and fallback requirements are explicit.

**Recommendation: Accept as draft.**

Residual questions belong in capability-specific design docs: exact layer/selection/bounds schemas, ID limits, transient event support, writable-subtree enforcement, capacities and performance budgets, quantitative algorithms and legends, validation fallback presentation, dateline test vectors, viewport precision, role sequencing, path segment details, independent harness architecture, and clustering/density/uncertainty/route/track/region contracts.

Minor editorial cleanup remains, including a duplicated `supports:` and a few stale references to route width or supplied reference location.

---

**OpenCode** — 2026-08-08T17:01:16+00:00

## Closure

Accepted the final recommendation. The roadmap remains `draft`, with the protocol-level blockers resolved and capability-specific schema/algorithm details explicitly delegated to later design documents. Applied the final editorial cleanup (`supports:` duplication, reference-point sequencing, and connection-width terminology).

Discussion loop closed with consensus: accept as draft.

---

**OpenCode** — 2026-08-08T17:18:23+00:00

## Owner decision

The project owner explicitly accepted the roadmap on 2026-08-08. Updated `.agents/specs/2026-08-08-maps-catalog-roadmap.md` from `status: draft` to `status: accepted`.

---

**OpenCode** — 2026-08-08T17:32:13+00:00

## Implementation handoff

Implemented the repository-owned first gate work:

- Hardened experimental `maps/v1`: valid-record capacity overflow now renders an explicit fallback rather than silently truncating; connections have a keyboard-operable, visible feature list using the same selection bindings; terminology now calls endpoint curves schematic connections.
- Added `docs/maps-v2-contract.md`, an implementation-ready v2 core contract: ordered independent point/connection layers, atomic per-layer validation, minimum capacities, stable `{layerId, featureId}` identity, bounded identity-only selection, accessibility, no-network/privacy requirements, and release prerequisites.
- Added renderer-independent validator and fixtures in `src/lib/a2ui-maps-v2.ts` and `src/lib/a2ui-maps-v2.test.ts`.

Verification: focused Maps tests, typecheck, Biome, full suite (236 tests), and production build all pass.

The v2 catalog is deliberately not advertised or rendered yet. The accepted roadmap requires an externally published immutable schema/catalog ID and evidence from a materially independent interactive host before Parley may negotiate it. Those release prerequisites are outside this repository; inventing a local v2 ID or claiming solo-host conformance would contradict the roadmap.

---

**OpenCode** — 2026-08-08T17:52:43+00:00

## Maps v2 publication and Parley integration

Published and merged the immutable Maps v2 contract in `artemis-sh/a2ui-catalogs` through PR #2, then pushed annotated tag `maps-v2.0.0`. The pinned catalog ID is `https://github.com/artemis-sh/a2ui-catalogs/blob/maps-v2.0.0/catalogs/maps/v2/catalog.json`.

Parley now registers that exact ID separately from experimental v1, has a v2 adapter that validates ordered independent point/connection layers, enforces stable string feature IDs and identity-only selection, rejects invalid layers independently, and supplies keyboard-operable accessible feature interaction. The demo emits v2 point and connection layers with one `/selectedFeature` `{layerId, featureId}` binding. Full Parley suite (237 tests), typecheck, Biome, and production build pass.

Remaining conformance evidence is an independently implemented interactive host. Browser QA could not run in this environment because the installed `agent-browser` CLI reports its skills directory is missing; no browser result is claimed.
