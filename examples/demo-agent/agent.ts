/** A standalone reference implementation of the Open Responses protocol. */

const A2UI_MIME_TYPE = "application/a2ui+json";
const A2UI_CHARTS_CATALOG_ID =
  "https://github.com/artemis-sh/a2ui-catalogs/blob/main/catalogs/charts/v1/catalog.json";
const A2UI_MAPS_CATALOG_ID =
  "https://github.com/artemis-sh/a2ui-catalogs/blob/main/catalogs/maps/v1/catalog.json";

type ContentPart = Record<string, unknown> & { type: string };
type ORItem = Record<string, unknown> & { type: string };

const ALPHABET = "0123456789abcdefghijklmnopqrstuvwxyz";

function newId(prefix: string): string {
  const bytes = crypto.getRandomValues(new Uint8Array(24));
  let suffix = "";
  for (const byte of bytes) suffix += ALPHABET[byte % ALPHABET.length];
  return `${prefix}_${suffix}`;
}

interface DemoRequestBody {
  input?: unknown;
  stream?: boolean;
  instructions?: string;
  model?: string;
}

interface DemoEvent {
  type: string;
  [key: string]: unknown;
}

const encoder = new TextEncoder();

/** An A2UI action carried in a user message's `a2ui` content part. */
interface DemoA2uiAction {
  name: string;
  context: Record<string, unknown>;
}

function a2uiActionFromParts(
  parts: Array<Record<string, unknown>>,
): DemoA2uiAction | null {
  for (const part of parts) {
    if (part.type !== "a2ui" || !Array.isArray(part.data)) continue;
    for (const raw of part.data as Array<Record<string, unknown>>) {
      const action = raw?.action as Record<string, unknown> | undefined;
      if (action && typeof action.name === "string") {
        return {
          name: action.name,
          context:
            typeof action.context === "object" && action.context !== null
              ? (action.context as Record<string, unknown>)
              : {},
        };
      }
    }
  }
  return null;
}

function lastUserText(input: unknown): {
  text: string;
  images: number;
  files: number;
  turns: number;
  a2uiAction: DemoA2uiAction | null;
} {
  let text = "";
  let images = 0;
  let files = 0;
  let turns = 0;
  let a2uiAction: DemoA2uiAction | null = null;
  if (typeof input === "string")
    return { text: input, images: 0, files: 0, turns: 1, a2uiAction: null };
  if (!Array.isArray(input)) return { text, images, files, turns, a2uiAction };
  for (const raw of input) {
    const item = raw as Record<string, unknown>;
    if (item.type === "message" && item.role === "user") {
      turns += 1;
      text = "";
      images = 0;
      files = 0;
      a2uiAction = null;
      if (typeof item.content === "string") {
        text = item.content;
      } else if (Array.isArray(item.content)) {
        for (const part of item.content as Array<Record<string, unknown>>) {
          if (part.type === "input_text" && typeof part.text === "string") {
            text += part.text;
          }
          if (part.type === "input_image") images += 1;
          if (part.type === "input_file") files += 1;
        }
        a2uiAction = a2uiActionFromParts(
          item.content as Array<Record<string, unknown>>,
        );
      }
    }
  }
  return { text, images, files, turns, a2uiAction };
}

function chunkText(text: string, size = 12): string[] {
  const chunks: string[] = [];
  for (let i = 0; i < text.length; i += size) {
    chunks.push(text.slice(i, i + size));
  }
  return chunks;
}

const MARKDOWN_SAMPLE = `Here's a quick tour of what I can render:

## Markdown showcase

**Bold**, *italic*, ~~strikethrough~~, \`inline code\`, and [links](https://openresponses.org).

### A table

| Feature | Status |
| --- | --- |
| Streaming | ✅ |
| Reasoning | ✅ |
| Tool calls | ✅ |

### Code

\`\`\`ts
export function greet(name: string): string {
  return \`Hello, \${name}!\`;
}
\`\`\`

> Everything you see here streamed over the Open Responses protocol.

1. First
2. Second
3. Third

That's the demo!`;

/* ------------------------------ A2UI showcase ----------------------------- */

const A2UI_VERSION = "v0.9.1";
const A2UI_CATALOG_ID =
  "https://a2ui.org/specification/v0_9_1/catalogs/basic/catalog.json";

/** Wraps A2UI messages in the MCP embedded-resource convention, alongside a
 * textual fallback for clients that can't render the resource. */
function a2uiToolOutput(
  uri: string,
  fallback: string,
  messages: Array<Record<string, unknown>>,
): ContentPart[] {
  return [
    { type: "output_text", text: fallback },
    {
      type: "resource",
      resource: {
        uri,
        mimeType: A2UI_MIME_TYPE,
        text: JSON.stringify(messages),
      },
    } as unknown as ContentPart,
  ];
}

/** The reservation form surface (exercises most of the Basic Catalog). */
function reservationFormMessages(): Array<Record<string, unknown>> {
  const surfaceId = "demo_reservation_form";
  const requiredName = {
    condition: {
      call: "required",
      args: { value: { path: "/reservation/name" } },
    },
    message: "A reservation name is required.",
  };
  const components = [
    { id: "root", component: "Card", child: "layout" },
    {
      id: "layout",
      component: "Column",
      children: [
        "title",
        "subtitle",
        "rule",
        "name",
        "when",
        "party",
        "seating",
        "notify",
        "footer",
      ],
    },
    {
      id: "title",
      component: "Text",
      variant: "h3",
      text: "Book a table at Chez Parley",
    },
    {
      id: "subtitle",
      component: "Text",
      variant: "caption",
      text: "The demo bistro always has room — this form arrived as an A2UI resource in a tool result.",
    },
    { id: "rule", component: "Divider" },
    {
      id: "name",
      component: "TextField",
      label: "Reservation name",
      value: { path: "/reservation/name" },
      checks: [requiredName],
    },
    {
      id: "when",
      component: "DateTimeInput",
      label: "Date & time",
      enableDate: true,
      enableTime: true,
      value: { path: "/reservation/when" },
    },
    {
      id: "party",
      component: "Slider",
      label: "Party size",
      min: 1,
      max: 12,
      value: { path: "/reservation/partySize" },
    },
    {
      id: "seating",
      component: "ChoicePicker",
      label: "Seating",
      variant: "mutuallyExclusive",
      displayStyle: "chips",
      options: [
        { label: "Dining room", value: "dining room" },
        { label: "Patio", value: "patio" },
        { label: "Chef's bar", value: "chef's bar" },
      ],
      value: { path: "/reservation/seating" },
    },
    {
      id: "notify",
      component: "CheckBox",
      label: "Email me a confirmation",
      value: { path: "/reservation/notify" },
    },
    { id: "footer", component: "Row", justify: "end", children: ["submit"] },
    { id: "submit_text", component: "Text", text: "Request reservation" },
    {
      id: "submit",
      component: "Button",
      variant: "primary",
      child: "submit_text",
      action: {
        event: {
          name: "submit_reservation",
          context: { reservation: { path: "/reservation" } },
        },
      },
      checks: [requiredName],
    },
  ];
  return [
    {
      version: A2UI_VERSION,
      createSurface: { surfaceId, catalogId: A2UI_CATALOG_ID },
    },
    { version: A2UI_VERSION, updateComponents: { surfaceId, components } },
    {
      version: A2UI_VERSION,
      updateDataModel: {
        surfaceId,
        path: "/reservation",
        value: {
          name: "",
          when: "",
          partySize: 2,
          seating: ["dining room"],
          notify: true,
        },
      },
    },
  ];
}

