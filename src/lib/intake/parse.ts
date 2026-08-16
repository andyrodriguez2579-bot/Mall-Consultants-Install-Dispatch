/**
 * Install request extraction.
 *
 * Takes the raw text of a request -- a forwarded email, a customer work order,
 * notes typed from a phone call -- and pulls out what it can recognise so an
 * administrator corrects a pre-filled draft instead of re-keying everything.
 *
 * Two rules shape this module:
 *
 *   1. It never guesses silently. Every extracted field carries the snippet it
 *      came from, so the review screen can show its working and the operator
 *      can see at a glance what was inferred rather than read.
 *   2. It is a pure function with no imports that survive compilation, so it is
 *      cheap to test directly against real request text.
 *
 * Deliberately not an LLM call: this runs on every paste, needs no API key, and
 * fails in predictable ways. Messy free prose will defeat it, which is exactly
 * why the output is a draft for review rather than a finished job.
 */

export interface ExtractedField<T> {
  value: T;
  /** The text this was taken from, for the review screen to display. */
  evidence: string;
  /** 'label' -- read from an explicit "Customer: …" style field.
   *  'pattern' -- inferred from shape alone, e.g. a bare ZIP code. */
  basis: "label" | "pattern";
}

export interface SuggestedLineItem {
  code: string;
  quantity: number;
  evidence: string;
}

import type { EquipmentItem } from "./workbook";

export interface ParsedRequest {
  customer_name: ExtractedField<string> | null;
  site_name: ExtractedField<string> | null;
  address_line1: ExtractedField<string> | null;
  city: ExtractedField<string> | null;
  state_code: ExtractedField<string> | null;
  postal_code: ExtractedField<string> | null;
  site_contact_name: ExtractedField<string> | null;
  site_contact_phone: ExtractedField<string> | null;
  customer_reference: ExtractedField<string> | null;
  scheduled_start: ExtractedField<string> | null;
  deadline_at: ExtractedField<string> | null;
  title: ExtractedField<string> | null;
  scope: string;
  suggestedItems: SuggestedLineItem[];
  /**
   * Parts read from the install sheet's grid, when the request came in as a
   * spreadsheet. Added by the intake action rather than by the text parser,
   * because the parts table only survives being read column by column.
   */
  equipment?: EquipmentItem[];
  /** Fields the parser could not fill, for the review screen to highlight. */
  missing: string[];
}

/** Minimal shape needed from the price list to match work items. */
export interface MatchableItem {
  code: string;
  name: string;
}

// ---------------------------------------------------------------------------
// Label handling
// ---------------------------------------------------------------------------

const LABEL_ALIASES: Record<string, string[]> = {
  customer: [
    "customer", "client", "account", "customer name", "bill to", "company",
    "account name",
  ],
  site: ["site", "site name", "property", "mall", "location name", "store", "venue"],
  address: [
    "address", "site address", "service address", "street", "location", "job site",
    "street address",
  ],
  // The city line is labelled separately on survey forms, so it needs its own
  // key -- without it the extractor falls through to scanning the whole
  // document and can settle on a shipping address instead of the job site.
  region: ["city st zip", "city, state, zip", "city state zip", "city/state/zip", "city"],
  contact: [
    "contact", "site contact", "onsite contact", "poc", "point of contact", "attn",
    "customer first & last name", "customer first and last name", "customer contact",
  ],
  phone: [
    "phone", "contact phone", "mobile", "cell", "tel", "telephone", "contact number",
    "customer phone",
  ],
  reference: [
    "po", "po#", "po number", "wo", "wo#", "work order", "work order #",
    "reference", "ref", "ref#", "order", "order #", "ticket",
  ],
  date: [
    "date", "scheduled", "schedule", "start", "start date", "install date",
    "service date", "requested date", "when",
  ],
  deadline: ["deadline", "due", "due date", "complete by", "must be complete by", "by"],
  scope: ["scope", "work", "work required", "description", "details", "request", "notes"],
  // "Work Order:" appears under both reference and title: it introduces an
  // identifier on some forms and a description on others. Which one it is gets
  // decided from the value, not the label.
  title: ["title", "subject", "job", "job title", "re", "work order", "wo"],
};

