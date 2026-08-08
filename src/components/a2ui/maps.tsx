/** Native renderer for the trusted Artemis Maps v1 A2UI catalog. */

import "maplibre-gl/dist/maplibre-gl.css";

import type { Map as MapLibreMap, StyleSpecification } from "maplibre-gl";
import * as maplibregl from "maplibre-gl";
import { useEffect, useRef } from "react";
import type { ViewProps } from "~/components/a2ui/catalog";
import { useA2uiSurface } from "~/components/a2ui/context";
import {
  pointerGet,
  resolveDynamic,
  resolvePath,
  resolveString,
  toDisplayString,
} from "~/lib/a2ui";

const MAP_COLOR_TOKENS = new Set([
  "chart-1",
  "chart-2",
  "chart-3",
  "chart-4",
  "chart-5",
]);

export const MAX_MAP_POINTS = 2_000;
export const MAX_MAP_FLOWS = 500;

const MAP_STYLE: StyleSpecification = {
  version: 8,
  sources: {
    openstreetmap: {
      type: "raster",
      tiles: ["https://tile.openstreetmap.org/{z}/{x}/{y}.png"],
      tileSize: 256,
      attribution:
        '<a href="https://www.openstreetmap.org/copyright">© OpenStreetMap contributors</a>',
    },
  },
  layers: [{ id: "openstreetmap", type: "raster", source: "openstreetmap" }],
};

const asRecord = (value: unknown): Record<string, unknown> | null =>
  typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;

const finiteNumber = (value: unknown): number | null =>
  typeof value === "number" && Number.isFinite(value) ? value : null;

function validCoordinates(latitude: unknown, longitude: unknown): boolean {
  const lat = finiteNumber(latitude);
  const lon = finiteNumber(longitude);
  return (
    lat !== null &&
    lon !== null &&
    lat >= -90 &&
    lat <= 90 &&
    lon >= -180 &&
    lon <= 180
  );
}

function fieldKey(value: unknown): string | null {
  const key = asRecord(value)?.key;
  return typeof key === "string" && key.length > 0 ? key : null;
}

export interface MapPoint {
  index: number;
  id?: string | number;
  latitude: number;
  longitude: number;
  label?: string;
  value?: number;
}

export interface MapFlow {
  index: number;
  id?: string | number;
  label?: string;
  from: { latitude: number; longitude: number };
  to: { latitude: number; longitude: number };
  value?: number;
}

export interface MapPointFields {
  latitude: string | null;
  longitude: string | null;
  id: string | null;
  label: string | null;
  value: string | null;
}

export interface MapFlowFields {
  fromLatitude: string | null;
  fromLongitude: string | null;
  toLatitude: string | null;
  toLongitude: string | null;
  id: string | null;
  label: string | null;
  value: string | null;
}

/** A capacity overflow rejects the layer instead of rendering an arbitrary prefix. */
export function hasMapPointOverflow(
  value: unknown,
  fields: MapPointFields,
): boolean {
  if (!Array.isArray(value) || !fields.latitude || !fields.longitude)
    return false;
  let count = 0;
  for (const item of value) {
    const row = asRecord(item);
    if (row && validCoordinates(row[fields.latitude], row[fields.longitude])) {
      count++;
      if (count > MAX_MAP_POINTS) return true;
    }
  }
  return false;
}

/** A capacity overflow rejects the connection collection rather than truncating it. */
export function hasMapFlowOverflow(
  value: unknown,
  fields: MapFlowFields,
): boolean {
  if (
    !Array.isArray(value) ||
    !fields.fromLatitude ||
    !fields.fromLongitude ||
    !fields.toLatitude ||
    !fields.toLongitude
  ) {
    return false;
  }
  let count = 0;
  for (const item of value) {
    const row = asRecord(item);
    if (
      row &&
      validCoordinates(row[fields.fromLatitude], row[fields.fromLongitude]) &&
      validCoordinates(row[fields.toLatitude], row[fields.toLongitude])
    ) {
      count++;
      if (count > MAX_MAP_FLOWS) return true;
    }
  }
  return false;
}

