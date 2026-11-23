/**
 * Hand-rolled A2UI 1.0 binding resolution (the client never imports @a2ui/* at runtime).
 *
 * Shapes mirror the v1.0 basic catalog read off the installed .d.ts files:
 * - data bindings: `{ "@path": "/json/pointer" }` (or non-`@` `path`)
 * - function calls: `{ "@call": "name", args: { ... } }`; the `@index` system function
 *   gives a template list item's index
 * - validators (`required`, `regex`, `length`, `numeric`, `email`) return
 *   `{ valid: boolean, message?: string }`, so a check condition passes on
 *   `{ valid: true }` and fails on `{ valid: false }` or any falsy value
 * - `formatString` interpolates `${pointer}` and `${fn(arg:...)}` expressions
 */
import { openExternalUrl } from "@getpaseo/plugin/client";
import { readDataPath } from "./state";

export interface A2uiResolveContext {
  dataModel: Record<string, unknown>;
  /** JSON Pointer of the enclosing data context; "/" outside template lists. */
  dataPath: string;
  /** Index of the enclosing template list item, for `{"@call": "@index"}`. */
  index: number;
}

/** Visible placeholder for anything a surface referenced but we could not resolve. */
export const UNRESOLVED = "‹unresolved›";

export function rootContext(dataModel: Record<string, unknown>): A2uiResolveContext {
  return { dataModel, dataPath: "/", index: 0 };
}

/** Resolves one wire value: plain values pass through, bindings resolve, failures placeholder. */
export function resolveBinding(value: unknown, ctx: A2uiResolveContext): unknown {
  if (value === null || typeof value !== "object") return value;
  if (Array.isArray(value)) return value.map((item) => resolveBinding(item, ctx));
  const record = value as Record<string, unknown>;
  const path = bindingPath(record);
  if (path !== undefined) {
    const resolved = readDataPath(ctx.dataModel, ctx.dataPath, path);
    return resolved === undefined ? UNRESOLVED : resolved;
  }
  const call = bindingCall(record);
  if (call !== undefined) return evaluateFunction(call, bindingArgs(record), ctx);
  return value;
}

/** Returns the pointer of a `{"@path": p}` / `{"path": p}` binding, else undefined. */
export function bindingPath(value: unknown): string | undefined {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return undefined;
  const record = value as Record<string, unknown>;
  const at = record["@path"];
  if (typeof at === "string") return at;
  const plain = record["path"];
  if (typeof plain === "string") return plain;
  return undefined;
}

function bindingCall(record: Record<string, unknown>): string | undefined {
  const at = record["@call"];
  if (typeof at === "string") return at;
  const plain = record["call"];
  if (typeof plain === "string") return plain;
  return undefined;
}

function bindingArgs(record: Record<string, unknown>): Record<string, unknown> {
  const args = record["args"];
  if (typeof args !== "object" || args === null || Array.isArray(args)) return {};
  return args as Record<string, unknown>;
}

/** Mirrors web_core's `isTruthyOrValid`: `{ valid }` objects pass on `valid`, else JS truthiness. */
export function isTruthyOrValid(value: unknown): boolean {
  if (typeof value === "object" && value !== null && !Array.isArray(value)) {
    const valid = (value as Record<string, unknown>)["valid"];
    if (typeof valid === "boolean") return valid;
  }
  return !!value;
}

export interface A2uiCheckResult {
  ok: boolean;
  message?: string;
}

/** Evaluates a component's `checks: [{ condition, message }]`; first failure wins. */
export function evaluateChecks(checks: unknown, ctx: A2uiResolveContext): A2uiCheckResult {
  if (!Array.isArray(checks)) return { ok: true };
  for (const raw of checks) {
    if (typeof raw !== "object" || raw === null) continue;
    const check = raw as Record<string, unknown>;
    if (!isTruthyOrValid(resolveBinding(check["condition"], ctx))) {
      const message = check["message"];
      return { ok: false, message: typeof message === "string" ? message : undefined };
    }
  }
  return { ok: true };
}

