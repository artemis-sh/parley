import { describe, expect, it } from "vitest";
import {
  isMapsV2FeatureReference,
  MAPS_V2_MINIMUM_CAPACITY,
  validateMapsV2Layers,
  validateMapsV2Selection,
} from "~/lib/a2ui-maps-v2";

const pointLayer = {
  layerId: "places",
  type: "point",
  data: { path: "/places" },
  featureId: { key: "id" },
  latitude: { key: "latitude" },
  longitude: { key: "longitude" },
};

describe("Maps v2 contract", () => {
  it("accepts independent point and connection layers in producer order", () => {
    expect(
      validateMapsV2Layers([
        pointLayer,
        {
          layerId: "connections",
          type: "connection",
          data: { path: "/connections" },
          featureId: { key: "id" },
          fromLatitude: { key: "fromLatitude" },
          fromLongitude: { key: "fromLongitude" },
          toLatitude: { key: "toLatitude" },
          toLongitude: { key: "toLongitude" },
        },
      ]),
    ).toEqual([]);
  });

  it("rejects malformed layers atomically", () => {
    expect(
      validateMapsV2Layers([{ ...pointLayer, featureId: undefined }]),
    ).toEqual([
      {
        layerId: "places",
        message: "Each layer requires a stable featureId field.",
      },
    ]);
    expect(
      validateMapsV2Layers([{ ...pointLayer, layerId: "places" }, pointLayer]),
    ).toEqual([{ layerId: "places", message: "Layer IDs must be unique." }]);
    expect(
      validateMapsV2Layers(
        Array.from(
          { length: MAPS_V2_MINIMUM_CAPACITY.layers + 1 },
          () => pointLayer,
        ),
      ),
    ).toEqual([
      {
        layerId: null,
        message: `Map exceeds ${MAPS_V2_MINIMUM_CAPACITY.layers} layers.`,
      },
    ]);
  });

  it("accepts only stable, unique known feature references as persistent selection", () => {
    const known = new Set([
      "places\u0000london",
      "connections\u0000nyc-london",
    ]);
    expect(
      isMapsV2FeatureReference({ layerId: "places", featureId: "london" }),
    ).toBe(true);
    expect(validateMapsV2Selection(null, known)).toBeNull();
    expect(
      validateMapsV2Selection(
        { layerId: "places", featureId: "london" },
        known,
      ),
    ).toBeNull();
    expect(
      validateMapsV2Selection(
        [
          { layerId: "places", featureId: "london" },
          { layerId: "places", featureId: "london" },
        ],
        known,
      ),
    ).toBe("Selection contains duplicate feature references.");
    expect(
      validateMapsV2Selection(
        { layerId: "places", featureId: "unknown" },
        known,
      ),
    ).toBe("Selection references an unknown feature.");
  });
});
