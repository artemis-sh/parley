/** biome-ignore-all lint/suspicious/noTemplateCurlyInString: A2UI's
 * formatString interpolation syntax uses literal `${...}` in plain strings. */

import { describe, expect, it } from "vitest";
import {
  A2UI_CHARTS_CATALOG_ID,
  A2UI_INSTALLED_CATALOG_IDS,
  A2UI_MAPS_CATALOG_ID,
  A2UI_MAPS_V2_CATALOG_ID,
  A2UI_MIME_TYPE,
  type A2uiCallSurfaces,
  type A2uiMessage,
  type A2uiOutputRef,
  a2uiPresentationOutput,
  applyA2uiDataOps,
  buildA2uiActionPart,
  callCatalogFunction,
  collectA2uiOutputs as collectA2uiOutputsStrict,
  extractA2uiResources,
  failedChecks,
  interpolate,
  isA2uiMessageArray,
  messageA2uiActions,
  pointerDelete,
  pointerGet,
  pointerSet,
  reduceA2uiMessages as reduceA2uiMessagesStrict,
  reduceA2uiOutputs as reduceA2uiOutputsStrict,
  resolveDynamic,
  resolvePath,
  ScopedCallMap,
  summarizeA2uiAction,
} from "~/lib/a2ui";
import {
  A2UI_CATALOG_PLUGINS,
  A2UI_DEFAULT_ENABLED_PLUGIN_KEYS,
  catalogIdsForPluginKeys,
  normalizeA2uiCatalogPluginKeys,
} from "~/lib/a2ui-catalog-plugins";
import type {
  A2uiPresentationItem,
  ContentPart,
  FunctionCallOutputItem,
  MessageItem,
  ORItem,
} from "~/lib/openresponses";

const BASIC_CATALOG =
  "https://a2ui.org/specification/v0_9_1/catalogs/basic/catalog.json";

/* Production callers must pass the deployment's *enabled* catalog set
 * explicitly (the parameter is required so admin enablement can't be
 * bypassed by omission). Tests default to every installed catalog unless
 * the case under test says otherwise. */
const reduceA2uiMessages = (
  messages: A2uiMessage[],
  enabledCatalogIds: readonly string[] = A2UI_INSTALLED_CATALOG_IDS,
) => reduceA2uiMessagesStrict(messages, enabledCatalogIds);

/**
 * `collectA2uiOutputs`/`reduceA2uiOutputs` scope every lookup by
 * `(turnKey, callId)` in production, since `call_id` is only unique within
 * one turn (see the "call_id uniqueness scope" tests further below, which
 * exercise the real, turn-aware signatures directly). Every other test in
 * this file is only concerned with trajectory ordering *within* a single
 * turn, so these wrappers default everything to one implicit turn
 * (`DEFAULT_TURN`) and flatten the result back to a plain
 * `Map<callId, ...>` / `{callId, output}[]`, so those call sites don't need
 * to thread a turnKey through.
 */
const DEFAULT_TURN = "turn1";

const collectA2uiOutputs = (
  items: ORItem[],
): Array<{ callId: string; output: A2uiOutputRef["output"] }> =>
  collectA2uiOutputsStrict(
    items.map((item) => ({ item, turnKey: DEFAULT_TURN })),
  ).map(({ callId, output }) => ({ callId, output }));

const reduceA2uiOutputs = (
  outputs: Array<{ callId: string; output: A2uiOutputRef["output"] }>,
  enabledCatalogIds: readonly string[] = A2UI_INSTALLED_CATALOG_IDS,
): Map<string, A2uiCallSurfaces> => {
  const scoped = reduceA2uiOutputsStrict(
    outputs.map((output) => ({ ...output, turnKey: DEFAULT_TURN })),
    enabledCatalogIds,
  );
  const flat = new Map<string, A2uiCallSurfaces>();
  for (const callId of new Set(outputs.map((output) => output.callId))) {
    const value = scoped.get(DEFAULT_TURN, callId);
    if (value) flat.set(callId, value);
  }
  return flat;
};

/* ------------------------------ JSON Pointer ------------------------------ */

describe("JSON Pointer utilities", () => {
  const model = {
    user: { name: "Ada", tags: ["a", "b"] },
    "odd/key": { "til~de": 1 },
  };

  it("reads nested values, array indices, and escaped tokens", () => {
    expect(pointerGet(model, "/user/name")).toBe("Ada");
    expect(pointerGet(model, "/user/tags/1")).toBe("b");
    expect(pointerGet(model, "/odd~1key/til~0de")).toBe(1);
    expect(pointerGet(model, "")).toBe(model);
    expect(pointerGet(model, "/missing/deep")).toBeUndefined();
  });

  it("writes immutably, creating intermediate containers", () => {
    const next = pointerSet(model, "/user/address/city", "London") as never;
    expect(pointerGet(next, "/user/address/city")).toBe("London");
    expect(pointerGet(model, "/user/address")).toBeUndefined();
    expect(pointerGet(next, "/user/name")).toBe("Ada");

    const withArray = pointerSet({}, "/items/0/label", "first");
    expect(Array.isArray(pointerGet(withArray, "/items"))).toBe(true);
    expect(pointerGet(withArray, "/items/0/label")).toBe("first");
  });

  it("replaces the whole model for the root pointer", () => {
    expect(pointerSet(model, "/", { fresh: true })).toEqual({ fresh: true });
    expect(pointerSet(model, "", 42)).toBe(42);
  });

  it("deletes keys and unsets array indices preserving length", () => {
    const next = pointerDelete(model, "/user/name") as never;
    expect(pointerGet(next, "/user/name")).toBeUndefined();
    expect(pointerGet(next, "/user/tags/0")).toBe("a");

    const array = pointerDelete(model, "/user/tags/0") as never;
    const tags = pointerGet(array, "/user/tags") as unknown[];
    expect(tags.length).toBe(2);
    expect(tags[0]).toBeUndefined();
    expect(tags[1]).toBe("b");
  });

  it("resolves relative paths against a scope base", () => {
    expect(resolvePath("/abs", "/employees/2")).toBe("/abs");
    expect(resolvePath("name", "/employees/2")).toBe("/employees/2/name");
  });
});

/* ---------------------------- surface reduction --------------------------- */

const createSurface = (surfaceId = "s1") => ({
  version: "v0.9.1",
  createSurface: { surfaceId, catalogId: BASIC_CATALOG },
});

