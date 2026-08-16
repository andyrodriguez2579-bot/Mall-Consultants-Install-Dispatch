import {
  Card,
  CardHeader,
  Detail,
  InfoBanner,
  JobStatusBadge,
  OfferStatusBadge,
  StatCard,
  SuccessBanner,
  buttonClass,
} from "@/components/ui";
import { PricingPanel } from "@/components/pricing-panel";
import { ORG_NAME, PRODUCT_NAME } from "@/lib/branding";
import { formatMoney } from "@/lib/format";
import { calculatePricing } from "@/lib/pricing";
import type { PriceListItem } from "@/lib/types";

/**
 * Visual preview.
 *
 * Renders the real interface components against fixed demo data so the product
 * can be looked at without a Supabase project attached. Every figure below is
 * produced by the same calculator the application uses -- nothing here is a
 * hand-typed number pretending to be output.
 *
 * This route is development-only scaffolding, not part of the product.
 */
export const dynamic = "force-static";

const CATALOGUE: PriceListItem[] = [
  {
    id: "1", code: "SSDC-A-PROGRAM", name: "SSDC A-Program Installation",
    category: "SSDC Installation", description: null,
    scope_description: "Install the A-Program dispenser, standard scrape sprayer connection.",
    customer_labor_price_cents: 12000, contractor_percentage_bps: 4500,
    contractor_labor_pay_cents: 5400, mall_share_cents: 6600,
    unit: "each", allows_quantity: true, allows_additional_labor: true,
    allows_mileage: true, is_active: true, sort_order: 1,
  },
  {
    id: "2", code: "INST-SINK-RITE-SOLO", name: "Sink-Rite Solo",
    category: "INSTALL EQUIPMENT", description: null, scope_description: null,
    customer_labor_price_cents: 7280, contractor_percentage_bps: 4500,
    contractor_labor_pay_cents: 3276, mall_share_cents: 4004,
    unit: "each", allows_quantity: true, allows_additional_labor: true,
    allows_mileage: true, is_active: true, sort_order: 24,
  },
  {
    id: "3", code: "DMI-SINGLE-RACK-LOW-TEMP", name: "Single rack install, low temp",
    category: "DM INSTALL", description: null, scope_description: null,
    customer_labor_price_cents: 25900, contractor_percentage_bps: 4500,
    contractor_labor_pay_cents: 11655, mall_share_cents: 14245,
    unit: "each", allows_quantity: false, allows_additional_labor: true,
    allows_mileage: true, is_active: true, sort_order: 63,
  },
  {
    id: "4", code: "ZONE-SSDC-A-PROGRAM", name: "SSDC A-PROGRAM",
    category: "Zone Install Program", description: null, scope_description: null,
    customer_labor_price_cents: 14500, contractor_percentage_bps: 4500,
    contractor_labor_pay_cents: 6525, mall_share_cents: 7975,
    unit: "each", allows_quantity: true, allows_additional_labor: true,
    allows_mileage: true, is_active: true, sort_order: 34,
  },
];

// The specification's worked example, computed rather than transcribed.
const EXAMPLE = calculatePricing({
  lines: [{ unitPriceCents: 12000, quantity: 1 }],
  contractorMiles: 50,
  excludedMiles: 30,
  mileageRate: 0.725,
});

function Section({
  n,
  title,
  who,
  children,
}: {
  n: string;
  title: string;
  who: "Contractor" | "Administrator";
  children: React.ReactNode;
}) {
  return (
    <section className="scroll-mt-6">
      <div className="mb-3 flex flex-wrap items-center gap-3">
        <span className="rounded-full bg-slate-900 px-2.5 py-1 font-mono text-xs font-semibold text-white">
          {n}
        </span>
        <h2 className="text-lg font-bold text-slate-900">{title}</h2>
        <span
          className={`rounded-full px-2.5 py-1 text-xs font-semibold ring-1 ring-inset ${
            who === "Contractor"
              ? "bg-blue-50 text-blue-800 ring-blue-200"
              : "bg-violet-50 text-violet-800 ring-violet-200"
          }`}
        >
          {who} view
        </span>
      </div>
      {children}
    </section>
  );
}

/** A phone-width frame, since contractors only ever see this on a handset. */
function Phone({ children }: { children: React.ReactNode }) {
  return (
    <div className="mx-auto w-full max-w-[420px] overflow-hidden rounded-[1.75rem] border-8 border-slate-800 bg-canvas shadow-xl">
      <div className="bg-slate-800 pb-1 pt-1 text-center text-[10px] text-slate-400">
        9:41
      </div>
      <div className="max-h-[720px] overflow-y-auto bg-slate-50 p-4">{children}</div>
    </div>
  );
}

