/**
 * Native renderers for the catalogs Parley supports, and the registry that
 * maps a surface's `catalogId` to its component views.
 *
 * This file implements the official A2UI Basic Catalog (v0.9 / v0.9.1);
 * Parley's first-party charts catalog extends it with lazily-loaded views
 * from ~/components/a2ui/charts (see `catalogComponentViews` at the
 * bottom). Each A2UI component maps onto Parley's own visual language
 * (shadcn + Tailwind); the resource's structure and behavior are preserved
 * while the look stays native to the host, as the A2UI spec intends.
 * Unknown component types render an inert, labeled placeholder — never
 * executed content.
 */

import {
  ArrowLeft,
  ArrowRight,
  Bell,
  BellOff,
  Calendar,
  CalendarDays,
  Camera,
  Check,
  CircleAlert,
  CircleHelp,
  CircleUserRound,
  CreditCard,
  Download,
  Ellipsis,
  EllipsisVertical,
  Eye,
  EyeOff,
  FastForward,
  Folder,
  Heart,
  HeartOff,
  House,
  Image as ImageIcon,
  Info,
  Lock,
  LockOpen,
  type LucideIcon,
  Mail,
  MapPin,
  Menu,
  Paperclip,
  Pause,
  Pencil,
  Phone,
  Play,
  Plus,
  Printer,
  RefreshCw,
  Rewind,
  Search,
  Send,
  Settings,
  Share2,
  ShoppingCart,
  SkipBack,
  SkipForward,
  Square,
  Star,
  StarHalf,
  StarOff,
  Trash2,
  TriangleAlert,
  Upload,
  User,
  Volume,
  Volume1,
  Volume2,
  VolumeX,
  X,
} from "lucide-react";
import {
  Component,
  type ComponentType,
  lazy,
  type ReactNode,
  Suspense,
  useId,
  useMemo,
  useState,
} from "react";
import { useA2uiSurface } from "~/components/a2ui/context";
import { Markdown } from "~/components/chat/markdown";
import { useI18n } from "~/components/i18n";
import { Button } from "~/components/ui/button";
import { Checkbox } from "~/components/ui/checkbox";
import {
  Dialog,
  DialogContent,
  DialogTitle,
  DialogTrigger,
} from "~/components/ui/dialog";
import { Input } from "~/components/ui/input";
import { Label } from "~/components/ui/label";
import { Separator } from "~/components/ui/separator";
import { Slider } from "~/components/ui/slider";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "~/components/ui/tabs";
import { Textarea } from "~/components/ui/textarea";
import {
  type A2uiComponent,
  failedChecks,
  pointerGet,
  resolveDynamic,
  resolvePath,
  resolveString,
  toDisplayString,
} from "~/lib/a2ui";
import { A2UI_CATALOG_PLUGINS } from "~/lib/a2ui-catalog-plugins";
import { cn } from "~/lib/utils";

const asRecord = (value: unknown): Record<string, unknown> | null =>
  typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;

/** Only ever load media/links from unambiguous, non-executable schemes. */
function safeUrl(raw: string, allowData = false): string | null {
  try {
    const url = new URL(raw, "https://invalid.localhost");
    if (url.protocol === "http:" || url.protocol === "https:") return raw;
    if (allowData && url.protocol === "data:" && raw.startsWith("data:image/"))
      return raw;
    return null;
  } catch {
    return null;
  }
}

function openUrlSafely(raw: string): void {
  const url = safeUrl(raw);
  if (url) window.open(url, "_blank", "noopener,noreferrer");
}

/* --------------------------------- node ---------------------------------- */

export function CatalogNode({ id, base }: { id: string; base: string }) {
  const { surface } = useA2uiSurface();
  const component = surface.components[id];
  // Forward references are legal (progressive rendering): render nothing
  // until the component arrives.
  if (!component) return null;

  const View = catalogComponentViews(surface.catalogId)?.[component.component];
  if (!View) {
    /* Unknown component within a supported catalog: a safe, labeled
     * placeholder — never guessed rendering, never executed content. */
    return (
      <div className="rounded-lg border border-dashed px-2.5 py-1.5 text-muted-foreground text-xs">
        Unsupported component{" "}
        <span className="font-mono">{component.component}</span>
      </div>
    );
  }
  return <View component={component} base={base} />;
}