describe("reduceA2uiMessages", () => {
  it("builds a surface from create + updateComponents + updateDataModel", () => {
    const surfaces = reduceA2uiMessages([
      createSurface(),
      {
        version: "v0.9.1",
        updateComponents: {
          surfaceId: "s1",
          components: [
            { id: "root", component: "Column", children: ["hello"] },
            { id: "hello", component: "Text", text: { path: "/user/name" } },
          ],
        },
      },
      {
        version: "v0.9.1",
        updateDataModel: {
          surfaceId: "s1",
          path: "/user",
          value: { name: "Ada" },
        },
      },
    ]);

    expect(surfaces).toHaveLength(1);
    const surface = surfaces[0];
    expect(surface?.supported).toBe(true);
    expect(surface?.components.root?.component).toBe("Column");
    expect(pointerGet(surface?.dataModel, "/user/name")).toBe("Ada");
  });

  it("re-sending a component id updates it in place", () => {
    const [surface] = reduceA2uiMessages([
      createSurface(),
      {
        updateComponents: {
          surfaceId: "s1",
          components: [{ id: "root", component: "Text", text: "one" }],
        },
      },
      {
        updateComponents: {
          surfaceId: "s1",
          components: [{ id: "root", component: "Text", text: "two" }],
        },
      },
    ]);
    expect(surface?.components.root?.text).toBe("two");
  });

  it("updateDataModel without value deletes at path", () => {
    const [surface] = reduceA2uiMessages([
      createSurface(),
      {
        updateDataModel: {
          surfaceId: "s1",
          path: "/",
          value: { keep: 1, drop: 2 },
        },
      },
      { updateDataModel: { surfaceId: "s1", path: "/drop" } },
    ]);
    expect(surface?.dataModel).toEqual({ keep: 1 });
  });

  it("marks unsupported catalogs and versions, keeps the surface", () => {
    const [unknownCatalog] = reduceA2uiMessages([
      {
        version: "v0.9.1",
        createSurface: { surfaceId: "s1", catalogId: "urn:custom:catalog" },
      },
    ]);
    expect(unknownCatalog?.supported).toBe(false);

    const [futureVersion] = reduceA2uiMessages([
      {
        version: "v42.0",
        createSurface: { surfaceId: "s2", catalogId: BASIC_CATALOG },
      },
    ]);
    expect(futureVersion?.supported).toBe(false);
  });

  it("supports Parley's first-party charts catalog", () => {
    const [surface] = reduceA2uiMessages([
      {
        version: "v0.9.1",
        createSurface: { surfaceId: "s1", catalogId: A2UI_CHARTS_CATALOG_ID },
      },
    ]);
    expect(surface?.supported).toBe(true);
  });

  it("marks installed catalogs unsupported when their plugin is disabled", () => {
    const enabledCatalogIds = catalogIdsForPluginKeys(["basic"]);
    const [surface] = reduceA2uiMessages(
      [
        {
          version: "v0.9.1",
          createSurface: {
            surfaceId: "s1",
            catalogId: A2UI_CHARTS_CATALOG_ID,
          },
        },
      ],
      enabledCatalogIds,
    );
    expect(surface?.supported).toBe(false);
  });

  it("deleteSurface removes the surface; stray updates are ignored", () => {
    const surfaces = reduceA2uiMessages([
      createSurface(),
      { deleteSurface: { surfaceId: "s1" } },
      {
        updateComponents: {
          surfaceId: "ghost",
          components: [{ id: "root", component: "Text", text: "x" }],
        },
      },
    ]);
    expect(surfaces).toHaveLength(0);
  });

  it("records data ops; replaying them reproduces the model", () => {
    const [surface] = reduceA2uiMessages([
      createSurface(),
      {
        updateDataModel: {
          surfaceId: "s1",
          path: "/user",
          value: { name: "Ada", tmp: 1 },
        },
      },
      { updateDataModel: { surfaceId: "s1", path: "/user/tmp" } },
    ]);
    expect(surface?.dataOps).toHaveLength(2);
    expect(surface?.dataModel).toEqual({ user: { name: "Ada" } });
    expect(applyA2uiDataOps({}, surface?.dataOps ?? [])).toEqual(
      surface?.dataModel,
    );
  });

  it("re-creating a surface resets its accumulated data ops", () => {
    const [surface] = reduceA2uiMessages([
      createSurface(),
      { updateDataModel: { surfaceId: "s1", path: "/a", value: 1 } },
      createSurface(),
    ]);
    expect(surface?.dataOps).toHaveLength(0);
    expect(surface?.dataModel).toEqual({});
    expect(surface?.generation).toBe("local:2");
  });
});

describe("A2UI catalog plugins", () => {
  it("registers Basic, Charts, and Maps through the same manifest", () => {
    expect(A2UI_CATALOG_PLUGINS.map((plugin) => plugin.key)).toEqual([
      "basic",
      "charts",
      "maps",
    ]);
    expect(catalogIdsForPluginKeys(A2UI_DEFAULT_ENABLED_PLUGIN_KEYS)).toEqual(
      A2UI_INSTALLED_CATALOG_IDS,
    );
  });

  it("normalizes enabled keys against installed plugins", () => {
    expect(
      normalizeA2uiCatalogPluginKeys(["charts", "maps", "missing", "charts"]),
    ).toEqual(["charts", "maps"]);
    expect(normalizeA2uiCatalogPluginKeys(undefined)).toEqual([]);
  });
});

/* ------------------------- conversation-level state ------------------------ */

describe("reduceA2uiOutputs", () => {
  const asOutput = (msgs: unknown[]): ContentPart[] => [
    { type: "output_text", text: "fallback" },
    {
      type: "resource",
      resource: { mimeType: A2UI_MIME_TYPE, text: JSON.stringify(msgs) },
    } as never,
  ];

  const formMessages = [
    createSurface(),
    {
      updateComponents: {
        surfaceId: "s1",
        components: [{ id: "root", component: "Text", text: "form" }],
      },
    },
    {
      updateDataModel: { surfaceId: "s1", path: "/user", value: { name: "" } },
    },
  ];

  it("anchors surfaces at the creating call; later outputs update in place", () => {
    const byCall = reduceA2uiOutputs([
      { callId: "call_1", output: asOutput(formMessages) },
      {
        callId: "call_2",
        output: asOutput([
          {
            updateDataModel: {
              surfaceId: "s1",
              path: "/user/name",
              value: "Ada",
            },
          },
          {
            updateComponents: {
              surfaceId: "s1",
              components: [{ id: "root", component: "Text", text: "done" }],
            },
          },
        ]),
      },
    ]);

    const creator = byCall.get("call_1");
    expect(creator?.surfaces).toHaveLength(1);
    const surface = creator?.surfaces[0];
    expect(surface?.components.root?.text).toBe("done");
    expect(pointerGet(surface?.dataModel, "/user/name")).toBe("Ada");
    expect(surface?.dataOps).toHaveLength(2);

    /* The updating call renders nothing of its own — its effect is
     * visible at the surface's anchor. */
    const updater = byCall.get("call_2");
    expect(updater?.surfaces).toHaveLength(0);
    expect(updater?.showFallback).toBe(false);
  });

  it("flags update-only outputs that reference no known surface", () => {
    const byCall = reduceA2uiOutputs([
      {
        callId: "call_1",
        output: asOutput([
          { updateDataModel: { surfaceId: "ghost", path: "/x", value: 1 } },
        ]),
      },
    ]);
    expect(byCall.get("call_1")?.surfaces).toHaveLength(0);
    expect(byCall.get("call_1")?.showFallback).toBe(true);
    expect(byCall.get("call_1")?.fallbackText).toBe("fallback");
  });

  it("a later deleteSurface removes the surface with no fallback anywhere", () => {
    const byCall = reduceA2uiOutputs([
      { callId: "call_1", output: asOutput(formMessages) },
      {
        callId: "call_2",
        output: asOutput([{ deleteSurface: { surfaceId: "s1" } }]),
      },
    ]);
    expect(byCall.get("call_1")?.surfaces).toHaveLength(0);
    expect(byCall.get("call_1")?.showFallback).toBe(false);
    expect(byCall.get("call_2")?.surfaces).toHaveLength(0);
    expect(byCall.get("call_2")?.showFallback).toBe(false);
  });

  it("re-creating a deleted surface moves its anchor to the later call", () => {
    const byCall = reduceA2uiOutputs([
      { callId: "call_1", output: asOutput(formMessages) },
      {
        callId: "call_2",
        output: asOutput([
          { deleteSurface: { surfaceId: "s1" } },
          createSurface(),
          {
            updateComponents: {
              surfaceId: "s1",
              components: [{ id: "root", component: "Text", text: "fresh" }],
            },
          },
        ]),
      },
    ]);
    expect(byCall.get("call_1")?.surfaces).toHaveLength(0);
    expect(byCall.get("call_2")?.surfaces).toHaveLength(1);
    expect(byCall.get("call_2")?.surfaces[0]?.components.root?.text).toBe(
      "fresh",
    );
  });

  it("omits outputs with no A2UI content", () => {
    const byCall = reduceA2uiOutputs([
      { callId: "call_1", output: JSON.stringify({ city: "Tokyo" }) },
      { callId: "call_2", output: null },
    ]);
    expect(byCall.size).toBe(0);
  });

  it("retains the latest non-null fallback for repeated call IDs", () => {
    const resource = (surfaceId: string): ContentPart =>
      ({
        type: "resource",
        resource: {
          mimeType: A2UI_MIME_TYPE,
          text: JSON.stringify([createSurface(surfaceId)]),
        },
      }) as never;
    const outputs = [
      {
        callId: "call_1",
        output: [
          { type: "output_text", text: "Readable result" },
          resource("s1"),
        ],
      },
      { callId: "call_1", output: [resource("s2")] },
    ];
    expect(reduceA2uiOutputs(outputs).get("call_1")?.fallbackText).toBe(
      "Readable result",
    );
    outputs.push({
      callId: "call_1",
      output: [{ type: "output_text", text: "Newer result" }, resource("s3")],
    });
    expect(reduceA2uiOutputs(outputs).get("call_1")?.fallbackText).toBe(
      "Newer result",
    );
  });
});

