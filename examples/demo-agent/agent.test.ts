import { describe, expect, it } from "vitest";
import {
  A2UI_CHARTS_CATALOG_ID,
  A2UI_INSTALLED_CATALOG_IDS,
  A2UI_MAPS_CATALOG_ID,
  type A2uiCallSurfaces,
  type A2uiMessage,
  type A2uiOutputRef,
  extractA2uiResources,
  pointerGet,
  reduceA2uiMessages as reduceA2uiMessagesStrict,
  reduceA2uiOutputs as reduceA2uiOutputsStrict,
} from "~/lib/a2ui";
import {
  type FunctionCallOutputItem,
  initialTurnStreamState,
  isMessageItem,
  type MessageItem,
  messageText,
  type ORStreamEvent,
  reduceORevent,
} from "~/lib/openresponses";
import { parseSseStream, SSE_DONE } from "~/lib/sse";
import { handleDemoResponses } from "./agent";

/* Production callers must pass the deployment's *enabled* catalog set
 * explicitly (the parameter is required so admin enablement can't be
 * bypassed by omission). The demo agent exercises every installed catalog. */
const reduceA2uiMessages = (messages: A2uiMessage[]) =>
  reduceA2uiMessagesStrict(messages, A2UI_INSTALLED_CATALOG_IDS);

/*
 * `reduceA2uiOutputs` scopes every lookup by `(turnKey, callId)` in
 * production (call_id is only unique within one turn — see
 * ~/lib/a2ui.ts's `ScopedCallMap` docs). These tests only ever reduce one
 * turn's worth of output at a time, so default everything to one implicit
 * turn and flatten the result back to a plain `Map<callId, ...>`.
 */
const DEFAULT_TURN = "turn1";

const reduceA2uiOutputs = (
  outputs: Array<{ callId: string; output: A2uiOutputRef["output"] }>,
): Map<string, A2uiCallSurfaces> => {
  const scoped = reduceA2uiOutputsStrict(
    outputs.map((output) => ({ ...output, turnKey: DEFAULT_TURN })),
    A2UI_INSTALLED_CATALOG_IDS,
  );
  const flat = new Map<string, A2uiCallSurfaces>();
  for (const callId of new Set(outputs.map((output) => output.callId))) {
    const value = scoped.get(DEFAULT_TURN, callId);
    if (value) flat.set(callId, value);
  }
  return flat;
};

const request = (body: unknown) =>
  new Request("http://demo.local/v1/responses", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });

const userMessage = (text: string) => ({
  type: "message",
  role: "user",
  content: [{ type: "input_text", text }],
});

/** Streams a demo response and reduces it like the platform does. */
async function streamAndReduce(body: unknown) {
  const response = await handleDemoResponses(request(body));
  expect(response.headers.get("content-type")).toContain("text/event-stream");
  const events: ORStreamEvent[] = [];
  let sawDone = false;
  for await (const message of parseSseStream(
    response.body as ReadableStream<Uint8Array>,
  )) {
    if (message.data === SSE_DONE) {
      sawDone = true;
      break;
    }
    events.push(JSON.parse(message.data) as ORStreamEvent);
  }
  const state = events.reduce(reduceORevent, initialTurnStreamState);
  return { events, state, sawDone };
}

