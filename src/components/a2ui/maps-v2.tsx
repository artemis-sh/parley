/** Native renderer for the immutable, layer-oriented Artemis Maps v2 catalog. */

import { useEffect, useRef } from "react";
import type { ViewProps } from "~/components/a2ui/catalog";
import { useA2uiSurface } from "~/components/a2ui/context";
import {
  MAX_MAP_FLOWS,
  MAX_MAP_POINTS,
  type MapFlow,
  type MapFlowFields,
  type MapPoint,
  type MapPointFields,
  parseMapFlows,
  parseMapPoints,
} from "~/components/a2ui/maps";
import {
  pointerGet,
  resolveDynamic,
  resolvePath,
  resolveString,
} from "~/lib/a2ui";
import {
  isMapsV2FeatureReference,
  type MapsV2FeatureReference,
  validateMapsV2Layers,
  validateMapsV2Selection,
} from "~/lib/a2ui-maps-v2";

const asRecord = (value: unknown): Record<string, unknown> | null =>
  typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;

const fieldKey = (value: unknown): string | null => {
  const key = asRecord(value)?.key;
  return typeof key === "string" && key.length > 0 ? key : null;
};

const stringId = (value: unknown): string | null =>
  typeof value === "string" && value.length > 0 ? value : null;

type Feature =
  | { reference: MapsV2FeatureReference; label: string; point: MapPoint }
  | { reference: MapsV2FeatureReference; label: string; connection: MapFlow };

type ParsedLayer = {
  layerId: string;
  features: Feature[];
  error: string | null;
};

function parseLayer(
  layer: Record<string, unknown>,
  dataModel: unknown,
  base: string,
): ParsedLayer {
  const layerId = stringId(layer.layerId) ?? "unknown";
  const rawData = resolveDynamic(layer.data, dataModel, base);
  const featureId = fieldKey(layer.featureId);
  const label = fieldKey(layer.label);
  if (!Array.isArray(rawData) || !featureId) {
    return {
      layerId,
      features: [],
      error: "Layer data or feature IDs are invalid.",
    };
  }

  if (layer.type === "point") {
    const fields: MapPointFields = {
      latitude: fieldKey(layer.latitude),
      longitude: fieldKey(layer.longitude),
      id: featureId,
      label,
      value: null,
    };
    const points = parseMapPoints(rawData, fields);
    if (points.length > MAX_MAP_POINTS) {
      return {
        layerId,
        features: [],
        error: "Point layer exceeds host capacity.",
      };
    }
    const features = points.flatMap((point) => {
      const id = stringId(point.id);
      return id
        ? [
            {
              reference: { layerId, featureId: id },
              label: point.label || id,
              point,
            },
          ]
        : [];
    });
    if (
      features.length !== points.length ||
      new Set(features.map((feature) => feature.reference.featureId)).size !==
        features.length
    ) {
      return {
        layerId,
        features: [],
        error: "Point feature IDs must be unique strings.",
      };
    }
    return { layerId, features, error: null };
  }

  const fields: MapFlowFields = {
    fromLatitude: fieldKey(layer.fromLatitude),
    fromLongitude: fieldKey(layer.fromLongitude),
    toLatitude: fieldKey(layer.toLatitude),
    toLongitude: fieldKey(layer.toLongitude),
    id: featureId,
    label,
    value: null,
  };
  const connections = parseMapFlows(rawData, fields);
  if (connections.length > MAX_MAP_FLOWS) {
    return {
      layerId,
      features: [],
      error: "Connection layer exceeds host capacity.",
    };
  }
  const features = connections.flatMap((connection) => {
    const id = stringId(connection.id);
    return id
      ? [
          {
            reference: { layerId, featureId: id },
            label: connection.label || id,
            connection,
          },
        ]
      : [];
  });
  if (
    features.length !== connections.length ||
    new Set(features.map((feature) => feature.reference.featureId)).size !==
      features.length
  ) {
    return {
      layerId,
      features: [],
      error: "Connection feature IDs must be unique strings.",
    };
  }
  return { layerId, features, error: null };
}

function selectedReferences(value: unknown): MapsV2FeatureReference[] {
  const values = Array.isArray(value) ? value : value === null ? [] : [value];
  return values.filter(isMapsV2FeatureReference);
}

function featureText(feature: Feature): string {
  if ("point" in feature) {
    return `${feature.label}: ${feature.point.latitude}, ${feature.point.longitude}`;
  }
  return `${feature.label}: ${feature.connection.from.latitude}, ${feature.connection.from.longitude} to ${feature.connection.to.latitude}, ${feature.connection.to.longitude}`;
}