/**
 * The confirmation: no new surface — these envelopes target the existing
 * `demo_reservation_form` surface (created by an earlier tool result) and
 * morph it in place, the standard A2UI way to reflect an action's outcome.
 * Data lands first so the swapped components bind in the same commit; the
 * details are server-written (not read from the client's local edits) so
 * replaying the conversation reproduces the confirmed state.
 * (Exercises template children + relative bindings.)
 */
function confirmationUpdateMessages(
  details: Array<{ label: string; value: string }>,
): Array<Record<string, unknown>> {
  const surfaceId = "demo_reservation_form";
  const components = [
    // Re-point the existing root at the confirmation layout; the old form
    // components stay in the surface's map, just unreferenced.
    { id: "root", component: "Card", child: "confirm_layout" },
    {
      id: "confirm_layout",
      component: "Column",
      children: [
        "confirm_header",
        "confirm_rule",
        "confirm_details",
        "confirm_footnote",
      ],
    },
    {
      id: "confirm_header",
      component: "Row",
      align: "center",
      children: ["confirm_icon", "confirm_title"],
    },
    { id: "confirm_icon", component: "Icon", name: "check" },
    {
      id: "confirm_title",
      component: "Text",
      variant: "h4",
      text: "Reservation confirmed",
    },
    { id: "confirm_rule", component: "Divider" },
    {
      id: "confirm_details",
      component: "List",
      children: { path: "/confirmation/details", componentId: "confirm_row" },
    },
    {
      id: "confirm_row",
      component: "Row",
      justify: "spaceBetween",
      children: ["confirm_label", "confirm_value"],
    },
    {
      id: "confirm_label",
      component: "Text",
      variant: "caption",
      text: { path: "label" },
    },
    {
      id: "confirm_value",
      component: "Text",
      variant: "h5",
      text: { path: "value" },
    },
    {
      id: "confirm_footnote",
      component: "Text",
      variant: "caption",
      text: "Confirmation #PARLEY-0042 — the demo bistro never overbooks.",
    },
  ];
  return [
    {
      version: A2UI_VERSION,
      updateDataModel: {
        surfaceId,
        path: "/confirmation",
        value: { details },
      },
    },
    { version: A2UI_VERSION, updateComponents: { surfaceId, components } },
  ];
}

/* ------------------------- A2UI charts showcase --------------------------- */

/** The fabricated monthly figures behind the demo revenue report. */
const REVENUE_MONTHS: ReadonlyArray<{
  month: string;
  revenue: number;
  expenses: number;
  forecast: number | null;
  margin: number;
}> = [
  { month: "Jan", revenue: 186_000, expenses: 152_000, forecast: 190_000, margin: 0.183 },
  { month: "Feb", revenue: 198_500, expenses: 156_400, forecast: 201_000, margin: 0.212 },
  { month: "Mar", revenue: 224_300, expenses: 161_200, forecast: 218_000, margin: 0.281 },
  { month: "Apr", revenue: 209_800, expenses: 173_900, forecast: 228_000, margin: 0.171 },
  { month: "May", revenue: 241_600, expenses: 178_300, forecast: 240_000, margin: 0.262 },
  { month: "Jun", revenue: 253_100, expenses: 182_700, forecast: 252_000, margin: 0.278 },
  { month: "Jul", revenue: 275_400, expenses: 189_500, forecast: 268_000, margin: 0.312 },
  { month: "Aug", revenue: 291_200, expenses: 196_800, forecast: null, margin: 0.324 },
] as const;

type RevenueMonth = (typeof REVENUE_MONTHS)[number];

const REVENUE_LAST = REVENUE_MONTHS[REVENUE_MONTHS.length - 1] as RevenueMonth;

const sum = (pick: (m: RevenueMonth) => number): number =>
  REVENUE_MONTHS.reduce((total, m) => total + pick(m), 0);

const monthMargin = (m: RevenueMonth): number =>
  (m.revenue - m.expenses) / m.revenue;

/**
 * The revenue report surface — Parley's first-party charts catalog (Basic
 * Catalog + Chart/Stat). The Chart's point selection binds to /selection in
 * the surface's local data model; the analyze Button sends it back as
 * action context.
 */
function revenueReportMessages(): Array<Record<string, unknown>> {
  const surfaceId = "demo_revenue_report";
  const first = REVENUE_MONTHS[0] as RevenueMonth;
  const totalRevenue = sum((m) => m.revenue);
  const totalExpenses = sum((m) => m.expenses);
  const components = [
    { id: "root", component: "Card", child: "report_layout" },
    {
      id: "report_layout",
      component: "Column",
      children: [
        "report_title",
        "report_subtitle",
        "report_stats",
        "report_chart",
        "report_hint",
        "report_footer",
      ],
    },
    {
      id: "report_title",
      component: "Text",
      variant: "h3",
      text: "Revenue report — FY26",
    },
    {
      id: "report_subtitle",
      component: "Text",
      variant: "caption",
      text: "Actuals and expenses are bars; the dashed plan ends in August, while the right axis tracks net margin.",
    },
    {
      id: "report_stats",
      component: "Row",
      children: ["stat_revenue", "stat_expenses", "stat_margin"],
    },
    {
      id: "stat_revenue",
      component: "Stat",
      label: "Revenue (8 mo)",
      value: { path: "/report/stats/revenue" },
      format: "currency",
      delta: { path: "/report/stats/revenueDelta" },
      comparisonLabel: "vs. January",
      description: "Booked revenue year to date",
      trend: "up",
      status: "positive",
      sparkline: { path: "/report/stats/revenueTrend" },
      weight: 1,
    },
    {
      id: "stat_expenses",
      component: "Stat",
      label: "Expenses (8 mo)",
      value: { path: "/report/stats/expenses" },
      format: "currency",
      delta: { path: "/report/stats/expensesDelta" },
      comparisonLabel: "vs. January",
      description: "Operating costs year to date",
      trend: "down",
      status: "positive",
      sparkline: { path: "/report/stats/expenseTrend" },
      weight: 1,
    },
    {
      id: "stat_margin",
      component: "Stat",
      label: "Net margin",
      value: { path: "/report/stats/margin" },
      format: "percent",
      delta: { path: "/report/stats/marginDelta" },
      comparisonLabel: "vs. January",
      description: "After operating expenses",
      trend: "up",
      status: "positive",
      sparkline: { path: "/report/stats/marginTrend" },
      weight: 1,
    },
    {
      id: "report_chart",
      component: "Chart",
      variant: "bar",
      title: "Revenue actuals, plan, expenses, and margin by month",
      description: "Actual revenue and expenses rise through August. The revenue plan ends in July because August has no forecast; net margin uses the right axis.",
      data: { path: "/report/monthly" },
      x: { key: "month", label: "Month" },
      yAxes: {
        left: {
          label: "USD",
          format: "currency",
          maximumFractionDigits: 0,
          includeZero: true,
        },
        right: {
          label: "Net margin",
          format: "percent",
          maximumFractionDigits: 0,
          includeZero: true,
          min: 0,
          max: 0.4,
        },
      },
      // Recharts presents legend entries in reverse rendering order.
      series: [
        { key: "expenses", label: "Expenses", color: "chart-5", type: "bar" },
        {
          key: "forecast",
          label: "Revenue plan",
          color: "chart-3",
          type: "line",
          lineStyle: "dashed",
          connectNulls: false,
        },
        { key: "revenue", label: "Revenue actual", color: "chart-1", type: "bar" },
        {
          key: "margin",
          label: "Net margin",
          color: "chart-4",
          type: "line",
          axis: "right",
        },
      ],
      referenceBands: [
        {
          from: 230_000,
          to: 260_000,
          label: "",
          color: "chart-2",
        },
      ],
      referenceLines: [
        { value: 250_000, label: "Target: $250k", color: "chart-2" },
      ],
      legend: { path: "/hiddenSeries" },
      selection: { path: "/selection", mode: "point" },
      dataTable: true,
      height: 260,
    },
    {
      id: "report_hint",
      component: "Text",
      variant: "caption",
      text: {
        call: "formatString",
        args: {
          value:
            // biome-ignore lint/suspicious/noTemplateCurlyInString: A2UI formatString interpolation syntax
            "Selected month: ${/selection/x}. The plan is unavailable in August. Click a bar to analyze it.",
        },
      },
    },
    {
      id: "report_footer",
      component: "Row",
      justify: "end",
      children: ["analyze"],
    },
    { id: "analyze_text", component: "Text", text: "Analyze selection" },
    {
      id: "analyze",
      component: "Button",
      variant: "primary",
      child: "analyze_text",
      action: {
        event: {
          name: "analyze_revenue",
          context: { selection: { path: "/selection" } },
        },
      },
    },
  ];
  return [
    {
      version: A2UI_VERSION,
      createSurface: { surfaceId, catalogId: A2UI_CHARTS_CATALOG_ID },
    },
    { version: A2UI_VERSION, updateComponents: { surfaceId, components } },
    {
      version: A2UI_VERSION,
      updateDataModel: {
        surfaceId,
        path: "/report",
        value: {
          monthly: REVENUE_MONTHS.map((m) => ({ ...m })),
          stats: {
            revenue: totalRevenue,
            expenses: totalExpenses,
            margin: (totalRevenue - totalExpenses) / totalRevenue,
            revenueDelta: REVENUE_LAST.revenue / first.revenue - 1,
            expensesDelta: REVENUE_LAST.expenses / first.expenses - 1,
            marginDelta: monthMargin(REVENUE_LAST) - monthMargin(first),
            revenueTrend: REVENUE_MONTHS.map((month) => month.revenue),
            expenseTrend: REVENUE_MONTHS.map((month) => month.expenses),
            marginTrend: REVENUE_MONTHS.map(monthMargin),
          },
        },
      },
    },
    { version: A2UI_VERSION, updateDataModel: { surfaceId, path: "/hiddenSeries", value: [] } },
    {
      version: A2UI_VERSION,
      updateDataModel: {
        surfaceId,
        path: "/selection",
        value: {
          mode: "point",
          index: REVENUE_MONTHS.length - 1,
          x: REVENUE_LAST.month,
          values: {
            revenue: REVENUE_LAST.revenue,
            expenses: REVENUE_LAST.expenses,
            forecast: REVENUE_LAST.forecast,
          },
        },
      },
    },
  ];
}