describe("handleDemoResponses", () => {
  it("rejects invalid JSON with a 400 in OR error shape", async () => {
    const response = await handleDemoResponses(
      new Request("http://demo.local/v1/responses", {
        method: "POST",
        body: "{oops",
      }),
    );
    expect(response.status).toBe(400);
    const payload = (await response.json()) as { error: { code: string } };
    expect(payload.error.code).toBe("invalid_json");
  });

  it("returns a complete JSON response when stream=false", async () => {
    const response = await handleDemoResponses(
      request({ stream: false, input: [userMessage("hi")] }),
    );
    expect(response.headers.get("content-type")).toContain("application/json");
    const payload = (await response.json()) as {
      status: string;
      output: Array<Record<string, unknown>>;
      usage: { total_tokens: number };
    };
    expect(payload.status).toBe("completed");
    expect(payload.output.length).toBeGreaterThan(0);
    expect(payload.usage.total_tokens).toBeGreaterThan(0);
  });

  it("streams a spec-shaped event sequence ending in [DONE]", async () => {
    const { events, state, sawDone } = await streamAndReduce({
      input: [userMessage("hello there")],
    });

    expect(sawDone).toBe(true);
    expect(events[0]?.type).toBe("response.created");
    expect(events.at(-1)?.type).toBe("response.completed");
    expect(events.every((e) => typeof e.sequence_number === "number")).toBe(
      true,
    );

    // Reducing the stream must converge to the completed snapshot.
    expect(state.status).toBe("completed");
    expect(state.responseId).toMatch(/^resp_/);
    const message = state.items.find((i) => isMessageItem(i)) as MessageItem;
    expect(messageText(message)).toContain("demo agent");
  });

  it("echoes the user text back in the reply", async () => {
    const { state } = await streamAndReduce({
      input: [userMessage("my unique probe 12321")],
    });
    const message = state.items.find(isMessageItem) as MessageItem;
    expect(messageText(message)).toContain("my unique probe 12321");
  });

  it("emits reasoning plus a get_weather tool round-trip for weather asks", async () => {
    const { state } = await streamAndReduce({
      input: [userMessage("What is the weather in Tokyo?")],
    });
    const types = state.items.map((i) => i.type);
    expect(types).toContain("reasoning");
    expect(types).toContain("function_call");
    expect(types).toContain("function_call_output");

    const call = state.items.find((i) => i.type === "function_call") as {
      name: string;
      arguments: string;
      call_id: string;
    };
    expect(call.name).toBe("get_weather");
    expect(JSON.parse(call.arguments)).toMatchObject({ city: "Tokyo" });

    const output = state.items.find(
      (i) => i.type === "function_call_output",
    ) as {
      call_id: string;
      output: string;
    };
    expect(output.call_id).toBe(call.call_id);
    expect(JSON.parse(output.output)).toMatchObject({ city: "Tokyo" });
  });

  it("returns the markdown tour when asked about markdown", async () => {
    const { state } = await streamAndReduce({
      input: [userMessage("show markdown")],
    });
    const message = state.items.find(isMessageItem) as MessageItem;
    const text = messageText(message);
    expect(text).toContain("| Feature |");
    expect(text).toContain("```ts");
  });

  it("acknowledges attachments", async () => {
    const { state } = await streamAndReduce({
      input: [
        {
          type: "message",
          role: "user",
          content: [
            { type: "input_text", text: "look at these" },
            { type: "input_image", image_url: "data:image/png;base64,AAA" },
            { type: "input_image", image_url: "data:image/png;base64,BBB" },
            { type: "input_file", filename: "notes.txt", file_data: "aGk=" },
          ],
        },
      ],
    });
    const message = state.items.find(isMessageItem) as MessageItem;
    const text = messageText(message);
    expect(text).toContain("2 images");
    expect(text).toContain("1 file");
  });

  it("counts conversation turns from the replayed transcript", async () => {
    const { state } = await streamAndReduce({
      input: [
        userMessage("first"),
        {
          type: "message",
          role: "assistant",
          content: [{ type: "output_text", text: "reply" }],
        },
        userMessage("second"),
        {
          type: "message",
          role: "assistant",
          content: [{ type: "output_text", text: "reply" }],
        },
        userMessage("third"),
      ],
    });
    const message = state.items.find(isMessageItem) as MessageItem;
    expect(messageText(message)).toContain("3 turns");
  });

  it("accepts a bare string input", async () => {
    const { state } = await streamAndReduce({ input: "plain string input" });
    const message = state.items.find(isMessageItem) as MessageItem;
    expect(messageText(message)).toContain("plain string input");
  });

  it("returns a typed A2UI form resource when asked to book a table", async () => {
    const { state } = await streamAndReduce({
      input: [userMessage("Can I book a table for tonight?")],
    });

    const call = state.items.find((i) => i.type === "function_call") as {
      name: string;
    };
    expect(call.name).toBe("find_table");

    const output = state.items.find(
      (i) => i.type === "function_call_output",
    ) as FunctionCallOutputItem;
    const extraction = extractA2uiResources(output.output);
    expect(extraction.resources).toHaveLength(1);
    expect(extraction.resources[0]?.uri).toBe("a2ui://demo/reservation-form");
    expect(extraction.fallbackText).toContain("Reservation form");

    const surfaces = reduceA2uiMessages(
      extraction.resources[0]?.messages ?? [],
    );
    expect(surfaces).toHaveLength(1);
    const surface = surfaces[0] as (typeof surfaces)[number];
    expect(surface.supported).toBe(true);
    expect(surface.components.root?.component).toBe("Card");
    expect(surface.components.submit?.component).toBe("Button");
    expect(
      (surface.dataModel as { reservation: { partySize: number } }).reservation
        .partySize,
    ).toBe(2);
  });

  it("confirms a submitted reservation by updating the form surface in place", async () => {
    /* Turn 1: the form arrives as an A2UI resource. */
    const first = await streamAndReduce({
      input: [userMessage("book a table")],
    });
    const formOutput = first.state.items.find(
      (i) => i.type === "function_call_output",
    ) as FunctionCallOutputItem;

    /* Turn 2: the user submits — the action routes back as an a2ui part. */
    const { state } = await streamAndReduce({
      input: [
        userMessage("book a table"),
        {
          type: "message",
          role: "assistant",
          content: [{ type: "output_text", text: "form sent" }],
        },
        {
          type: "message",
          role: "user",
          content: [
            {
              type: "input_text",
              text: 'UI action: submit_reservation {"reservation":{...}}',
            },
            {
              type: "a2ui",
              mime_type: "application/a2ui+json",
              data: [
                {
                  version: "v0.9.1",
                  action: {
                    name: "submit_reservation",
                    surfaceId: "demo_reservation_form",
                    sourceComponentId: "submit",
                    timestamp: "2026-07-10T18:00:00.000Z",
                    context: {
                      reservation: {
                        name: "Ada Lovelace",
                        when: "2026-07-11T19:30",
                        partySize: 4,
                        seating: ["patio"],
                        notify: true,
                      },
                    },
                  },
                },
              ],
            },
          ],
        },
      ],
    });

    const message = state.items.find(isMessageItem) as MessageItem;
    const text = messageText(message);
    expect(text).toContain("Ada Lovelace");
    expect(text).toContain("**4**");
    expect(text).toContain("patio");

    const call = state.items.find((i) => i.type === "function_call") as {
      name: string;
    };
    expect(call.name).toBe("confirm_reservation");

    /* The confirmation targets the existing form surface: no new surface,
     * just update envelopes for demo_reservation_form. */
    const confirmOutput = state.items.find(
      (i) => i.type === "function_call_output",
    ) as FunctionCallOutputItem;
    const messages =
      extractA2uiResources(confirmOutput.output).resources[0]?.messages ?? [];
    expect(messages.length).toBeGreaterThan(0);
    expect(messages.some((m) => m.createSurface)).toBe(false);
    expect(
      messages.every(
        (m) =>
          (m.updateComponents?.surfaceId ?? m.updateDataModel?.surfaceId) ===
          "demo_reservation_form",
      ),
    ).toBe(true);

    /* Reduced conversation-wide (as the thread does), the form surface —
     * still anchored at find_table's call — morphs into the confirmation. */
    const byCall = reduceA2uiOutputs([
      { callId: "call_form", output: formOutput.output },
      { callId: "call_confirm", output: confirmOutput.output },
    ]);
    const formGroup = byCall.get("call_form");
    expect(formGroup?.surfaces).toHaveLength(1);
    const surface = formGroup?.surfaces[0];
    expect(surface?.surfaceId).toBe("demo_reservation_form");
    expect(surface?.components.root?.child).toBe("confirm_layout");
    expect(surface?.components.confirm_title?.text).toBe(
      "Reservation confirmed",
    );
    const details = pointerGet(
      surface?.dataModel,
      "/confirmation/details",
    ) as Array<{ label: string; value: string }>;
    expect(details.find((d) => d.label === "Name")?.value).toBe("Ada Lovelace");
    expect(details.find((d) => d.label === "Party")?.value).toBe("4 guests");

    /* The confirming call renders nothing itself — no surface, no
     * unsupported-fallback treatment. */
    const confirmGroup = byCall.get("call_confirm");
    expect(confirmGroup?.surfaces).toHaveLength(0);
    expect(confirmGroup?.showFallback).toBe(false);
  });

  it("returns a charts-catalog surface for revenue asks", async () => {
    const { state } = await streamAndReduce({
      input: [userMessage("show me a revenue chart")],
    });

    const call = state.items.find((i) => i.type === "function_call") as {
      name: string;
    };
    expect(call.name).toBe("get_revenue_report");

    const output = state.items.find(
      (i) => i.type === "function_call_output",
    ) as FunctionCallOutputItem;
    const extraction = extractA2uiResources(output.output);
    expect(extraction.resources[0]?.uri).toBe("a2ui://demo/revenue-report");
    expect(extraction.fallbackText).toContain("net margin");

    const surfaces = reduceA2uiMessages(
      extraction.resources[0]?.messages ?? [],
    );
    expect(surfaces).toHaveLength(1);
    const surface = surfaces[0] as (typeof surfaces)[number];
    expect(surface.supported).toBe(true);
    expect(surface.catalogId).toBe(A2UI_CHARTS_CATALOG_ID);

    /* The extension components, wired for the selection loop. */
    const chart = surface.components.report_chart;
    expect(chart?.component).toBe("Chart");
    expect(chart?.series).toEqual([
      expect.objectContaining({ key: "expenses", type: "bar" }),
      expect.objectContaining({
        key: "forecast",
        type: "line",
        lineStyle: "dashed",
        connectNulls: false,
      }),
      expect.objectContaining({ key: "revenue", type: "bar" }),
      expect.objectContaining({ key: "margin", type: "line", axis: "right" }),
    ]);
    expect(chart?.yAxes).toMatchObject({
      left: { format: "currency", maximumFractionDigits: 0, includeZero: true },
      right: {
        format: "percent",
        maximumFractionDigits: 0,
        includeZero: true,
        min: 0,
        max: 0.4,
      },
    });
    expect(chart?.selection).toEqual({ path: "/selection", mode: "point" });
    expect(chart?.description).toContain("Actual revenue and expenses");
    expect(chart?.legend).toEqual({ path: "/hiddenSeries" });
    expect(chart?.dataTable).toBe(true);
    expect(chart?.referenceBands).toEqual([
      expect.objectContaining({ from: 230_000, to: 260_000, label: "" }),
    ]);
    expect(chart?.referenceLines).toEqual([
      expect.objectContaining({ value: 250_000, label: "Target: $250k" }),
    ]);
    expect(surface.components.stat_margin?.component).toBe("Stat");
    expect(surface.components.stat_margin).toMatchObject({
      comparisonLabel: "vs. January",
      trend: "up",
      status: "positive",
      sparkline: { path: "/report/stats/marginTrend" },
    });

    /* Server-seeded data: rows plus a preselected latest month. */
    const monthly = pointerGet(surface.dataModel, "/report/monthly");
    expect(Array.isArray(monthly) && monthly.length).toBe(8);
    expect((monthly as Array<{ forecast: number | null }>).at(-1)?.forecast).toBe(
      null,
    );
    expect(pointerGet(surface.dataModel, "/selection/x")).toBe("Aug");
  });

  it("appends the revenue analysis to the report surface in place", async () => {
    /* Turn 1: the report arrives as a charts-catalog surface. */
    const first = await streamAndReduce({
      input: [userMessage("revenue chart please")],
    });
    const reportOutput = first.state.items.find(
      (i) => i.type === "function_call_output",
    ) as FunctionCallOutputItem;

    /* Turn 2: the user picked May in the chart and hit analyze. */
    const { state } = await streamAndReduce({
      input: [
        userMessage("revenue chart please"),
        {
          type: "message",
          role: "assistant",
          content: [{ type: "output_text", text: "report sent" }],
        },
        {
          type: "message",
          role: "user",
          content: [
            { type: "input_text", text: "UI action: analyze_revenue" },
            {
              type: "a2ui",
              mime_type: "application/a2ui+json",
              data: [
                {
                  version: "v0.9.1",
                  action: {
                    name: "analyze_revenue",
                    surfaceId: "demo_revenue_report",
                    sourceComponentId: "analyze",
                    timestamp: "2026-07-11T18:00:00.000Z",
                    context: {
                      selection: {
                        mode: "point",
                        index: 4,
                        x: "May",
                        values: { revenue: 241_600, expenses: 178_300 },
                      },
                    },
                  },
                },
              ],
            },
          ],
        },
      ],
    });

    const message = state.items.find(isMessageItem) as MessageItem;
    expect(messageText(message)).toContain("May");

    const call = state.items.find((i) => i.type === "function_call") as {
      name: string;
      arguments: string;
    };
    expect(call.name).toBe("analyze_selection");
    expect(JSON.parse(call.arguments)).toEqual({ month: "May" });

    /* The analysis targets the existing surface: update envelopes only. */
    const insightOutput = state.items.find(
      (i) => i.type === "function_call_output",
    ) as FunctionCallOutputItem;
    const messages =
      extractA2uiResources(insightOutput.output).resources[0]?.messages ?? [];
    expect(messages.length).toBeGreaterThan(0);
    expect(messages.some((m) => m.createSurface)).toBe(false);
    expect(
      messages.every(
        (m) =>
          (m.updateComponents?.surfaceId ?? m.updateDataModel?.surfaceId) ===
          "demo_revenue_report",
      ),
    ).toBe(true);

    /* Reduced conversation-wide, the report — still anchored at
     * get_revenue_report's call — gains the insight section. */
    const byCall = reduceA2uiOutputs([
      { callId: "call_report", output: reportOutput.output },
      { callId: "call_insight", output: insightOutput.output },
    ]);
    const reportGroup = byCall.get("call_report");
    expect(reportGroup?.surfaces).toHaveLength(1);
    const surface = reportGroup?.surfaces[0];
    expect(surface?.components.report_layout?.children).toContain(
      "insight_body",
    );
    expect(pointerGet(surface?.dataModel, "/insight/month")).toBe("May");
    expect(pointerGet(surface?.dataModel, "/insight/summary")).toContain(
      "net margin",
    );

    const insightGroup = byCall.get("call_insight");
    expect(insightGroup?.surfaces).toHaveLength(0);
    expect(insightGroup?.showFallback).toBe(false);
  });

  it("returns a single-series donut chart for revenue mix asks", async () => {
    const { state } = await streamAndReduce({
      input: [userMessage("show revenue mix")],
    });
    const call = state.items.find((item) => item.type === "function_call") as {
      name: string;
    };
    expect(call.name).toBe("get_revenue_mix");
    const output = state.items.find(
      (item) => item.type === "function_call_output",
    ) as FunctionCallOutputItem;
    const messages = extractA2uiResources(output.output).resources[0]?.messages ?? [];
    expect(reduceA2uiMessages(messages)[0]?.components.chart).toMatchObject({
      component: "Chart",
      variant: "donut",
      series: [{ key: "revenue" }],
      sort: "descending",
      centerLabel: "FY26 revenue",
    });
  });

  it("returns a stacked-percent chart for channel share asks", async () => {
    const { state } = await streamAndReduce({ input: [userMessage("show channel share")] });
    const output = state.items.find((item) => item.type === "function_call_output") as FunctionCallOutputItem;
    const messages = extractA2uiResources(output.output).resources[0]?.messages ?? [];
    expect(reduceA2uiMessages(messages)[0]?.components.chart).toMatchObject({
      component: "Chart", variant: "bar", normalize: "stackedPercent",
      selection: { path: "/selectedSeries", mode: "series" },
    });
  });

  it("returns a numeric bubble chart for opportunity asks", async () => {
    const { state } = await streamAndReduce({
      input: [userMessage("show account opportunity")],
    });
    const call = state.items.find((item) => item.type === "function_call") as {
      name: string;
    };
    expect(call.name).toBe("get_account_opportunity");
    const output = state.items.find(
      (item) => item.type === "function_call_output",
    ) as FunctionCallOutputItem;
    const messages = extractA2uiResources(output.output).resources[0]?.messages ?? [];
    expect(reduceA2uiMessages(messages)[0]?.components.chart).toMatchObject({
      component: "Chart",
      variant: "bubble",
      x: { key: "engagement", type: "number" },
      size: { key: "value" },
    });
  });

  it("returns focused progress and sparkline leaves for delivery health asks", async () => {
    const { state } = await streamAndReduce({ input: [userMessage("show delivery health")] });
    const call = state.items.find((item) => item.type === "function_call") as { name: string };
    expect(call.name).toBe("get_delivery_health");
    const output = state.items.find((item) => item.type === "function_call_output") as FunctionCallOutputItem;
    const messages = extractA2uiResources(output.output).resources[0]?.messages ?? [];
    const components = reduceA2uiMessages(messages)[0]?.components;
    expect(components?.progress?.component).toBe("Progress");
    expect(components?.sparkline?.component).toBe("Sparkline");
    expect(components?.gauge?.component).toBe("Gauge");
  });

  it("returns a selectable bubble map for location asks", async () => {
    const { state } = await streamAndReduce({
      input: [userMessage("show me the customer map")],
    });
    const call = state.items.find((item) => item.type === "function_call") as {
      name: string;
    };
    expect(call.name).toBe("get_customer_map");
    const output = state.items.find(
      (item) => item.type === "function_call_output",
    ) as FunctionCallOutputItem;
    const extraction = extractA2uiResources(output.output);
    expect(extraction.resources[0]?.uri).toBe("a2ui://demo/customer-map");
    const surface = reduceA2uiMessages(
      extraction.resources[0]?.messages ?? [],
    )[0];
    expect(surface?.catalogId).toBe(A2UI_MAPS_CATALOG_ID);
    expect(surface?.components.map).toMatchObject({
      component: "Map",
      variant: "bubble",
      latitude: { key: "latitude" },
      longitude: { key: "longitude" },
      selection: { path: "/selectedLocation" },
    });
    expect(surface?.components.map?.flows).toMatchObject({
      data: { path: "/flows" },
      fromLatitude: { key: "fromLatitude" },
      toLongitude: { key: "toLongitude" },
      selection: { path: "/selectedConnection" },
    });
    expect(pointerGet(surface?.dataModel, "/customers")).toHaveLength(5);
    expect(pointerGet(surface?.dataModel, "/flows")).toHaveLength(4);
  });

  it("returns a range-selectable traffic chart for trend asks", async () => {
    const { state } = await streamAndReduce({
      input: [userMessage("what's the traffic trend?")],
    });

    const call = state.items.find((i) => i.type === "function_call") as {
      name: string;
    };
    expect(call.name).toBe("get_traffic_report");

    const output = state.items.find(
      (i) => i.type === "function_call_output",
    ) as FunctionCallOutputItem;
    const extraction = extractA2uiResources(output.output);
    expect(extraction.resources[0]?.uri).toBe("a2ui://demo/traffic-report");

    const surfaces = reduceA2uiMessages(
      extraction.resources[0]?.messages ?? [],
    );
    const surface = surfaces[0] as (typeof surfaces)[number];
    expect(surface.supported).toBe(true);
    expect(surface.catalogId).toBe(A2UI_CHARTS_CATALOG_ID);

    const chart = surface.components.traffic_chart;
    expect(chart?.component).toBe("Chart");
    expect(chart?.variant).toBe("area");
    expect(chart?.x).toMatchObject({ type: "time", format: "short" });
    expect(chart?.selection).toEqual({ path: "/range", mode: "range" });

    /* Server-seeded data: 45 daily rows plus a full-window selection. */
    const daily = pointerGet(surface.dataModel, "/traffic/daily");
    expect(Array.isArray(daily) && daily.length).toBe(45);
    expect(pointerGet(surface.dataModel, "/range")).toEqual({
      mode: "range",
      startIndex: 0,
      endIndex: 44,
      from: "2026-05-01T00:00:00.000Z",
      to: "2026-06-14T00:00:00.000Z",
    });
  });

  it("summarizes a dragged range in place, clamping wild indices", async () => {
    const summarize = (range: Record<string, unknown>) =>
      streamAndReduce({
        input: [
          {
            type: "message",
            role: "user",
            content: [
              { type: "input_text", text: "UI action: summarize_range" },
              {
                type: "a2ui",
                mime_type: "application/a2ui+json",
                data: [
                  {
                    version: "v0.9.1",
                    action: {
                      name: "summarize_range",
                      surfaceId: "demo_traffic_report",
                      sourceComponentId: "summarize",
                      timestamp: "2026-07-11T18:00:00.000Z",
                      context: { range },
                    },
                  },
                ],
              },
            ],
          },
        ],
      });

    /* A one-week drag-selected window (May 8 – May 14). */
    const { state } = await summarize({
      mode: "range",
      startIndex: 7,
      endIndex: 13,
      from: "2026-05-08T00:00:00.000Z",
      to: "2026-05-14T00:00:00.000Z",
    });
    const call = state.items.find((i) => i.type === "function_call") as {
      name: string;
      arguments: string;
    };
    expect(call.name).toBe("summarize_range");
    expect(JSON.parse(call.arguments)).toEqual({
      from: "2026-05-08T00:00:00.000Z",
      to: "2026-05-14T00:00:00.000Z",
      days: 7,
    });

    /* Update envelopes only, targeting the existing traffic surface. */
    const output = state.items.find(
      (i) => i.type === "function_call_output",
    ) as FunctionCallOutputItem;
    const messages =
      extractA2uiResources(output.output).resources[0]?.messages ?? [];
    expect(messages.some((m) => m.createSurface)).toBe(false);
    expect(
      messages.every(
        (m) =>
          (m.updateComponents?.surfaceId ?? m.updateDataModel?.surfaceId) ===
          "demo_traffic_report",
      ),
    ).toBe(true);

    /* The figures are recomputed server-side from the source series. */
    const message = state.items.find(isMessageItem) as MessageItem;
    expect(messageText(message)).toContain("May 8 – May 14");
    expect(messageText(message)).toContain("7 days");

    /* Wild indices are clamped to the series bounds (and reordered). */
    const clamped = await summarize({ startIndex: 999, endIndex: -3 });
    const clampedCall = clamped.state.items.find(
      (i) => i.type === "function_call",
    ) as { arguments: string };
    expect(JSON.parse(clampedCall.arguments)).toEqual({
      from: "2026-05-01T00:00:00.000Z",
      to: "2026-06-14T00:00:00.000Z",
      days: 45,
    });
  });

  it("acknowledges unknown A2UI actions without a tool round-trip", async () => {
    const { state } = await streamAndReduce({
      input: [
        {
          type: "message",
          role: "user",
          content: [
            { type: "input_text", text: "UI action: custom_action" },
            {
              type: "a2ui",
              mime_type: "application/a2ui+json",
              data: [
                {
                  version: "v0.9.1",
                  action: {
                    name: "custom_action",
                    surfaceId: "s",
                    sourceComponentId: "c",
                    timestamp: "2026-07-10T18:00:00.000Z",
                    context: { probe: 42 },
                  },
                },
              ],
            },
          ],
        },
      ],
    });
    const types = state.items.map((i) => i.type);
    expect(types).not.toContain("function_call");
    const message = state.items.find(isMessageItem) as MessageItem;
    expect(messageText(message)).toContain("custom_action");
    expect(messageText(message)).toContain("42");
  });
});
