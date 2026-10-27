// @ts-check
/**
 * In-page measurement for the single-insight template.
 *
 * The renderer evaluates these functions inside the page through Playwright's
 * evaluation channel. The page's own JavaScript stays disabled. They only read the
 * document and never change it. The file is shipped to the browser as source text, so it
 * must stay self-contained: no imports and no references outside this file.
 */

/**
 * Every element in document order, with its sorted attribute names. Content bound as
 * text cannot change this. Content bound as markup always does.
 *
 * @param {Document} doc
 * @returns {string[]}
 */
function elementSkeleton(doc) {
  return [...doc.querySelectorAll("*")].map((el) => `${el.tagName.toLowerCase()}[${el.getAttributeNames().sort().join(",")}]`);
}

/**
 * @param {import("../measurement.js").MeasureSpec} spec
 * @returns {Promise<import("../measurement.js").Measurement>}
 */
async function measureInsight(spec) {
  /** @param {number} n */
  const round = (n) => Math.round(n * 100) / 100;
  /** @param {DOMRect} r */
  const box = (r) => ({ x: round(r.x), y: round(r.y), width: round(r.width), height: round(r.height) });
  /** @param {Element} el */
  const describe = (el) => el.tagName.toLowerCase() + [...el.classList].map((c) => "." + c).join("");
  /** @param {DOMRect} inner @param {DOMRect} outer */
  const contains = (inner, outer) =>
    inner.left >= outer.left - 0.5 &&
    inner.top >= outer.top - 0.5 &&
    inner.right <= outer.right + 0.5 &&
    inner.bottom <= outer.bottom + 0.5;
  /** @param {Element} el */
  const backgroundOf = (el) => {
    for (let node = /** @type {Element | null} */ (el); node; node = node.parentElement) {
      const color = getComputedStyle(node).backgroundColor;
      if (color && color !== "transparent" && color !== "rgba(0, 0, 0, 0)") return color;
    }
    return null;
  };

  // Fonts and images must be settled before anything is measured, or line breaks
  // could be computed against fallback fonts.
  await document.fonts.ready;
  const fonts = [];
  for (const font of spec.fonts) {
    const descriptor = `${font.style} ${font.weight} 16px "${font.family}"`;
    /** @type {FontFace[]} */
    let faces = [];
    try {
      faces = await document.fonts.load(descriptor);
    } catch {
      faces = [];
    }
    fonts.push({
      family: font.family,
      weight: font.weight,
      style: font.style,
      loaded: faces.length > 0 && faces.every((face) => face.status === "loaded"),
    });
  }
  for (const image of document.images) {
    try {
      await image.decode();
    } catch {
      // Reported through the brand slot's image.complete / natural size.
    }
  }

  const canvases = document.querySelectorAll("[data-canvas]");
  const canvas = canvases[0] ?? null;

  /** @type {Record<string, import("../measurement.js").SlotMeasurement>} */
  const slots = {};
  for (const name of spec.slots) {
    const matches = document.querySelectorAll(`[data-slot="${name}"]`);
    const el = matches[0];
    if (!el) {
      slots[name] = {
        count: 0, tag: null, text: null, child_elements: 0, rect: null, region_rect: null,
        scroll_width: 0, client_width: 0, scroll_height: 0, client_height: 0, line_height_px: null, visible: false,
        background_color: null, styles: null, clipped_by: [], image: null,
      };
      continue;
    }

    const style = getComputedStyle(el);
    const rect = el.getBoundingClientRect();
    const region = el.closest("[data-region]");
    const lineHeight = Number.parseFloat(style.lineHeight);

    // The slot's content can be larger than its own box (a fixed height, or overflow on
    // the slot itself). scrollWidth/scrollHeight report the full extent either way.
    const content = new DOMRect(rect.x, rect.y, Math.max(rect.width, el.scrollWidth), Math.max(rect.height, el.scrollHeight));
    const clippedBy = [];
    for (let node = /** @type {Element | null} */ (el); node && node !== document.body; node = node.parentElement) {
      const nodeStyle = getComputedStyle(node);
      const clipsOverflow = nodeStyle.overflowX !== "visible" || nodeStyle.overflowY !== "visible";
      const bounds = node === el ? rect : node.getBoundingClientRect();
      if (clipsOverflow && !contains(content, bounds)) clippedBy.push(`${describe(node)} (overflow: ${nodeStyle.overflowX} ${nodeStyle.overflowY})`);
      if (nodeStyle.clipPath !== "none") clippedBy.push(`${describe(node)} (clip-path: ${nodeStyle.clipPath})`);
      if (nodeStyle.maskImage !== "none" || nodeStyle.webkitMaskImage !== "none") clippedBy.push(`${describe(node)} (mask)`);
    }

    slots[name] = {
      count: matches.length,
      tag: el.tagName.toLowerCase(),
      text: el instanceof HTMLImageElement ? el.getAttribute("alt") : el.textContent,
      child_elements: el.childElementCount,
      rect: box(rect),
      region_rect: region ? box(region.getBoundingClientRect()) : null,
      scroll_width: el.scrollWidth,
      client_width: el.clientWidth,
      scroll_height: el.scrollHeight,
      client_height: el.clientHeight,
      line_height_px: Number.isFinite(lineHeight) ? round(lineHeight) : null,
      visible: el.checkVisibility({ opacityProperty: true, visibilityProperty: true, contentVisibilityAuto: true }),
      background_color: backgroundOf(el),
      styles: {
        display: style.display,
        visibility: style.visibility,
        opacity: Number.parseFloat(style.opacity),
        color: style.color,
        font_family: style.fontFamily,
        font_size_px: Number.parseFloat(style.fontSize),
        text_transform: style.textTransform,
        first_line_text_transform: getComputedStyle(el, "::first-line").textTransform,
        first_letter_text_transform: getComputedStyle(el, "::first-letter").textTransform,
        font_variant_caps: style.fontVariantCaps,
        direction: style.direction,
        unicode_bidi: style.unicodeBidi,
        text_security: style.getPropertyValue("-webkit-text-security") || "none",
        text_overflow: style.textOverflow,
        line_clamp: style.webkitLineClamp,
        overflow_x: style.overflowX,
        overflow_y: style.overflowY,
        before_content: getComputedStyle(el, "::before").content,
        after_content: getComputedStyle(el, "::after").content,
      },
      clipped_by: clippedBy,
      image:
        el instanceof HTMLImageElement
          ? {
              complete: el.complete,
              natural_width: el.naturalWidth,
              natural_height: el.naturalHeight,
              src: el.currentSrc ? new URL(el.currentSrc).pathname : "",
            }
          : null,
    };
  }

  const expected = spec.expected_skeleton;
  const actual = elementSkeleton(document);
  let firstDifference = null;
  for (let i = 0; i < Math.max(expected.length, actual.length); i++) {
    if (expected[i] !== actual[i]) {
      firstDifference = { index: i, expected: expected[i] ?? null, actual: actual[i] ?? null };
      break;
    }
  }

  let eventHandlerAttributes = 0;
  for (const el of document.querySelectorAll("*")) {
    eventHandlerAttributes += el.getAttributeNames().filter((attr) => attr.toLowerCase().startsWith("on")).length;
  }

  return {
    url_path: location.pathname,
    viewport: { width: window.innerWidth, height: window.innerHeight },
    canvas: {
      count: canvases.length,
      rect: canvas ? box(canvas.getBoundingClientRect()) : null,
      background_color: canvas ? backgroundOf(canvas) : null,
    },
    fonts,
    slots: /** @type {import("../measurement.js").Measurement["slots"]} */ (slots),
    document: {
      script_elements: document.querySelectorAll("script").length,
      event_handler_attributes: eventHandlerAttributes,
      skeleton: {
        matches: firstDifference === null,
        expected_length: expected.length,
        actual_length: actual.length,
        first_difference: firstDifference,
      },
    },
  };
}

// The renderer evaluates this file as source text and calls measureInsight itself.
// This line only tells the type checker that the function is used.
void measureInsight;