function revenueMixMessages(): Array<Record<string, unknown>> {
  const surfaceId = "demo_revenue_mix";
  const components = [
    { id: "root", component: "Card", child: "layout" },
    { id: "layout", component: "Column", children: ["title", "subtitle", "chart"] },
    { id: "title", component: "Text", variant: "h3", text: "Revenue mix" },
    {
      id: "subtitle",
      component: "Text",
      variant: "caption",
      text: "A donut chart uses one value series across named categories.",
    },
    {
      id: "chart",
      component: "Chart",
      variant: "donut",
      title: "Revenue by channel",
      data: { path: "/mix/channels" },
      x: { key: "channel", label: "Channel" },
      series: [{ key: "revenue", label: "Revenue" }],
      sort: "descending",
      centerValue: { path: "/mix/total" },
      centerLabel: "FY26 revenue",
      height: 280,
    },
  ];
  return [
    {
      version: A2UI_VERSION,
      createSurface: { surfaceId, catalogId: A2UI_CHARTS_CATALOG_ID },
    },
    { version: A2UI_VERSION, updateComponents: { surfaceId, components } },
    {
      version: A2UI_VERSION,
      updateDataModel: {
        surfaceId,
        path: "/mix",
        value: {
          total: "$1.53M",
          channels: [
            { channel: "Enterprise", revenue: 640_000 },
            { channel: "Self-serve", revenue: 430_000 },
            { channel: "Partners", revenue: 285_000 },
            { channel: "Services", revenue: 175_000 },
          ],
        },
      },
    },
  ];
}

function channelShareMessages(): Array<Record<string, unknown>> {
  const surfaceId = "demo_channel_share";
  const components = [
    { id: "root", component: "Card", child: "layout" },
    { id: "layout", component: "Column", children: ["title", "chart"] },
    { id: "title", component: "Text", variant: "h3", text: "Channel share" },
    { id: "chart", component: "Chart", variant: "bar", title: "Revenue share by quarter", description: "Each stacked bar sums to 100 percent. Select a legend entry to bind its series identity.", data: { path: "/share" }, x: { key: "quarter", label: "Quarter" }, y: { format: "percent", includeZero: true }, series: [{ key: "enterprise", label: "Enterprise", color: "chart-1" }, { key: "selfServe", label: "Self-serve", color: "chart-2" }, { key: "partners", label: "Partners", color: "chart-3" }], normalize: "stackedPercent", legend: { path: "/hiddenSeries" }, selection: { path: "/selectedSeries", mode: "series" }, height: 260 },
  ];
  return [
    { version: A2UI_VERSION, createSurface: { surfaceId, catalogId: A2UI_CHARTS_CATALOG_ID } },
    { version: A2UI_VERSION, updateComponents: { surfaceId, components } },
    { version: A2UI_VERSION, updateDataModel: { surfaceId, path: "/share", value: [{ quarter: "Q1", enterprise: 520, selfServe: 270, partners: 110 }, { quarter: "Q2", enterprise: 560, selfServe: 330, partners: 125 }, { quarter: "Q3", enterprise: 610, selfServe: 370, partners: 155 }] } },
    { version: A2UI_VERSION, updateDataModel: { surfaceId, path: "/hiddenSeries", value: [] } },
  ];
}

function accountOpportunityMessages(): Array<Record<string, unknown>> {
  const surfaceId = "demo_account_opportunity";
  const components = [
    { id: "root", component: "Card", child: "layout" },
    { id: "layout", component: "Column", children: ["title", "subtitle", "chart"] },
    { id: "title", component: "Text", variant: "h3", text: "Account opportunity" },
    {
      id: "subtitle",
      component: "Text",
      variant: "caption",
      text: "Bubble position compares engagement and opportunity; size shows account value.",
    },
    {
      id: "chart",
      component: "Chart",
      variant: "bubble",
      title: "Engagement versus opportunity",
      data: { path: "/accounts" },
      x: { key: "engagement", label: "Engagement score", type: "number" },
      y: { label: "Opportunity score", includeZero: true },
      size: { key: "value" },
      series: [{ key: "opportunity", label: "Opportunity", color: "chart-4" }],
      height: 280,
    },
  ];
  return [
    {
      version: A2UI_VERSION,
      createSurface: { surfaceId, catalogId: A2UI_CHARTS_CATALOG_ID },
    },
    { version: A2UI_VERSION, updateComponents: { surfaceId, components } },
    {
      version: A2UI_VERSION,
      updateDataModel: {
        surfaceId,
        path: "/accounts",
        value: [
          { engagement: 28, opportunity: 42, value: 45 },
          { engagement: 45, opportunity: 61, value: 120 },
          { engagement: 63, opportunity: 55, value: 80 },
          { engagement: 76, opportunity: 82, value: 210 },
          { engagement: 88, opportunity: 73, value: 155 },
        ],
      },
    },
  ];
}

