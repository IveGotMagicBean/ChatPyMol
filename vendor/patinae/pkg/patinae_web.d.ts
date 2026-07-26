/* tslint:disable */
/* eslint-disable */

/**
 * The main web viewer — owns scene state, command executor, and GPU resources.
 */
export class WebViewer {
    private constructor();
    free(): void;
    [Symbol.dispose](): void;
    count_atoms(selection: string): number;
    /**
     * Create a new WebViewer bound to a `<canvas>` element.
     *
     * `picking_enabled = false` (default) drops hit-test picking readbacks
     * and the half-res picking target. Selection overlay is controlled
     * separately; silhouettes remain command/settings-driven.
     */
    static create(canvas_id: string, picking_enabled: boolean, selection_overlay_enabled: boolean): Promise<WebViewer>;
    /**
     * Create a WebViewer with an explicit renderer memory profile.
     *
     * Pass `"auto"` or an empty string to use adapter-based selection.
     * Accepted forced profiles are `"performance"`, `"balanced"`, and `"lite"`.
     */
    static createWithMemoryProfile(canvas_id: string, picking_enabled: boolean, selection_overlay_enabled: boolean, memory_profile: string): Promise<WebViewer>;
    /**
     * Execute a command string. Returns JSON with output messages.
     */
    execute(command: string): any;
    get_labels(): any;
    get_movie_state(): any;
    get_object_info(name: string): any;
    get_object_names(): any;
    /**
     * Return debug performance counters for browser-side perf harnesses.
     */
    get_performance_snapshot(): any;
    get_selection_list(): any;
    get_sequence_data(): any;
    /**
     * Load molecular or map data from bytes.
     */
    load_data(data: Uint8Array, name: string, format: string): void;
    /**
     * Returns true when the scene has changed and needs a re-render.
     */
    needs_redraw(): boolean;
    on_mouse_down(x: number, y: number, button: number, modifiers: number): void;
    on_mouse_move(x: number, y: number, modifiers: number): void;
    on_mouse_up(x: number, y: number, button: number): void;
    on_wheel(delta_y: number, modifiers: number): void;
    /**
     * Submit a GPU click pick at physical-pixel canvas coordinates.
     * Returns `null` immediately — the actual hit lands asynchronously
     * via `take_completed_pick()`.
     */
    pick_at_screen(screen_x: number, screen_y: number): any;
    /**
     * Try to drain any in-flight GPU picks. JS calls this every rAF so
     * readbacks complete even when no visible redraw is pending.
     */
    poll_pending_picks(): void;
    /**
     * Update hover indicators by submitting a GPU pick at physical-pixel
     * coordinates.
     */
    process_hover(screen_x: number, screen_y: number): void;
    /**
     * Process accumulated input deltas and update the camera.
     */
    process_input(): void;
    /**
     * Render one frame to the canvas.
     */
    render_frame(): void;
    /**
     * Clear debug performance counters for the next harness scenario.
     */
    reset_performance_stats(): void;
    /**
     * Handle canvas resize.
     */
    resize(width: number, height: number): void;
    /**
     * Enable or disable cursor-based atom picking (default: disabled).
     */
    set_picking_enabled(enabled: boolean): void;
    /**
     * Enable or disable the visible selection / hover overlay. Hit-test
     * picking remains controlled by `set_picking_enabled`.
     */
    set_selection_overlay_enabled(enabled: boolean): void;
    /**
     * Drain renderer warnings produced outside direct command execution.
     */
    takeWarnings(): any;
    /**
     * Drain the most recent GPU click pick result.
     */
    take_completed_pick(): any;
    /**
     * Advance movie playback, rock animation, and camera interpolation.
     */
    update_animations(dt: number): void;
}

/**
 * Initialize the WASM module: panic hook + console logger.
 *
 * Called automatically before `WebViewer::create()`, but can also
 * be called explicitly from JS if early logging is needed.
 */
export function init(): void;

export type InitInput = RequestInfo | URL | Response | BufferSource | WebAssembly.Module;