describe("collectA2uiOutputs", () => {
  const sidecar = (
    messages: unknown[],
    callId = "missing",
    fallbackText?: string,
  ): A2uiPresentationItem => ({
    type: "ajac-zero:a2ui",
    id: "sidecar",
    status: "completed",
    call_id: callId,
    mime_type: A2UI_MIME_TYPE,
    uri: "a2ui://example/sidecar",
    fallback_text: fallbackText,
    messages: messages as Array<Record<string, unknown>>,
  });

  const canonicalItems = (): ORItem[] => [
    {
      type: "function_call",
      call_id: "call_1",
      name: "tool",
      arguments: "{}",
    },
    {
      type: "function_call_output",
      call_id: "call_1",
      output: [
        {
          type: "resource",
          resource: {
            mimeType: A2UI_MIME_TYPE,
            text: JSON.stringify([createSurface()]),
          },
        },
      ],
    },
  ];

  it("ignores an orphan sidecar that updates a valid surface", () => {
    const outputs = collectA2uiOutputs([
      ...canonicalItems(),
      {
        type: "function_call",
        call_id: "missing",
        name: "orphan",
        arguments: "{}",
      },
      sidecar([
        {
          updateComponents: {
            surfaceId: "s1",
            components: [{ id: "root", component: "Text", text: "hijacked" }],
          },
        },
      ]),
    ]);
    expect(
      reduceA2uiOutputs(outputs).get("call_1")?.surfaces[0]?.components.root,
    ).toBeUndefined();
  });

  it("ignores an orphan sidecar that deletes a valid surface", () => {
    const outputs = collectA2uiOutputs([
      ...canonicalItems(),
      { type: "function_call_output", call_id: "missing", output: "{}" },
      sidecar([{ deleteSurface: { surfaceId: "s1" } }]),
    ]);
    expect(reduceA2uiOutputs(outputs).get("call_1")?.surfaces).toHaveLength(1);
  });

  it("applies a linked sidecar in order and moves a recreated surface anchor", () => {
    const outputs = collectA2uiOutputs([
      ...canonicalItems(),
      sidecar(
        [
          createSurface(),
          {
            updateComponents: {
              surfaceId: "s1",
              components: [{ id: "root", component: "Text", text: "fresh" }],
            },
          },
        ],
        "call_1",
      ),
    ]);
    expect(
      reduceA2uiOutputs(outputs).get("call_1")?.surfaces[0]?.components.root
        ?.text,
    ).toBe("fresh");
  });

  it("applies a linked update-only sidecar to its canonical surface", () => {
    const outputs = collectA2uiOutputs([
      ...canonicalItems(),
      sidecar(
        [
          {
            updateComponents: {
              surfaceId: "s1",
              components: [{ id: "root", component: "Text", text: "updated" }],
            },
          },
        ],
        "call_1",
      ),
    ]);
    expect(
      reduceA2uiOutputs(outputs).get("call_1")?.surfaces[0]?.components.root
        ?.text,
    ).toBe("updated");
  });

  it("keeps an update-only sidecar before its canonical output in trajectory order", () => {
    const [call, output] = canonicalItems();
    const outputs = collectA2uiOutputs([
      call as ORItem,
      sidecar(
        [
          {
            updateComponents: {
              surfaceId: "s1",
              components: [{ id: "root", component: "Text", text: "updated" }],
            },
          },
        ],
        "call_1",
      ),
      output as ORItem,
    ]);
    expect(
      reduceA2uiOutputs(outputs).get("call_1")?.surfaces[0]?.components.root,
    ).toBeUndefined();
  });

  it("preserves canonical fallback through an empty sidecar and uses a later sidecar fallback", () => {
    const items: ORItem[] = [
      {
        type: "function_call",
        call_id: "call_1",
        name: "tool",
        arguments: "{}",
      },
      {
        type: "function_call_output",
        call_id: "call_1",
        output: [
          { type: "output_text", text: "Readable result" },
          {
            type: "resource",
            resource: {
              mimeType: A2UI_MIME_TYPE,
              text: JSON.stringify([
                {
                  createSurface: {
                    surfaceId: "s1",
                    catalogId: "urn:unsupported",
                  },
                },
              ]),
            },
          },
        ],
      },
      sidecar([createSurface("s2")], "call_1"),
    ];
    let group = reduceA2uiOutputs(collectA2uiOutputs(items)).get("call_1");
    expect(group?.fallbackText).toBe("Readable result");
    expect(group?.showFallback).toBe(false);

    items.push(sidecar([createSurface("s3")], "call_1", ""));
    group = reduceA2uiOutputs(collectA2uiOutputs(items)).get("call_1");
    expect(group?.fallbackText).toBe("");
    expect(group?.showFallback).toBe(false);

    items.push(sidecar([createSurface("s4")], "call_1", "Newer result"));
    group = reduceA2uiOutputs(collectA2uiOutputs(items)).get("call_1");
    expect(group?.fallbackText).toBe("Newer result");
    expect(group?.showFallback).toBe(false);
  });
});

/* ------------------------- dynamic values & checks ------------------------ */