export interface ViewProps {
  component: A2uiComponent;
  base: string;
}

function useAriaLabel({ component, base }: ViewProps): string | undefined {
  const { dataModel } = useA2uiSurface();
  const accessibility = asRecord(component.accessibility);
  if (!accessibility?.label) return undefined;
  const label = resolveString(accessibility.label, dataModel, base);
  return label.length > 0 ? label : undefined;
}

/* ------------------------------- children -------------------------------- */

/**
 * Renders a ChildList: either a static list of component ids or a template
 * binding `{path, componentId}` instantiated per item of the bound array,
 * with relative paths inside resolving against each item (the "scope").
 */
function ChildList({ value, base }: { value: unknown; base: string }) {
  const { dataModel } = useA2uiSurface();

  if (Array.isArray(value)) {
    return (
      <>
        {value.map((id) =>
          typeof id === "string" ? (
            <CatalogNode key={id} id={id} base={base} />
          ) : null,
        )}
      </>
    );
  }

  const template = asRecord(value);
  if (
    template &&
    typeof template.path === "string" &&
    typeof template.componentId === "string"
  ) {
    const listPath = resolvePath(template.path, base);
    const items = pointerGet(dataModel, listPath);
    if (!Array.isArray(items)) return null;
    return (
      <>
        {items.map((_, index) => (
          <CatalogNode
            // biome-ignore lint/suspicious/noArrayIndexKey: items are positional per spec
            key={index}
            id={template.componentId as string}
            base={`${listPath}/${index}`}
          />
        ))}
      </>
    );
  }

  return null;
}

/** Wraps flex children so a child's `weight` becomes its flex-grow. */
function WeightedChildren({ value, base }: { value: unknown; base: string }) {
  const { surface } = useA2uiSurface();
  if (!Array.isArray(value)) return <ChildList value={value} base={base} />;
  return (
    <>
      {value.map((id) => {
        if (typeof id !== "string") return null;
        const weight = surface.components[id]?.weight;
        if (typeof weight === "number" && weight > 0) {
          return (
            <div key={id} className="min-w-0" style={{ flexGrow: weight }}>
              <CatalogNode id={id} base={base} />
            </div>
          );
        }
        return <CatalogNode key={id} id={id} base={base} />;
      })}
    </>
  );
}

/* --------------------------------- layout --------------------------------- */

const justifyClass: Record<string, string> = {
  start: "justify-start",
  center: "justify-center",
  end: "justify-end",
  spaceAround: "justify-around",
  spaceBetween: "justify-between",
  spaceEvenly: "justify-evenly",
  stretch: "justify-stretch",
};

const alignClass: Record<string, string> = {
  start: "items-start",
  center: "items-center",
  end: "items-end",
  stretch: "items-stretch",
};

function FlexView({
  component,
  base,
  axis,
}: ViewProps & { axis: "row" | "column" }) {
  const ariaLabel = useAriaLabel({ component, base });
  const justify = toDisplayString(component.justify) || "start";
  const align = toDisplayString(component.align) || "stretch";
  return (
    // biome-ignore lint/a11y/useAriaPropsSupportedByRole: aria-label is only set together with role="group"
    <div
      role={ariaLabel ? "group" : undefined}
      aria-label={ariaLabel}
      className={cn(
        "flex gap-2",
        axis === "row" ? "flex-row flex-wrap" : "flex-col",
        justifyClass[justify] ?? "justify-start",
        alignClass[align] ?? "items-stretch",
      )}
    >
      <WeightedChildren value={component.children} base={base} />
    </div>
  );
}

function ListView({ component, base }: ViewProps) {
  const ariaLabel = useAriaLabel({ component, base });
  const direction = toDisplayString(component.direction) || "vertical";
  const align = toDisplayString(component.align) || "stretch";
  return (
    // biome-ignore lint/a11y/useAriaPropsSupportedByRole: aria-label is only set together with role="group"
    <div
      role={ariaLabel ? "group" : undefined}
      aria-label={ariaLabel}
      className={cn(
        "flex gap-1.5",
        direction === "horizontal"
          ? "flex-row overflow-x-auto pb-1"
          : "flex-col",
        alignClass[align] ?? "items-stretch",
      )}
    >
      <ChildList value={component.children} base={base} />
    </div>
  );
}

