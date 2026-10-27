import type { SlotName } from "./contracts.js";

/** Shapes returned by src/browser/measure.js. Plain JSON: it crosses the browser boundary. */

export interface Rect {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface SlotStyles {
  display: string;
  visibility: string;
  opacity: number;
  color: string;
  font_family: string;
  font_size_px: number;
  text_transform: string;
  first_line_text_transform: string;
  first_letter_text_transform: string;
  font_variant_caps: string;
  direction: string;
  unicode_bidi: string;
  /** -webkit-text-security: "disc" etc. would paint the text as bullets. */
  text_security: string;
  text_overflow: string;
  line_clamp: string;
  overflow_x: string;
  overflow_y: string;
  before_content: string;
  after_content: string;
}

export interface SlotMeasurement {
  /** Number of elements carrying data-slot="<name>". Exactly one is expected. */
  count: number;
  tag: string | null;
  /** textContent for text slots; the alt text for the brand image. */
  text: string | null;
  child_elements: number;
  rect: Rect | null;
  region_rect: Rect | null;
  /** Full content extent, which exceeds client_* when text overflows the slot's own box. */
  scroll_width: number;
  client_width: number;
  scroll_height: number;
  client_height: number;
  line_height_px: number | null;
  visible: boolean;
  /** First ancestor background that is not transparent, used for the ink check. */
  background_color: string | null;
  styles: SlotStyles | null;
  /** The slot itself or ancestors that cut off part of its content (overflow, clip-path, mask). */
  clipped_by: string[];
  image: { complete: boolean; natural_width: number; natural_height: number; src: string } | null;
}

export interface FontMeasurement {
  family: string;
  weight: number;
  style: string;
  loaded: boolean;
}

export interface SkeletonComparison {
  matches: boolean;
  expected_length: number;
  actual_length: number;
  first_difference: { index: number; expected: string | null; actual: string | null } | null;
}

export interface Measurement {
  url_path: string;
  viewport: { width: number; height: number };
  canvas: { count: number; rect: Rect | null; background_color: string | null };
  fonts: FontMeasurement[];
  slots: Record<SlotName, SlotMeasurement>;
  document: {
    script_elements: number;
    event_handler_attributes: number;
    skeleton: SkeletonComparison;
  };
}

export interface MeasureSpec {
  slots: readonly SlotName[];
  fonts: ReadonlyArray<{ family: string; weight: number; style: string }>;
  /** Element-and-attribute skeleton of the unbound template, which the rendered page must match. */
  expected_skeleton: readonly string[];
}