describe("resolveDynamic and catalog functions", () => {
  const model = { user: { name: "Ada", email: "ada@example.com" }, n: 3 };

  it("passes literals through and resolves bindings", () => {
    expect(resolveDynamic("plain", model, "")).toBe("plain");
    expect(resolveDynamic(7, model, "")).toBe(7);
    expect(resolveDynamic({ path: "/user/name" }, model, "")).toBe("Ada");
    expect(resolveDynamic({ path: "name" }, model, "/user")).toBe("Ada");
  });

  it("evaluates validation functions", () => {
    const call = (name: string, args: Record<string, unknown>) =>
      callCatalogFunction(name, args, model, "");
    expect(call("required", { value: { path: "/user/name" } })).toBe(true);
    expect(call("required", { value: { path: "/user/missing" } })).toBe(false);
    expect(call("required", { value: "  " })).toBe(false);
    expect(call("regex", { value: "abc123", pattern: "^[a-z]+\\d+$" })).toBe(
      true,
    );
    expect(call("length", { value: "abcd", min: 2, max: 3 })).toBe(false);
    expect(call("numeric", { value: { path: "/n" }, min: 1, max: 5 })).toBe(
      true,
    );
    expect(call("email", { value: { path: "/user/email" } })).toBe(true);
    expect(call("email", { value: "nope" })).toBe(false);
    expect(call("and", { values: [true, { path: "/user/name" }] })).toBe(true);
    expect(call("or", { values: [false, ""] })).toBe(false);
    expect(call("not", { value: false })).toBe(true);
    expect(call("no_such_function", {})).toBeUndefined();
  });

  it("formats strings with ${path} interpolation", () => {
    expect(interpolate("Hi ${/user/name}!", model, "")).toBe("Hi Ada!");
    expect(interpolate("Hi ${name}", model, "/user")).toBe("Hi Ada");
    expect(interpolate("literal \\${notapath}", model, "")).toBe(
      "literal ${notapath}",
    );
    expect(
      callCatalogFunction("formatString", { value: "${/n} items" }, model, ""),
    ).toBe("3 items");
  });

  it("evaluates checks in both normative and shorthand shapes", () => {
    const failing = failedChecks(
      [
        {
          condition: { call: "required", args: { value: { path: "/none" } } },
          message: "Value is required.",
        },
        { call: "required", args: { value: { path: "/user/name" } } },
      ],
      model,
      "",
    );
    expect(failing).toEqual(["Value is required."]);
  });
});

/* --------------------------------- actions -------------------------------- */

describe("action envelopes", () => {
  const action = {
    name: "submit",
    surfaceId: "s1",
    sourceComponentId: "btn",
    timestamp: "2026-07-10T00:00:00.000Z",
    context: { guests: 2 },
  };

  it("builds a typed part and summary, then reads them back", () => {
    const part = buildA2uiActionPart(action);
    expect(part.type).toBe("a2ui");
    expect(part.mime_type).toBe(A2UI_MIME_TYPE);

    const item: MessageItem = {
      type: "message",
      role: "user",
      content: [
        { type: "input_text", text: summarizeA2uiAction(action) },
        part as never,
      ],
    };
    const actions = messageA2uiActions(item);
    expect(actions).toHaveLength(1);
    expect(actions[0]?.name).toBe("submit");
    expect(actions[0]?.context).toEqual({ guests: 2 });
    expect(summarizeA2uiAction(action)).toBe('UI action: submit {"guests":2}');
  });

  it("ignores messages without a2ui parts", () => {
    const item: MessageItem = {
      type: "message",
      role: "user",
      content: [{ type: "input_text", text: "hello" }],
    };
    expect(messageA2uiActions(item)).toHaveLength(0);
  });
});

/* ---------------------------- resource detection --------------------------- */

describe("extractA2uiResources", () => {
  const messages = [
    createSurface(),
    {
      updateComponents: {
        surfaceId: "s1",
        components: [{ id: "root", component: "Text", text: "hi" }],
      },
    },
  ];
  const embeddedResource = {
    type: "resource",
    resource: {
      uri: "a2ui://demo/card",
      mimeType: A2UI_MIME_TYPE,
      text: JSON.stringify(messages),
    },
  };

  it("finds MCP embedded resources in content part arrays", () => {
    const extraction = extractA2uiResources([
      { type: "output_text", text: "Textual fallback." },
      embeddedResource as never,
    ]);
    expect(extraction.resources).toHaveLength(1);
    expect(extraction.resources[0]?.uri).toBe("a2ui://demo/card");
    expect(extraction.resources[0]?.messages).toHaveLength(2);
    expect(extraction.fallbackText).toBe("Textual fallback.");
  });

  it("finds resources in a JSON string of an MCP CallToolResult", () => {
    const output = JSON.stringify({
      content: [{ type: "text", text: "fallback" }, embeddedResource],
    });
    const extraction = extractA2uiResources(output);
    expect(extraction.resources).toHaveLength(1);
    expect(extraction.fallbackText).toBe("fallback");
  });

  it("accepts a bare A2UI message array (string or value)", () => {
    expect(
      extractA2uiResources(JSON.stringify(messages)).resources,
    ).toHaveLength(1);
    expect(isA2uiMessageArray(messages)).toBe(true);
  });

  it("does not sniff untyped or unrelated payloads", () => {
    expect(extractA2uiResources("not json").resources).toHaveLength(0);
    expect(
      extractA2uiResources(JSON.stringify({ city: "Tokyo" })).resources,
    ).toHaveLength(0);
    expect(
      extractA2uiResources(JSON.stringify([{ foo: 1 }])).resources,
    ).toHaveLength(0);
    expect(
      extractA2uiResources([{ type: "output_text", text: "just text" }])
        .resources,
    ).toHaveLength(0);
    expect(extractA2uiResources(null).resources).toHaveLength(0);
  });

  it("ignores resources with the right mime type but invalid payloads", () => {
    const extraction = extractA2uiResources([
      {
        type: "resource",
        resource: { mimeType: A2UI_MIME_TYPE, text: "{broken" },
      } as never,
    ]);
    expect(extraction.resources).toHaveLength(0);
  });
  it("renders a financial optimization dashboard contract", () => {
    const surfaceId = "optimization_results_fixture";
    const components = [
      { id: "root", component: "Card", child: "layout" },
      {
        id: "layout",
        component: "Column",
        children: ["stats", "ventas", "margin", "uafirda"],
      },
      {
        id: "stats",
        component: "Row",
        children: ["convergence", "cells", "residual", "iterations"],
      },
      ...["convergence", "cells", "residual", "iterations"].map((id) => ({
        id,
        component: "Stat",
        label: id,
        value: { path: `/report/stats/${id}` },
      })),
      ...[
        ["ventas", "/report/ventas"],
        ["margin", "/report/uafirdaMargin"],
        ["uafirda", "/report/uafirdaAbsolute"],
      ].map(([id, path]) => ({
        id,
        component: "Chart",
        data: { path },
        x: { key: "period" },
        y: {
          label: id === "margin" ? "Margin" : "Model units",
          format: id === "margin" ? "percent" : "number",
          maximumFractionDigits: 1,
          includeZero: true,
        },
        series: [{ key: "after" }],
      })),
    ];
    const dashboard = [
      {
        version: "v0.9.1",
        createSurface: {
          surfaceId,
          catalogId: A2UI_CHARTS_CATALOG_ID,
        },
      },
      {
        version: "v0.9.1",
        updateComponents: { surfaceId, components },
      },
      {
        version: "v0.9.1",
        updateDataModel: {
          surfaceId,
          path: "/",
          value: {
            report: {
              stats: { convergence: 1, cells: 16, residual: 0, iterations: 3 },
              ventas: [{ period: "2026", after: 100 }],
              uafirdaMargin: [{ period: "2026", after: 0.2 }],
              uafirdaAbsolute: [{ period: "2026", after: 50 }],
            },
          },
        },
      },
    ];
    const output = [
      { type: "output_text", text: "Optimization completed." },
      {
        type: "resource",
        resource: {
          uri: "a2ui://example/optimization/results",
          mimeType: A2UI_MIME_TYPE,
          text: JSON.stringify(dashboard),
        },
      } as never,
    ] as ContentPart[];

    const result = reduceA2uiOutputs([{ callId: "call_results", output }]);
    const group = result.get("call_results");
    const surface = group?.surfaces[0];

    expect(group?.fallbackText).toBe("Optimization completed.");
    expect(surface?.supported).toBe(true);
    expect(surface?.components.root?.component).toBe("Card");
    expect(
      Object.values(surface?.components ?? {}).filter(
        (component) => component.component === "Chart",
      ),
    ).toHaveLength(3);
    expect(
      Object.values(surface?.components ?? {}).filter(
        (component) => component.component === "Stat",
      ),
    ).toHaveLength(4);
    expect(surface?.components.margin?.y).toEqual({
      label: "Margin",
      format: "percent",
      maximumFractionDigits: 1,
      includeZero: true,
    });
  });

  it("reduces a linked A2UI presentation sidecar", () => {
    const item: A2uiPresentationItem = {
      type: "ajac-zero:a2ui",
      id: "a2ui_fixture",
      status: "completed",
      call_id: "call_solve",
      mime_type: A2UI_MIME_TYPE,
      uri: "a2ui://example/results",
      fallback_text: "Calculation completed.",
      messages: [
        createSurface("results"),
        {
          updateComponents: {
            surfaceId: "results",
            components: [{ id: "root", component: "Text", text: "Results" }],
          },
        },
      ],
    };

    const output = a2uiPresentationOutput(item);
    expect(output?.callId).toBe("call_solve");
    const reduced = reduceA2uiOutputs(output ? [output] : []);
    expect(reduced.get("call_solve")?.fallbackText).toBe(
      "Calculation completed.",
    );
    expect(reduced.get("call_solve")?.surfaces[0]?.surfaceId).toBe("results");
  });

  it("ignores invalid A2UI presentation sidecars", () => {
    const item: A2uiPresentationItem = {
      type: "ajac-zero:a2ui",
      id: "a2ui_invalid",
      status: "completed",
      call_id: "call_solve",
      mime_type: A2UI_MIME_TYPE,
      uri: "a2ui://example/results",
      messages: [],
    };

    expect(a2uiPresentationOutput(item)).toBeNull();
  });
});

