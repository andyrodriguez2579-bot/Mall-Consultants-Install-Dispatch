import Link from "next/link";
import { requireRole } from "@/lib/auth";
import { ORG_NAME, PRODUCT_NAME } from "@/lib/branding";
import { signOut } from "@/app/sign-in/actions";

/**
 * Contractor shell. Requires the contractor role but not approval -- a pending
 * or suspended contractor can still reach their own account page and see where
 * they stand.
 */
export default async function ContractorLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const user = await requireRole("contractor");

  return (
    <div className="min-h-screen pb-20">
      <header className="border-b border-slate-200 bg-white">
        <div className="mx-auto flex max-w-2xl items-center justify-between gap-3 px-4 py-3">
          <Link href="/jobs" className="min-w-0">
            <p className="text-[10px] font-semibold uppercase tracking-widest text-blue-700">
              {ORG_NAME}
            </p>
            <p className="truncate text-sm font-bold text-slate-900">{PRODUCT_NAME}</p>
          </Link>
          <span className="truncate text-sm text-slate-600">{user.profile.full_name}</span>
        </div>
      </header>

      <main className="mx-auto max-w-2xl px-4 py-5">{children}</main>

      {/* Thumb-reachable bottom bar: this app lives on a phone. */}
      <nav className="fixed inset-x-0 bottom-0 border-t border-slate-200 bg-white pb-[env(safe-area-inset-bottom)]">
        <ul className="mx-auto flex max-w-2xl">
          {[
            { href: "/jobs", label: "My jobs" },
            { href: "/account", label: "Account" },
          ].map((item) => (
            <li key={item.href} className="flex-1">
              <Link
                href={item.href}
                className="tap flex h-14 items-center justify-center text-sm font-medium text-slate-700 hover:bg-slate-50"
              >
                {item.label}
              </Link>
            </li>
          ))}
          <li className="flex-1">
            <form action={signOut} className="h-full">
              <button
                type="submit"
                className="h-14 w-full text-sm font-medium text-slate-500 hover:bg-slate-50"
              >
                Sign out
              </button>
            </form>
          </li>
        </ul>
      </nav>
    </div>
  );
}
