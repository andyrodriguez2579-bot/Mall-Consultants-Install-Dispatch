/**
 * The contact block at the top of an INSTALL sheet.
 *
 * Everyone who needs to hear about the job is named here: the customer, the PFS
 * sales rep, the SSDC rep who signed the work order, and the PFG specialist.
 * The site-readiness email goes to those addresses, so reading them off the
 * sheet is what removes the last piece of retyping from the intake.
 *
 * Labels are matched loosely on purpose. This form is edited by hand across
 * dozens of operating companies, and the difference between "PFS SALES REP
 * EMAIL:" and "PFS Sales Rep Email" is not a difference anyone intends.
 */

export interface InstallContacts {
  accountName: string | null;
  accountNumber: string | null;
  streetAddress: string | null;
  city: string | null;
  stateCode: string | null;
  postalCode: string | null;

  customerName: string | null;
  customerPhone: string | null;
  customerEmail: string | null;

  salesRepName: string | null;
  salesRepPhone: string | null;
  salesRepEmail: string | null;

  /** The RSM. The sheet carries the name but never an address. */
  ssdcRepName: string | null;

  specialistName: string | null;
  specialistEmail: string | null;

  operatingCompany: string | null;
  /** Present only when a machine was ordered, which is the dish-machine tell. */
  machineModels: string[];
}

const EMAIL = /[^\s@]+@[^\s@]+\.[^\s@]{2,}/;

const cell = (value: unknown): string =>
  value === null || value === undefined ? "" : String(value).trim();

/** Compare labels ignoring case, punctuation and the notes in parentheses. */
const normalize = (label: string): string =>
  label
    .toLowerCase()
    .replace(/\([^)]*\)/g, " ")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();

/**
 * "Brooklyn NY, 11217" and "Ringwood, NJ 07456" are both in use, and one form
 * puts the comma where the other does not. Read the ZIP and the state from the
 * end, where they are unambiguous, and treat whatever is left as the city.
 */
export function splitCityStateZip(value: string | null): {
  city: string | null;
  stateCode: string | null;
  postalCode: string | null;
} {
  if (!value) return { city: null, stateCode: null, postalCode: null };

  const zip = value.match(/(\d{5}(?:-\d{4})?)\s*$/);
  const withoutZip = zip ? value.slice(0, zip.index).trim() : value.trim();
  const trimmed = withoutZip.replace(/[,\s]+$/, "");

  const state = trimmed.match(/[,\s]([A-Za-z]{2})$/);
  const city =
    state && state.index !== undefined
      ? trimmed.slice(0, state.index).replace(/[,\s]+$/, "")
      : trimmed;

  return {
    city: city || null,
    stateCode: state?.[1] ? state[1].toUpperCase() : null,
    postalCode: zip?.[1] ?? null,
  };
}

/**
 * Read the header block.
 *
 * Only the first column is treated as a label. The INSTALL sheet has a second
 * block of SSDC-only fields further right on the same rows, and reading labels
 * from anywhere would let "BREAKER:" or "VOLTAGE:" answer for the customer.
 */
export function readInstallContacts(rows: unknown[][]): InstallContacts {
  const values = new Map<string, string>();
  const machineModels: string[] = [];

  for (const row of rows.slice(0, 40)) {
    const label = normalize(cell(row[0]));
    if (!label) continue;

    const value = cell(row[1]);

    if (/^machine model ordered/.test(label)) {
      if (value) machineModels.push(value);
      continue;
    }

    // First one wins: the block is at the top, and the same words recur further
    // down the sheet in the product tables.
    if (value && !values.has(label)) values.set(label, value);
  }

  const get = (...labels: string[]): string | null => {
    for (const label of labels) {
      const hit = values.get(label);
      if (hit) return hit;
    }
    return null;
  };

  /** An address field that must actually be one; the sheet leaves blanks. */
  const email = (...labels: string[]): string | null => {
    const raw = get(...labels);
    const found = raw?.match(EMAIL);
    return found ? found[0] : null;
  };

  const place = splitCityStateZip(get("city state zip"));

  return {
    accountName: get("account name"),
    accountNumber: get("pfs acct number", "pfs account number", "b9 account number"),
    streetAddress: get("street address"),
    ...place,

    customerName: get("customer first last name", "customer name"),
    customerPhone: get("customer phone"),
    customerEmail: email("customer email"),

    salesRepName: get("pfs sales rep"),
    salesRepPhone: get("pfs sales rep phone"),
    salesRepEmail: email("pfs sales rep email"),

    ssdcRepName: get("ssdc rep serves as signed pwo", "ssdc rep"),

    // "Irwin Yaffe - 609-744-6016" carries a phone; the name is what is wanted.
    specialistName: get("pfg specialist")?.split(/\s+-\s+/)[0]?.trim() || null,
    specialistEmail: email("pfg specialist email tel", "pfg specialist email"),

    operatingCompany: get("pfs opco"),
    machineModels,
  };
}

/**
 * Everyone the site-readiness email should reach, deduplicated.
 *
 * The SSDC rep is named on the sheet but never given an address, so their email
 * is looked up from the roster rather than found here -- which is why the
 * caller passes it in.
 */
export function readinessRecipients(
  contacts: InstallContacts,
  rsmEmail: string | null,
): string[] {
  const all = [contacts.customerEmail, contacts.salesRepEmail, rsmEmail];

  const seen = new Set<string>();
  const out: string[] = [];
  for (const address of all) {
    if (!address) continue;
    const key = address.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(address);
  }
  return out;
}