export function parseMapPoints(
  value: unknown,
  fields: MapPointFields,
): MapPoint[] {
  if (!Array.isArray(value) || !fields.latitude || !fields.longitude) return [];
  const points: MapPoint[] = [];
  for (
    let index = 0;
    index < value.length && points.length < MAX_MAP_POINTS;
    index++
  ) {
    const row = asRecord(value[index]);
    if (!row) continue;
    const latitude = finiteNumber(row[fields.latitude]);
    const longitude = finiteNumber(row[fields.longitude]);
    if (
      latitude === null ||
      longitude === null ||
      !validCoordinates(latitude, longitude)
    ) {
      continue;
    }
    const rawId = fields.id ? row[fields.id] : undefined;
    const rawLabel = fields.label ? row[fields.label] : undefined;
    const numericValue = fields.value ? finiteNumber(row[fields.value]) : null;
    points.push({
      index,
      ...(typeof rawId === "string" || typeof rawId === "number"
        ? { id: rawId }
        : {}),
      latitude,
      longitude,
      ...(rawLabel === null || rawLabel === undefined
        ? {}
        : { label: toDisplayString(rawLabel) }),
      ...(numericValue === null ? {} : { value: numericValue }),
    });
  }
  return points;
}

export function parseMapFlows(
  value: unknown,
  fields: MapFlowFields,
): MapFlow[] {
  if (
    !Array.isArray(value) ||
    !fields.fromLatitude ||
    !fields.fromLongitude ||
    !fields.toLatitude ||
    !fields.toLongitude
  ) {
    return [];
  }
  const flows: MapFlow[] = [];
  for (
    let index = 0;
    index < value.length && flows.length < MAX_MAP_FLOWS;
    index++
  ) {
    const row = asRecord(value[index]);
    if (!row) continue;
    const fromLatitude = finiteNumber(row[fields.fromLatitude]);
    const fromLongitude = finiteNumber(row[fields.fromLongitude]);
    const toLatitude = finiteNumber(row[fields.toLatitude]);
    const toLongitude = finiteNumber(row[fields.toLongitude]);
    if (
      fromLatitude === null ||
      fromLongitude === null ||
      toLatitude === null ||
      toLongitude === null ||
      !validCoordinates(fromLatitude, fromLongitude) ||
      !validCoordinates(toLatitude, toLongitude)
    ) {
      continue;
    }
    const rawId = fields.id ? row[fields.id] : undefined;
    const rawLabel = fields.label ? row[fields.label] : undefined;
    const numericValue = fields.value ? finiteNumber(row[fields.value]) : null;
    flows.push({
      index,
      ...(typeof rawId === "string" || typeof rawId === "number"
        ? { id: rawId }
        : {}),
      ...(rawLabel === null || rawLabel === undefined
        ? {}
        : { label: toDisplayString(rawLabel) }),
      from: { latitude: fromLatitude, longitude: fromLongitude },
      to: { latitude: toLatitude, longitude: toLongitude },
      ...(numericValue === null ? {} : { value: numericValue }),
    });
  }
  return flows;
}

interface ValueSpec {
  key: string | null;
  label: string;
  format: "number" | "currency" | "percent";
  currency: string;
  maximumFractionDigits: number;
}

function parseValueSpec(value: unknown): ValueSpec {
  const record = asRecord(value);
  const digits = finiteNumber(record?.maximumFractionDigits);
  return {
    key: fieldKey(record),
    label: typeof record?.label === "string" ? record.label : "Value",
    format:
      record?.format === "currency" || record?.format === "percent"
        ? record.format
        : "number",
    currency:
      typeof record?.currency === "string" && record.currency.length > 0
        ? record.currency
        : "USD",
    maximumFractionDigits:
      digits === null ? 2 : Math.min(6, Math.max(0, Math.floor(digits))),
  };
}

