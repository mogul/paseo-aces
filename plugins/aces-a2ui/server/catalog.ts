/**
 * A2UI catalog constants only — this module never imports `@a2ui/*`. Those
 * packages live in the worker subprocess (`server/a2ui-worker.mjs`) because
 * `@a2ui/web_core` is built against zod 3 while the daemon evaluates this
 * plugin's bundle with its own zod 4.
 *
 * `catalogId` is `basicCatalog.id` from `@a2ui/web_core/v1_0` 0.15.0, pinned as
 * a string (the client renderer needs only the id, not the catalog object).
 */
export const catalogId = "https://a2ui.org/specification/v1_0/catalogs/basic/catalog.json";

/** The message envelopes this plugin lets agents send; everything else fails validation. */
export const ALLOWED_A2UI_MESSAGES: readonly string[] = [
  "createSurface",
  "updateComponents",
  "updateDataModel",
  "deleteSurface",
];