function LayerFallback({
  layerId,
  message,
}: {
  layerId: string;
  message: string;
}) {
  return (
    <p
      role="alert"
      className="rounded border border-dashed px-2 py-1.5 text-destructive text-xs"
    >
      {layerId}: {message}
    </p>
  );
}

export function MapV2View({ component, base }: ViewProps) {
  const { dataModel, setValue, disabled } = useA2uiSurface();
  const title = resolveString(component.title, dataModel, base);
  const description = resolveString(component.description, dataModel, base);
  const layersValue = Array.isArray(component.layers) ? component.layers : [];
  const shapeErrors = validateMapsV2Layers(layersValue);
  const invalidLayerIds = new Set(
    shapeErrors.flatMap((error) => (error.layerId ? [error.layerId] : [])),
  );
  const layers = layersValue.flatMap((value) => {
    const layer = asRecord(value);
    const layerId = stringId(layer?.layerId);
    return layer && layerId && !invalidLayerIds.has(layerId)
      ? [parseLayer(layer, dataModel, base)]
      : [];
  });
  const features = layers.flatMap((layer) => layer.features);
  const knownFeatures = new Set(
    features.map(
      (feature) =>
        `${feature.reference.layerId}\u0000${feature.reference.featureId}`,
    ),
  );
  const selection = asRecord(component.selection);
  const selectionPath =
    typeof selection?.path === "string"
      ? resolvePath(selection.path, base)
      : null;
  const selectionMode = selection?.mode === "multiple" ? "multiple" : "single";
  const selectionValue = selectionPath
    ? pointerGet(dataModel, selectionPath)
    : null;
  const selectionError = validateMapsV2Selection(selectionValue, knownFeatures);
  const selected = selectedReferences(selectionValue);
  const selectedKeys = new Set(
    selected.map(
      (reference) => `${reference.layerId}\u0000${reference.featureId}`,
    ),
  );
  const titleRef = useRef(title);
  titleRef.current = title;

  useEffect(() => {
    if (!selectionPath || !selectionError) return;
    // Invalid producer-originated selection never remains stale after refresh.
    setValue(selectionPath, null);
  }, [selectionError, selectionPath, setValue]);

  const toggle = (reference: MapsV2FeatureReference) => {
    if (disabled || !selectionPath) return;
    const key = `${reference.layerId}\u0000${reference.featureId}`;
    if (selectionMode === "single") {
      setValue(selectionPath, selectedKeys.has(key) ? null : reference);
      return;
    }
    const next = selectedKeys.has(key)
      ? selected.filter(
          (item) =>
            item.layerId !== reference.layerId ||
            item.featureId !== reference.featureId,
        )
      : [...selected, reference];
    setValue(selectionPath, next);
  };

  if (shapeErrors.some((error) => error.layerId === null)) {
    return (
      <LayerFallback
        layerId="Map"
        message={shapeErrors[0]?.message ?? "Invalid map."}
      />
    );
  }

  return (
    <section className="flex w-full flex-col gap-2" aria-label={title || "Map"}>
      {title && <h3 className="font-medium text-sm">{title}</h3>}
      {description && (
        <p className="text-muted-foreground text-xs">{description}</p>
      )}
      <div
        className="rounded-lg border bg-muted/30 p-2"
        role="group"
        aria-label={title || "Map"}
      >
        <p className="text-muted-foreground text-xs">
          Map rendering is host-owned. Use the feature list to explore and
          select map data.
        </p>
        {layers.map((layer) =>
          layer.error ? (
            <LayerFallback
              key={layer.layerId}
              layerId={layer.layerId}
              message={layer.error}
            />
          ) : (
            <div key={layer.layerId} className="mt-2">
              <p className="font-medium text-xs">{layer.layerId}</p>
              <div className="mt-1 flex flex-col gap-1">
                {layer.features.map((feature) => {
                  const key = `${feature.reference.layerId}\u0000${feature.reference.featureId}`;
                  return (
                    <button
                      key={key}
                      type="button"
                      disabled={disabled || !selectionPath}
                      aria-pressed={selectedKeys.has(key)}
                      onClick={() => toggle(feature.reference)}
                      className="rounded px-2 py-1.5 text-left text-xs hover:bg-accent focus-visible:outline-2 focus-visible:outline-ring disabled:cursor-not-allowed disabled:opacity-50"
                    >
                      {featureText(feature)}
                    </button>
                  );
                })}
              </div>
            </div>
          ),
        )}
      </div>
      {shapeErrors.map((error) =>
        error.layerId ? (
          <LayerFallback
            key={`${error.layerId}-${error.message}`}
            layerId={error.layerId}
            message={error.message}
          />
        ) : null,
      )}
      {selectionError ? (
        <LayerFallback layerId="Selection" message={selectionError} />
      ) : null}
    </section>
  );
}
