/**
 * The advisor preset: a lean agent composition for advisor children.
 *
 * A spawned child otherwise inherits the parent agent's whole composition —
 * the full system prompt (skill catalog, every tool's guidance, our own
 * usage-boundary section) plus every tool schema, including host-level MCP
 * tools. On the maintainer's machine that costs about 48k input tokens per
 * consultation before a single word of transcript. The preset mounts, by
 * package name (so plugins that rewrite the shipped presets, such as
 * dsh-ops, cannot affect it):
 *
 * - `tool-fs` with only `read` / `read_image` (write / edit / apply_patch off),
 * - `tool-fs-search` (grep / glob),
 * - the platform shell (`pwsh` / `bash`) for read-only commands,
 * - this plugin in `presetRole`, which masks every host-level tool with a
 *   `ToolRestriction` deny list (see `applyAdvisorToolMask`), so the advisor
 *   sees exactly what the preset mounts.
 *
 * The system prompt is then just those tools' guidance plus our preamble. If
 * the preset cannot be activated (packages renamed in a future host, …) the
 * consultation falls back to the inherited composition and says so.
 */

/** This package's name, as the preset row mounts it; `tests/preset.test.ts` pins it to the entry's `name`. */
const PLUGIN_NAME = "dsh-advisor-chain";

export const ADVISOR_PRESET_ID = "dsh-advisor-chain-advisor";

/** Tool names the lean composition exposes; also the allow-list for inherited tools. */
export const LEAN_TOOL_NAMES = ["read", "read_image", "glob", "grep", "pwsh", "bash"] as const;

export interface PresetPluginRow {
  id?: string;
  name: string;
  config?: Record<string, unknown>;
  disabled?: boolean;
}

export interface AdvisorPresetDefinition {
  id: string;
  name: string;
  description: string;
  order: number;
  plugins: PresetPluginRow[];
}

export function advisorPresetDefinition(platform = process.platform): AdvisorPresetDefinition {
  return {
    id: ADVISOR_PRESET_ID,
    name: "Second Opinion advisor",
    description: "Read-only advisor composition: read / grep / glob / shell, nothing inherited.",
    order: 1000,
    plugins: [
      { id: "tool-fs", name: "@deepseek-ai/dsh-tool-fs", config: { read: true, readImage: true, write: false, edit: false, applyPatch: false } },
      { id: "tool-fs-search", name: "@deepseek-ai/dsh-tool-fs-search", config: { sampleOverCapGlobResults: false } },
      { id: "tool-pwsh", name: "@deepseek-ai/dsh-tool-pwsh", disabled: platform !== "win32" },
      { id: "tool-bash", name: "@deepseek-ai/dsh-tool-bash", disabled: platform === "win32" },
      { id: "advisor-composition", name: PLUGIN_NAME, config: { presetRole: true } },
    ],
  };
}

export interface PresetRegistryLike {
  register(definition: AdvisorPresetDefinition): Promise<() => Promise<void>>;
  resolve(id: string): Promise<{ id: string; broken?: string }>;
  /** Preset id recorded for a session, or null when none was selected. */
  presetForSession?(session: unknown): string | null;
}

/** Register the preset; resolves to its disposer, or undefined (after logging) when registration failed. */
export async function registerAdvisorPreset(registry: PresetRegistryLike, log: (message: string) => void): Promise<(() => Promise<void>) | undefined> {
  try {
    const dispose = await registry.register(advisorPresetDefinition());
    log(`advisor preset registered (${ADVISOR_PRESET_ID})`);
    return dispose;
  } catch (error) {
    log(`advisor preset registration failed: ${error instanceof Error ? error.message : String(error)}`);
    return undefined;
  }
}

export type PresetCheck = { ok: true; preset: string } | { ok: false; reason: string };

/** Confirm the preset is mounted and healthy before handing it to `startActivation`. */
export async function checkAdvisorPreset(registry: PresetRegistryLike | undefined, log: (message: string) => void): Promise<PresetCheck> {
  if (!registry || typeof registry.resolve !== "function") return { ok: false, reason: "unavailable" };
  try {
    const resolved = await registry.resolve(ADVISOR_PRESET_ID);
    if (resolved.broken) return { ok: false, reason: resolved.broken };
    return { ok: true, preset: ADVISOR_PRESET_ID };
  } catch (error) {
    return { ok: false, reason: error instanceof Error ? error.message : String(error) };
  }
}

/** The slice of the tool registry the preset role needs. */
export interface RestrictableTools {
  /** Visible definitions of the global (host) view. */
  definitions(): Array<{ name: string }>;
  /** Mask inherited tools by name; returns the disposer that lifts the mask. */
  restrict(filter: { deny: string[] }): () => void;
}

/** Name the registry reserves for the PTC transport; it cannot be named in a restriction. */
const RESERVED_TOOL_NAMES = new Set(["run_code"]);

export interface AllowListState {
  /** Currently denied global tool names (sorted). */
  denied: string[];
}

/**
 * Keep every host-level (global) tool out of the advisor's view.
 *
 * The advisor agent sees its own (empty) layer plus the preset layer, where
 * the read-only tools and this restriction both live; an `allow` list cannot
 * name the preset's own tools (scope-local names are rejected), so the mask
 * is a `deny` list of the global layer — MCP tools, second_opinion, plugin
 * managers, … — recomputed whenever the registry changes, because MCP tools
 * may register after this plugin activates. Returns the current state for
 * diagnostics.
 */
export function applyAdvisorToolMask(tools: RestrictableTools, onChange: (apply: () => void) => unknown = () => {}): { state: () => AllowListState; dispose: () => void } {
  let lift: (() => void) | undefined;
  let denied: string[] = [];
  const apply = (): AllowListState => {
    const names = Array.from(new Set(tools.definitions().map((d) => d.name)))
      .filter((name) => !RESERVED_TOOL_NAMES.has(name))
      .sort();
    if (names.join("\n") === denied.join("\n")) return { denied };
    lift?.();
    lift = undefined;
    denied = names;
    if (names.length > 0) lift = tools.restrict({ deny: names });
    return { denied };
  };
  const unsubscribe = onChange(apply);
  apply();
  return {
    state: () => ({ denied }),
    dispose: () => {
      typeof unsubscribe === "function" && (unsubscribe as () => void)();
      lift?.();
      lift = undefined;
    },
  };
}