export function formatMapValue(value: number, spec: ValueSpec): string {
  try {
    return new Intl.NumberFormat(undefined, {
      style:
        spec.format === "currency"
          ? "currency"
          : spec.format === "percent"
            ? "percent"
            : "decimal",
      currency: spec.format === "currency" ? spec.currency : undefined,
      maximumFractionDigits: spec.maximumFractionDigits,
    }).format(value);
  } catch {
    return String(value);
  }
}

function mapColor(token: string, element: HTMLElement): string {
  const safe = MAP_COLOR_TOKENS.has(token) ? token : "chart-1";
  return (
    getComputedStyle(element).getPropertyValue(`--${safe}`).trim() || "#2563eb"
  );
}

export function markerDiameter(
  point: MapPoint,
  points: MapPoint[],
  variant: "marker" | "bubble",
): number {
  if (variant === "marker") return 14;
  const maximum = Math.max(
    0,
    ...points.map((point) => Math.max(0, point.value ?? 0)),
  );
  if (maximum === 0) return 14;
  return 12 + Math.sqrt(Math.max(0, point.value ?? 0) / maximum) * 36;
}

export function flowWidth(flow: MapFlow, flows: MapFlow[]): number {
  const maximum = Math.max(
    0,
    ...flows.map((entry) => Math.max(0, entry.value ?? 0)),
  );
  if (maximum === 0) return 2;
  return 1.5 + Math.sqrt(Math.max(0, flow.value ?? 0) / maximum) * 5;
}

function flowPath(map: MapLibreMap, flow: MapFlow): string {
  const from = map.project([flow.from.longitude, flow.from.latitude]);
  const to = map.project([flow.to.longitude, flow.to.latitude]);
  const dx = to.x - from.x;
  const dy = to.y - from.y;
  const distance = Math.hypot(dx, dy);
  const bend = Math.min(120, Math.max(24, distance * 0.2));
  const midpointX = (from.x + to.x) / 2;
  const midpointY = (from.y + to.y) / 2;
  const controlX =
    distance === 0 ? midpointX : midpointX - (dy / distance) * bend;
  const controlY =
    distance === 0 ? midpointY : midpointY + (dx / distance) * bend;
  return `M ${from.x} ${from.y} Q ${controlX} ${controlY} ${to.x} ${to.y}`;
}

function fitPoints(map: MapLibreMap, points: MapPoint[]) {
  if (points.length === 1) {
    const point = points[0] as MapPoint;
    map.jumpTo({ center: [point.longitude, point.latitude], zoom: 8 });
    return;
  }
  const bounds = new maplibregl.LngLatBounds();
  for (const point of points) bounds.extend([point.longitude, point.latitude]);
  map.fitBounds(bounds, { padding: 36, maxZoom: 12, duration: 0 });
}

function MapPlaceholder({ message }: { message: string }) {
  return (
    <div
      role="alert"
      className="flex h-60 w-full items-center justify-center rounded-lg border border-dashed text-muted-foreground text-xs"
    >
      {message}
    </div>
  );
}