/* ------------------------ conversation trajectory order --------------------- */

describe("collectA2uiOutputs", () => {
  const functionCall = (callId: string): ORItem => ({
    type: "function_call",
    call_id: callId,
    name: "tool",
    arguments: "{}",
  });

  const functionCallOutput = (
    callId: string,
    messages: A2uiMessage[],
  ): ORItem =>
    ({
      type: "function_call_output",
      call_id: callId,
      output: JSON.stringify(messages),
    }) as FunctionCallOutputItem;

  const presentationSidecar = (
    callId: string,
    messages: A2uiMessage[],
  ): ORItem =>
    ({
      type: "ajac-zero:a2ui",
      id: `a2ui_${callId}`,
      status: "completed",
      call_id: callId,
      mime_type: A2UI_MIME_TYPE,
      uri: `a2ui://example/${callId}`,
      messages,
    }) as A2uiPresentationItem;

  it("keeps trajectory order so a later call's update wins over an earlier sidecar's create", () => {
    // Trajectory: call1's sidecar creates s1 first; call2's canonical output
    // updates s1 afterwards. A grouped (all-outputs-then-all-sidecars)
    // reduction would apply call2's update before call1's createSurface,
    // discarding it.
    const items: ORItem[] = [
      functionCall("call1"),
      functionCall("call2"),
      presentationSidecar("call1", [createSurface("s1")]),
      functionCallOutput("call1", []),
      functionCallOutput("call2", [
        {
          updateComponents: {
            surfaceId: "s1",
            components: [{ id: "root", component: "Text", text: "from call2" }],
          },
        },
      ]),
    ];

    const outputs = collectA2uiOutputs(items);
    const reduced = reduceA2uiOutputs(outputs);
    const surface = reduced.get("call1")?.surfaces[0];
    expect(surface?.components.root?.text).toBe("from call2");
  });

  it("keeps a pre-output recreating sidecar before an intervening update", () => {
    const items: ORItem[] = [
      functionCall("call1"),
      functionCall("call2"),
      presentationSidecar("call1", [createSurface("s1")]),
      functionCallOutput("call2", [
        {
          updateComponents: {
            surfaceId: "s1",
            components: [{ id: "root", component: "Text", text: "from call2" }],
          },
        },
      ]),
      functionCallOutput("call1", []),
    ];

    const surface = reduceA2uiOutputs(collectA2uiOutputs(items)).get("call1")
      ?.surfaces[0];
    expect(surface?.components.root?.text).toBe("from call2");
  });

  it("discards a pre-output update-only sidecar before another call creates its target", () => {
    const items: ORItem[] = [
      functionCall("call1"),
      presentationSidecar("call1", [
        {
          updateComponents: {
            surfaceId: "s1",
            components: [{ id: "root", component: "Text", text: "sidecar" }],
          },
        },
      ]),
      functionCall("call2"),
      functionCallOutput("call2", [createSurface("s1")]),
      functionCallOutput("call1", []),
    ];

    expect(
      reduceA2uiOutputs(collectA2uiOutputs(items)).get("call2")?.surfaces[0]
        ?.components.root,
    ).toBeUndefined();
  });

  it("preserves order regardless of whether the sidecar or canonical output comes first", () => {
    const items: ORItem[] = [
      functionCall("call1"),
      functionCall("call2"),
      functionCallOutput("call2", [
        {
          updateComponents: {
            surfaceId: "s1",
            components: [{ id: "root", component: "Text", text: "stale" }],
          },
        },
      ]),
      presentationSidecar("call1", [createSurface("s1")]),
      functionCallOutput("call1", []),
    ];

    const outputs = collectA2uiOutputs(items);
    const reduced = reduceA2uiOutputs(outputs);
    const surface = reduced.get("call1")?.surfaces[0];
    // call2's update now precedes call1's createSurface in the trajectory,
    // so it's the create that wins and the surface has no components yet.
    expect(surface?.components.root).toBeUndefined();
  });

  it("prefers a linked presentation sidecar over the canonical embedded-resource form", () => {
    const canonicalResource: ContentPart = {
      type: "resource",
      resource: {
        uri: "a2ui://example/call1",
        mimeType: A2UI_MIME_TYPE,
        text: JSON.stringify([
          createSurface("s1"),
          {
            updateComponents: {
              surfaceId: "s1",
              components: [
                { id: "root", component: "Text", text: "canonical" },
              ],
            },
          },
        ]),
      },
    } as ContentPart;

    const items: ORItem[] = [
      functionCall("call1"),
      {
        type: "function_call_output",
        call_id: "call1",
        output: [canonicalResource],
      } as FunctionCallOutputItem,
      {
        type: "ajac-zero:a2ui",
        id: "a2ui_call1",
        status: "completed",
        call_id: "call1",
        mime_type: A2UI_MIME_TYPE,
        uri: "a2ui://example/call1",
        fallback_text: "sidecar wins",
        messages: [
          createSurface("s1"),
          {
            updateComponents: {
              surfaceId: "s1",
              components: [{ id: "root", component: "Text", text: "sidecar" }],
            },
          },
        ],
      } as A2uiPresentationItem,
    ];

    const outputs = collectA2uiOutputs(items);
    // Both entries stay at their own trajectory position, keyed by the same
    // call_id — but the canonical entry's messages for `s1` are dropped
    // since the sidecar describes that surface too, so only the sidecar's
    // version survives the reduction.
    expect(outputs).toHaveLength(2);
    expect(outputs.every((output) => output.callId === "call1")).toBe(true);

    const reduced = reduceA2uiOutputs(outputs);
    expect(reduced.get("call1")?.surfaces[0]?.components.root?.text).toBe(
      "sidecar",
    );
    expect(reduced.get("call1")?.fallbackText).toBe("sidecar wins");
  });

  it("preserves an empty canonical fallback through a recreating sidecar", () => {
    const items: ORItem[] = [
      functionCall("call1"),
      {
        type: "function_call_output",
        call_id: "call1",
        output: [
          { type: "output_text", text: "" },
          {
            type: "resource",
            resource: {
              mimeType: A2UI_MIME_TYPE,
              text: JSON.stringify([createSurface("s1")]),
            },
          },
        ],
      } as FunctionCallOutputItem,
      presentationSidecar("call1", [createSurface("s1")]),
    ];

    expect(
      reduceA2uiOutputs(collectA2uiOutputs(items)).get("call1")?.fallbackText,
    ).toBe("");
  });

  it("preserves canonical content for surfaces the sidecar doesn't describe", () => {
    // The canonical output creates two surfaces (s1, s2); the sidecar only
    // replaces s1. s2 must survive untouched — precedence is per-surface,
    // not a blanket override of the whole call's canonical content.
    const canonicalResource: ContentPart = {
      type: "resource",
      resource: {
        uri: "a2ui://example/call1",
        mimeType: A2UI_MIME_TYPE,
        text: JSON.stringify([createSurface("s1"), createSurface("s2")]),
      },
    } as ContentPart;

    const items: ORItem[] = [
      functionCall("call1"),
      {
        type: "function_call_output",
        call_id: "call1",
        output: [canonicalResource],
      } as FunctionCallOutputItem,
      {
        type: "ajac-zero:a2ui",
        id: "a2ui_call1",
        status: "completed",
        call_id: "call1",
        mime_type: A2UI_MIME_TYPE,
        uri: "a2ui://example/call1/s1",
        messages: [
          createSurface("s1"),
          {
            updateComponents: {
              surfaceId: "s1",
              components: [{ id: "root", component: "Text", text: "sidecar" }],
            },
          },
        ],
      } as A2uiPresentationItem,
    ];

    const outputs = collectA2uiOutputs(items);
    const reduced = reduceA2uiOutputs(outputs);
    const call1 = reduced.get("call1");

    const s1 = call1?.surfaces.find((surface) => surface.surfaceId === "s1");
    const s2 = call1?.surfaces.find((surface) => surface.surfaceId === "s2");
    expect(s1?.components.root?.text).toBe("sidecar");
    expect(s2).toBeDefined();
  });

  it("preserves an unrelated canonical update to an existing surface on the same call", () => {
    // Same call also updates a surface created earlier in the conversation
    // (s0); that update is unrelated to the sidecar's surface (s1) and must
    // not be dropped.
    const items: ORItem[] = [
      functionCall("call0"),
      functionCall("call1"),
      functionCall("call2"),
      {
        type: "function_call_output",
        call_id: "call0",
        output: JSON.stringify([createSurface("s0")]),
      } as FunctionCallOutputItem,
      {
        type: "function_call_output",
        call_id: "call1",
        output: [
          {
            type: "resource",
            resource: {
              uri: "a2ui://example/call1",
              mimeType: A2UI_MIME_TYPE,
              text: JSON.stringify([
                createSurface("s1"),
                {
                  updateComponents: {
                    surfaceId: "s0",
                    components: [
                      { id: "root", component: "Text", text: "s0 updated" },
                    ],
                  },
                },
              ]),
            },
          } as ContentPart,
        ],
      } as FunctionCallOutputItem,
      {
        type: "ajac-zero:a2ui",
        id: "a2ui_call1",
        status: "completed",
        call_id: "call1",
        mime_type: A2UI_MIME_TYPE,
        uri: "a2ui://example/call1/s1",
        messages: [createSurface("s1")],
      } as A2uiPresentationItem,
    ];

    const outputs = collectA2uiOutputs(items);
    const reduced = reduceA2uiOutputs(outputs);
    const s0 = reduced.get("call0")?.surfaces[0];
    expect(s0?.components.root?.text).toBe("s0 updated");
  });

  it("keeps a sidecar at its true trajectory position, even after an intervening call", () => {
    // Real trajectory: call1 creates s1, call2 updates s1, then call1's
    // sidecar (emitted later) recreates s1. Since the sidecar is genuinely
    // last, it must win — relocating it to call1's position (right after
    // call1's own canonical output) would let call2's update win instead.
    const items: ORItem[] = [
      functionCall("call1"),
      functionCall("call2"),
      {
        type: "function_call_output",
        call_id: "call1",
        output: JSON.stringify([createSurface("s1")]),
      } as FunctionCallOutputItem,
      {
        type: "function_call_output",
        call_id: "call2",
        output: JSON.stringify([
          {
            updateComponents: {
              surfaceId: "s1",
              components: [
                { id: "root", component: "Text", text: "from call2" },
              ],
            },
          },
        ]),
      } as FunctionCallOutputItem,
      {
        type: "ajac-zero:a2ui",
        id: "a2ui_call1_late",
        status: "completed",
        call_id: "call1",
        mime_type: A2UI_MIME_TYPE,
        uri: "a2ui://example/call1/s1",
        messages: [createSurface("s1")],
      } as A2uiPresentationItem,
    ];

    const outputs = collectA2uiOutputs(items);
    const reduced = reduceA2uiOutputs(outputs);
    const surface = reduced.get("call1")?.surfaces[0];
    // The late sidecar's createSurface really was last, so it wins and the
    // component from call2's update is gone (matching the true trajectory,
    // not a repositioned one).
    expect(surface?.components.root).toBeUndefined();
  });

  it("preserves multiple sidecars for one call, each reduced in its own trajectory position", () => {
    const items: ORItem[] = [
      functionCall("call1"),
      {
        type: "function_call_output",
        call_id: "call1",
        output: JSON.stringify([createSurface("s1")]),
      } as FunctionCallOutputItem,
      {
        type: "ajac-zero:a2ui",
        id: "a2ui_call1_first",
        status: "completed",
        call_id: "call1",
        mime_type: A2UI_MIME_TYPE,
        uri: "a2ui://example/call1/s1",
        messages: [
          createSurface("s1"),
          {
            updateComponents: {
              surfaceId: "s1",
              components: [{ id: "root", component: "Text", text: "first" }],
            },
          },
        ],
      } as A2uiPresentationItem,
      {
        type: "ajac-zero:a2ui",
        id: "a2ui_call1_second",
        status: "completed",
        call_id: "call1",
        mime_type: A2UI_MIME_TYPE,
        uri: "a2ui://example/call1/s1",
        messages: [
          createSurface("s1"),
          {
            updateComponents: {
              surfaceId: "s1",
              components: [{ id: "root", component: "Text", text: "second" }],
            },
          },
        ],
      } as A2uiPresentationItem,
    ];

    const outputs = collectA2uiOutputs(items);
    // Neither sidecar is dropped or deduplicated — both contribute.
    expect(outputs.filter((output) => output.callId === "call1")).toHaveLength(
      3,
    );

    const reduced = reduceA2uiOutputs(outputs);
    const surface = reduced.get("call1")?.surfaces[0];
    // The second sidecar is genuinely last in the trajectory, so it wins.
    expect(surface?.components.root?.text).toBe("second");
  });

  it("preserves a canonical createSurface an update-only sidecar depends on", () => {
    // The sidecar has no createSurface of its own — it's an incremental
    // update to the surface the canonical output created. Dropping the
    // canonical createSurface (because the surface is "covered" by a
    // sidecar) would leave the update with no surface to apply to.
    const items: ORItem[] = [
      functionCall("call1"),
      {
        type: "function_call_output",
        call_id: "call1",
        output: JSON.stringify([createSurface("s1")]),
      } as FunctionCallOutputItem,
      {
        type: "ajac-zero:a2ui",
        id: "a2ui_call1",
        status: "completed",
        call_id: "call1",
        mime_type: A2UI_MIME_TYPE,
        uri: "a2ui://example/call1/s1",
        messages: [
          {
            updateComponents: {
              surfaceId: "s1",
              components: [{ id: "root", component: "Text", text: "note" }],
            },
          },
        ],
      } as A2uiPresentationItem,
    ];

    const outputs = collectA2uiOutputs(items);
    const reduced = reduceA2uiOutputs(outputs);
    const surface = reduced.get("call1")?.surfaces[0];
    // Surface must exist at all (canonical createSurface preserved) and
    // carry the sidecar's incremental update.
    expect(surface?.surfaceId).toBe("s1");
    expect(surface?.components.root?.text).toBe("note");
  });
});

