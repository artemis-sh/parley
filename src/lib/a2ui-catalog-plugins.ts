/**
 * Client-safe metadata for trusted A2UI catalog plugins installed in this
 * build. Renderer registrations live under ~/components/a2ui; catalog IDs
 * never trigger downloads or dynamic imports on their own.
 */

export interface A2uiCatalogPluginManifest {
  /** Stable settings key. One plugin may provide multiple catalog versions. */
  key: string;
  name: string;
  description: string;
  catalogIds: readonly string[];
  /**
   * Enabled on fresh installs only. Once a deployment has persisted its
   * enabled keys, a later build shipping a new `defaultEnabled: true` plugin
   * stays disabled there until an admin turns it on (fail closed).
   */
  defaultEnabled: boolean;
  builtin: boolean;
}

export const A2UI_BASIC_CATALOG_IDS: readonly string[] = [
  "https://a2ui.org/specification/v0_9/catalogs/basic/catalog.json",
  "https://a2ui.org/specification/v0_9_1/catalogs/basic/catalog.json",
];

export const A2UI_CHARTS_CATALOG_ID =
  "https://github.com/artemis-sh/a2ui-catalogs/blob/main/catalogs/charts/v1/catalog.json";

export const A2UI_MAPS_CATALOG_ID =
  "https://github.com/artemis-sh/a2ui-catalogs/blob/main/catalogs/maps/v1/catalog.json";

/** Immutable Maps v2 release contract. */
export const A2UI_MAPS_V2_CATALOG_ID =
  "https://github.com/artemis-sh/a2ui-catalogs/blob/maps-v2.0.0/catalogs/maps/v2/catalog.json";

export const A2UI_CATALOG_PLUGINS: readonly A2uiCatalogPluginManifest[] = [
  {
    key: "basic",
    name: "A2UI Basic Catalog",
    description: "Portable layouts, forms, lists, media, and actions.",
    catalogIds: A2UI_BASIC_CATALOG_IDS,
    defaultEnabled: true,
    builtin: true,
  },
  {
    key: "charts",
    name: "A2UI Charts",
    description: "Native charts and headline statistics.",
    catalogIds: [A2UI_CHARTS_CATALOG_ID],
    defaultEnabled: true,
    builtin: true,
  },
  {
    key: "maps",
    name: "A2UI Maps",
    description: "Native maps with experimental v1 and immutable v2 layers.",
    catalogIds: [A2UI_MAPS_CATALOG_ID, A2UI_MAPS_V2_CATALOG_ID],
    defaultEnabled: true,
    builtin: true,
  },
];

function assertValidPluginManifests(
  plugins: readonly A2uiCatalogPluginManifest[],
): void {
  const keys = new Set<string>();
  const catalogIds = new Set<string>();
  for (const plugin of plugins) {
    if (keys.has(plugin.key)) {
      throw new Error(`Duplicate A2UI catalog plugin key: ${plugin.key}`);
    }
    keys.add(plugin.key);
    for (const catalogId of plugin.catalogIds) {
      if (catalogIds.has(catalogId)) {
        throw new Error(`Duplicate A2UI catalog ID: ${catalogId}`);
      }
      catalogIds.add(catalogId);
    }
  }
}

assertValidPluginManifests(A2UI_CATALOG_PLUGINS);

const installedKeys = new Set(A2UI_CATALOG_PLUGINS.map((plugin) => plugin.key));

export const A2UI_DEFAULT_ENABLED_PLUGIN_KEYS: readonly string[] =
  A2UI_CATALOG_PLUGINS.filter((plugin) => plugin.defaultEnabled).map(
    (plugin) => plugin.key,
  );

/** Installed catalog IDs, independent of deployment enablement. */
export const A2UI_INSTALLED_CATALOG_IDS: readonly string[] =
  A2UI_CATALOG_PLUGINS.flatMap((plugin) => plugin.catalogIds);

/** Drops duplicate, malformed, and no-longer-installed plugin keys. */
export function normalizeA2uiCatalogPluginKeys(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return [
    ...new Set(
      value.filter(
        (key): key is string =>
          typeof key === "string" && installedKeys.has(key),
      ),
    ),
  ];
}

/** Derives the catalog IDs the deployment currently accepts and renders. */
export function catalogIdsForPluginKeys(keys: readonly string[]): string[] {
  const enabled = new Set(keys);
  return A2UI_CATALOG_PLUGINS.filter((plugin) =>
    enabled.has(plugin.key),
  ).flatMap((plugin) => plugin.catalogIds);
}