function evaluateFunction(name: string, args: Record<string, unknown>, ctx: A2uiResolveContext): unknown {
  const arg = (key: string): unknown => resolveBinding(args[key], ctx);
  const argNumber = (key: string): number | undefined => {
    const resolved = arg(key);
    const num = Number(resolved);
    return Number.isFinite(num) ? num : undefined;
  };
  const argString = (key: string): string | undefined => {
    const resolved = arg(key);
    return typeof resolved === "string" ? resolved : undefined;
  };

  switch (name) {
    case "@index": {
      const offset = argNumber("offset") ?? 0;
      return ctx.index + offset;
    }
    case "formatString": {
      const template = argString("value") ?? "";
      return interpolate(template, ctx);
    }
    case "formatNumber":
      return formatNumber(argNumber("value"), argNumber("decimals"), arg("grouping"));
    case "formatCurrency":
      return formatCurrency(argNumber("value"), argString("currency"), argNumber("decimals"), arg("grouping"));
    case "formatDate":
      return formatDate(arg("value"), argString("format"));
    case "pluralize": {
      const value = argNumber("value") ?? 0;
      const word = (key: string): string | undefined => argString(key);
      const fallback = word("other") ?? word("many") ?? UNRESOLVED;
      if (value === 0) return word("zero") ?? fallback;
      if (value === 1) return word("one") ?? fallback;
      if (value === 2) return word("two") ?? fallback;
      return fallback;
    }
    case "openUrl": {
      const url = argString("url");
      if (url === undefined) return UNRESOLVED;
      // Fire-and-forget; a failed open must never crash the surface.
      void openExternalUrl(url).catch(() => {});
      return undefined;
    }
    case "and":
    case "or": {
      const values = arg("values");
      if (!Array.isArray(values) || values.length === 0) return false;
      const truthy = values.map((item) => isTruthyOrValid(resolveBinding(item, ctx)));
      return name === "and" ? truthy.every(Boolean) : truthy.some(Boolean);
    }
    case "not":
      return !isTruthyOrValid(arg("value"));
    case "required": {
      const value = arg("value");
      const valid = !(value === null || value === undefined || value === "" || (Array.isArray(value) && value.length === 0));
      return valid ? { valid: true } : { valid: false, message: "This field is required." };
    }
    case "regex": {
      const value = arg("value");
      const pattern = argString("pattern");
      if (pattern === undefined) return UNRESOLVED;
      try {
        const valid = new RegExp(pattern).test(String(value ?? ""));
        return valid ? { valid: true } : { valid: false, message: "Value does not match required pattern." };
      } catch {
        return UNRESOLVED;
      }
    }
    case "length": {
      const value = arg("value");
      const length = typeof value === "string" || Array.isArray(value) ? value.length : 0;
      const min = argNumber("min");
      const max = argNumber("max");
      if (min !== undefined && length < min) return { valid: false, message: `Minimum length is ${min}.` };
      if (max !== undefined && length > max) return { valid: false, message: `Maximum length is ${max}.` };
      return { valid: true };
    }
    case "numeric": {
      const num = argNumber("value");
      if (num === undefined) return { valid: false, message: "Value must be a number." };
      const min = argNumber("min");
      const max = argNumber("max");
      if (min !== undefined && num < min) return { valid: false, message: `Minimum value is ${min}.` };
      if (max !== undefined && num > max) return { valid: false, message: `Maximum value is ${max}.` };
      return { valid: true };
    }
    case "email": {
      const value = argString("value") ?? "";
      const valid = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value);
      return valid ? { valid: true } : { valid: false, message: "Enter a valid email address." };
    }
    default:
      return UNRESOLVED;
  }
}

function formatNumber(value: number | undefined, decimals: number | undefined, grouping: unknown): string {
  if (value === undefined) return UNRESOLVED;
  const options: Intl.NumberFormatOptions = { useGrouping: isTruthyOrValid(grouping) || grouping === undefined };
  if (decimals !== undefined) {
    options.minimumFractionDigits = decimals;
    options.maximumFractionDigits = decimals;
  }
  return new Intl.NumberFormat(undefined, options).format(value);
}

function formatCurrency(
  value: number | undefined,
  currency: string | undefined,
  decimals: number | undefined,
  grouping: unknown,
): string {
  if (value === undefined || currency === undefined) return UNRESOLVED;
  const options: Intl.NumberFormatOptions = {
    style: "currency",
    currency,
    useGrouping: isTruthyOrValid(grouping) || grouping === undefined,
  };
  if (decimals !== undefined) {
    options.minimumFractionDigits = decimals;
    options.maximumFractionDigits = decimals;
  }
  return new Intl.NumberFormat(undefined, options).format(value);
}

const DATE_TOKENS = /yyyy|yy|MMMM|MMM|MM|M|EEEE|E|dd|d|HH|H|hh|h|mm|ss|a/g;

