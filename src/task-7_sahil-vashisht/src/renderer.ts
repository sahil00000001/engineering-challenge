import { readFile } from "node:fs/promises";
import { chromium, type Browser, type BrowserContext, type Route } from "playwright";
import type { AllowedAsset } from "./assets.js";
import type { Measurement, MeasureSpec } from "./measurement.js";

/**
 * Documents are served from this origin and nowhere else. The .invalid TLD is reserved
 * (RFC 2606), so a request that escaped interception could never resolve.
 */
export const VIRTUAL_ORIGIN = "https://insight-renderer.invalid";

export interface SecurityEvents {
  blocked_requests: string[];
  csp_violations: string[];
  dialogs: number;
  page_errors: string[];
}

export interface RenderRequest {
  /** URL path the bound document is served at: the template's own path, so its relative links resolve as on disk. */
  pageUrlPath: string;
  html: string;
  csp: string;
  allowlist: ReadonlyMap<string, AllowedAsset>;
  viewport: { width: number; height: number };
  deviceScaleFactor: number;
  /** The unbound template. The rendered page must keep its element structure. */
  templateSource: string;
  measure: Omit<MeasureSpec, "expected_skeleton">;
}

export interface RenderOutput {
  png: Buffer;
  measurement: Measurement;
  security: SecurityEvents;
  /** URL paths of allowlisted assets the page actually requested. */
  servedAssets: Set<string>;
  engine: string;
  browserVersion: string;
}

/** The browser boundary. Swappable: tests use a fake to exercise validation without a browser. */
export interface Renderer {
  render(request: RenderRequest): Promise<RenderOutput>;
  close(): Promise<void>;
}

const MEASURE_SOURCE = await readFile(new URL("./browser/measure.js", import.meta.url), "utf8");

// Flags that remove machine-specific rendering variation (hinting, subpixel text, colour profile).
const DETERMINISM_ARGS = ["--font-render-hinting=none", "--disable-lcd-text", "--force-color-profile=srgb"];

export class ChromiumRenderer implements Renderer {
  private readonly fileCache = new Map<string, Buffer>();
  private readonly skeletonCache = new Map<string, string[]>();

  private constructor(private readonly browser: Browser) {}

  static async launch(): Promise<ChromiumRenderer> {
    return new ChromiumRenderer(await chromium.launch({ args: DETERMINISM_ARGS }));
  }

  async render(request: RenderRequest): Promise<RenderOutput> {
    const context = await this.browser.newContext({
      viewport: request.viewport,
      deviceScaleFactor: request.deviceScaleFactor,
      // The page never needs its own JavaScript. Bound content is escaped already;
      // this is the second layer, and the hash-pinned CSP is the third.
      javaScriptEnabled: false,
      locale: "en-US",
      timezoneId: "UTC",
      colorScheme: "light",
      reducedMotion: "reduce",
      forcedColors: "none",
      serviceWorkers: "block",
    });
    const security: SecurityEvents = { blocked_requests: [], csp_violations: [], dialogs: 0, page_errors: [] };
    const servedAssets = new Set<string>();

    try {
      const page = await context.newPage();
      page.on("console", (message) => {
        const text = message.text();
        if (text.includes("Content Security Policy")) security.csp_violations.push(text.slice(0, 300));
      });
      page.on("dialog", (dialog) => {
        security.dialogs += 1;
        void dialog.dismiss();
      });
      page.on("pageerror", (error) => security.page_errors.push(error.message));
      await context.route("**/*", (route) => this.serve(route, request, security, servedAssets));

      const response = await page.goto(VIRTUAL_ORIGIN + request.pageUrlPath, { waitUntil: "load" });
      if (!response?.ok()) throw new Error(`Rendered document failed to load (status ${response?.status() ?? "none"})`);

      const spec: MeasureSpec = {
        ...request.measure,
        expected_skeleton: await this.templateSkeleton(context, request.templateSource),
      };
      const measurement = (await page.evaluate(
        `(() => {\n${MEASURE_SOURCE}\nreturn measureInsight(${JSON.stringify(spec)});\n})()`,
      )) as Measurement;

      // animations/caret are left alone on purpose: Playwright's helpers for them inject
      // a stylesheet, which the CSP would (rightly) report as a violation. The template
      // has no animations, and reducedMotion is set.
      const png = await page.screenshot({
        type: "png",
        clip: { x: 0, y: 0, width: request.viewport.width, height: request.viewport.height },
        animations: "allow",
        caret: "initial",
        scale: "device",
      });
      // One round trip so console events raised during the screenshot are delivered.
      await page.evaluate("0");

      return {
        png,
        measurement,
        security,
        servedAssets,
        engine: "chromium",
        browserVersion: this.browser.version(),
      };
    } finally {
      await context.close();
    }
  }

  async close(): Promise<void> {
    await this.browser.close();
  }

  /**
   * The element structure the browser's own parser builds from the unbound template.
   * It is parsed in a separate probe page with every request aborted. Parsing it inside
   * the rendered page (with DOMParser) would make the CSP report the template's unhashed
   * <style> placeholder as a violation.
   */
  private async templateSkeleton(context: BrowserContext, templateSource: string): Promise<string[]> {
    const cached = this.skeletonCache.get(templateSource);
    if (cached) return cached;
    const probe = await context.newPage();
    try {
      await probe.route("**/*", (route) => route.abort());
      await probe.setContent(templateSource, { waitUntil: "domcontentloaded" });
      const skeleton = (await probe.evaluate(`(() => {\n${MEASURE_SOURCE}\nreturn elementSkeleton(document);\n})()`)) as string[];
      this.skeletonCache.set(templateSource, skeleton);
      return skeleton;
    } finally {
      await probe.close();
    }
  }

  private async serve(route: Route, request: RenderRequest, security: SecurityEvents, served: Set<string>): Promise<void> {
    const url = new URL(route.request().url());
    const urlPath = safeDecode(url.pathname);

    if (url.origin === VIRTUAL_ORIGIN && urlPath === request.pageUrlPath) {
      await route.fulfill({
        status: 200,
        contentType: "text/html; charset=utf-8",
        headers: { "content-security-policy": request.csp },
        body: request.html,
      });
      return;
    }

    const asset = url.origin === VIRTUAL_ORIGIN && urlPath !== null ? request.allowlist.get(urlPath) : undefined;
    if (!asset || asset.role === "template") {
      security.blocked_requests.push(url.href);
      await route.abort("blockedbyclient");
      return;
    }

    let body = this.fileCache.get(asset.file);
    if (!body) {
      try {
        body = await readFile(asset.file);
      } catch {
        // Reported as ASSET_NOT_LOADED, because the asset never shows up in servedAssets.
        await route.abort("failed");
        return;
      }
      this.fileCache.set(asset.file, body);
    }
    served.add(urlPath!);
    await route.fulfill({ status: 200, contentType: asset.contentType, body });
  }
}

function safeDecode(pathname: string): string | null {
  try {
    return decodeURIComponent(pathname);
  } catch {
    return null;
  }
}