function CardView({ component, base }: ViewProps) {
  const ariaLabel = useAriaLabel({ component, base });
  return (
    // biome-ignore lint/a11y/useAriaPropsSupportedByRole: aria-label is only set together with role="group"
    <div
      role={ariaLabel ? "group" : undefined}
      aria-label={ariaLabel}
      className="w-full rounded-xl border bg-card p-4 text-card-foreground shadow-xs"
    >
      {typeof component.child === "string" && (
        <CatalogNode id={component.child} base={base} />
      )}
    </div>
  );
}

function TabsView({ component, base }: ViewProps) {
  const { dataModel } = useA2uiSurface();
  const tabs = Array.isArray(component.tabs) ? component.tabs : [];
  if (tabs.length === 0) return null;
  return (
    <Tabs defaultValue="0" className="w-full">
      <TabsList className="max-w-full flex-wrap">
        {tabs.map((tab, index) => {
          const record = asRecord(tab);
          return (
            <TabsTrigger
              // biome-ignore lint/suspicious/noArrayIndexKey: tabs are positional
              key={index}
              value={String(index)}
            >
              {record ? resolveString(record.title, dataModel, base) : ""}
            </TabsTrigger>
          );
        })}
      </TabsList>
      {tabs.map((tab, index) => {
        const record = asRecord(tab);
        const child = record?.child;
        return (
          <TabsContent
            // biome-ignore lint/suspicious/noArrayIndexKey: tabs are positional
            key={index}
            value={String(index)}
          >
            {typeof child === "string" && (
              <CatalogNode id={child} base={base} />
            )}
          </TabsContent>
        );
      })}
    </Tabs>
  );
}

function ModalView({ component, base }: ViewProps) {
  const { t } = useI18n();
  const { surface } = useA2uiSurface();
  const [open, setOpen] = useState(false);
  const triggerId =
    typeof component.trigger === "string" ? component.trigger : null;
  const contentId =
    typeof component.content === "string" ? component.content : null;
  const trigger = triggerId ? surface.components[triggerId] : undefined;

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      {trigger?.component === "Button" ? (
        /* A Button trigger keeps its native look; the modal owns the click. */
        <ButtonView
          component={trigger}
          base={base}
          onClickOverride={() => setOpen(true)}
        />
      ) : (
        <DialogTrigger className="w-fit cursor-pointer text-left">
          {triggerId && <CatalogNode id={triggerId} base={base} />}
        </DialogTrigger>
      )}
      <DialogContent className="max-h-[80vh] overflow-y-auto">
        <DialogTitle className="sr-only">{t("dialog")}</DialogTitle>
        {contentId && <CatalogNode id={contentId} base={base} />}
      </DialogContent>
    </Dialog>
  );
}

function DividerView({ component }: ViewProps) {
  const vertical = toDisplayString(component.axis) === "vertical";
  return (
    <Separator
      orientation={vertical ? "vertical" : "horizontal"}
      className={cn(
        vertical && "self-stretch data-[orientation=vertical]:h-auto",
      )}
    />
  );
}

/* --------------------------------- content -------------------------------- */

const textVariantClass: Record<string, string> = {
  h1: "text-2xl font-semibold tracking-tight",
  h2: "text-xl font-semibold tracking-tight",
  h3: "text-lg font-semibold",
  h4: "text-base font-semibold",
  h5: "text-sm font-semibold",
  caption: "text-xs text-muted-foreground",
};

function TextView({ component, base }: ViewProps) {
  const { dataModel } = useA2uiSurface();
  const text = resolveString(component.text, dataModel, base);
  const variant = toDisplayString(component.variant) || "body";
  if (variant === "body") {
    /* Body text supports simple Markdown, per the catalog. Keyed by the
     * resolved text: Streamdown is built for append-only streaming and
     * keeps stale DOM when a data binding *replaces* the text, so a
     * rebind remounts it (these are small, atomic strings). */
    return (
      <div className="min-w-0">
        <Markdown key={text} text={text} />
      </div>
    );
  }
  return (
    <div className={cn("min-w-0 break-words", textVariantClass[variant])}>
      {text}
    </div>
  );
}

const imageVariantClass: Record<string, string> = {
  icon: "size-5 rounded",
  avatar: "size-10 rounded-full",
  smallFeature: "h-24 rounded-lg",
  mediumFeature: "h-40 rounded-lg",
  largeFeature: "h-64 rounded-lg",
  header: "h-40 w-full rounded-lg",
};