// "&" and "," are allowed in a label because survey forms use them:
// "CUSTOMER FIRST & LAST NAME:", "CITY, STATE, ZIP:".
const LABEL_LINE = /^\s*[*\-•]?\s*([A-Za-z][A-Za-z0-9 /#.'()&,]{0,34}?)\s*[:\-–]\s*(.+?)\s*$/;

function normalizeLabel(raw: string): string {
  return raw.toLowerCase().replace(/[.#]/g, "").replace(/\s+/g, " ").trim();
}

interface LabelHit {
  value: string;
  line: string;
}

/**
 * Collect "Label: value" pairs.
 *
 * Every occurrence is kept rather than only the first, because a label alone
 * does not settle what a value is. "Work Order:" can introduce either a
 * reference number or a description, so the caller picks between candidates by
 * inspecting the values themselves.
 */
function readLabels(lines: string[]): Map<string, LabelHit[]> {
  const found = new Map<string, LabelHit[]>();

  for (const line of lines) {
    const match = LABEL_LINE.exec(line);
    if (!match) continue;

    const label = normalizeLabel(match[1]!);
    const value = match[2]!.trim();
    if (!value) continue;

    for (const [key, aliases] of Object.entries(LABEL_ALIASES)) {
      if (!aliases.includes(label)) continue;
      const list = found.get(key) ?? [];
      list.push({ value, line: line.trim() });
      found.set(key, list);
    }
  }

  return found;
}

const first = (hits: LabelHit[] | undefined): LabelHit | undefined => hits?.[0];

/** Looks like an identifier -- no spaces, and carrying at least one digit. */
function looksLikeIdentifier(value: string): boolean {
  return /^[A-Za-z0-9][A-Za-z0-9\-_/#.]{0,30}$/.test(value) && /\d/.test(value);
}

// ---------------------------------------------------------------------------
// Patterns
// ---------------------------------------------------------------------------

const ZIP = /\b(\d{5})(?:-\d{4})?\b/;
const PHONE = /(?:\+?1[\s.-]?)?\(?(\d{3})\)?[\s.-]?(\d{3})[\s.-]?(\d{4})\b/;
// "Houston, TX 77024" / "Houston TX 77024"
const CITY_STATE_ZIP = /([A-Za-z][A-Za-z .'-]{1,40}?)[,\s]+([A-Z]{2})\s+(\d{5})(?:-\d{4})?\b/;
const STREET = /^\d+[A-Za-z]?\s+[A-Za-z0-9 .'#/-]{3,}$/;

const MONTHS = [
  "january", "february", "march", "april", "may", "june",
  "july", "august", "september", "october", "november", "december",
];

const NUMBER_WORDS: Record<string, number> = {
  one: 1, two: 2, three: 3, four: 4, five: 5, six: 6,
  seven: 7, eight: 8, nine: 9, ten: 10, eleven: 11, twelve: 12,
};

/**
 * Parse a date out of a fragment.
 *
 * Two-digit years and ambiguous day/month ordering are read as US convention
 * (M/D/Y), matching where the business operates. Anything unparseable returns
 * null rather than a wrong date -- a wrong install date is worse than a blank
 * one an operator has to fill in.
 */
function parseDate(text: string): { iso: string; evidence: string } | null {
  const trimmed = text.trim();

  // ISO first: unambiguous.
  const iso = /\b(\d{4})-(\d{2})-(\d{2})\b/.exec(trimmed);
  if (iso) {
    const d = buildDate(Number(iso[1]), Number(iso[2]), Number(iso[3]), trimmed);
    if (d) return { iso: d, evidence: iso[0] };
  }

  // M/D/YYYY or M-D-YY
  const slash = /\b(\d{1,2})[/-](\d{1,2})[/-](\d{2,4})\b/.exec(trimmed);
  if (slash) {
    let year = Number(slash[3]);
    if (year < 100) year += 2000;
    const d = buildDate(year, Number(slash[1]), Number(slash[2]), trimmed);
    if (d) return { iso: d, evidence: slash[0] };
  }

  // "April 22, 2026" / "Apr 22" / "22 April 2026"
  const monthPattern = new RegExp(
    `\\b(${MONTHS.map((m) => `${m.slice(0, 3)}[a-z]*`).join("|")})\\.?\\s+(\\d{1,2})(?:st|nd|rd|th)?(?:,?\\s*(\\d{4}))?\\b`,
    "i",
  );
  const named = monthPattern.exec(trimmed);
  if (named) {
    const monthIndex = MONTHS.findIndex((m) => m.startsWith(named[1]!.toLowerCase().slice(0, 3)));
    if (monthIndex >= 0) {
      const year = named[3] ? Number(named[3]) : new Date().getFullYear();
      const d = buildDate(year, monthIndex + 1, Number(named[2]), trimmed);
      if (d) return { iso: d, evidence: named[0] };
    }
  }

  return null;
}

/** Combine a date with any time found in the same fragment. */
function buildDate(year: number, month: number, day: number, context: string): string | null {
  if (month < 1 || month > 12 || day < 1 || day > 31) return null;

  let hours = 8; // A field job with no stated time starts in the morning.
  let minutes = 0;

  const time = /\b(\d{1,2})(?::(\d{2}))?\s*(am|pm)\b/i.exec(context);
  if (time) {
    hours = Number(time[1]) % 12;
    if (/pm/i.test(time[3]!)) hours += 12;
    minutes = time[2] ? Number(time[2]) : 0;
  } else {
    const military = /\b([01]?\d|2[0-3]):([0-5]\d)\b/.exec(context);
    if (military) {
      hours = Number(military[1]);
      minutes = Number(military[2]);
    }
  }

  const date = new Date(year, month - 1, day, hours, minutes, 0, 0);
  // Reject rollovers like 31 February, which Date silently accepts.
  if (date.getMonth() !== month - 1 || date.getDate() !== day) return null;

  return date.toISOString();
}

function formatPhone(match: RegExpExecArray): string {
  return `+1${match[1]}${match[2]}${match[3]}`;
}

// ---------------------------------------------------------------------------
// Work item matching
// ---------------------------------------------------------------------------

/**
 * How each catalogue item is recognised in a request.
 *
 * Patterns rather than literal phrases, because requests are written by people:
 * "replace 2 SSDC units", "SSDC replacement x2" and "swap out the SSDC" all
 * mean the same work and none is a substring of the others. Allowing a short
 * gap between the verb and its object is what lets a quantity sit in between.
 *
 * `priority` resolves competition for the same words. A specific noun phrase
 * ("controller board") outranks a generic verb-plus-object ("replace … unit"),
 * so a board swap is never also billed as a whole-unit replacement.
 */
interface ItemPattern {
  code: string;
  re: RegExp;
  priority: number;
}

const ITEM_PATTERNS: ItemPattern[] = [
  // -- Specific noun phrases -------------------------------------------------
  { code: "SSDC-BOARD", re: /\b(?:controller|control|logic)\s+boards?\b/g, priority: 100 },
  { code: "FA-INTERFACE", re: /\bfire\s+(?:alarm|panel)\b|\bfa\s+interface\b/g, priority: 100 },
  { code: "LIFT-DAY", re: /\b(?:scissor|boom|man|aerial)\s+lifts?\b/g, priority: 100 },
  { code: "TRIP-STD", re: /\btrip\s+charge\b|\bmobili[sz]ation\b|\bsite\s+visits?\b/g, priority: 100 },
  {
    code: "TRIP-EMERG",
    re: /\bemergency\b|\bafter[\s-]hours?\b|\bsame[\s-]day\b|\burgent\b|\bcall[\s-]outs?\b/g,
    priority: 100,
  },
  { code: "LV-RUN", re: /\b(?:cable|wire|low[\s-]voltage)\s+(?:runs?|pulls?)\b/g, priority: 95 },

  // -- Verb plus SSDC --------------------------------------------------------
  {
    code: "SSDC-SWAP",
    re: /\b(?:replace|replacing|replacement|swap(?:ping)?|change[\s-]?out)\b[^.\n]{0,24}?\bssdc\b/g,
    priority: 80,
  },
  {
    code: "SSDC-SWAP",
    re: /\bssdc\b[^.\n]{0,24}?\b(?:replacements?|swaps?)\b/g,
    priority: 80,
  },
  {
    code: "SSDC-INSTALL",
    re: /\b(?:install(?:ing|ation)?|add|new|fit)\b[^.\n]{0,24}?\bssdc\b/g,
    priority: 80,
  },
  { code: "SSDC-INSTALL", re: /\bssdc\b[^.\n]{0,16}?\binstalls?\b/g, priority: 80 },

  // -- Verb plus generic object ---------------------------------------------
  {
    code: "SSDC-SWAP",
    re: /\b(?:replace|replacing|swap(?:ping)?|change[\s-]?out)\b[^.\n]{0,20}?\bunits?\b/g,
    priority: 60,
  },
  {
    code: "SSDC-INSTALL",
    re: /\b(?:install(?:ing|ation)?)\b[^.\n]{0,20}?\bunits?\b/g,
    priority: 60,
  },
  { code: "LV-RUN", re: /\b(?:pull|run)\b[^.\n]{0,20}?\bcables?\b/g, priority: 60 },

  // -- Bare terms ------------------------------------------------------------
  { code: "SSDC-COMMISH", re: /\b(?:re[\s-]?)?commission(?:ing|ed)?\b/g, priority: 40 },
  { code: "SSDC-COMMISH", re: /\bpoint[\s-]to[\s-]point\b/g, priority: 40 },
  { code: "LV-TERM", re: /\btermination[s]?\b|\bterminate[d]?\b/g, priority: 40 },
  { code: "LABOR-HR", re: /\b(?:additional|extra)\s+(?:labou?r|hours)\b|\bman[\s-]?hours\b/g, priority: 40 },
];

/** Read a quantity out of a fragment: digits, "(3)", "x3", or a number word. */
function readQuantityFrom(fragment: string, preferLast: boolean): number | null {
  const tokens: number[] = [];

  const pattern = /\((\d{1,3})\)|(?:x|×)\s*(\d{1,3})\b|\b(\d{1,3})\b|\b([a-z]+)\b/gi;
  let m: RegExpExecArray | null;

  while ((m = pattern.exec(fragment)) !== null) {
    if (m[1]) tokens.push(Number(m[1]));
    else if (m[2]) tokens.push(Number(m[2]));
    else if (m[3]) {
      const n = Number(m[3]);
      // Reject anything that is obviously not a count of work items -- a street
      // number, a year, a unit label like "unit 3" is handled by position.
      if (n > 0 && n <= 200) tokens.push(n);
    } else if (m[4]) {
      const n = NUMBER_WORDS[m[4].toLowerCase()];
      if (n) tokens.push(n);
    }
  }

  if (tokens.length === 0) return null;
  return preferLast ? tokens[tokens.length - 1]! : tokens[0]!;
}

/**
 * Establish how many of an item a request is asking for.
 *
 * Searched in order of how reliably each position indicates a count:
 * inside the matched phrase ("replace 2 SSDC units"), then just after it
 * ("commission four units"), then just before it ("six units need
 * commissioning"). Looking inside first is what keeps a street number on a
 * neighbouring line from being read as a quantity.
 */
function findQuantity(haystack: string, start: number, end: number): number {
  const inside = readQuantityFrom(haystack.slice(start, end), false);
  if (inside !== null) return inside;

  const after = readQuantityFrom(haystack.slice(end, end + 18), false);
  if (after !== null) return after;

  const before = readQuantityFrom(haystack.slice(Math.max(0, start - 24), start), true);
  if (before !== null) return before;

  return 1;
}

/**
 * Match catalogue items against the request text.
 *
 * Once a span of text is claimed by one item it is not offered to another, so
 * a single phrase cannot generate two overlapping charges.
 */
export function matchLineItems(text: string, items: MatchableItem[]): SuggestedLineItem[] {
  const available = new Set(items.map((i) => i.code));
  const haystack = text.toLowerCase();
  const claimed: Array<[number, number]> = [];
  const results: SuggestedLineItem[] = [];

  const patterns = ITEM_PATTERNS.filter((p) => available.has(p.code)).sort(
    (a, b) => b.priority - a.priority,
  );

  for (const { code, re } of patterns) {
    // The patterns are module-level and carry /g, so reset before each use.
    re.lastIndex = 0;

    let match: RegExpExecArray | null;
    while ((match = re.exec(haystack)) !== null) {
      const start = match.index;
      const end = start + match[0].length;

      // Zero-length matches would loop forever.
      if (match[0].length === 0) {
        re.lastIndex += 1;
        continue;
      }

      if (claimed.some(([s, e]) => start < e && end > s)) continue;
      claimed.push([start, end]);

      const quantity = findQuantity(haystack, start, end);
      const lineStart = haystack.lastIndexOf("\n", start) + 1;
      const lineEndRaw = haystack.indexOf("\n", start);
      const lineEnd = lineEndRaw === -1 ? text.length : lineEndRaw;

      const existing = results.find((r) => r.code === code);
      if (existing) {
        existing.quantity += quantity;
      } else {
        results.push({
          code,
          quantity,
          evidence: text.slice(lineStart, lineEnd).trim().slice(0, 160),
        });
      }
    }
  }

  return results;
}

// ---------------------------------------------------------------------------
// Entry point
// ---------------------------------------------------------------------------

const field = <T>(
  value: T | null | undefined,
  evidence: string,
  basis: "label" | "pattern",
): ExtractedField<T> | null =>
  value === null || value === undefined || value === "" ? null : { value, evidence, basis };

export function parseInstallRequest(
  rawText: string,
  priceList: MatchableItem[] = [],
): ParsedRequest {
  const text = rawText.replace(/\r\n?/g, "\n");
  const lines = text.split("\n");
  const labels = readLabels(lines);

  // --- Address -----------------------------------------------------------
  let street: ExtractedField<string> | null = null;
  let city: ExtractedField<string> | null = null;
  let state: ExtractedField<string> | null = null;
  let postal: ExtractedField<string> | null = null;

  const addressLabel = first(labels.get("address"));
  const addressSource = addressLabel?.value ?? "";

  // A labelled address may be all on one line, or the label may hold only the
  // street with the city line following it.
  const searchSpaces: Array<{ text: string; basis: "label" | "pattern" }> = [];
  if (addressSource) searchSpaces.push({ text: addressSource, basis: "label" });
  const regionLabel = first(labels.get("region"));
  if (regionLabel) searchSpaces.push({ text: regionLabel.value, basis: "label" });
  searchSpaces.push({ text, basis: "pattern" });

  for (const space of searchSpaces) {
    const csz = CITY_STATE_ZIP.exec(space.text);
    if (csz) {
      city = field(csz[1]!.replace(/[,\s]+$/, "").trim(), csz[0], space.basis);
      state = field(csz[2]!.toUpperCase(), csz[0], space.basis);
      postal = field(csz[3]!, csz[0], space.basis);
      break;
    }
  }

  if (!postal) {
    const zip = ZIP.exec(text);
    if (zip) postal = field(zip[1]!, zip[0], "pattern");
  }

  if (addressSource) {
    // Strip any trailing "City, ST ZIP" so only the street remains.
    const streetOnly = addressSource.replace(CITY_STATE_ZIP, "").replace(/[,\s]+$/, "").trim();
    if (streetOnly) street = field(streetOnly, addressLabel!.line, "label");
  }
  if (!street) {
    for (const line of lines) {
      const candidate = line.trim().replace(/^[*\-•]\s*/, "");
      if (STREET.test(candidate) && !ZIP.test(candidate)) {
        street = field(candidate, line.trim(), "pattern");
        break;
      }
    }
  }

  // --- Contact -----------------------------------------------------------
  let contactPhone: ExtractedField<string> | null = null;
  const phoneLabel = first(labels.get("phone")) ?? first(labels.get("contact"));
  if (phoneLabel) {
    const m = PHONE.exec(phoneLabel.value);
    if (m) contactPhone = field(formatPhone(m), phoneLabel.line, "label");
  }
  if (!contactPhone) {
    const m = PHONE.exec(text);
    if (m) contactPhone = field(formatPhone(m), m[0], "pattern");
  }

  let contactName: ExtractedField<string> | null = null;
  const contactLabel = first(labels.get("contact"));
  if (contactLabel) {
    // "Danielle Ruiz 713-555-0199" -> drop the number, keep the name.
    const withoutPhone = contactLabel.value.replace(PHONE, "").replace(/[,|·-]+\s*$/, "").trim();
    if (withoutPhone) contactName = field(withoutPhone, contactLabel.line, "label");
  }

  // --- Dates -------------------------------------------------------------
  let scheduled: ExtractedField<string> | null = null;
  const dateLabel = first(labels.get("date"));
  if (dateLabel) {
    const parsed = parseDate(dateLabel.value);
    if (parsed) scheduled = field(parsed.iso, dateLabel.line, "label");
  }

  let deadline: ExtractedField<string> | null = null;
  const deadlineLabel = first(labels.get("deadline"));
  if (deadlineLabel) {
    const parsed = parseDate(deadlineLabel.value);
    if (parsed) deadline = field(parsed.iso, deadlineLabel.line, "label");
  }

  // Only fall back to a loose date scan when nothing was labelled, and skip
  // any line that already contributed the address -- a ZIP is not a date.
  if (!scheduled && !deadline) {
    for (const line of lines) {
      if (ZIP.test(line) && CITY_STATE_ZIP.test(line)) continue;
      const parsed = parseDate(line);
      if (parsed) {
        scheduled = field(parsed.iso, line.trim(), "pattern");
        break;
      }
    }
  }

  // --- Text fields -------------------------------------------------------
  const customer = first(labels.get("customer"));
  const site = first(labels.get("site"));
  const scopeLabel = first(labels.get("scope"));

  // A reference is an identifier, so pick the first candidate that reads like
  // one. This is what stops "Work Order: SSDC retrofit - north vestibule" from
  // being filed as a PO number.
  const reference = (labels.get("reference") ?? []).find((hit) =>
    looksLikeIdentifier(hit.value),
  );

  // Conversely, a title is prose -- so skip any candidate that is an
  // identifier, since that belongs in the reference field.
  const titleLabel = (labels.get("title") ?? []).find(
    (hit) => !looksLikeIdentifier(hit.value),
  );

  // Prefer an explicit scope; otherwise use the whole request, which is always
  // better than nothing and is edited before dispatch anyway.
  const scope = scopeLabel?.value ?? text.trim();

  // A title is a nicety: use the subject if given, else the first substantial
  // line that is not a label.
  let title: ExtractedField<string> | null = titleLabel
    ? field(titleLabel.value, titleLabel.line, "label")
    : null;
  if (!title) {
    const firstProse = lines
      .map((l) => l.trim())
      .find(
        (l) =>
          l.length > 12 &&
          l.length < 120 &&
          !LABEL_LINE.test(l) &&
          // A spreadsheet is flattened with "--- SheetName ---" dividers. They
          // are structure, not prose, and make a poor job title.
          !/^-{2,}.*-{2,}$/.test(l),
      );
    if (firstProse) title = field(firstProse, firstProse, "pattern");
  }

  const suggestedItems = matchLineItems(text, priceList);

  const result: ParsedRequest = {
    customer_name: customer ? field(customer.value, customer.line, "label") : null,
    site_name: site ? field(site.value, site.line, "label") : null,
    address_line1: street,
    city,
    state_code: state,
    postal_code: postal,
    site_contact_name: contactName,
    site_contact_phone: contactPhone,
    customer_reference: reference ? field(reference.value, reference.line, "label") : null,
    scheduled_start: scheduled,
    deadline_at: deadline,
    title,
    scope,
    suggestedItems,
    missing: [],
  };

  // Everything the job form requires but the parser could not supply.
  const required: Array<[keyof ParsedRequest, string]> = [
    ["customer_name", "Customer"],
    ["address_line1", "Street address"],
    ["city", "City"],
    ["state_code", "State"],
    ["postal_code", "ZIP"],
  ];
  result.missing = required.filter(([key]) => result[key] === null).map(([, label]) => label);

  return result;
}