function deliveryHealthMessages(): Array<Record<string, unknown>> {
  const surfaceId = "demo_delivery_health";
  const components = [
    { id: "root", component: "Card", child: "layout" },
    { id: "layout", component: "Column", children: ["title", "subtitle", "metrics"] },
    { id: "title", component: "Text", variant: "h3", text: "Delivery health" },
    { id: "subtitle", component: "Text", variant: "caption", text: "Focused chart leaves for a compact operational summary." },
    { id: "metrics", component: "Row", children: ["progress", "sparkline", "gauge"] },
    { id: "progress", component: "Progress", label: "Sprint completion", value: { path: "/delivery/completed" }, max: { path: "/delivery/planned" }, target: { path: "/delivery/target" }, format: "percent", weight: 1 },
    { id: "sparkline", component: "Sparkline", label: "Deploys per day", data: { path: "/delivery/deploys" }, color: "chart-2", weight: 1 },
    { id: "gauge", component: "Gauge", label: "Release confidence", value: { path: "/delivery/confidence" }, min: 0, max: 1, format: "percent", weight: 1 },
  ];
  return [
    { version: A2UI_VERSION, createSurface: { surfaceId, catalogId: A2UI_CHARTS_CATALOG_ID } },
    { version: A2UI_VERSION, updateComponents: { surfaceId, components } },
    { version: A2UI_VERSION, updateDataModel: { surfaceId, path: "/delivery", value: { completed: 37, planned: 48, target: 40, confidence: 0.82, deploys: [3, 5, 4, 7, 6, 9, 8] } } },
  ];
}

function customerMapMessages(): Array<Record<string, unknown>> {
  const surfaceId = "demo_customer_map";
  const components = [
    { id: "root", component: "Card", child: "layout" },
    {
      id: "layout",
      component: "Column",
      children: ["title", "subtitle", "map", "footer"],
    },
    { id: "title", component: "Text", variant: "h3", text: "Customer footprint" },
    {
      id: "subtitle",
      component: "Text",
      variant: "caption",
      text: "Revenue flows from New York to each customer region. Select a location or connection to explore it.",
    },
    {
      id: "map",
      component: "Map",
      title: "Global customer revenue flows",
      description:
        "Customer locations sized by annual revenue, with schematic connections from New York.",
      height: 340,
      variant: "bubble",
      data: { path: "/customers" },
      latitude: { key: "latitude" },
      longitude: { key: "longitude" },
      idField: { key: "id" },
      labelField: { key: "name" },
      value: { key: "revenue", label: "Annual revenue", format: "currency", currency: "USD", maximumFractionDigits: 0 },
      color: "chart-2",
      selection: { path: "/selectedLocation" },
      flows: {
        data: { path: "/flows" },
        fromLatitude: { key: "fromLatitude" },
        fromLongitude: { key: "fromLongitude" },
        toLatitude: { key: "toLatitude" },
        toLongitude: { key: "toLongitude" },
        idField: { key: "id" },
        labelField: { key: "label" },
        color: "chart-4",
        animated: true,
        selection: { path: "/selectedConnection" },
      },
      dataTable: true,
    },
    { id: "footer", component: "Row", justify: "end", children: ["analyze"] },
    { id: "analyze_text", component: "Text", text: "Analyze location" },
    {
      id: "analyze",
      component: "Button",
      variant: "primary",
      child: "analyze_text",
      action: {
        event: {
          name: "analyze_location",
          context: { selection: { path: "/selectedLocation" } },
        },
      },
    },
  ];
  return [
    {
      version: A2UI_VERSION,
      createSurface: { surfaceId, catalogId: A2UI_MAPS_CATALOG_ID },
    },
    { version: A2UI_VERSION, updateComponents: { surfaceId, components } },
    {
      version: A2UI_VERSION,
      updateDataModel: {
        surfaceId,
        path: "/customers",
        value: [
          { id: "nyc", name: "New York", latitude: 40.7128, longitude: -74.006, revenue: 425_000 },
          { id: "london", name: "London", latitude: 51.5072, longitude: -0.1276, revenue: 310_000 },
          { id: "bogota", name: "Bogotá", latitude: 4.711, longitude: -74.0721, revenue: 190_000 },
          { id: "singapore", name: "Singapore", latitude: 1.3521, longitude: 103.8198, revenue: 265_000 },
          { id: "sydney", name: "Sydney", latitude: -33.8688, longitude: 151.2093, revenue: 225_000 },
        ],
      },
    },
    {
      version: A2UI_VERSION,
      updateDataModel: {
        surfaceId,
        path: "/flows",
        value: [
          { id: "nyc-london", label: "New York → London", fromLatitude: 40.7128, fromLongitude: -74.006, toLatitude: 51.5072, toLongitude: -0.1276, revenue: 310_000 },
          { id: "nyc-bogota", label: "New York → Bogotá", fromLatitude: 40.7128, fromLongitude: -74.006, toLatitude: 4.711, toLongitude: -74.0721, revenue: 190_000 },
          { id: "nyc-singapore", label: "New York → Singapore", fromLatitude: 40.7128, fromLongitude: -74.006, toLatitude: 1.3521, toLongitude: 103.8198, revenue: 265_000 },
          { id: "nyc-sydney", label: "New York → Sydney", fromLatitude: 40.7128, fromLongitude: -74.006, toLatitude: -33.8688, toLongitude: 151.2093, revenue: 225_000 },
        ],
      },
    },
  ];
}


/**
 * The analysis for one selected month: update envelopes targeting the
 * existing `demo_revenue_report` surface — the insight section is appended
 * to the report card in place, never a new surface.
 */
function revenueInsightMessages(
  row: RevenueMonth,
  summary: string,
): Array<Record<string, unknown>> {
  const surfaceId = "demo_revenue_report";
  const components = [
    {
      id: "report_layout",
      component: "Column",
      children: [
        "report_title",
        "report_subtitle",
        "report_stats",
        "report_chart",
        "report_hint",
        "report_footer",
        "insight_rule",
        "insight_title",
        "insight_body",
      ],
    },
    { id: "insight_rule", component: "Divider" },
    {
      id: "insight_title",
      component: "Text",
      variant: "h5",
      text: {
        call: "formatString",
        // biome-ignore lint/suspicious/noTemplateCurlyInString: A2UI formatString interpolation syntax
        args: { value: "Analysis — ${/insight/month}" },
      },
    },
    {
      id: "insight_body",
      component: "Text",
      text: { path: "/insight/summary" },
    },
  ];
  return [
    {
      version: A2UI_VERSION,
      updateDataModel: {
        surfaceId,
        path: "/insight",
        value: { month: row.month, summary },
      },
    },
    { version: A2UI_VERSION, updateComponents: { surfaceId, components } },
  ];
}

const usd = (value: number): string =>
  `$${Math.round(value).toLocaleString("en-US")}`;
const num = (value: number): string =>
  Math.round(value).toLocaleString("en-US");
const pct = (fraction: number): string =>
  `${fraction >= 0 ? "+" : ""}${(fraction * 100).toFixed(1)}%`;