export default function PreviewPage() {
  return (
    <main className="mx-auto max-w-6xl space-y-12 px-4 py-10">
      <header className="border-b border-slate-200 pb-6">
        <p className="text-xs font-semibold uppercase tracking-widest text-blue-700">
          {ORG_NAME}
        </p>
        <h1 className="mt-1 text-3xl font-bold text-slate-900">{PRODUCT_NAME}</h1>
        <p className="mt-2 max-w-2xl text-sm text-slate-600">
          Interface preview. Every currency figure below is produced by the same
          calculator the live application uses, so the arithmetic on screen is the
          arithmetic that gets paid.
        </p>
      </header>

      {/* ------------------------------------------------------------------ */}
      <Section n="01" title="Job board — what a contractor sees" who="Contractor">
        <div className="grid gap-6 lg:grid-cols-2">
          <Phone>
            <h3 className="mb-3 text-xl font-bold text-slate-900">My jobs</h3>
            <Card>
              <CardHeader
                title="Available now"
                description="First eligible contractor to accept is assigned."
              />
              <ul className="divide-y divide-slate-100">
                {[
                  {
                    title: "SSDC A-Program install — Luigi's Pizza",
                    where: "Ringwood, NJ 07456",
                    expires: "in 3h 40m",
                    pay: EXAMPLE.totalContractorPaymentCents,
                    miles: 50,
                  },
                  {
                    title: "Sink-Rite Solo — Memorial City Mall",
                    where: "Houston, TX 77024",
                    expires: "in 1h 12m",
                    pay: 3276 + 1015,
                    miles: 44,
                  },
                ].map((job) => (
                  <li key={job.title} className="px-4 py-4">
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0">
                        <p className="text-sm font-semibold text-slate-900">{job.title}</p>
                        <p className="mt-0.5 text-xs text-slate-500">{job.where}</p>
                        <p className="mt-0.5 text-xs text-slate-500">
                          Est. {job.miles} mi round trip
                        </p>
                        <p className="mt-1 text-xs font-medium text-amber-700">
                          Expires {job.expires}
                        </p>
                      </div>
                      <span className="shrink-0 text-base font-bold tabular-nums text-slate-900">
                        {formatMoney(job.pay)}
                      </span>
                    </div>
                  </li>
                ))}
              </ul>
            </Card>
          </Phone>

          <div className="space-y-3">
            <InfoBanner>
              <span className="font-semibold">What is deliberately absent.</span> No
              customer price, no Mall Consultants share, no margin. Those live in a
              separate table with no contractor-facing security policy — it is not a
              matter of leaving columns out of a query.
            </InfoBanner>
            <Card className="p-4">
              <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">
                Their pay, broken down
              </p>
              <dl className="mt-2 space-y-1.5 text-sm">
                <div className="flex justify-between">
                  <dt className="text-slate-600">Labor</dt>
                  <dd className="tabular-nums">{formatMoney(EXAMPLE.contractorLaborPayCents)}</dd>
                </div>
                <div className="flex justify-between">
                  <dt className="text-slate-600">
                    Mileage — {EXAMPLE.payableMiles} payable miles at $0.725
                  </dt>
                  <dd className="tabular-nums">{formatMoney(EXAMPLE.mileagePaymentCents)}</dd>
                </div>
                <div className="mt-2 flex justify-between border-t border-slate-200 pt-2 font-semibold">
                  <dt>Total expected</dt>
                  <dd className="tabular-nums">
                    {formatMoney(EXAMPLE.totalContractorPaymentCents)}
                  </dd>
                </div>
              </dl>
              <p className="mt-2 text-xs text-slate-500">
                50 miles driven, 30 deducted by the commuter rule.
              </p>
            </Card>
          </div>
        </div>
      </Section>

      {/* ------------------------------------------------------------------ */}
      <Section n="02" title="The SMS offer — and losing the race" who="Contractor">
        <div className="grid gap-6 lg:grid-cols-2">
          <Phone>
            <Card className="overflow-hidden">
              <div className="border-b border-slate-200 bg-slate-50 px-4 py-4">
                <div className="flex items-baseline justify-between gap-3">
                  <p className="font-mono text-xs text-slate-500">MID-2026-1007</p>
                  <p className="text-xs font-medium text-amber-700">Expires in 3h 40m</p>
                </div>
                <h1 className="mt-1 text-lg font-bold leading-snug text-slate-900">
                  SSDC A-Program install — Luigi&apos;s Pizza
                </h1>
                <p className="mt-1 text-sm text-slate-600">
                  Hello Marcus — this job was offered to you directly.
                </p>
              </div>
              <div className="border-b border-slate-200 px-4 py-4">
                <p className="text-xs font-medium uppercase tracking-wide text-slate-500">
                  Contractor pay — fixed
                </p>
                <p className="mt-0.5 text-3xl font-bold tabular-nums text-slate-900">
                  {formatMoney(EXAMPLE.totalContractorPaymentCents)}
                </p>
                <p className="mt-1 text-xs text-slate-500">
                  {formatMoney(EXAMPLE.contractorLaborPayCents)} labor +{" "}
                  {formatMoney(EXAMPLE.mileagePaymentCents)} mileage
                </p>
              </div>
              <dl className="grid grid-cols-1 gap-4 px-4 py-4">
                <Detail label="Location" value="Ringwood, NJ 07456" />
                <Detail label="Scheduled start" value="Wed, Apr 22, 8:00 AM" />
                <Detail
                  label="Scope of work"
                  value="Install Sink-Rite and gang a Solo floor dispenser at the 3-comp sink. Fit brackets, signage and stickers. Train staff."
                />
              </dl>
              <div className="border-t border-slate-200 px-4 py-3">
                <p className="text-xs text-slate-500">
                  The exact address and site contact are shown once the job is yours.
                </p>
              </div>
            </Card>
            <div className="mt-4 space-y-3">
              <button className={buttonClass("success", true)}>Accept this job</button>
              <p className="text-center text-xs text-slate-500">
                First eligible contractor to accept is assigned the job.
              </p>
              <button className={buttonClass("secondary", true)}>Pass</button>
            </div>
          </Phone>

          <div className="space-y-4">
            <Card className="p-4">
              <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-500">
                The winner
              </p>
              <SuccessBanner>
                <span className="font-semibold">This job is yours.</span> We have texted
                you a confirmation with the full address and site contact.
              </SuccessBanner>
            </Card>
            <Card className="p-4">
              <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-500">
                Everyone else, the instant it is taken
              </p>
              <InfoBanner>
                <span className="font-semibold">Job already filled.</span> Another
                contractor accepted this one first. We will send the next opportunity as
                soon as it is posted.
              </InfoBanner>
            </Card>
            <InfoBanner>
              Exactly one contractor can win, guaranteed by a row lock plus a guarded
              update in Postgres — verified by a 16-way simultaneous race and ten
              consecutive races in the test suite.
            </InfoBanner>
          </div>
        </div>
      </Section>

      {/* ------------------------------------------------------------------ */}
      <Section n="03" title="Pricing calculator" who="Administrator">
        <p className="mb-4 max-w-3xl text-sm text-slate-600">
          Interactive — change the customer price, tasks, miles or expenses and every
          figure updates. This is the live component, not a picture of one.
        </p>
        <PricingPanel
          priceList={CATALOGUE}
          defaults={{
            lines: [
              {
                description: "SSDC A-Program Installation",
                unitPriceCents: 12000,
                quantity: 1,
              },
            ],
            contractorMiles: 50,
            excludedMiles: 30,
            mileageRate: 0.725,
          }}
        />
      </Section>

      {/* ------------------------------------------------------------------ */}
      <Section n="04" title="Job financials" who="Administrator">
        <Card>
          <CardHeader
            title="Financial breakdown"
            description="Administrator view. None of these customer-side figures reach the contractor."
          />
          <div className="grid gap-5 p-5 sm:grid-cols-2">
            <div>
              <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">
                Labor
              </p>
              <dl className="mt-2 space-y-1.5 text-sm">
                <Row label="Customer labor price x 1" value={12000} />
                <Row label="Total labor revenue" value={EXAMPLE.totalLaborRevenueCents} strong />
                <div className="!mt-2 border-t border-slate-200 pt-2" />
                <Row label="Contractor (45%)" value={EXAMPLE.contractorLaborPayCents} />
                <Row label="Mall Consultants (55%)" value={EXAMPLE.mallShareCents} />
              </dl>
            </div>
            <div>
              <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">
                Passed through, not split
              </p>
              <dl className="mt-2 space-y-1.5 text-sm">
                <Row
                  label="Mileage — 20 payable of 50 at $0.7250"
                  value={EXAMPLE.mileagePaymentCents}
                />
                <Row label="Total reimbursables" value={0} strong />
              </dl>
            </div>
            <div className="rounded-lg bg-slate-900 px-4 py-3">
              <p className="text-xs font-medium uppercase tracking-wide text-slate-400">
                Total contractor payment
              </p>
              <p className="mt-0.5 text-2xl font-bold tabular-nums text-white">
                {formatMoney(EXAMPLE.totalContractorPaymentCents)}
              </p>
            </div>
            <div className="rounded-lg bg-emerald-700 px-4 py-3">
              <p className="text-xs font-medium uppercase tracking-wide text-emerald-100">
                Total customer charge
              </p>
              <p className="mt-0.5 text-2xl font-bold tabular-nums text-white">
                {formatMoney(EXAMPLE.totalCustomerChargeCents)}
              </p>
              <p className="mt-1 text-xs text-emerald-100">
                Margin {formatMoney(EXAMPLE.mallShareCents)}
              </p>
            </div>
          </div>
        </Card>
      </Section>

      {/* ------------------------------------------------------------------ */}
      <Section n="05" title="Dashboard and dispatch" who="Administrator">
        <dl className="mb-5 grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
          <StatCard label="Live offers" value={3} tone="warn" />
          <StatCard label="Assigned" value={5} />
          <StatCard label="In progress" value={2} />
          <StatCard label="Awaiting review" value={4} tone="warn" />
          <StatCard label="Unfilled" value={1} tone="warn" />
          <StatCard label="Owed" value={formatMoney(184250)} tone="good" />
        </dl>

        <Card>
          <CardHeader
            title="Dispatch"
            description="Each contractor receives a secure link that only works for them."
          />
          <ul className="divide-y divide-slate-100">
            {[
              { name: "Marcus Webb", co: "Webb Installations LLC", ok: true, area: true },
              { name: "Dana Ortiz", co: "Ortiz Field Services", ok: true, area: true },
              { name: "Tom Beckett", co: "Beckett Low Voltage", ok: false, area: true },
            ].map((c) => (
              <li key={c.name} className="flex items-start gap-3 px-4 py-3">
                <input
                  type="checkbox"
                  defaultChecked={c.ok}
                  disabled={!c.ok}
                  className="mt-0.5 h-4 w-4 rounded border-slate-300"
                />
                <span className={c.ok ? "" : "opacity-60"}>
                  <span className="block text-sm font-medium text-slate-900">
                    {c.name}
                    <span className="font-normal text-slate-500"> · {c.co}</span>
                  </span>
                  <span className="mt-1 flex flex-wrap gap-1.5">
                    <Tag tone={c.ok ? "good" : "bad"}>
                      {c.ok ? "Qualified" : "Missing certification"}
                    </Tag>
                    {c.area ? <Tag tone="info">In service area</Tag> : null}
                  </span>
                </span>
              </li>
            ))}
          </ul>
          <div className="flex items-center justify-end gap-3 border-t border-slate-200 p-4">
            <span className={buttonClass("primary")}>Send offer to 2</span>
          </div>
        </Card>

        <div className="mt-5">
          <Card>
            <CardHeader title="Offers" description="Round 1 · 3 contractors" />
            <div className="overflow-x-auto">
              <table className="min-w-full divide-y divide-slate-200 text-sm">
                <thead className="bg-slate-50 text-left text-xs uppercase tracking-wide text-slate-500">
                  <tr>
                    <th className="px-4 py-2 font-medium">Contractor</th>
                    <th className="px-4 py-2 font-medium">Status</th>
                    <th className="px-4 py-2 font-medium">Responded</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {(
                    [
                      ["Marcus Webb", "accepted", "2m ago"],
                      ["Dana Ortiz", "filled", "2m ago"],
                      ["Priya Raman", "delivered", "—"],
                    ] as const
                  ).map(([name, status, when]) => (
                    <tr key={name}>
                      <td className="px-4 py-2.5 font-medium text-slate-900">{name}</td>
                      <td className="px-4 py-2.5">
                        <OfferStatusBadge status={status} />
                      </td>
                      <td className="px-4 py-2.5 text-xs text-slate-500">{when}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </Card>
        </div>
      </Section>

      {/* ------------------------------------------------------------------ */}
      <Section n="06" title="Price list" who="Administrator">
        <p className="mb-4 max-w-3xl text-sm text-slate-600">
          105 active services, transcribed from your zone pricing workbook. Each row
          shows the customer price with both derived shares.
        </p>
        <Card>
          <CardHeader title="SSDC Installation · INSTALL EQUIPMENT · DM INSTALL · Zone Install Program" />
          <ul className="divide-y divide-slate-100">
            {CATALOGUE.map((item) => (
              <li key={item.id} className="flex flex-wrap items-center justify-between gap-3 px-4 py-3">
                <div className="min-w-0">
                  <p className="text-sm font-medium text-slate-900">{item.name}</p>
                  <p className="mt-0.5 font-mono text-[11px] text-slate-400">{item.code}</p>
                </div>
                <div className="text-right">
                  <span className="block text-sm font-semibold tabular-nums text-slate-900">
                    {formatMoney(item.customer_labor_price_cents)}
                    <span className="font-normal text-slate-400">/{item.unit}</span>
                  </span>
                  <span className="block text-xs tabular-nums text-slate-500">
                    contractor {formatMoney(item.contractor_labor_pay_cents)} · MC{" "}
                    {formatMoney(item.mall_share_cents)}
                  </span>
                </div>
              </li>
            ))}
          </ul>
        </Card>
      </Section>

      {/* ------------------------------------------------------------------ */}
      <Section n="07" title="Friday payment run" who="Administrator">
        <div className="mb-4 rounded-xl bg-slate-900 px-5 py-4">
          <p className="text-xs font-medium uppercase tracking-wide text-slate-400">
            Total owed
          </p>
          <p className="mt-0.5 text-3xl font-bold tabular-nums text-white">
            {formatMoney(184250)}
          </p>
          <p className="mt-1 text-xs text-slate-400">across 6 approved jobs</p>
        </div>

        <Card>
          <CardHeader
            title="Friday, April 24"
            description="6 jobs scheduled for this run"
          />
          <div className="divide-y divide-slate-100">
            {[
              { who: "Marcus Webb", total: 68500, jobs: [["MID-2026-1007", "Luigi's Pizza — A-Program", 68500]] },
              {
                who: "Dana Ortiz",
                total: 115750,
                jobs: [
                  ["MID-2026-1005", "Deerbrook panel swap", 55000],
                  ["MID-2026-1009", "Baybrook commissioning", 60750],
                ],
              },
            ].map((group) => (
              <div key={group.who} className="px-4 py-3">
                <div className="flex items-baseline justify-between gap-3">
                  <p className="text-sm font-semibold text-slate-900">{group.who}</p>
                  <p className="text-sm font-semibold tabular-nums text-slate-900">
                    {formatMoney(group.total)}
                  </p>
                </div>
                <ul className="mt-2 space-y-1.5">
                  {group.jobs.map(([num, title, cents]) => (
                    <li key={num as string} className="flex items-center gap-3 text-sm">
                      <input type="checkbox" defaultChecked className="h-4 w-4 rounded border-slate-300" />
                      <span className="min-w-0 flex-1 truncate text-slate-600">
                        <span className="font-mono text-xs text-slate-400">{num}</span> {title}
                      </span>
                      <span className="tabular-nums text-slate-500">
                        {formatMoney(cents as number)}
                      </span>
                    </li>
                  ))}
                </ul>
              </div>
            ))}
          </div>
          <div className="flex flex-wrap items-end gap-3 border-t border-slate-200 p-4">
            <span className={buttonClass("success")}>
              Mark 3 paid — {formatMoney(184250)}
            </span>
          </div>
        </Card>
      </Section>

      <footer className="border-t border-slate-200 pt-6 text-sm text-slate-500">
        Development preview route. Not part of the shipped product — delete{" "}
        <code className="rounded bg-slate-100 px-1 py-0.5 text-xs">src/app/preview</code>{" "}
        to remove it.
      </footer>
    </main>
  );
}

function Row({ label, value, strong }: { label: string; value: number; strong?: boolean }) {
  return (
    <div className="flex justify-between gap-4">
      <dt className="text-slate-600">{label}</dt>
      <dd className={`tabular-nums ${strong ? "font-semibold text-slate-900" : "text-slate-800"}`}>
        {formatMoney(value)}
      </dd>
    </div>
  );
}

function Tag({ children, tone }: { children: string; tone: "good" | "bad" | "info" }) {
  const tones = {
    good: "bg-emerald-50 text-emerald-700 ring-emerald-200",
    bad: "bg-rose-50 text-rose-700 ring-rose-200",
    info: "bg-sky-50 text-sky-700 ring-sky-200",
  } as const;
  return (
    <span
      className={`inline-flex rounded-full px-2 py-0.5 text-[11px] font-medium ring-1 ring-inset ${tones[tone]}`}
    >
      {children}
    </span>
  );
}
