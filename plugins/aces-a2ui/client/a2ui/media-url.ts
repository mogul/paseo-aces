/**
 * Spec-mandated media URL validation (A2UI v1.0 Basic Catalog Guide, "Media
 * URLs"): `Image.url`, `Video.url`, `Video.posterUrl` and `AudioPlayer.url`
 * come from the agent, so renderers may only load `http:`, `https:`, `data:`
 * URLs and same-host relative paths — never `javascript:`, `file:`, `blob:`,
 * `ftp:` or protocol-relative `//host` forms. Validation runs on every render
 * and a `data:` URL can be megabytes, so only the scheme prefix and the first
 * characters are inspected: no full-string copies, no payload-wide regex.
 *
 * Mirrors @a2ui/web_core's `sanitizeMediaUrl` (type-only reference; never
 * imported) without a WHATWG URL parser, which Hermes does not guarantee.
 */
export function isValidMediaUrl(url: unknown): boolean {
  if (typeof url !== "string") return false;
  // Rule 1: trim leading/trailing whitespace and control characters (scanned
  // between bounds — no copy); an empty result is rejected.
  let start = 0;
  let end = url.length;
  while (start < end && isTrimChar(url.charCodeAt(start))) start++;
  while (end > start && isTrimChar(url.charCodeAt(end - 1))) end--;
  if (start === end) return false;
  // Browsers drop TAB/CR/LF everywhere before parsing, so `ht\ttps://host`
  // parses as a valid https URL there; http(s) therefore additionally
  // requires the literal raw prefix below. Dropping happens lazily while
  // scanning so `/\t/host` counts as `//host` and rejects.
  let i = start;
  const next = (): number => {
    while (i < end) {
      const code = url.charCodeAt(i);
      if (code !== 9 && code !== 10 && code !== 13) return code;
      i++;
    }
    return -1;
  };
  if (isAsciiAlpha(next())) {
    // Scheme state: ASCII alphanumeric plus `+`/`-`/`.` up to `:`. The
    // 64-character window is far past any real scheme; anything longer only
    // ever resolves as an unloadable relative path on the client.
    let scheme = "";
    let hasColon = false;
    for (let count = 0; count < 64; count++) {
      const code = next();
      if (code === -1) break;
      if (code === 58) {
        i++;
        hasColon = true;
        break;
      }
      if (!isSchemeChar(code)) break;
      scheme += String.fromCharCode(code);
      i++;
    }
    if (hasColon) {
      const lowered = scheme.toLowerCase();
      if (lowered === "http" || lowered === "https") {
        // Rule 3: http(s) must literally read `scheme://` with a non-empty
        // host — `https:host`, `https:\\host` and `ht\ttps://host` all reject.
        const prefix = `${lowered}://`;
        if (end - start < prefix.length) return false;
        for (let k = 0; k < prefix.length; k++) {
          if (toLowerCaseAscii(url.charCodeAt(start + k)) !== prefix.charCodeAt(k)) return false;
        }
        for (let k = 0; k < 2; k++) {
          const code = next();
          if (code !== 47 && code !== 92) return false;
          i++;
        }
        const host = next();
        return host !== -1 && host !== 47 && host !== 92 && host !== 63 && host !== 35;
      }
      if (lowered === "data") {
        return next() !== -1; // `data:` alone is not a URL; the rest stays unexamined
      }
      return false; // every other scheme — javascript:, file:, ftp:, … — rejects
    }
  }
  // No scheme: a relative path. Rule 4: reject protocol-relative forms — two
  // or more leading slashes, counting `\` as `/`, after dropping TAB/CR/LF.
  let slashes = 0;
  for (;;) {
    const code = next();
    if (code !== 47 && code !== 92) break;
    if (++slashes >= 2) return false;
    i++;
  }
  return true;
}

/** Whitespace plus the C0 control characters and DEL. */
function isTrimChar(code: number): boolean {
  return code <= 0x20 || code === 0x7f;
}

function isAsciiAlpha(code: number): boolean {
  return (code >= 97 && code <= 122) || (code >= 65 && code <= 90);
}

/** RFC 3986 scheme characters after the leading letter. */
function isSchemeChar(code: number): boolean {
  return isAsciiAlpha(code) || (code >= 48 && code <= 57) || code === 43 || code === 45 || code === 46;
}

function toLowerCaseAscii(code: number): number {
  return code >= 65 && code <= 90 ? code + 32 : code;
}