/* --------------------------- call_id uniqueness scope ---------------------- */

/**
 * `call_id` is defined by the agent/model and is only required to be
 * unique *within the turn (response) that produced it* — see
 * docs/generative-ui.md. These tests exercise the real, turn-aware
 * `collectA2uiOutputsStrict`/`reduceA2uiOutputsStrict` signatures directly
 * (not the single-implicit-turn wrappers used everywhere else in this
 * file), since they're specifically about the turn-scoping contract.
 */
describe("ScopedCallMap", () => {
  it("keeps values for the same callId in different turns independent", () => {
    const map = new ScopedCallMap<string>();
    map.set("turn_a", "call_1", "from turn a");
    map.set("turn_b", "call_1", "from turn b");
    expect(map.get("turn_a", "call_1")).toBe("from turn a");
    expect(map.get("turn_b", "call_1")).toBe("from turn b");
  });

  it("overwrites only the exact (turnKey, callId) pair on repeated set", () => {
    const map = new ScopedCallMap<string>();
    map.set("turn_a", "call_1", "first");
    map.set("turn_a", "call_1", "second");
    expect(map.get("turn_a", "call_1")).toBe("second");
  });

  it("has() and get() agree on presence, including for unknown turns", () => {
    const map = new ScopedCallMap<string>();
    map.set("turn_a", "call_1", "value");
    expect(map.has("turn_a", "call_1")).toBe(true);
    expect(map.has("turn_a", "call_2")).toBe(false);
    expect(map.has("turn_z", "call_1")).toBe(false);
    expect(map.get("turn_z", "call_1")).toBeUndefined();
  });

  it("values() and entries() enumerate everything stored, across turns", () => {
    const map = new ScopedCallMap<string>();
    map.set("turn_a", "call_1", "a1");
    map.set("turn_a", "call_2", "a2");
    map.set("turn_b", "call_1", "b1");

    expect(new Set(map.values())).toEqual(new Set(["a1", "a2", "b1"]));
    expect(new Set(map.entries())).toEqual(
      new Set([
        ["turn_a", "call_1", "a1"],
        ["turn_a", "call_2", "a2"],
        ["turn_b", "call_1", "b1"],
      ]),
    );
  });
});

