/**
 * Hand-rolled A2UI 1.0 client state (the client never imports @a2ui/* at runtime).
 *
 * Shapes mirror the v1.0 schemas read off the installed @a2ui/web_core .d.ts files:
 * - messages: { version: "1.0", createSurface | updateComponents | updateDataModel | deleteSurface }
 * - components: flat { id, component: "Type", ...props } records; the root is id "root"
 * - bindings: { "@path": "/json/pointer" }; data paths are RFC 6901 JSON Pointers
 * - updateComponents replaces a component's properties wholesale when type/catalog stay
 *   the same (mirrors web_core ComponentModel.applyUpdate), and recreates it otherwise
 */

export interface A2uiComponentPayload {
  id: string;
  component?: string;
  [property: string]: unknown;
}

export interface A2uiSurfaceState {
  surfaceId: string;
  catalogId?: string;
  components: Record<string, A2uiComponentPayload>;
  dataModel: Record<string, unknown>;
  rootId: string;
}

const ROOT_ID = "root";
const MAX_DATA_LIST_INDEX = 10000;

/** Applies messages in order; returns null when they delete (or never create) the surface. */
export function applyMessages(messages: unknown[]): A2uiSurfaceState | null {
  let state: A2uiSurfaceState | null = null;
  for (const message of messages) {
    if (typeof message !== "object" || message === null) continue;
    const envelope = message as Record<string, unknown>;
    if (isBody(envelope.createSurface)) {
      state = applyCreateSurface(envelope.createSurface as Record<string, unknown>);
    } else if (state && isBody(envelope.updateComponents)) {
      applyUpdateComponents(state, envelope.updateComponents as Record<string, unknown>);
    } else if (state && isBody(envelope.updateDataModel)) {
      applyUpdateDataModel(state, envelope.updateDataModel as Record<string, unknown>);
    } else if (isBody(envelope.deleteSurface)) {
      const body = envelope.deleteSurface as Record<string, unknown>;
      if (state && typeof body.surfaceId === "string" && body.surfaceId === state.surfaceId) return null;
    }
  }
  return state;
}

function isBody(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function applyCreateSurface(body: Record<string, unknown>): A2uiSurfaceState {
  const components: Record<string, A2uiComponentPayload> = {};
  if (Array.isArray(body.components)) {
    for (const raw of body.components) {
      if (typeof raw !== "object" || raw === null) continue;
      const component = raw as A2uiComponentPayload;
      if (typeof component.id === "string") components[component.id] = component;
    }
  }
  const dataModel = isBody(body.dataModel) ? (JSON.parse(JSON.stringify(body.dataModel)) as Record<string, unknown>) : {};
  return {
    surfaceId: typeof body.surfaceId === "string" ? body.surfaceId : ROOT_ID,
    catalogId: typeof body.catalogId === "string" ? body.catalogId : undefined,
    components,
    dataModel,
    rootId: ROOT_ID,
  };
}

function applyUpdateComponents(state: A2uiSurfaceState, body: Record<string, unknown>): void {
  if (!Array.isArray(body.components)) return;
  for (const raw of body.components) {
    if (typeof raw !== "object" || raw === null) continue;
    const { id, component, ...properties } = raw as A2uiComponentPayload;
    if (typeof id !== "string") continue;
    const existing = state.components[id];
    if (existing) {
      const type = typeof component === "string" && component ? component : existing.component;
      state.components[id] = { id, component: type, ...properties };
    } else if (typeof component === "string" && component) {
      state.components[id] = { id, component, ...properties };
    }
  }
}

function applyUpdateDataModel(state: A2uiSurfaceState, body: Record<string, unknown>): void {
  const path = typeof body.path === "string" ? body.path : "/";
  if (path !== "/" && !path.startsWith("/")) return; // server validation rejects this; stay lenient
  setDataPath(state.dataModel, path, body.value);
}

/**
 * RFC 6901 JSON Pointer set, mirroring web_core DataModel.set: missing containers are
 * created (arrays padded up to a sane index), and `undefined`/`null` values remove the
 * entry (v1.0 no longer stores null). Exported for the live-model edit path: field
 * edits mutate a copy of the message-time dataModel via `onEdit`.
 */
export function setDataPath(root: Record<string, unknown>, pointer: string, value: unknown): void {
  if (pointer === "/" || pointer === "") {
    if (value === null || value === undefined) {
      for (const key of Object.keys(root)) delete root[key];
    } else if (isBody(value)) {
      for (const key of Object.keys(root)) delete root[key];
      Object.assign(root, value);
    }
    return;
  }
  const segments = pointer.split("/").slice(1).map(unescapePointerSegment);
  const last = segments.length - 1;
  let container: unknown = root;
  for (let i = 0; i < last; i++) {
    const segment = segments[i];
    const next = segments[i + 1];
    container = descend(container, segment, next);
    if (container === null) return; // a primitive blocks the path; leave the model alone
  }
  const segment = segments[last];
  if (Array.isArray(container)) {
    const index = Number(segment);
    if (!Number.isInteger(index) || index < 0 || index > MAX_DATA_LIST_INDEX) return;
    if (value === null || value === undefined) delete container[index];
    else container[index] = value;
  } else if (isBody(container)) {
    if (value === null || value === undefined) delete container[segment];
    else container[segment] = value;
  }
}

function descend(container: unknown, segment: string, next: string): unknown {
  if (Array.isArray(container)) {
    const index = Number(segment);
    if (!Number.isInteger(index) || index < 0 || index > MAX_DATA_LIST_INDEX) return null;
    if (container[index] === undefined) container[index] = /^\d+$/.test(next) ? [] : {};
    return container[index];
  }
  if (isBody(container)) {
    if (container[segment] === undefined || container[segment] === null) {
      container[segment] = /^\d+$/.test(next) ? [] : {};
    } else if (!isBody(container[segment]) && !Array.isArray(container[segment])) {
      return null; // a primitive sits where a container is needed
    }
    return container[segment];
  }
  return null;
}


function unescapePointerSegment(segment: string): string {
  return segment.replace(/~1/g, "/").replace(/~0/g, "~");
}

/** Reads a JSON Pointer against a data model; relative paths resolve against `dataPath`. */
export function readDataPath(dataModel: Record<string, unknown>, dataPath: string, path: string): unknown {
  const absolute = absoluteDataPath(dataPath, path);
  if (absolute === "/" || absolute === "") return dataModel;
  const segments = absolute.split("/").slice(1).map(unescapePointerSegment);
  let current: unknown = dataModel;
  for (const segment of segments) {
    if (Array.isArray(current)) {
      const index = Number(segment);
      if (!Number.isInteger(index) || index < 0) return undefined;
      current = current[index];
    } else if (isBody(current)) {
      current = current[segment];
    } else {
      return undefined;
    }
  }
  return current;
}

/** Resolves a possibly-relative JSON Pointer against a base context path. */
export function absoluteDataPath(base: string, path: string): string {
  if (path.startsWith("/")) return path;
  if (base === "/" || base === "") return "/" + path;
  return base + "/" + path;
}