const imageFitClass: Record<string, string> = {
  contain: "object-contain",
  cover: "object-cover",
  fill: "object-fill",
  none: "object-none",
  scaleDown: "object-scale-down",
};

function ImageView({ component, base }: ViewProps) {
  const { dataModel } = useA2uiSurface();
  const url = safeUrl(resolveString(component.url, dataModel, base), true);
  if (!url) return null;
  const variant = toDisplayString(component.variant) || "mediumFeature";
  const fit = toDisplayString(component.fit) || "fill";
  return (
    <img
      src={url}
      alt={resolveString(component.description, dataModel, base)}
      className={cn(
        "max-w-full",
        imageVariantClass[variant] ?? imageVariantClass.mediumFeature,
        imageFitClass[fit] ?? "object-fill",
      )}
    />
  );
}

const iconMap: Record<string, LucideIcon> = {
  accountCircle: CircleUserRound,
  add: Plus,
  arrowBack: ArrowLeft,
  arrowForward: ArrowRight,
  attachFile: Paperclip,
  calendarToday: Calendar,
  call: Phone,
  camera: Camera,
  check: Check,
  close: X,
  delete: Trash2,
  download: Download,
  edit: Pencil,
  event: CalendarDays,
  error: CircleAlert,
  fastForward: FastForward,
  favorite: Heart,
  favoriteOff: HeartOff,
  folder: Folder,
  help: CircleHelp,
  home: House,
  info: Info,
  locationOn: MapPin,
  lock: Lock,
  lockOpen: LockOpen,
  mail: Mail,
  menu: Menu,
  moreVert: EllipsisVertical,
  moreHoriz: Ellipsis,
  notificationsOff: BellOff,
  notifications: Bell,
  pause: Pause,
  payment: CreditCard,
  person: User,
  phone: Phone,
  photo: ImageIcon,
  play: Play,
  print: Printer,
  refresh: RefreshCw,
  rewind: Rewind,
  search: Search,
  send: Send,
  settings: Settings,
  share: Share2,
  shoppingCart: ShoppingCart,
  skipNext: SkipForward,
  skipPrevious: SkipBack,
  star: Star,
  starHalf: StarHalf,
  starOff: StarOff,
  stop: Square,
  upload: Upload,
  visibility: Eye,
  visibilityOff: EyeOff,
  volumeDown: Volume1,
  volumeMute: Volume,
  volumeOff: VolumeX,
  volumeUp: Volume2,
  warning: TriangleAlert,
};

function IconView({ component, base }: ViewProps) {
  const { dataModel } = useA2uiSurface();
  const ariaLabel = useAriaLabel({ component, base });
  const resolved = resolveDynamic(component.name, dataModel, base);

  const record = asRecord(resolved);
  const svgPath = record
    ? toDisplayString(record.svgPath ?? record.path)
    : null;
  if (svgPath) {
    return (
      <svg
        viewBox="0 0 24 24"
        className="size-5 shrink-0 fill-current"
        aria-label={ariaLabel}
        aria-hidden={ariaLabel === undefined}
        role={ariaLabel ? "img" : undefined}
      >
        <path d={svgPath} />
      </svg>
    );
  }

  const IconComponent = iconMap[toDisplayString(resolved)];
  if (!IconComponent) return null;
  return <IconComponent className="size-5 shrink-0" aria-label={ariaLabel} />;
}

function VideoView({ component, base }: ViewProps) {
  const { dataModel } = useA2uiSurface();
  const ariaLabel = useAriaLabel({ component, base });
  const url = safeUrl(resolveString(component.url, dataModel, base));
  if (!url) return null;
  return (
    // biome-ignore lint/a11y/useMediaCaption: captions aren't part of the A2UI resource
    <video
      src={url}
      controls
      preload="metadata"
      aria-label={ariaLabel}
      className="max-h-72 w-full rounded-lg border bg-black"
    />
  );
}

function AudioPlayerView({ component, base }: ViewProps) {
  const { dataModel } = useA2uiSurface();
  const url = safeUrl(resolveString(component.url, dataModel, base));
  const description = resolveString(component.description, dataModel, base);
  if (!url) return null;
  return (
    <div className="flex w-full flex-col gap-1">
      {description.length > 0 && (
        <span className="text-muted-foreground text-xs">{description}</span>
      )}
      {/* biome-ignore lint/a11y/useMediaCaption: captions aren't part of the A2UI resource */}
      <audio src={url} controls preload="metadata" className="w-full" />
    </div>
  );
}