/** Formats a timestamp with the TR35 token subset web_core supports; best-effort client-side. */
function formatDate(value: unknown, pattern: string | undefined): string {
  if (value === null || value === undefined || value === "") return "";
  const date = parseTimestamp(value);
  if (date === null) return UNRESOLVED;
  if (pattern === "ISO") return date.toISOString();
  const format = pattern ?? "yyyy-MM-dd";
  const monthsLong = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
  const monthsShort = monthsLong.map((month) => month.slice(0, 3));
  const weekdaysLong = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"];
  const weekdaysShort = weekdaysLong.map((day) => day.slice(0, 3));
  const hours = date.getUTCHours();
  return format.replace(DATE_TOKENS, (token) => {
    switch (token) {
      case "yyyy": return String(date.getUTCFullYear()).padStart(4, "0");
      case "yy": return String(date.getUTCFullYear()).slice(-2);
      case "MMMM": return monthsLong[date.getUTCMonth()];
      case "MMM": return monthsShort[date.getUTCMonth()];
      case "MM": return String(date.getUTCMonth() + 1).padStart(2, "0");
      case "M": return String(date.getUTCMonth() + 1);
      case "EEEE": return weekdaysLong[(date.getUTCDay() + 6) % 7];
      case "E": return weekdaysShort[(date.getUTCDay() + 6) % 7];
      case "dd": return String(date.getUTCDate()).padStart(2, "0");
      case "d": return String(date.getUTCDate());
      case "HH": return String(hours).padStart(2, "0");
      case "H": return String(hours);
      case "hh": return String(hours % 12 || 12).padStart(2, "0");
      case "h": return String(hours % 12 || 12);
      case "mm": return String(date.getUTCMinutes()).padStart(2, "0");
      case "ss": return String(date.getUTCSeconds()).padStart(2, "0");
      case "a": return hours < 12 ? "AM" : "PM";
      default: return token;
    }
  });
}

function parseTimestamp(value: unknown): Date | null {
  const date = typeof value === "number" ? new Date(value) : new Date(String(value));
  return Number.isNaN(date.getTime()) ? null : date;
}

/**
 * Expands `${...}` expressions in a formatString template, innermost first (the grammar
 * allows a pointer inside a function argument, e.g. `${formatDate(value:${/date})}`).
 */
function interpolate(template: string, ctx: A2uiResolveContext): string {
  let result = template;
  for (let guard = 0; guard < 100; guard++) {
    const match = /\$\{([^{}]*)\}/.exec(result);
    if (!match) return result;
    result = result.replace(match[0], expressionText(match[1].trim(), ctx));
  }
  return result;
}

function expressionText(expression: string, ctx: A2uiResolveContext): string {
  const resolved = evaluateExpression(expression, ctx);
  return resolved === undefined || resolved === null ? UNRESOLVED : String(resolved);
}

function evaluateExpression(expression: string, ctx: A2uiResolveContext): unknown {
  const call = /^([a-zA-Z_]\w*)\((.*)\)$/.exec(expression);
  if (call) {
    const args: Record<string, unknown> = {};
    for (const piece of splitArguments(call[2])) {
      const separator = piece.indexOf(":");
      if (separator === -1) continue;
      args[piece.slice(0, separator).trim()] = argumentValue(piece.slice(separator + 1).trim(), ctx);
    }
    return evaluateFunction(call[1], args, ctx);
  }
  return readDataPath(ctx.dataModel, ctx.dataPath, expression);
}

function argumentValue(text: string, ctx: A2uiResolveContext): unknown {
  const quoted = /^'(.*)'$/.exec(text) ?? /^"(.*)"$/.exec(text);
  if (quoted) return quoted[1];
  if (text === "true") return true;
  if (text === "false") return false;
  if (/^-?\d+(\.\d+)?$/.test(text)) return Number(text);
  // Anything else is a JSON Pointer into the data model (the grammar's only other form).
  return readDataPath(ctx.dataModel, ctx.dataPath, text);
}

function splitArguments(text: string): string[] {
  const pieces: string[] = [];
  let current = "";
  let quote = "";
  for (const char of text) {
    if (quote) {
      current += char;
      if (char === quote) quote = "";
    } else if (char === "'" || char === '"') {
      quote = char;
      current += char;
    } else if (char === ",") {
      pieces.push(current);
      current = "";
    } else {
      current += char;
    }
  }
  if (current.trim() !== "") pieces.push(current);
  return pieces;
}