export function MapView({ component, base }: ViewProps) {
  const { dataModel, setValue, disabled } = useA2uiSurface();
  const containerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<MapLibreMap | null>(null);
  const markerElementsRef = useRef(new Map<number, HTMLElement>());
  const flowElementsRef = useRef(new Map<number, SVGPathElement>());
  const title = resolveString(component.title, dataModel, base);
  const description = resolveString(component.description, dataModel, base);
  const latitudeKey = fieldKey(component.latitude);
  const longitudeKey = fieldKey(component.longitude);
  const idKey = fieldKey(component.idField);
  const labelKey = fieldKey(component.labelField);
  const valueSpec = parseValueSpec(component.value);
  const valueSpecRef = useRef(valueSpec);
  valueSpecRef.current = valueSpec;
  const rawData = resolveDynamic(component.data, dataModel, base);
  const pointFields = {
    latitude: latitudeKey,
    longitude: longitudeKey,
    id: idKey,
    label: labelKey,
    value: valueSpec.key,
  };
  const points = parseMapPoints(rawData, pointFields);
  const pointsOverflow = hasMapPointOverflow(rawData, pointFields);
  const flowsSpec = asRecord(component.flows);
  const flowValueSpec = parseValueSpec(flowsSpec?.value);
  const rawFlows = resolveDynamic(flowsSpec?.data, dataModel, base);
  const flowFields = {
    fromLatitude: fieldKey(flowsSpec?.fromLatitude),
    fromLongitude: fieldKey(flowsSpec?.fromLongitude),
    toLatitude: fieldKey(flowsSpec?.toLatitude),
    toLongitude: fieldKey(flowsSpec?.toLongitude),
    id: fieldKey(flowsSpec?.idField),
    label: fieldKey(flowsSpec?.labelField),
    value: flowValueSpec.key,
  };
  const parsedFlows = parseMapFlows(rawFlows, flowFields);
  const flowsOverflow = hasMapFlowOverflow(rawFlows, flowFields);
  const flows = flowsOverflow ? [] : parsedFlows;
  const flowColor = toDisplayString(flowsSpec?.color) || "chart-1";
  const flowsAnimated = flowsSpec?.animated === true;
  const flowSelection = asRecord(flowsSpec?.selection);
  const flowSelectionPath =
    typeof flowSelection?.path === "string"
      ? resolvePath(flowSelection.path, base)
      : null;
  const selectedFlow = flowSelectionPath
    ? asRecord(pointerGet(dataModel, flowSelectionPath))
    : null;
  const selectedFlowIndex = finiteNumber(selectedFlow?.index);
  const variant =
    toDisplayString(component.variant) === "bubble" ? "bubble" : "marker";
  const color = toDisplayString(component.color) || "chart-1";
  const height = Math.min(
    480,
    Math.max(240, finiteNumber(component.height) ?? 320),
  );
  const viewport = asRecord(component.viewport);
  const viewportLatitude = finiteNumber(viewport?.latitude);
  const viewportLongitude = finiteNumber(viewport?.longitude);
  const viewportZoom = finiteNumber(viewport?.zoom);
  const selection = asRecord(component.selection);
  const selectionPath =
    typeof selection?.path === "string"
      ? resolvePath(selection.path, base)
      : null;
  const selected = selectionPath
    ? asRecord(pointerGet(dataModel, selectionPath))
    : null;
  const selectedIndex = finiteNumber(selected?.index);
  const hasPoints = points.length > 0 && !pointsOverflow;
  const pointsRef = useRef(points);
  pointsRef.current = points;
  const flowsRef = useRef(flows);
  flowsRef.current = flows;
  const selectedIndexRef = useRef(selectedIndex);
  selectedIndexRef.current = selectedIndex;
  const disabledRef = useRef(disabled);
  disabledRef.current = disabled;
  const selectionPathRef = useRef(selectionPath);
  selectionPathRef.current = selectionPath;
  const flowSelectionPathRef = useRef(flowSelectionPath);
  flowSelectionPathRef.current = flowSelectionPath;
  const flowValueSpecRef = useRef(flowValueSpec);
  flowValueSpecRef.current = flowValueSpec;

  useEffect(() => {
    const container = containerRef.current;
    if (!container || !hasPoints) return;
    const map = new maplibregl.Map({
      container,
      style: MAP_STYLE,
      center: [viewportLongitude ?? 0, viewportLatitude ?? 0],
      zoom: viewportZoom ?? 1,
      attributionControl: false,
    });
    mapRef.current = map;
    map.addControl(
      new maplibregl.AttributionControl({ compact: true }),
      "bottom-right",
    );
    map.addControl(
      new maplibregl.NavigationControl({ showCompass: false }),
      "top-right",
    );
    map.on("load", () => {
      const containerColor = mapColor(color, container);
      const routeColor = mapColor(flowColor, container);
      const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
      svg.setAttribute("aria-hidden", "true");
      Object.assign(svg.style, {
        position: "absolute",
        inset: "0",
        width: "100%",
        height: "100%",
        pointerEvents: "none",
        zIndex: "1",
      });
      container.append(svg);
      const animations: Animation[] = [];
      const updateFlows = () => {
        for (const flow of flowsRef.current) {
          flowElementsRef.current
            .get(flow.index)
            ?.setAttribute("d", flowPath(map, flow));
        }
      };
      for (const flow of flowsRef.current) {
        const route = document.createElementNS(
          "http://www.w3.org/2000/svg",
          "path",
        );
        route.setAttribute("d", flowPath(map, flow));
        route.setAttribute("fill", "none");
        route.setAttribute("stroke", routeColor);
        route.setAttribute("stroke-linecap", "round");
        route.setAttribute(
          "stroke-width",
          String(flowWidth(flow, flowsRef.current)),
        );
        route.setAttribute("opacity", "0.72");
        route.style.pointerEvents = "stroke";
        route.style.cursor = disabledRef.current ? "default" : "pointer";
        if (flow.label) {
          const title = document.createElementNS(
            "http://www.w3.org/2000/svg",
            "title",
          );
          title.textContent =
            flow.value === undefined
              ? flow.label
              : `${flow.label}: ${formatMapValue(flow.value, flowValueSpecRef.current)}`;
          route.append(title);
        }
        route.addEventListener("click", () => {
          if (disabledRef.current || !flowSelectionPathRef.current) return;
          setValue(flowSelectionPathRef.current, {
            mode: "flow",
            index: flow.index,
            ...(flow.id === undefined ? {} : { id: flow.id }),
            ...(flow.label === undefined ? {} : { label: flow.label }),
            from: flow.from,
            to: flow.to,
            ...(flow.value === undefined ? {} : { value: flow.value }),
          });
        });
        if (
          flowsAnimated &&
          !window.matchMedia("(prefers-reduced-motion: reduce)").matches
        ) {
          route.setAttribute("stroke-dasharray", "2 12");
          animations.push(
            route.animate(
              [{ strokeDashoffset: "0" }, { strokeDashoffset: "-28" }],
              { duration: 1_400, iterations: Number.POSITIVE_INFINITY },
            ),
          );
        }
        flowElementsRef.current.set(flow.index, route);
        svg.append(route);
      }
      map.on("move", updateFlows);
      map.on("resize", updateFlows);
      for (const point of pointsRef.current) {
        const diameter = markerDiameter(point, pointsRef.current, variant);
        const marker = document.createElement("button");
        marker.type = "button";
        marker.title = point.label || `Point ${point.index + 1}`;
        marker.setAttribute("aria-label", marker.title);
        marker.style.width = `${diameter}px`;
        marker.style.height = `${diameter}px`;
        marker.style.borderRadius = "9999px";
        marker.style.border =
          point.index === selectedIndexRef.current
            ? "3px solid white"
            : "2px solid white";
        marker.style.background = containerColor;
        marker.style.boxShadow = "0 1px 4px rgb(0 0 0 / 35%)";
        marker.style.cursor = disabledRef.current ? "default" : "pointer";

        const popupContent = document.createElement("div");
        // MapLibre's default popup panel is white, including in Parley's dark theme.
        popupContent.style.color = "#111827";
        popupContent.style.fontSize = "12px";
        popupContent.style.lineHeight = "1.4";
        if (point.label) {
          const label = document.createElement("strong");
          label.textContent = point.label;
          popupContent.append(label);
        }
        if (point.value !== undefined) {
          const value = document.createElement("div");
          const currentValueSpec = valueSpecRef.current;
          value.textContent = `${currentValueSpec.label}: ${formatMapValue(point.value, currentValueSpec)}`;
          popupContent.append(value);
        }
        const popup = new maplibregl.Popup({
          closeButton: false,
          offset: 12,
        }).setDOMContent(popupContent);
        marker.addEventListener("mouseenter", () =>
          popup.setLngLat([point.longitude, point.latitude]).addTo(map),
        );
        marker.addEventListener("mouseleave", () => popup.remove());
        marker.addEventListener("click", () => {
          if (disabledRef.current || !selectionPathRef.current) return;
          setValue(selectionPathRef.current, {
            mode: "point",
            index: point.index,
            ...(point.id === undefined ? {} : { id: point.id }),
            latitude: point.latitude,
            longitude: point.longitude,
            ...(point.label === undefined ? {} : { label: point.label }),
            ...(point.value === undefined ? {} : { value: point.value }),
          });
        });
        markerElementsRef.current.set(point.index, marker);
        new maplibregl.Marker({ element: marker, anchor: "center" })
          .setLngLat([point.longitude, point.latitude])
          .addTo(map);
      }
      if (
        viewportLatitude === null ||
        viewportLongitude === null ||
        viewportZoom === null
      ) {
        const endpoints = flowsRef.current.flatMap((flow, index) => [
          {
            index: pointsRef.current.length + index * 2,
            latitude: flow.from.latitude,
            longitude: flow.from.longitude,
          },
          {
            index: pointsRef.current.length + index * 2 + 1,
            latitude: flow.to.latitude,
            longitude: flow.to.longitude,
          },
        ]);
        fitPoints(map, [...pointsRef.current, ...endpoints]);
      }
      map.once("remove", () => {
        for (const animation of animations) animation.cancel();
      });
    });
    return () => {
      mapRef.current = null;
      markerElementsRef.current.clear();
      flowElementsRef.current.clear();
      map.remove();
    };
  }, [
    color,
    flowColor,
    variant,
    flowsAnimated,
    setValue,
    hasPoints,
    viewportLatitude,
    viewportLongitude,
    viewportZoom,
  ]);

  useEffect(() => {
    for (const [index, marker] of markerElementsRef.current) {
      marker.style.border =
        index === selectedIndex ? "3px solid white" : "2px solid white";
    }
  }, [selectedIndex]);

  useEffect(() => {
    for (const [index, flow] of flowElementsRef.current) {
      flow.setAttribute("opacity", index === selectedFlowIndex ? "1" : "0.72");
      flow.setAttribute(
        "stroke-width",
        String(
          flowWidth(
            flows.find((entry) => entry.index === index) ?? {
              index,
              from: { latitude: 0, longitude: 0 },
              to: { latitude: 0, longitude: 0 },
            },
            flows,
          ) + (index === selectedFlowIndex ? 2 : 0),
        ),
      );
    }
  }, [flows, selectedFlowIndex]);

  if (pointsOverflow) {
    return (
      <MapPlaceholder
        message={`Map has more than ${MAX_MAP_POINTS.toLocaleString()} valid points`}
      />
    );
  }

  if (!latitudeKey || !longitudeKey || points.length === 0) {
    return <MapPlaceholder message="No valid map points" />;
  }

  return (
    <div className="flex w-full flex-col gap-2">
      {title && <div className="font-medium text-sm">{title}</div>}
      <div
        ref={containerRef}
        style={{ height }}
        className="w-full overflow-hidden rounded-lg border bg-muted"
        role="group"
        aria-label={title || "Map"}
        aria-description={description || undefined}
      />
      {flowsOverflow ? (
        <p role="alert" className="text-destructive text-xs">
          Connections weren't rendered because the map has more than{" "}
          {MAX_MAP_FLOWS.toLocaleString()} valid connections.
        </p>
      ) : null}
      <details className="text-xs">
        <summary className="cursor-pointer text-muted-foreground">
          Map features
        </summary>
        <div className="mt-2 max-h-52 overflow-auto rounded-md border p-1">
          <div className="flex flex-col gap-1">
            {points.map((point) => (
              <button
                key={point.index}
                type="button"
                disabled={disabled || !selectionPath}
                aria-pressed={point.index === selectedIndex}
                onClick={() => {
                  if (!selectionPath) return;
                  setValue(selectionPath, {
                    mode: "point",
                    index: point.index,
                    ...(point.id === undefined ? {} : { id: point.id }),
                    latitude: point.latitude,
                    longitude: point.longitude,
                    ...(point.label === undefined
                      ? {}
                      : { label: point.label }),
                    ...(point.value === undefined
                      ? {}
                      : { value: point.value }),
                  });
                }}
                className="rounded px-2 py-1.5 text-left hover:bg-accent focus-visible:outline-2 focus-visible:outline-ring disabled:cursor-not-allowed disabled:opacity-50"
              >
                {point.label || `Point ${point.index + 1}`}: {point.latitude},{" "}
                {point.longitude}
                {point.value === undefined
                  ? ""
                  : `; ${valueSpec.label}: ${formatMapValue(point.value, valueSpec)}`}
              </button>
            ))}
            {flows.map((flow) => (
              <button
                key={`flow-${flow.index}`}
                type="button"
                disabled={disabled || !flowSelectionPath}
                aria-pressed={flow.index === selectedFlowIndex}
                onClick={() => {
                  if (!flowSelectionPath) return;
                  setValue(flowSelectionPath, {
                    mode: "flow",
                    index: flow.index,
                    ...(flow.id === undefined ? {} : { id: flow.id }),
                    ...(flow.label === undefined ? {} : { label: flow.label }),
                    from: flow.from,
                    to: flow.to,
                    ...(flow.value === undefined ? {} : { value: flow.value }),
                  });
                }}
                className="rounded px-2 py-1.5 text-left hover:bg-accent focus-visible:outline-2 focus-visible:outline-ring disabled:cursor-not-allowed disabled:opacity-50"
              >
                {flow.label || `Connection ${flow.index + 1}`}:{" "}
                {flow.from.latitude}, {flow.from.longitude} to{" "}
                {flow.to.latitude}, {flow.to.longitude}
                {flow.value === undefined
                  ? ""
                  : `; ${flowValueSpec.label}: ${formatMapValue(flow.value, flowValueSpec)}`}
              </button>
            ))}
          </div>
        </div>
      </details>
      {component.dataTable === true ? (
        <details className="text-xs">
          <summary className="cursor-pointer text-muted-foreground">
            View map data
          </summary>
          <div className="mt-2 max-h-52 overflow-auto rounded-md border">
            <table className="w-full border-collapse text-left">
              <thead className="bg-muted/50 text-muted-foreground">
                <tr>
                  {labelKey ? (
                    <th className="px-2 py-1.5 font-medium">Label</th>
                  ) : null}
                  <th className="px-2 py-1.5 font-medium">Latitude</th>
                  <th className="px-2 py-1.5 font-medium">Longitude</th>
                  {valueSpec.key ? (
                    <th className="px-2 py-1.5 font-medium">
                      {valueSpec.label}
                    </th>
                  ) : null}
                </tr>
              </thead>
              <tbody>
                {points.map((point) => (
                  <tr key={point.index} className="border-t">
                    {labelKey ? (
                      <td className="px-2 py-1.5">{point.label}</td>
                    ) : null}
                    <td className="px-2 py-1.5 tabular-nums">
                      {point.latitude}
                    </td>
                    <td className="px-2 py-1.5 tabular-nums">
                      {point.longitude}
                    </td>
                    {valueSpec.key ? (
                      <td className="px-2 py-1.5 tabular-nums">
                        {point.value === undefined
                          ? ""
                          : formatMapValue(point.value, valueSpec)}
                      </td>
                    ) : null}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </details>
      ) : null}
    </div>
  );
}
