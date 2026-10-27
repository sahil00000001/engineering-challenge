import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";
import { TemplateError, escapeHtml, inspectTemplate, safeBinder } from "../src/binder.js";
import { TEXT_SLOTS } from "../src/contracts.js";
import { loadDesignConfig } from "../src/pipeline.js";
import { resolveRepoPath } from "../src/paths.js";

describe("escapeHtml", () => {
  it("escapes every character that could start markup or leave an attribute", () => {
    expect(escapeHtml(`<a href="x" title='y'>&</a>`)).toBe("&lt;a href=&quot;x&quot; title=&#39;y&#39;&gt;&amp;&lt;/a&gt;");
  });

  it("turns a script tag into inert text", () => {
    expect(escapeHtml('<script>alert("test")</script>')).toBe("&lt;script&gt;alert(&quot;test&quot;)&lt;/script&gt;");
  });

  it("escapes existing entities again so they display literally", () => {
    expect(escapeHtml("&amp; &lt;b&gt;")).toBe("&amp;amp; &amp;lt;b&amp;gt;");
  });
});

describe("safeBinder", () => {
  const template = `<title>{{title}}</title><img alt="{{@alt}}"><style>{{@config_css}}</style><p>{{body}}</p>`;
  const values = { title: "T", body: "B", "@alt": "Logo", "@config_css": ":root{--x:1px}" };

  it("binds text and attribute values escaped, and CSS values verbatim", () => {
    const html = safeBinder.bind(template, { ...values, body: "<b>bold</b>", "@alt": `" onerror="x` });
    expect(html).toContain("<p>&lt;b&gt;bold&lt;/b&gt;</p>");
    expect(html).toContain('alt="&quot; onerror=&quot;x"');
    expect(html).toContain("<style>:root{--x:1px}</style>");
  });

  it("substitutes in a single pass, so placeholders inside values are never expanded", () => {
    const html = safeBinder.bind(template, { ...values, title: "{{body}}", body: "{{@config_css}}" });
    expect(html).toContain("<title>{{body}}</title>");
    expect(html).toContain("<p>{{@config_css}}</p>");
  });

  it("keeps String.replace patterns such as $& and $1 literal", () => {
    expect(safeBinder.bind(template, { ...values, body: "$& $1 $$ $`" })).toContain("<p>$&amp; $1 $$ $`</p>");
  });

  it("leaves placeholders inside HTML comments alone", () => {
    const html = safeBinder.bind(`<!-- {{undocumented}} --><p>{{body}}</p>`, { body: "B" });
    expect(html).toBe("<!-- {{undocumented}} --><p>B</p>");
  });

  it("refuses to bind when a value is missing", () => {
    expect(() => safeBinder.bind(template, { title: "T", body: "B", "@alt": "L" })).toThrow(/No value supplied for \{\{@config_css\}\}/);
  });

  it("refuses CSS values that could close the <style> element", () => {
    expect(() => safeBinder.bind(template, { ...values, "@config_css": "</style><script>x()</script>" })).toThrow(TemplateError);
  });
});

describe("template context rules", () => {
  it.each([
    ["content in an attribute", `<img alt="{{title}}">`, /content may only be bound as element text/],
    ["anything in a script", `<script>{{@x}}</script>`, /inside <script>/],
    ["non-CSS value in a style", `<style>{{@x}}</style>`, /only \{\{@\*_css\}\} placeholders/],
    ["CSS value outside a style", `<p>{{@x_css}}</p>`, /must sit inside a <style> element/],
    ["unquoted attribute value", `<img alt={{@x}}>`, /double-quoted attribute value/],
    ["partial attribute value", `<img alt="logo {{@x}}">`, /double-quoted attribute value/],
    ["single-quoted attribute value", `<img alt='{{@x}}'>`, /double-quoted attribute value/],
    // A ">" inside an earlier attribute value must not end the tag early.
    ["content in an attribute after a quoted >", `<img alt=">" src="{{title}}">`, /content may only be bound as element text/],
    ["content as an attribute name after a quoted >", `<p data-x=">" {{title}}>`, /content may only be bound as element text/],
    ["content in a script after a commented-out end tag", `<script>/* </p> */ {{title}}</script>`, /inside <script>/],
  ])("rejects %s", (_label, template, message) => {
    expect(() => inspectTemplate(template)).toThrow(message);
  });

  it("is not confused by markup-like text inside comments or attribute values", () => {
    const template = `<!-- <style> {{ignored}} --><p title="a > b <c>">{{body}}</p><style>{{@x_css}}</style><p>{{title}}</p>`;
    expect(inspectTemplate(template).map((p) => `${p.name}:${p.context}`)).toEqual(["body:text", "@x_css:css", "title:text"]);
  });

  it("the shipped template binds every content slot as element text", async () => {
    const { config } = await loadDesignConfig();
    const source = await readFile(resolveRepoPath(config.template.html), "utf8");
    const placeholders = inspectTemplate(source);
    for (const slot of TEXT_SLOTS) {
      const uses = placeholders.filter((p) => p.name === slot);
      expect(uses.length, slot).toBeGreaterThan(0);
      expect(uses.every((p) => p.context === "text"), slot).toBe(true);
    }
    // Slot elements hold their placeholder with no surrounding whitespace, so textContent can be compared exactly.
    for (const slot of TEXT_SLOTS) expect(source).toMatch(new RegExp(`data-slot="${slot}">\\{\\{${slot}\\}\\}</`));
  });
});