describe("call_id uniqueness scope", () => {
  const functionCall = (callId: string): ORItem => ({
    type: "function_call",
    call_id: callId,
    name: "tool",
    arguments: "{}",
  });

  const functionCallOutput = (
    callId: string,
    messages: A2uiMessage[],
  ): ORItem =>
    ({
      type: "function_call_output",
      call_id: callId,
      output: JSON.stringify(messages),
    }) as FunctionCallOutputItem;

  it("does not let a later turn's call reuse collide with an earlier turn's", () => {
    // Both turns coincidentally use "call_1" — legitimate per the
    // within-turn-only uniqueness contract. Each must resolve to its own,
    // independent surface.
    const entries = [
      { item: functionCall("call_1"), turnKey: "turn_a" },
      {
        item: functionCallOutput("call_1", [createSurface("s_a")]),
        turnKey: "turn_a",
      },
      { item: functionCall("call_1"), turnKey: "turn_b" },
      {
        item: functionCallOutput("call_1", [createSurface("s_b")]),
        turnKey: "turn_b",
      },
    ];

    const outputs = collectA2uiOutputsStrict(entries);
    const reduced = reduceA2uiOutputsStrict(
      outputs,
      A2UI_INSTALLED_CATALOG_IDS,
    );

    const turnA = reduced.get("turn_a", "call_1");
    const turnB = reduced.get("turn_b", "call_1");
    expect(turnA?.surfaces[0]?.surfaceId).toBe("s_a");
    expect(turnB?.surfaces[0]?.surfaceId).toBe("s_b");
  });

  it("keeps surfaces conversation-wide when call_id is reused across turns", () => {
    const entries = [
      { item: functionCall("call_1"), turnKey: "turn_a" },
      {
        item: functionCallOutput("call_1", [createSurface("shared")]),
        turnKey: "turn_a",
      },
      { item: functionCall("call_1"), turnKey: "turn_b" },
      {
        item: functionCallOutput("call_1", [
          {
            updateComponents: {
              surfaceId: "shared",
              components: [{ id: "root", component: "Text", text: "updated" }],
            },
          },
        ]),
        turnKey: "turn_b",
      },
    ];

    const reduced = reduceA2uiOutputsStrict(
      collectA2uiOutputsStrict(entries),
      A2UI_INSTALLED_CATALOG_IDS,
    );

    expect(
      reduced.get("turn_a", "call_1")?.surfaces[0]?.components.root?.text,
    ).toBe("updated");
    expect(reduced.get("turn_b", "call_1")?.surfaces).toHaveLength(0);
  });

  it("changes generation when a later output recreates a surface", () => {
    const outputs = [
      {
        turnKey: "turn_a",
        callId: "call_1",
        output: JSON.stringify([createSurface("shared")]),
      },
      {
        turnKey: "turn_b",
        callId: "call_1",
        output: JSON.stringify([createSurface("shared")]),
      },
    ];

    const first = reduceA2uiOutputsStrict(
      outputs.slice(0, 1),
      A2UI_INSTALLED_CATALOG_IDS,
    ).get("turn_a", "call_1")?.surfaces[0];
    const replaced = reduceA2uiOutputsStrict(
      outputs,
      A2UI_INSTALLED_CATALOG_IDS,
    ).get("turn_b", "call_1")?.surfaces[0];

    expect(first?.generation).not.toBe(replaced?.generation);
  });

  it("keeps generation stable when unrelated messages are inserted", () => {
    const base = {
      turnKey: "turn_a",
      callId: "call_1",
      sourceKey: "output_item_1",
    };
    const before = reduceA2uiOutputsStrict(
      [{ ...base, output: JSON.stringify([createSurface("shared")]) }],
      A2UI_INSTALLED_CATALOG_IDS,
    ).get("turn_a", "call_1")?.surfaces[0];
    const after = reduceA2uiOutputsStrict(
      [
        {
          ...base,
          output: JSON.stringify([
            createSurface("other"),
            createSurface("shared"),
          ]),
        },
      ],
      A2UI_INSTALLED_CATALOG_IDS,
    )
      .get("turn_a", "call_1")
      ?.surfaces.find((surface) => surface.surfaceId === "shared");

    expect(after?.generation).toBe(before?.generation);
  });

  it("ignores A2UI for duplicate function_calls sharing one id", () => {
    const entries = [
      { item: functionCall("call_1"), turnKey: "turn_a" },
      { item: functionCall("call_1"), turnKey: "turn_a" },
      {
        item: functionCallOutput("call_1", [createSurface("s1")]),
        turnKey: "turn_a",
      },
    ];

    const outputs = collectA2uiOutputsStrict(entries);
    const reduced = reduceA2uiOutputsStrict(
      outputs,
      A2UI_INSTALLED_CATALOG_IDS,
    );
    expect(reduced.get("turn_a", "call_1")).toBeUndefined();
  });

  it("ignores A2UI for duplicate function_call_outputs sharing one id", () => {
    const entries = [
      { item: functionCall("call_1"), turnKey: "turn_a" },
      {
        item: functionCallOutput("call_1", [createSurface("s1")]),
        turnKey: "turn_a",
      },
      {
        item: functionCallOutput("call_1", [createSurface("s2")]),
        turnKey: "turn_a",
      },
      {
        item: {
          type: "ajac-zero:a2ui",
          id: "a2ui_call_1",
          status: "completed",
          call_id: "call_1",
          mime_type: A2UI_MIME_TYPE,
          uri: "a2ui://example/call_1",
          messages: [createSurface("sidecar_surface")],
        } as A2uiPresentationItem,
        turnKey: "turn_a",
      },
    ];

    const outputs = collectA2uiOutputsStrict(entries);
    const reduced = reduceA2uiOutputsStrict(
      outputs,
      A2UI_INSTALLED_CATALOG_IDS,
    );
    expect(outputs).toEqual([]);
    expect(reduced.get("turn_a", "call_1")).toBeUndefined();
  });

  it("keeps an unrelated call in the same turn unaffected by another call's duplicate id", () => {
    const entries = [
      { item: functionCall("call_1"), turnKey: "turn_a" },
      { item: functionCall("call_1"), turnKey: "turn_a" },
      { item: functionCall("call_2"), turnKey: "turn_a" },
      {
        item: functionCallOutput("call_1", [createSurface("s1")]),
        turnKey: "turn_a",
      },
      {
        item: functionCallOutput("call_2", [createSurface("s2")]),
        turnKey: "turn_a",
      },
    ];

    const outputs = collectA2uiOutputsStrict(entries);
    const reduced = reduceA2uiOutputsStrict(
      outputs,
      A2UI_INSTALLED_CATALOG_IDS,
    );
    expect(reduced.get("turn_a", "call_2")?.surfaces[0]?.surfaceId).toBe("s2");
  });

  it("scopes a linked presentation sidecar to its own turn too", () => {
    const sidecar = (callId: string, messages: A2uiMessage[]): ORItem =>
      ({
        type: "ajac-zero:a2ui",
        id: `a2ui_${callId}`,
        status: "completed",
        call_id: callId,
        mime_type: A2UI_MIME_TYPE,
        uri: `a2ui://example/${callId}`,
        messages,
      }) as A2uiPresentationItem;

    // turn_a's call has a canonical output only; turn_b reuses "call_1"
    // and has both a canonical output and a linked sidecar. The sidecar
    // must never attach to turn_a's call of the same id.
    const entries = [
      { item: functionCall("call_1"), turnKey: "turn_a" },
      {
        item: functionCallOutput("call_1", []),
        turnKey: "turn_a",
      },
      { item: functionCall("call_1"), turnKey: "turn_b" },
      { item: functionCallOutput("call_1", []), turnKey: "turn_b" },
      {
        item: sidecar("call_1", [createSurface("sidecar_surface")]),
        turnKey: "turn_b",
      },
    ];

    const outputs = collectA2uiOutputsStrict(entries);
    const reduced = reduceA2uiOutputsStrict(
      outputs,
      A2UI_INSTALLED_CATALOG_IDS,
    );
    // turn_a's call_1 had no A2UI content of its own, so it never gets a
    // scan entry at all — the key point is that it certainly never picks
    // up turn_b's sidecar surface.
    expect(reduced.get("turn_a", "call_1")?.surfaces ?? []).toHaveLength(0);
    expect(reduced.get("turn_b", "call_1")?.surfaces[0]?.surfaceId).toBe(
      "sidecar_surface",
    );
  });
});

