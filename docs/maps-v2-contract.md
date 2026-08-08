# Maps v2 Core Contract

This document summarizes the implementation-ready core contract published at
the immutable `maps-v2.0.0` release ID:

`https://github.com/artemis-sh/a2ui-catalogs/blob/maps-v2.0.0/catalogs/maps/v2/catalog.json`

## Boundary

Maps presents supplied geographic records and captures explicit user
interaction. It does not acquire location, search for places, geocode, route,
or accept renderer sources, styles, expressions, markup, scripts, images, or
network URLs. The host owns renderer, basemap, network policy, attribution,
projection, clipping, display simplification, and accessibility presentation.

## Map

A `Map` has an ordered `layers` array. Its array order is the normative
back-to-front order. A map has 1 through 12 layers. Every layer requires a
unique string `layerId` of at most 64 characters and a data-model `data` binding.
An invalid or over-capacity layer has a visible and nonvisual validation
fallback; independently valid layers continue rendering. Hosts must not reorder,
silently omit, truncate, aggregate, or retain a prefix of a valid layer.

The v2 core admits these independent layer types:

- `point`: requires `featureId`, `latitude`, and `longitude` field mappings.
- `connection`: requires `featureId`, `fromLatitude`, `fromLongitude`,
  `toLatitude`, and `toLongitude` field mappings. It is a schematic endpoint
  relation, never a route or a traversable path.

All supplied coordinates are finite WGS84 decimal degrees with explicit latitude
and longitude axes. Latitude is `[-90, 90]`; longitude is `[-180, 180]`.

## Identity and Selection

Each feature has a stable string `featureId`, unique within its layer and at
most 128 characters. Its portable identity is:

```json
{ "layerId": "places", "featureId": "london" }
```

Persistent selection is `null`, one reference, or an ordered unique array of no
more than 100 references, as declared by the layer. It contains no index,
labels, coordinates, values, or copied records. Unknown or duplicate references
are invalid. A data refresh that removes a selected feature clears that reference
without selecting another feature. The map's accessible feature list and any
Basic Catalog list use this identical reference shape.

## Minimum Capacities

Every conforming v2 host supports at least 2,000 valid point records and 500
valid connection records per layer. It supports no fewer than 12 layers. Limits
also apply to labels (512 characters), feature IDs, selections, and updates as
specified by the immutable release document. Overflow rejects the whole layer
with its fallback; producer-supplied aggregation is separate valid input.

## Accessibility and Privacy

Every selectable feature has a keyboard-operable, screen-reader-visible
equivalent with a visible focus indicator and selected state. Motion honors
reduced-motion settings. Feature rendering and the fallback work with a blank,
offline, self-hosted, or privacy-preserving basemap. Writable selections are
confined to the resource's declared data-model bindings. A map never writes a
viewport merely because it pans, fits, or receives a programmatic camera change.

## Release Prerequisites

The immutable schema is published and registered in Parley. Remaining release
evidence includes complete fixtures for invalid input, capacity, stale
selection, antimeridian, no-network, and accessibility, plus demonstration in
one materially independent interactive host.
