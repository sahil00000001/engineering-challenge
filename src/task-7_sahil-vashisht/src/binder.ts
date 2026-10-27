/**
 * Template binding: puts values into {{placeholders}} without ever letting a value become markup.
 *
 * - {{name}} placeholders take approved content. They are only allowed as element text.
 * - {{@name}} placeholders take renderer-derived values. They may also sit inside a quoted
 *   attribute value. A {{@name_css}} placeholder sits inside <style> and only accepts a
 *   strict CSS character set.
 * - Every value is HTML-escaped. Substitution is a single pass, so a value that contains
 *   "{{title}}" is shown literally and never expanded.
 * - Placeholders inside HTML comments are documentation and are left alone.
 *
 * The template is trusted input, but these context rules are still checked on every
 * bind, so a template edit that moved a content slot into an attribute or a <script>
 * fails loudly instead of quietly opening an injection path.
 */

export type TemplateValues = Readonly<Record<string, string>>;

/** Replaceable so tests can substitute a deliberately faulty binder and prove the validator catches it. */
export interface TemplateBinder {
  bind(template: string, values: TemplateValues): string;
}

export class TemplateError extends Error {
  override name = "TemplateError";
}

export type PlaceholderContext = "text" | "attribute" | "css";

export interface Placeholder {
  name: string;
  index: number;
  context: PlaceholderContext;
}

const PLACEHOLDER = /\{\{\s*(@?[a-z][a-z0-9_]*)\s*\}\}/g;
const SAFE_CSS = /^[A-Za-z0-9\s:;{}().,%#*+\/_-]*$/;

const ESCAPES: Record<string, string> = { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" };

export function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, (char) => ESCAPES[char]!);
}

/** Lists the template's placeholders and verifies each one sits in a context where escaping is sufficient. */
export function inspectTemplate(template: string): Placeholder[] {
  const lexical = lexicalContexts(template);
  const placeholders: Placeholder[] = [];

  for (const match of template.matchAll(PLACEHOLDER)) {
    const index = match.index;
    const name = match[1]!;
    const end = index + match[0].length;
    const context = lexical[index];

    if (context === "comment") continue;
    if (context === "script") {
      throw new TemplateError(`{{${name}}} is inside <script>; no value may be bound there`);
    }
    if (context === "style") {
      if (!isCssPlaceholder(name)) {
        throw new TemplateError(`{{${name}}} is inside <style>; only {{@*_css}} placeholders may be bound there`);
      }
      placeholders.push({ name, index, context: "css" });
      continue;
    }
    if (isCssPlaceholder(name)) {
      throw new TemplateError(`{{${name}}} must sit inside a <style> element`);
    }
    if (context === "attribute-value" || context === "tag") {
      if (!name.startsWith("@")) {
        throw new TemplateError(`Content placeholder {{${name}}} is inside a tag; content may only be bound as element text`);
      }
      const wholeValue = context === "attribute-value" && template[index - 1] === '"' && template[end] === '"' && lexical[index - 1] === "tag";
      if (!wholeValue) {
        throw new TemplateError(`{{${name}}} must fill a whole double-quoted attribute value`);
      }
      placeholders.push({ name, index, context: "attribute" });
      continue;
    }
    placeholders.push({ name, index, context: "text" });
  }
  return placeholders;
}

/** The production binder: context-checked, escaped, single-pass. */
export const safeBinder: TemplateBinder = {
  bind(template, values) {
    const placeholders = inspectTemplate(template);
    for (const { name } of placeholders) {
      if (!Object.hasOwn(values, name)) throw new TemplateError(`No value supplied for {{${name}}}`);
    }
    const bound = new Map(placeholders.map((p) => [p.index, p]));

    return template.replace(PLACEHOLDER, (token, _name: string, index: number) => {
      const placeholder = bound.get(index);
      if (!placeholder) return token; // inside a comment
      const value = values[placeholder.name]!;
      if (placeholder.context === "css") {
        if (!SAFE_CSS.test(value)) throw new TemplateError(`Value for {{${placeholder.name}}} contains characters not allowed in CSS context`);
        return value;
      }
      return escapeHtml(value);
    });
  },
};

function isCssPlaceholder(name: string): boolean {
  return name.startsWith("@") && name.endsWith("_css");
}

type Lexical = "text" | "comment" | "tag" | "attribute-value" | "script" | "style";

/**
 * A minimal HTML tokenizer for the template. It labels each character as text, comment,
 * tag (between < and >), quoted attribute value, or raw text inside <script> or <style>.
 * It tracks quotes, so a ">" inside an attribute value cannot end a tag early.
 */
export function lexicalContexts(template: string): Lexical[] {
  const lower = template.toLowerCase();
  const out = new Array<Lexical>(template.length);
  let state: "text" | "comment" | "tag" | "raw" = "text";
  let quote: string | null = null;
  let rawElement: "script" | "style" | null = null;

  let i = 0;
  while (i < template.length) {
    const char = template[i]!;
    if (state === "text") {
      if (lower.startsWith("<!--", i)) {
        out.fill("comment", i, i + 4);
        i += 4;
        state = "comment";
        continue;
      }
      if (char === "<" && /[a-z!/?]/i.test(template[i + 1] ?? "")) {
        const name = /^<([a-z][a-z0-9-]*)/.exec(lower.slice(i, i + 32))?.[1];
        rawElement = name === "script" || name === "style" ? name : null;
        state = "tag";
      }
      out[i++] = state === "tag" ? "tag" : "text";
    } else if (state === "comment") {
      if (lower.startsWith("-->", i)) {
        out.fill("comment", i, i + 3);
        i += 3;
        state = "text";
        continue;
      }
      out[i++] = "comment";
    } else if (state === "tag") {
      if (quote) {
        out[i++] = char === quote ? "tag" : "attribute-value";
        if (char === quote) quote = null;
        continue;
      }
      if (char === '"' || char === "'") quote = char;
      else if (char === ">") state = rawElement ? "raw" : "text";
      out[i++] = "tag";
    } else if (lower.startsWith(`</${rawElement}`, i)) {
      rawElement = null;
      state = "tag";
      out[i++] = "tag";
    } else {
      out[i++] = rawElement!;
    }
  }
  return out;
}