/* --------------------------- charts catalog contract ----------------------- */

describe("charts catalog contract", () => {
  it("advertises the independently owned catalog ID", () => {
    expect(A2UI_CHARTS_CATALOG_ID).toBe(
      "https://github.com/artemis-sh/a2ui-catalogs/blob/main/catalogs/charts/v1/catalog.json",
    );
    expect(A2UI_INSTALLED_CATALOG_IDS).toContain(A2UI_CHARTS_CATALOG_ID);
  });
});

describe("maps catalog contract", () => {
  it("advertises the independently owned catalog ID", () => {
    expect(A2UI_MAPS_CATALOG_ID).toBe(
      "https://github.com/artemis-sh/a2ui-catalogs/blob/main/catalogs/maps/v1/catalog.json",
    );
    expect(A2UI_INSTALLED_CATALOG_IDS).toContain(A2UI_MAPS_CATALOG_ID);
  });

  it("advertises the immutable v2 catalog ID", () => {
    expect(A2UI_MAPS_V2_CATALOG_ID).toBe(
      "https://github.com/artemis-sh/a2ui-catalogs/blob/maps-v2.0.0/catalogs/maps/v2/catalog.json",
    );
    expect(A2UI_INSTALLED_CATALOG_IDS).toContain(A2UI_MAPS_V2_CATALOG_ID);
  });
});