/* ------------------------------- interactive ------------------------------ */

const buttonVariantMap: Record<string, "default" | "outline" | "ghost"> = {
  primary: "default",
  default: "outline",
  borderless: "ghost",
};

export function ButtonView({
  component,
  base,
  onClickOverride,
}: ViewProps & { onClickOverride?: () => void }) {
  const { surface, dataModel, dispatchEvent, disabled } = useA2uiSurface();
  const failures = failedChecks(component.checks, dataModel, base);
  const ariaLabel = useAriaLabel({ component, base });

  const onClick = () => {
    if (onClickOverride) return onClickOverride();
    const action = asRecord(component.action);
    if (!action) return;
    const event = asRecord(action.event);
    if (event) {
      dispatchEvent(event, component.id, base);
      return;
    }
    const functionCall = asRecord(action.functionCall);
    if (functionCall && functionCall.call === "openUrl") {
      const args = asRecord(functionCall.args);
      openUrlSafely(resolveString(args?.url, dataModel, base));
    }
  };

  const childId = typeof component.child === "string" ? component.child : null;
  const child = childId ? surface.components[childId] : undefined;

  return (
    <Button
      type="button"
      variant={
        buttonVariantMap[toDisplayString(component.variant)] ?? "outline"
      }
      size="sm"
      disabled={disabled || failures.length > 0}
      title={failures[0]}
      aria-label={ariaLabel}
      onClick={onClick}
      className="w-fit"
    >
      {child?.component === "Text" ? (
        /* Text inside a button renders inline, without Markdown blocks. */
        resolveString(child.text, dataModel, base)
      ) : childId ? (
        <CatalogNode id={childId} base={base} />
      ) : null}
    </Button>
  );
}

/** Shared two-way binding helper: resolves the bound pointer, if any. */
function boundPointer(value: unknown, base: string): string | null {
  const record = asRecord(value);
  return record && typeof record.path === "string"
    ? resolvePath(record.path, base)
    : null;
}

function FieldErrors({ messages }: { messages: string[] }) {
  if (messages.length === 0) return null;
  return <p className="text-destructive text-xs">{messages[0]}</p>;
}

function TextFieldView({ component, base }: ViewProps) {
  const { dataModel, setValue, disabled } = useA2uiSurface();
  const id = useId();
  const [touched, setTouched] = useState(false);
  const pointer = boundPointer(component.value, base);
  const value = resolveString(component.value, dataModel, base);
  const label = resolveString(component.label, dataModel, base);
  const variant = toDisplayString(component.variant) || "shortText";

  const failures = failedChecks(component.checks, dataModel, base);
  const pattern = toDisplayString(component.validationRegexp);
  if (pattern && value.length > 0) {
    try {
      if (!new RegExp(pattern).test(value)) {
        failures.push("Doesn't match the expected format.");
      }
    } catch {
      /* invalid regexp in the resource: ignore */
    }
  }

  const onChange = (next: string) => {
    if (pointer) setValue(pointer, next);
    setTouched(true);
  };

  const inputType =
    variant === "number"
      ? "number"
      : variant === "obscured"
        ? "password"
        : "text";

  return (
    <div className="flex w-full flex-col gap-1.5">
      {label.length > 0 && <Label htmlFor={id}>{label}</Label>}
      {variant === "longText" ? (
        <Textarea
          id={id}
          value={value}
          disabled={disabled}
          rows={3}
          onChange={(e) => onChange(e.target.value)}
        />
      ) : (
        <Input
          id={id}
          type={inputType}
          value={value}
          disabled={disabled}
          onChange={(e) => onChange(e.target.value)}
        />
      )}
      {touched && <FieldErrors messages={failures} />}
    </div>
  );
}

