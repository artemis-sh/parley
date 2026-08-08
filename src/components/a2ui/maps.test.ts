import { describe, expect, it } from "vitest";
import {
  flowWidth,
  formatMapValue,
  hasMapFlowOverflow,
  hasMapPointOverflow,
  MAX_MAP_FLOWS,
  MAX_MAP_POINTS,
  markerDiameter,
  parseMapFlows,
  parseMapPoints,
} from "~/components/a2ui/maps";

const fields = {
  latitude: "lat",
  longitude: "lon",
  id: "id",
  label: "name",
  value: "revenue",
};

describe("parseMapPoints", () => {
  it("reads valid coordinates and optional fields", () => {
    expect(
      parseMapPoints(
        [
          {
            id: "nyc",
            name: "New York",
            lat: 40.7128,
            lon: -74.006,
            revenue: 25,
          },
          { id: 2, name: 42, lat: 51.5072, lon: -0.1276, revenue: 18 },
        ],
        fields,
      ),
    ).toEqual([
      {
        index: 0,
        id: "nyc",
        label: "New York",
        latitude: 40.7128,
        longitude: -74.006,
        value: 25,
      },
      {
        index: 1,
        id: 2,
        label: "42",
        latitude: 51.5072,
        longitude: -0.1276,
        value: 18,
      },
    ]);
  });

  it("drops malformed and out-of-range coordinates", () => {
    expect(
      parseMapPoints(
        [
          { lat: 91, lon: 0 },
          { lat: 0, lon: -181 },
          { lat: "40", lon: -74 },
          { lat: 0, lon: 0, revenue: "unknown" },
        ],
        fields,
      ),
    ).toEqual([{ index: 3, latitude: 0, longitude: 0 }]);
  });

  it("requires an array and coordinate field keys", () => {
    expect(parseMapPoints({}, fields)).toEqual([]);
    expect(parseMapPoints([], { ...fields, latitude: null })).toEqual([]);
  });

  it("detects valid point capacity overflows without counting malformed rows", () => {
    expect(
      hasMapPointOverflow(
        Array.from({ length: MAX_MAP_POINTS + 1 }, (_, index) => ({
          lat: index === 0 ? 91 : 0,
          lon: 0,
        })),
        fields,
      ),
    ).toBe(false);
    expect(
      hasMapPointOverflow(
        Array.from({ length: MAX_MAP_POINTS + 1 }, () => ({ lat: 0, lon: 0 })),
        fields,
      ),
    ).toBe(true);
  });
});

describe("formatMapValue", () => {
  it("formats currencies and falls back for invalid codes", () => {
    const spec = {
      key: "revenue",
      label: "Revenue",
      format: "currency" as const,
      currency: "EUR",
      maximumFractionDigits: 0,
    };
    expect(formatMapValue(1234.5, spec)).toBe(
      new Intl.NumberFormat(undefined, {
        style: "currency",
        currency: "EUR",
        maximumFractionDigits: 0,
      }).format(1234.5),
    );
    expect(formatMapValue(1234.5, { ...spec, currency: "INVALID" })).toBe(
      "1234.5",
    );
  });
});

describe("markerDiameter", () => {
  it("scales bubbles against the largest non-negative value", () => {
    const points = [
      { index: 0, latitude: 0, longitude: 0, value: 0 },
      { index: 1, latitude: 1, longitude: 1, value: 100 },
    ];
    const smallest = points[0] as (typeof points)[number];
    const largest = points[1] as (typeof points)[number];
    expect(markerDiameter(smallest, points, "bubble")).toBe(12);
    expect(markerDiameter(largest, points, "bubble")).toBe(48);
    expect(markerDiameter(largest, points, "marker")).toBe(14);
  });
});

describe("map flows", () => {
  const flowFields = {
    fromLatitude: "fromLat",
    fromLongitude: "fromLon",
    toLatitude: "toLat",
    toLongitude: "toLon",
    id: "id",
    label: "label",
    value: "value",
  };

  it("parses valid routes and drops invalid coordinate pairs", () => {
    expect(
      parseMapFlows(
        [
          {
            id: "a-b",
            label: "A to B",
            fromLat: 40,
            fromLon: -74,
            toLat: 51,
            toLon: 0,
            value: 100,
          },
          { fromLat: 91, fromLon: 0, toLat: 0, toLon: 0 },
        ],
        flowFields,
      ),
    ).toEqual([
      {
        index: 0,
        id: "a-b",
        label: "A to B",
        from: { latitude: 40, longitude: -74 },
        to: { latitude: 51, longitude: 0 },
        value: 100,
      },
    ]);
  });

  it("scales route width by non-negative value", () => {
    const flows = parseMapFlows(
      [
        { fromLat: 0, fromLon: 0, toLat: 1, toLon: 1, value: 0 },
        { fromLat: 0, fromLon: 0, toLat: 2, toLon: 2, value: 100 },
      ],
      flowFields,
    );
    const smallest = flows[0] as (typeof flows)[number];
    const largest = flows[1] as (typeof flows)[number];
    expect(flowWidth(smallest, flows)).toBe(1.5);
    expect(flowWidth(largest, flows)).toBe(6.5);
  });

  it("detects connection capacity overflows", () => {
    expect(
      hasMapFlowOverflow(
        Array.from({ length: MAX_MAP_FLOWS + 1 }, () => ({
          fromLat: 0,
          fromLon: 0,
          toLat: 1,
          toLon: 1,
        })),
        flowFields,
      ),
    ).toBe(true);
  });
});