/* -------------------- A2UI charts showcase: range mode -------------------- */

/**
 * The fabricated daily-sessions series behind the demo traffic report:
 * 45 days from May 1 with a gentle upward trend, a weekly cycle, and a
 * slow swell. Deterministic (UTC math, no locale) so tests can rely on it.
 */
const TRAFFIC_DAYS = Array.from({ length: 45 }, (_, i) => {
  const date = new Date(Date.UTC(2026, 4, 1) + i * 86_400_000);
  return {
    day: date.toISOString(),
    sessions: Math.round(
      3200 +
        i * 28 +
        Math.sin((2 * Math.PI * i) / 7) * 450 +
        Math.sin(i / 9) * 260,
    ),
  };
});

type TrafficDay = (typeof TRAFFIC_DAYS)[number];

const TRAFFIC_FIRST = TRAFFIC_DAYS[0] as TrafficDay;
const TRAFFIC_LAST = TRAFFIC_DAYS[TRAFFIC_DAYS.length - 1] as TrafficDay;

const trafficTotal = (days: readonly TrafficDay[]): number =>
  days.reduce((total, d) => total + d.sessions, 0);

const displayTrafficDay = (iso: string): string => {
  const date = new Date(iso);
  return new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "numeric",
  }).format(date);
};

/**
 * The traffic report surface: an area chart with a `range` selection —
 * dragging across the plot writes {startIndex, endIndex, from, to} into the
 * surface's local data model, and the summarize Button sends it back as
 * action context.
 */
function trafficReportMessages(): Array<Record<string, unknown>> {
  const surfaceId = "demo_traffic_report";
  const components = [
    { id: "root", component: "Card", child: "traffic_layout" },
    {
      id: "traffic_layout",
      component: "Column",
      children: [
        "traffic_title",
        "traffic_subtitle",
        "traffic_chart",
        "traffic_hint",
        "traffic_footer",
      ],
    },
    {
      id: "traffic_title",
      component: "Text",
      variant: "h3",
      text: "Site traffic — last 45 days",
    },
    {
      id: "traffic_subtitle",
      component: "Text",
      variant: "caption",
       text: "ISO timestamps render as dates. Drag across the chart to select a date range in the surface data model.",
    },
    {
      id: "traffic_chart",
      component: "Chart",
      variant: "area",
      title: "Daily sessions",
      data: { path: "/traffic/daily" },
      x: { key: "day", label: "Day", type: "time", format: "short" },
      series: [{ key: "sessions", label: "Sessions", color: "chart-2" }],
      selection: { path: "/range", mode: "range" },
    },
    {
      id: "traffic_hint",
      component: "Text",
      variant: "caption",
      text: {
        call: "formatString",
        args: {
          // biome-ignore lint/suspicious/noTemplateCurlyInString: A2UI formatString interpolation syntax
          value: "Selected range: ${/range/from} – ${/range/to}.",
        },
      },
    },
    {
      id: "traffic_footer",
      component: "Row",
      justify: "end",
      children: ["summarize"],
    },
    { id: "summarize_text", component: "Text", text: "Summarize range" },
    {
      id: "summarize",
      component: "Button",
      variant: "primary",
      child: "summarize_text",
      action: {
        event: {
          name: "summarize_range",
          context: { range: { path: "/range" } },
        },
      },
    },
  ];
  return [
    {
      version: A2UI_VERSION,
      createSurface: { surfaceId, catalogId: A2UI_CHARTS_CATALOG_ID },
    },
    { version: A2UI_VERSION, updateComponents: { surfaceId, components } },
    {
      version: A2UI_VERSION,
      updateDataModel: {
        surfaceId,
        path: "/traffic",
        value: { daily: TRAFFIC_DAYS.map((d) => ({ ...d })) },
      },
    },
    {
      version: A2UI_VERSION,
      updateDataModel: {
        surfaceId,
        path: "/range",
        value: {
          mode: "range",
          startIndex: 0,
          endIndex: TRAFFIC_DAYS.length - 1,
          from: TRAFFIC_FIRST.day,
          to: TRAFFIC_LAST.day,
        },
      },
    },
  ];
}

/** The range summary, appended to the existing traffic surface in place. */
function trafficSummaryMessages(
  window: string,
  summary: string,
): Array<Record<string, unknown>> {
  const surfaceId = "demo_traffic_report";
  const components = [
    {
      id: "traffic_layout",
      component: "Column",
      children: [
        "traffic_title",
        "traffic_subtitle",
        "traffic_chart",
        "traffic_hint",
        "traffic_footer",
        "summary_rule",
        "summary_title",
        "summary_body",
      ],
    },
    { id: "summary_rule", component: "Divider" },
    {
      id: "summary_title",
      component: "Text",
      variant: "h5",
      text: {
        call: "formatString",
        // biome-ignore lint/suspicious/noTemplateCurlyInString: A2UI formatString interpolation syntax
        args: { value: "Summary — ${/summary/window}" },
      },
    },
    {
      id: "summary_body",
      component: "Text",
      text: { path: "/summary/text" },
    },
  ];
  return [
    {
      version: A2UI_VERSION,
      updateDataModel: {
        surfaceId,
        path: "/summary",
        value: { window, text: summary },
      },
    },
    { version: A2UI_VERSION, updateComponents: { surfaceId, components } },
  ];
}

/** Builds the summary turn for a `summarize_range` action. */
function replyForTrafficSummary(action: DemoA2uiAction): BuiltReply {
  const range =
    typeof action.context.range === "object" && action.context.range !== null
      ? (action.context.range as Record<string, unknown>)
      : {};
  /* The selection only names a window; every figure is recomputed from the
   * server's own series, with the indices clamped to its bounds. */
  const toIndex = (value: unknown, fallback: number): number =>
    typeof value === "number" && Number.isFinite(value)
      ? Math.min(Math.max(Math.round(value), 0), TRAFFIC_DAYS.length - 1)
      : fallback;
  let start = toIndex(range.startIndex, 0);
  let end = toIndex(range.endIndex, TRAFFIC_DAYS.length - 1);
  if (end < start) [start, end] = [end, start];

  const windowDays = TRAFFIC_DAYS.slice(start, end + 1);
  const from = (TRAFFIC_DAYS[start] as TrafficDay).day;
  const to = (TRAFFIC_DAYS[end] as TrafficDay).day;
  const window = `${displayTrafficDay(from)} – ${displayTrafficDay(to)}`;
  const total = trafficTotal(windowDays);
  const average = total / windowDays.length;
  const overallAverage = trafficTotal(TRAFFIC_DAYS) / TRAFFIC_DAYS.length;
  const peak = windowDays.reduce((best, d) =>
    d.sessions > best.sessions ? d : best,
  );
  const summary =
    `**${window}** (${windowDays.length} ${windowDays.length === 1 ? "day" : "days"}): ` +
    `**${num(total)}** sessions, averaging **${num(average)}/day** — ` +
    `**${pct(average / overallAverage - 1)}** vs the 45-day average. ` +
    `Peak day was **${peak.day}** with **${num(peak.sessions)}** sessions.`;

  return {
    reasoning: `The user dragged out ${window} in the traffic chart and asked for a summary (an A2UI action carrying the chart's range binding). I'll run summarize_range over that window and append the result to the existing report surface in place.`,
    reply: `I summarized **${window}**: ${num(total)} sessions across ${windowDays.length} days, averaging ${num(average)}/day.\n\nSame loop as the revenue demo, but with a **range** selection: dragging across the chart wrote \`{startIndex, endIndex, from, to}\` into the surface's data model, the button sent it back as action context, and \`summarize_range\` updated the *same* \`surfaceId\` in place. Drag a different window and summarize again — the section refreshes.`,
    tool: {
      name: "summarize_range",
      args: JSON.stringify({ from, to, days: windowDays.length }),
      output: a2uiToolOutput(
        "a2ui://demo/traffic-summary",
        `Traffic summary for ${window}: ${num(total)} sessions over ${windowDays.length} days (avg ${num(average)}/day), peaking on ${peak.day}.`,
        trafficSummaryMessages(window, summary),
      ),
    },
  };
}