function CheckBoxView({ component, base }: ViewProps) {
  const { dataModel, setValue, disabled } = useA2uiSurface();
  const id = useId();
  const pointer = boundPointer(component.value, base);
  const checked = Boolean(resolveDynamic(component.value, dataModel, base));
  const label = resolveString(component.label, dataModel, base);
  return (
    <div className="flex items-center gap-2">
      <Checkbox
        id={id}
        checked={checked}
        disabled={disabled}
        onCheckedChange={(state) => {
          if (pointer) setValue(pointer, state === true);
        }}
      />
      <Label htmlFor={id} className="font-normal">
        {label}
      </Label>
    </div>
  );
}

function ChoicePickerView({ component, base }: ViewProps) {
  const { t } = useI18n();
  const { dataModel, setValue, disabled } = useA2uiSurface();
  const [filter, setFilter] = useState("");
  const pointer = boundPointer(component.value, base);
  const label = resolveString(component.label, dataModel, base);
  const multiple = toDisplayString(component.variant) === "multipleSelection";
  const chips = toDisplayString(component.displayStyle) === "chips";
  const filterable = component.filterable === true;

  const raw = resolveDynamic(component.value, dataModel, base);
  const selected = useMemo(() => {
    if (Array.isArray(raw)) return raw.map(toDisplayString);
    if (typeof raw === "string" && raw.length > 0) return [raw];
    return [];
  }, [raw]);

  const options = (Array.isArray(component.options) ? component.options : [])
    .map((option) => {
      const record = asRecord(option);
      if (!record || typeof record.value !== "string") return null;
      return {
        value: record.value,
        label: resolveString(record.label, dataModel, base) || record.value,
      };
    })
    .filter((option): option is { value: string; label: string } =>
      Boolean(option),
    )
    .filter(
      (option) =>
        filter.length === 0 ||
        option.label.toLowerCase().includes(filter.toLowerCase()),
    );

  const toggle = (value: string) => {
    if (!pointer) return;
    if (multiple) {
      const next = selected.includes(value)
        ? selected.filter((entry) => entry !== value)
        : [...selected, value];
      setValue(pointer, next);
    } else {
      setValue(pointer, [value]);
    }
  };

  return (
    <div className="flex w-full flex-col gap-1.5">
      {label.length > 0 && <Label>{label}</Label>}
      {filterable && (
        <Input
          value={filter}
          placeholder={t("filter")}
          disabled={disabled}
          onChange={(e) => setFilter(e.target.value)}
        />
      )}
      {chips ? (
        <div className="flex flex-wrap gap-1.5">
          {options.map((option) => {
            const isSelected = selected.includes(option.value);
            return (
              <button
                key={option.value}
                type="button"
                disabled={disabled}
                aria-pressed={isSelected}
                onClick={() => toggle(option.value)}
                className={cn(
                  "rounded-full border px-3 py-1 text-sm transition-colors disabled:cursor-not-allowed disabled:opacity-50",
                  isSelected
                    ? "border-primary bg-primary text-primary-foreground"
                    : "bg-card hover:bg-accent",
                )}
              >
                {option.label}
              </button>
            );
          })}
        </div>
      ) : (
        <div className="flex flex-col gap-1.5">
          {options.map((option) => {
            const isSelected = selected.includes(option.value);
            return (
              <label
                key={option.value}
                className="flex cursor-pointer items-center gap-2 text-sm"
              >
                <Checkbox
                  checked={isSelected}
                  disabled={disabled}
                  className={cn(!multiple && "rounded-full")}
                  onCheckedChange={() => toggle(option.value)}
                />
                {option.label}
              </label>
            );
          })}
        </div>
      )}
    </div>
  );
}

function SliderView({ component, base }: ViewProps) {
  const { dataModel, setValue, disabled } = useA2uiSurface();
  const pointer = boundPointer(component.value, base);
  const label = resolveString(component.label, dataModel, base);
  const min = typeof component.min === "number" ? component.min : 0;
  const max = typeof component.max === "number" ? component.max : 100;
  const resolved = resolveDynamic(component.value, dataModel, base);
  const value =
    typeof resolved === "number" && Number.isFinite(resolved) ? resolved : min;

  return (
    <div className="flex w-full flex-col gap-1.5">
      <div className="flex items-baseline justify-between gap-2">
        {label.length > 0 && <Label>{label}</Label>}
        <span className="text-muted-foreground text-xs tabular-nums">
          {value}
        </span>
      </div>
      <Slider
        min={min}
        max={max}
        step={1}
        value={[Math.min(Math.max(value, min), max)]}
        disabled={disabled}
        aria-label={label || undefined}
        onValueChange={([next]) => {
          if (pointer && typeof next === "number") setValue(pointer, next);
        }}
      />
    </div>
  );
}