export interface InitOutput {
    readonly memory: WebAssembly.Memory;
    readonly __wbg_webviewer_free: (a: number, b: number) => void;
    readonly init: () => void;
    readonly webviewer_count_atoms: (a: number, b: number, c: number, d: number) => void;
    readonly webviewer_create: (a: number, b: number, c: number, d: number) => number;
    readonly webviewer_createWithMemoryProfile: (a: number, b: number, c: number, d: number, e: number, f: number) => number;
    readonly webviewer_execute: (a: number, b: number, c: number) => number;
    readonly webviewer_get_labels: (a: number) => number;
    readonly webviewer_get_movie_state: (a: number) => number;
    readonly webviewer_get_object_info: (a: number, b: number, c: number) => number;
    readonly webviewer_get_object_names: (a: number) => number;
    readonly webviewer_get_performance_snapshot: (a: number) => number;
    readonly webviewer_get_selection_list: (a: number) => number;
    readonly webviewer_get_sequence_data: (a: number) => number;
    readonly webviewer_load_data: (a: number, b: number, c: number, d: number, e: number, f: number, g: number, h: number) => void;
    readonly webviewer_needs_redraw: (a: number) => number;
    readonly webviewer_on_mouse_down: (a: number, b: number, c: number, d: number, e: number) => void;
    readonly webviewer_on_mouse_move: (a: number, b: number, c: number, d: number) => void;
    readonly webviewer_on_mouse_up: (a: number, b: number, c: number, d: number) => void;
    readonly webviewer_on_wheel: (a: number, b: number, c: number) => void;
    readonly webviewer_pick_at_screen: (a: number, b: number, c: number) => number;
    readonly webviewer_poll_pending_picks: (a: number) => void;
    readonly webviewer_process_hover: (a: number, b: number, c: number) => void;
    readonly webviewer_process_input: (a: number) => void;
    readonly webviewer_render_frame: (a: number) => void;
    readonly webviewer_reset_performance_stats: (a: number) => void;
    readonly webviewer_resize: (a: number, b: number, c: number) => void;
    readonly webviewer_set_picking_enabled: (a: number, b: number) => void;
    readonly webviewer_set_selection_overlay_enabled: (a: number, b: number) => void;
    readonly webviewer_takeWarnings: (a: number) => number;
    readonly webviewer_take_completed_pick: (a: number) => number;
    readonly webviewer_update_animations: (a: number, b: number) => void;
    readonly __wasm_bindgen_func_elem_12246: (a: number, b: number) => void;
    readonly __wasm_bindgen_func_elem_13190: (a: number, b: number) => void;
    readonly __wasm_bindgen_func_elem_13768: (a: number, b: number, c: number, d: number) => void;
    readonly __wasm_bindgen_func_elem_13773: (a: number, b: number, c: number, d: number) => void;
    readonly __wasm_bindgen_func_elem_12299: (a: number, b: number, c: number) => void;
    readonly __wbindgen_export: (a: number, b: number) => number;
    readonly __wbindgen_export2: (a: number, b: number, c: number, d: number) => number;
    readonly __wbindgen_export3: (a: number) => void;
    readonly __wbindgen_export4: (a: number, b: number, c: number) => void;
    readonly __wbindgen_add_to_stack_pointer: (a: number) => number;
    readonly __wbindgen_start: () => void;
}

export type SyncInitInput = BufferSource | WebAssembly.Module;

/**
 * Instantiates the given `module`, which can either be bytes or
 * a precompiled `WebAssembly.Module`.
 *
 * @param {{ module: SyncInitInput }} module - Passing `SyncInitInput` directly is deprecated.
 *
 * @returns {InitOutput}
 */
export function initSync(module: { module: SyncInitInput } | SyncInitInput): InitOutput;

/**
 * If `module_or_path` is {RequestInfo} or {URL}, makes a request and
 * for everything else, calls `WebAssembly.instantiate` directly.
 *
 * @param {{ module_or_path: InitInput | Promise<InitInput> }} module_or_path - Passing `InitInput` directly is deprecated.
 *
 * @returns {Promise<InitOutput>}
 */
export default function __wbg_init (module_or_path?: { module_or_path: InitInput | Promise<InitInput> } | InitInput | Promise<InitInput>): Promise<InitOutput>;