/** Builds the analysis turn for an `analyze_revenue` action. */
function replyForRevenueAnalysis(action: DemoA2uiAction): BuiltReply {
  const selection =
    typeof action.context.selection === "object" &&
    action.context.selection !== null
      ? (action.context.selection as Record<string, unknown>)
      : {};
  /* The server owns the report data: the selection only names the month,
   * and the figures are recomputed from the source of truth. */
  const row =
    REVENUE_MONTHS.find((m) => m.month === selection.x) ?? REVENUE_LAST;

  const avgRevenue = sum((m) => m.revenue) / REVENUE_MONTHS.length;
  const avgExpenses = sum((m) => m.expenses) / REVENUE_MONTHS.length;
  const margin = monthMargin(row);
  const avgMargin =
    (sum((m) => m.revenue) - sum((m) => m.expenses)) / sum((m) => m.revenue);
  const summary =
    `**${row.month}** brought in **${usd(row.revenue)}** against ` +
    `**${usd(row.expenses)}** in expenses — a **${(margin * 100).toFixed(1)}%** net margin. ` +
    `Revenue ran **${pct(row.revenue / avgRevenue - 1)}** vs the eight-month average and ` +
    `expenses **${pct(row.expenses / avgExpenses - 1)}**, leaving the margin ` +
    `${margin >= avgMargin ? "ahead of" : "behind"} the period's ${(avgMargin * 100).toFixed(1)}% baseline.`;

  return {
    reasoning: `The user selected ${row.month} in the revenue chart and asked for an analysis (an A2UI action carrying the chart's selection binding). I'll run analyze_selection and append the insight to the existing report surface in place.`,
    reply: `I analyzed **${row.month}**: revenue ${usd(row.revenue)}, expenses ${usd(row.expenses)}, a ${(margin * 100).toFixed(1)}% net margin.\n\nThe \`analyze_selection\` tool returned \`updateDataModel\`/\`updateComponents\` envelopes for the *same* \`surfaceId\`, so the analysis was appended to the report card above **in place**. Click a different bar and analyze again — the section refreshes instead of stacking up.`,
    tool: {
      name: "analyze_selection",
      args: JSON.stringify({ month: row.month }),
      output: a2uiToolOutput(
        "a2ui://demo/revenue-insight",
        `Analysis for ${row.month}: revenue ${usd(row.revenue)}, expenses ${usd(row.expenses)}, net margin ${(margin * 100).toFixed(1)}%.`,
        revenueInsightMessages(row, summary),
      ),
    },
  };
}

const str = (value: unknown, max = 120): string =>
  typeof value === "string" ? value.slice(0, max) : "";

/** Builds the confirmation turn for a submitted reservation action. */
function replyForA2uiAction(action: DemoA2uiAction): BuiltReply {
  if (action.name === "analyze_revenue") {
    return replyForRevenueAnalysis(action);
  }
  if (action.name === "summarize_range") {
    return replyForTrafficSummary(action);
  }
  if (action.name !== "submit_reservation") {
    return {
      reasoning: `The user triggered the A2UI action "${str(action.name, 60)}". I'll acknowledge it and echo the context so they can see the round-trip.`,
      reply: `I received your \`${str(action.name, 60)}\` UI action with this context:\n\n\`\`\`json\n${JSON.stringify(action.context, null, 2).slice(0, 2_000)}\n\`\`\`\n\nA real agent would route it back to the tool that owns the surface.`,
      tool: null,
    };
  }

  const reservation =
    typeof action.context.reservation === "object" &&
    action.context.reservation !== null
      ? (action.context.reservation as Record<string, unknown>)
      : {};
  const name = str(reservation.name, 80) || "Guest";
  const when = str(reservation.when, 40);
  const partySize =
    typeof reservation.partySize === "number" &&
    Number.isFinite(reservation.partySize)
      ? Math.max(1, Math.min(99, Math.round(reservation.partySize)))
      : 2;
  const seating = Array.isArray(reservation.seating)
    ? str(reservation.seating[0], 40)
    : str(reservation.seating, 40);
  const notify = reservation.notify === true;

  const details = [
    { label: "Name", value: name },
    { label: "When", value: when || "Whenever you arrive" },
    {
      label: "Party",
      value: `${partySize} ${partySize === 1 ? "guest" : "guests"}`,
    },
    { label: "Seating", value: seating || "Dining room" },
    {
      label: "Confirmation",
      value: notify ? "Email on its way" : "No email requested",
    },
  ];

  return {
    reasoning: `The user submitted the reservation form (an A2UI action routed back through the conversation). I'll confirm the booking for ${name} by updating the existing form surface in place.`,
    reply: `All set, **${name}**! Your table for **${partySize}** is requested${
      when ? ` for **${when}**` : ""
    }${seating ? ` in the **${seating}**` : ""}. ${
      notify
        ? "A (pretend) confirmation email is on its way."
        : "No confirmation email will be sent."
    }\n\nNotice the form above turned into the confirmation **in place**: \`confirm_reservation\` returned \`updateComponents\`/\`updateDataModel\` envelopes targeting the *same* \`surfaceId\`, so Parley morphed the existing surface instead of rendering a new one. That's the full A2UI loop: tool → typed resource → rendered form → user action → agent-driven update.`,
    tool: {
      name: "confirm_reservation",
      args: JSON.stringify({ name, when, party_size: partySize, seating }),
      output: a2uiToolOutput(
        "a2ui://demo/reservation-confirmation",
        `Reservation confirmed for ${name} (party of ${partySize}).`,
        confirmationUpdateMessages(details),
      ),
    },
  };
}

interface BuiltReply {
  reasoning: string;
  reply: string;
  tool: {
    name: string;
    args: string;
    output: string | ContentPart[];
  } | null;
}