function DateTimeInputView({ component, base }: ViewProps) {
  const { dataModel, setValue, disabled } = useA2uiSurface();
  const id = useId();
  const pointer = boundPointer(component.value, base);
  const label = resolveString(component.label, dataModel, base);
  const enableDate = component.enableDate === true;
  const enableTime = component.enableTime === true;
  const type =
    enableDate && enableTime ? "datetime-local" : enableTime ? "time" : "date";

  /* Trim ISO values to what the input type accepts. */
  const width = type === "datetime-local" ? 16 : type === "time" ? 5 : 10;
  const clip = (iso: string) =>
    type === "time" && iso.includes("T")
      ? iso.slice(11, 16)
      : iso.slice(0, width);

  const value = clip(resolveString(component.value, dataModel, base));
  const min = clip(resolveString(component.min, dataModel, base));
  const max = clip(resolveString(component.max, dataModel, base));

  return (
    <div className="flex w-full flex-col gap-1.5">
      {label.length > 0 && <Label htmlFor={id}>{label}</Label>}
      <Input
        id={id}
        type={type}
        value={value}
        min={min || undefined}
        max={max || undefined}
        disabled={disabled}
        onChange={(e) => {
          if (pointer) setValue(pointer, e.target.value);
        }}
        className="w-fit"
      />
    </div>
  );
}

/* -------------------------------- registry -------------------------------- */

/** Component views one catalog provides, keyed by `component` type. */
export type A2uiComponentViews = Record<
  string,
  ComponentType<ViewProps> | undefined
>;

function RowView(props: ViewProps) {
  return <FlexView {...props} axis="row" />;
}

function ColumnView(props: ViewProps) {
  return <FlexView {...props} axis="column" />;
}

const basicComponentViews: A2uiComponentViews = {
  Text: TextView,
  Image: ImageView,
  Icon: IconView,
  Video: VideoView,
  AudioPlayer: AudioPlayerView,
  Row: RowView,
  Column: ColumnView,
  List: ListView,
  Card: CardView,
  Tabs: TabsView,
  Modal: ModalView,
  Divider: DividerView,
  Button: ButtonView,
  TextField: TextFieldView,
  CheckBox: CheckBoxView,
  ChoicePicker: ChoicePickerView,
  Slider: SliderView,
  DateTimeInput: DateTimeInputView,
};

/* The charts catalog adds chart and metric views on top of the Basic Catalog.
 * Recharts is heavy, so those views load lazily — the chunk downloads only
 * when a chart component actually renders, behind a skeleton fallback. */

const LazyChartView = lazy(() =>
  import("~/components/a2ui/charts").then((module) => ({
    default: module.ChartView,
  })),
);

const LazyStatView = lazy(() =>
  import("~/components/a2ui/charts").then((module) => ({
    default: module.StatView,
  })),
);

const LazySparklineView = lazy(() =>
  import("~/components/a2ui/charts").then((module) => ({
    default: module.SparklineView,
  })),
);
const LazyProgressView = lazy(() =>
  import("~/components/a2ui/charts").then((module) => ({
    default: module.ProgressView,
  })),
);
const LazyGaugeView = lazy(() =>
  import("~/components/a2ui/charts").then((module) => ({
    default: module.GaugeView,
  })),
);

const LazyMapView = lazy(() =>
  import("~/components/a2ui/maps").then((module) => ({
    default: module.MapView,
  })),
);

const LazyMapV2View = lazy(() =>
  import("~/components/a2ui/maps-v2").then((module) => ({
    default: module.MapV2View,
  })),
);

/**
 * Contains failures from the charting library (or a chunk that failed to
 * load) to an inert placeholder: a malformed chart resource must degrade
 * like any other unsupported content, never take down the conversation.
 */
class ChartViewBoundary extends Component<
  { children: ReactNode },
  { failed: boolean }
> {
  state = { failed: false };
  static getDerivedStateFromError() {
    return { failed: true };
  }
  render() {
    if (!this.state.failed) return this.props.children;
    return (
      <div className="rounded-lg border border-dashed px-2.5 py-1.5 text-muted-foreground text-xs">
        This visualization couldn't be rendered.
      </div>
    );
  }
}

