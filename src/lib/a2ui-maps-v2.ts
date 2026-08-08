/**
 * Renderer-independent validation for the proposed immutable Maps v2 contract.
 * A host renders only layers that validate as a whole; it must never retain a
 * first-N prefix when a layer exceeds its published capacity.
 */

export const MAPS_V2_MINIMUM_CAPACITY = {
  layers: 12,
  pointsPerLayer: 2_000,
  connectionsPerLayer: 500,
  featureIdLength: 128,
  layerIdLength: 64,
  labelLength: 512,
  multiSelection: 100,
} as const;

export type MapsV2FeatureReference = {
  layerId: string;
  featureId: string;
};

export type MapsV2LayerError = {
  layerId: string | null;
  message: string;
};

const asRecord = (value: unknown): Record<string, unknown> | null =>
  typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;

const fieldKey = (value: unknown): string | null => {
  const key = asRecord(value)?.key;
  return typeof key === "string" && key.length > 0 ? key : null;
};

const path = (value: unknown): string | null => {
  const valuePath = asRecord(value)?.path;
  return typeof valuePath === "string" && valuePath.length > 0
    ? valuePath
    : null;
};

function layerId(value: unknown): string | null {
  return typeof value === "string" &&
    value.length > 0 &&
    value.length <= MAPS_V2_MINIMUM_CAPACITY.layerIdLength
    ? value
    : null;
}

function requiredFields(
  layer: Record<string, unknown>,
  keys: readonly string[],
): boolean {
  return keys.every((key) => fieldKey(layer[key]) !== null);
}

/**
 * Validates only portable layer shape. Record-level data validation belongs to
 * the host's layer parser, because it resolves A2UI bindings against a model.
 */
export function validateMapsV2Layers(value: unknown): MapsV2LayerError[] {
  if (!Array.isArray(value)) {
    return [{ layerId: null, message: "Map layers must be an array." }];
  }
  if (value.length === 0) {
    return [{ layerId: null, message: "Map must contain at least one layer." }];
  }
  if (value.length > MAPS_V2_MINIMUM_CAPACITY.layers) {
    return [
      {
        layerId: null,
        message: `Map exceeds ${MAPS_V2_MINIMUM_CAPACITY.layers} layers.`,
      },
    ];
  }

  const errors: MapsV2LayerError[] = [];
  const ids = new Set<string>();
  for (const valueLayer of value) {
    const layer = asRecord(valueLayer);
    const id = layerId(layer?.layerId);
    if (!layer || !id) {
      errors.push({
        layerId: null,
        message: "Each layer requires a bounded string layerId.",
      });
      continue;
    }
    if (ids.has(id)) {
      errors.push({ layerId: id, message: "Layer IDs must be unique." });
      continue;
    }
    ids.add(id);
    if (!path(layer.data)) {
      errors.push({ layerId: id, message: "Layer data must be a binding." });
      continue;
    }
    if (!fieldKey(layer.featureId)) {
      errors.push({
        layerId: id,
        message: "Each layer requires a stable featureId field.",
      });
    }
    if (layer.type === "point") {
      if (!requiredFields(layer, ["latitude", "longitude"])) {
        errors.push({
          layerId: id,
          message: "Point layers require latitude and longitude fields.",
        });
      }
      continue;
    }
    if (layer.type === "connection") {
      if (
        !requiredFields(layer, [
          "fromLatitude",
          "fromLongitude",
          "toLatitude",
          "toLongitude",
        ])
      ) {
        errors.push({
          layerId: id,
          message: "Connection layers require both endpoint coordinate fields.",
        });
      }
      continue;
    }
    errors.push({
      layerId: id,
      message: "Layer type must be point or connection.",
    });
  }
  return errors;
}

/** Persistent selection contains identities only, never copied source records. */
export function isMapsV2FeatureReference(
  value: unknown,
): value is MapsV2FeatureReference {
  const reference = asRecord(value);
  return (
    layerId(reference?.layerId) !== null &&
    typeof reference?.featureId === "string" &&
    reference.featureId.length > 0 &&
    reference.featureId.length <= MAPS_V2_MINIMUM_CAPACITY.featureIdLength
  );
}

export function validateMapsV2Selection(
  value: unknown,
  knownFeatures: ReadonlySet<string>,
): string | null {
  if (value === null) return null;
  const values = Array.isArray(value) ? value : [value];
  if (values.length > MAPS_V2_MINIMUM_CAPACITY.multiSelection) {
    return `Selection exceeds ${MAPS_V2_MINIMUM_CAPACITY.multiSelection} features.`;
  }
  const seen = new Set<string>();
  for (const reference of values) {
    if (!isMapsV2FeatureReference(reference))
      return "Selection has an invalid feature reference.";
    const key = `${reference.layerId}\u0000${reference.featureId}`;
    if (seen.has(key))
      return "Selection contains duplicate feature references.";
    if (!knownFeatures.has(key))
      return "Selection references an unknown feature.";
    seen.add(key);
  }
  return null;
}