function buildReply(parsed: ReturnType<typeof lastUserText>): BuiltReply {
  const text = parsed.text.trim();
  const lower = text.toLowerCase();

  if (parsed.a2uiAction) {
    return replyForA2uiAction(parsed.a2uiAction);
  }

  if (lower.includes("markdown")) {
    return {
      reasoning:
        "The user wants to see markdown rendering. I'll produce a document exercising headings, tables, code blocks and lists.",
      reply: MARKDOWN_SAMPLE,
      tool: null,
    };
  }

  if (/\b(traffic|trends?|sessions)\b/.test(lower)) {
    const total = trafficTotal(TRAFFIC_DAYS);
    return {
      reasoning:
        "The user wants to see trends. I'll call the demo get_traffic_report tool, which returns a charts-catalog surface with a range-selectable area chart, and explain the drag-to-select loop.",
      reply: `I called \`get_traffic_report\` — another surface from **Parley's charts catalog**, this time an area chart with a **range selection**.\n\nDrag across the chart to select a window, then hit **Summarize range**: the drag writes \`{startIndex, endIndex, from, to}\` into the surface's data model through two-way binding, and the button carries it back to me as action context.`,
      tool: {
        name: "get_traffic_report",
        args: JSON.stringify({ window_days: TRAFFIC_DAYS.length }),
        output: a2uiToolOutput(
          "a2ui://demo/traffic-report",
          `Site traffic, last ${TRAFFIC_DAYS.length} days: ${num(total)} sessions total (avg ${num(total / TRAFFIC_DAYS.length)}/day). Drag a range in the chart to summarize it.`,
          trafficReportMessages(),
        ),
      },
    };
  }

  if (/\b(map|locations?|geograph|customer footprint)\b/.test(lower)) {
    return {
      reasoning:
        "The user wants a geographic view. I'll return the customer-footprint surface from the Maps catalog.",
      reply:
        "I called `get_customer_map` to show the experimental Maps customer footprint with selectable locations and schematic connections.",
      tool: {
        name: "get_customer_map",
        args: JSON.stringify({ metric: "annual revenue" }),
        output: a2uiToolOutput(
          "a2ui://demo/customer-map",
          "Customer footprint across five locations, sized by annual revenue.",
          customerMapMessages(),
        ),
      },
    };
  }

  if (/\b(scatter|bubble|opportunity)\b/.test(lower)) {
    return {
      reasoning:
        "The user wants a relationship chart. I'll return the account-opportunity bubble surface.",
      reply:
        "I called `get_account_opportunity` to show a **bubble chart** with numeric X and Y values plus a size field.",
      tool: {
        name: "get_account_opportunity",
        args: JSON.stringify({ segment: "all accounts" }),
        output: a2uiToolOutput(
          "a2ui://demo/account-opportunity",
          "Account opportunity bubble chart.",
          accountOpportunityMessages(),
        ),
      },
    };
  }

  if (/\b(progress|sparkline|delivery health)\b/.test(lower)) {
    return {
      reasoning: "The user wants compact operational metrics. I'll return the delivery-health leaf-component surface.",
      reply: "I called `get_delivery_health` to show the standalone **Progress** and **Sparkline** chart leaves.",
      tool: { name: "get_delivery_health", args: JSON.stringify({ sprint: "current" }), output: a2uiToolOutput("a2ui://demo/delivery-health", "Delivery health: 37 of 48 planned items complete.", deliveryHealthMessages()) },
    };
  }

  if (/\b(donut|pie|revenue mix|channel mix)\b/.test(lower)) {
    return {
      reasoning:
        "The user wants a composition chart. I'll return the demo revenue-mix donut surface.",
      reply:
        "I called `get_revenue_mix` to show a **donut chart**: one numeric revenue series grouped by channel.",
      tool: {
        name: "get_revenue_mix",
        args: JSON.stringify({ period: "FY26" }),
        output: a2uiToolOutput(
          "a2ui://demo/revenue-mix",
          "Revenue mix by channel.",
          revenueMixMessages(),
        ),
      },
    };
  }

  if (/\b(channel share|stacked percent|share chart)\b/.test(lower)) {
    return {
      reasoning: "The user wants normalized composition. I'll return the stacked-percent channel-share chart.",
      reply: "I called `get_channel_share` to show a **stacked-percent** chart, where every quarter sums to 100%.",
      tool: { name: "get_channel_share", args: JSON.stringify({ metric: "revenue share" }), output: a2uiToolOutput("a2ui://demo/channel-share", "Channel revenue share by quarter.", channelShareMessages()) },
    };
  }

  if (/\b(charts?|revenue|graphs?|dashboard)\b/.test(lower)) {
    const totalRevenue = sum((m) => m.revenue);
    const totalExpenses = sum((m) => m.expenses);
    return {
      reasoning:
        "The user wants to see charts. I'll call the demo get_revenue_report tool, which returns an A2UI surface using Parley's first-party charts catalog, and explain the selection loop.",
      reply: `I called the \`get_revenue_report\` tool and it returned an A2UI surface using **Parley's charts catalog** — the official Basic Catalog extended with native \`Chart\` and \`Stat\` components (the catalog ID names a published JSON Schema contract; nothing is fetched or executed at runtime).\n\nClick a bar to select a month, then hit **Analyze selection**: the chart's selection binding rides along as action context, and my analysis lands on this same surface in place.`,
      tool: {
        name: "get_revenue_report",
        args: JSON.stringify({ period: "Jan–Aug FY26", currency: "USD" }),
        output: a2uiToolOutput(
          "a2ui://demo/revenue-report",
          `Revenue report Jan–Aug FY26: revenue ${usd(totalRevenue)}, expenses ${usd(totalExpenses)}, net margin ${(((totalRevenue - totalExpenses) / totalRevenue) * 100).toFixed(1)}%.`,
          revenueReportMessages(),
        ),
      },
    };
  }

  if (/\b(a2ui|book|reserve|reservation|table|form)\b/.test(lower)) {
    return {
      reasoning:
        "The user wants to see generative UI. I'll call the demo find_table tool, which returns an A2UI form resource, and invite them to submit it.",
      reply: `I called the \`find_table\` tool and it returned a **typed A2UI resource** (\`application/a2ui+json\`) along with its JSON result — Parley rendered it as the form above using native components.\n\nFill it in and hit **Request reservation**: the action flows back to me through the conversation, and I'll confirm your booking by updating this same surface in place.`,
      tool: {
        name: "find_table",
        args: JSON.stringify({ venue: "Chez Parley", date: "tonight" }),
        output: a2uiToolOutput(
          "a2ui://demo/reservation-form",
          "Reservation form for Chez Parley. Fill it in and submit to request a table.",
          reservationFormMessages(),
        ),
      },
    };
  }

  if (lower.includes("weather") || lower.includes("tool")) {
    const city =
      /in ([a-z\s]+)[?.!]?$/i.exec(text)?.[1]?.trim() ?? "San Francisco";
    return {
      reasoning: `The user asked about ${
        lower.includes("weather") ? "the weather" : "tool calling"
      }. I'll call the demo get_weather tool for ${city}, then summarize the result.`,
      reply: `I called the \`get_weather\` tool for **${city}**. It reports **18°C, partly cloudy** with a light breeze — a fabricated but beautifully formatted forecast, since I'm the demo agent. Connect a real agent to get real answers!`,
      tool: {
        name: "get_weather",
        args: JSON.stringify({ city, unit: "celsius" }),
        output: JSON.stringify({
          city,
          temperature_c: 18,
          conditions: "partly cloudy",
          wind_kph: 9,
        }),
      },
    };
  }

  const attachmentNote =
    parsed.images > 0 || parsed.files > 0
      ? ` I can see you attached ${[
          parsed.images > 0
            ? `${parsed.images} image${parsed.images > 1 ? "s" : ""}`
            : null,
          parsed.files > 0
            ? `${parsed.files} file${parsed.files > 1 ? "s" : ""}`
            : null,
        ]
          .filter(Boolean)
          .join(" and ")} — a real agent would be able to analyze ${
          parsed.images + parsed.files > 1 ? "them" : "it"
        }.`
      : "";

  const intro =
    parsed.turns > 1
      ? `We're ${parsed.turns} turns into this conversation — the full transcript is replayed to me each time, exactly as the Open Responses spec prescribes.`
      : "I'm **Parley's standalone demo agent**, a minimal reference implementation of the [Open Responses](https://openresponses.org) protocol.";

  const echo =
    text.length > 0
      ? `\n\nYou said:\n\n> ${text.slice(0, 500).replace(/\n/g, "\n> ")}\n\n`
      : "\n\n";

  return {
    reasoning:
      "The user sent a general message. I'll introduce myself, echo their message back, and suggest things to try.",
    reply: `${intro}${echo}${attachmentNote}\n\nThings to try:\n- Ask me about the **weather** to see a tool call\n- Say **markdown** to see rich rendering\n- Say **book a table** to see generative UI (A2UI)\n- Say **revenue chart** to see the charts catalog\n- Say **revenue mix** to see a donut chart\n- Say **traffic trend** to drag-select a range in a chart\n- Connect your own agent from the **Agents** page`,
    tool: null,
  };
}