function SuspendedChartView(props: ViewProps) {
  return (
    <ChartViewBoundary>
      <Suspense
        fallback={
          <div
            aria-hidden
            className="h-64 w-full animate-pulse rounded-lg bg-muted/40"
          />
        }
      >
        <LazyChartView {...props} />
      </Suspense>
    </ChartViewBoundary>
  );
}

function SuspendedStatView(props: ViewProps) {
  return (
    <ChartViewBoundary>
      <Suspense
        fallback={
          <div
            aria-hidden
            className="h-16 w-28 animate-pulse rounded-lg bg-muted/40"
          />
        }
      >
        <LazyStatView {...props} />
      </Suspense>
    </ChartViewBoundary>
  );
}

function SuspendedSparklineView(props: ViewProps) {
  return (
    <ChartViewBoundary>
      <Suspense
        fallback={
          <div
            aria-hidden
            className="h-10 w-full animate-pulse rounded bg-muted/40"
          />
        }
      >
        <LazySparklineView {...props} />
      </Suspense>
    </ChartViewBoundary>
  );
}
function SuspendedProgressView(props: ViewProps) {
  return (
    <ChartViewBoundary>
      <Suspense
        fallback={
          <div
            aria-hidden
            className="h-10 w-36 animate-pulse rounded bg-muted/40"
          />
        }
      >
        <LazyProgressView {...props} />
      </Suspense>
    </ChartViewBoundary>
  );
}
function SuspendedGaugeView(props: ViewProps) {
  return (
    <ChartViewBoundary>
      <Suspense
        fallback={
          <div
            aria-hidden
            className="size-20 animate-pulse rounded-full bg-muted/40"
          />
        }
      >
        <LazyGaugeView {...props} />
      </Suspense>
    </ChartViewBoundary>
  );
}

function SuspendedMapView(props: ViewProps) {
  return (
    <ChartViewBoundary>
      <Suspense
        fallback={
          <div
            aria-hidden
            className="h-80 w-full animate-pulse rounded-lg bg-muted/40"
          />
        }
      >
        <LazyMapView {...props} />
      </Suspense>
    </ChartViewBoundary>
  );
}

function SuspendedMapV2View(props: ViewProps) {
  return (
    <ChartViewBoundary>
      <Suspense
        fallback={
          <div
            aria-hidden
            className="h-64 w-full animate-pulse rounded-lg bg-muted/40"
          />
        }
      >
        <LazyMapV2View {...props} />
      </Suspense>
    </ChartViewBoundary>
  );
}

const chartsComponentViews: A2uiComponentViews = {
  ...basicComponentViews,
  Chart: SuspendedChartView,
  Stat: SuspendedStatView,
  Sparkline: SuspendedSparklineView,
  Progress: SuspendedProgressView,
  Gauge: SuspendedGaugeView,
};

const mapsComponentViews: A2uiComponentViews = {
  ...basicComponentViews,
  Map: SuspendedMapView,
};

const mapsV2ComponentViews: A2uiComponentViews = {
  ...basicComponentViews,
  Map: SuspendedMapV2View,
};

/**
 * Trusted renderer plugins installed in this build. Plugin manifests and
 * renderers use the same keys so built-in and external plugins share one path.
 */
const pluginViews: Record<string, A2uiComponentViews> = {
  basic: basicComponentViews,
  charts: chartsComponentViews,
  maps: mapsComponentViews,
  mapsV2: mapsV2ComponentViews,
};

const catalogViews: Record<string, A2uiComponentViews> = Object.fromEntries(
  A2UI_CATALOG_PLUGINS.flatMap((plugin) =>
    plugin.catalogIds.map((catalogId) => {
      const views =
        plugin.key === "maps" && plugin.catalogIds.indexOf(catalogId) > 0
          ? pluginViews.mapsV2
          : pluginViews[plugin.key];
      if (!views)
        throw new Error(`Missing A2UI renderer plugin: ${plugin.key}`);
      return [catalogId, views] as const;
    }),
  ),
);

/**
 * Resolves the component views for an installed catalog. Unknown catalogs
 * fail closed even if a stale surface is accidentally passed to CatalogNode.
 */
export function catalogComponentViews(
  catalogId: string,
): A2uiComponentViews | undefined {
  return catalogViews[catalogId];
}