function buildEvents(body: DemoRequestBody): {
  events: DemoEvent[];
  response: Record<string, unknown>;
} {
  const parsed = lastUserText(body.input);
  const { reasoning, reply, tool } = buildReply(parsed);

  const responseId = newId("resp");
  const reasoningId = newId("rs");
  const messageId = newId("msg");

  const output: ORItem[] = [];
  const events: DemoEvent[] = [];
  let seq = 0;
  const push = (event: DemoEvent) => {
    events.push({ ...event, sequence_number: seq++ });
  };

  const baseResponse = {
    id: responseId,
    object: "response",
    model: body.model ?? "parley-demo-1",
    created_at: Math.floor(Date.now() / 1000),
  };

  push({
    type: "response.created",
    response: { ...baseResponse, status: "queued", output: [] },
  });
  push({
    type: "response.in_progress",
    response: { ...baseResponse, status: "in_progress", output: [] },
  });

  /* Reasoning item with a streamed summary */
  let outputIndex = 0;
  push({
    type: "response.output_item.added",
    output_index: outputIndex,
    item: {
      id: reasoningId,
      type: "reasoning",
      status: "in_progress",
      summary: [],
    },
  });
  push({
    type: "response.reasoning_summary_part.added",
    item_id: reasoningId,
    output_index: outputIndex,
    summary_index: 0,
    part: { type: "summary_text", text: "" },
  });
  for (const delta of chunkText(reasoning, 18)) {
    push({
      type: "response.reasoning_summary_text.delta",
      item_id: reasoningId,
      output_index: outputIndex,
      summary_index: 0,
      delta,
    });
  }
  push({
    type: "response.reasoning_summary_text.done",
    item_id: reasoningId,
    output_index: outputIndex,
    summary_index: 0,
    text: reasoning,
  });
  const reasoningItem: ORItem = {
    id: reasoningId,
    type: "reasoning",
    status: "completed",
    summary: [{ type: "summary_text", text: reasoning }],
  } as ORItem;
  push({
    type: "response.output_item.done",
    output_index: outputIndex,
    item: reasoningItem,
  });
  output.push(reasoningItem);

  /* Optional demo tool round-trip (internally hosted) */
  if (tool) {
    outputIndex += 1;
    const callId = newId("call");
    const fcId = newId("fc");
    push({
      type: "response.output_item.added",
      output_index: outputIndex,
      item: {
        id: fcId,
        type: "function_call",
        status: "in_progress",
        call_id: callId,
        name: tool.name,
        arguments: "",
      },
    });
    for (const delta of chunkText(tool.args, 10)) {
      push({
        type: "response.function_call_arguments.delta",
        item_id: fcId,
        output_index: outputIndex,
        delta,
      });
    }
    push({
      type: "response.function_call_arguments.done",
      item_id: fcId,
      output_index: outputIndex,
      arguments: tool.args,
    });
    const fcItem: ORItem = {
      id: fcId,
      type: "function_call",
      status: "completed",
      call_id: callId,
      name: tool.name,
      arguments: tool.args,
    };
    push({
      type: "response.output_item.done",
      output_index: outputIndex,
      item: fcItem,
    });
    output.push(fcItem);

    outputIndex += 1;
    const fcoId = newId("fco");
    const fcoItem: ORItem = {
      id: fcoId,
      type: "function_call_output",
      status: "completed",
      call_id: callId,
      output: tool.output,
    };
    push({
      type: "response.output_item.added",
      output_index: outputIndex,
      item: { ...fcoItem, status: "in_progress" },
    });
    push({
      type: "response.output_item.done",
      output_index: outputIndex,
      item: fcoItem,
    });
    output.push(fcoItem);
  }

  /* Assistant message streamed as output_text deltas */
  outputIndex += 1;
  push({
    type: "response.output_item.added",
    output_index: outputIndex,
    item: {
      id: messageId,
      type: "message",
      status: "in_progress",
      role: "assistant",
      content: [],
    },
  });
  push({
    type: "response.content_part.added",
    item_id: messageId,
    output_index: outputIndex,
    content_index: 0,
    part: { type: "output_text", annotations: [], text: "" },
  });
  for (const delta of chunkText(reply, 16)) {
    push({
      type: "response.output_text.delta",
      item_id: messageId,
      output_index: outputIndex,
      content_index: 0,
      delta,
    });
  }
  push({
    type: "response.output_text.done",
    item_id: messageId,
    output_index: outputIndex,
    content_index: 0,
    text: reply,
  });
  push({
    type: "response.content_part.done",
    item_id: messageId,
    output_index: outputIndex,
    content_index: 0,
    part: { type: "output_text", annotations: [], text: reply },
  });
  const messageItem: ORItem = {
    id: messageId,
    type: "message",
    status: "completed",
    role: "assistant",
    content: [{ type: "output_text", annotations: [], text: reply }],
  } as ORItem;
  push({
    type: "response.output_item.done",
    output_index: outputIndex,
    item: messageItem,
  });
  output.push(messageItem);

  const usage = {
    input_tokens: Math.ceil(JSON.stringify(body.input ?? "").length / 4),
    output_tokens: Math.ceil(reply.length / 4),
    total_tokens: Math.ceil(
      (JSON.stringify(body.input ?? "").length + reply.length) / 4,
    ),
  };

  const response = {
    ...baseResponse,
    status: "completed",
    completed_at: Math.floor(Date.now() / 1000),
    output,
    usage,
    error: null,
  };
  push({ type: "response.completed", response });

  return { events, response };
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

export async function handleDemoResponses(request: Request): Promise<Response> {
  let body: DemoRequestBody;
  try {
    body = (await request.json()) as DemoRequestBody;
  } catch {
    return Response.json(
      {
        error: {
          message: "Request body must be valid JSON.",
          type: "invalid_request",
          param: null,
          code: "invalid_json",
        },
      },
      { status: 400 },
    );
  }

  const { events, response } = buildEvents(body);

  if (body.stream === false) {
    return Response.json(response);
  }

  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      try {
        for (const event of events) {
          controller.enqueue(
            encoder.encode(
              `event: ${event.type}\ndata: ${JSON.stringify(event)}\n\n`,
            ),
          );
          const type = String(event.type);
          // Pace the interesting delta events so streaming is visible.
          if (type.endsWith(".delta")) await sleep(24);
          else await sleep(8);
        }
        controller.enqueue(encoder.encode("data: [DONE]\n\n"));
        controller.close();
      } catch {
        // Client disconnected; nothing to clean up.
      }
    },
  });

  return new Response(stream, {
    headers: {
      "content-type": "text/event-stream; charset=utf-8",
      "cache-control": "no-cache",
      connection: "keep-alive",
    },
  });
}
