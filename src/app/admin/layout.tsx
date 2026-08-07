import Link from "next/link";
import { requireAdmin } from "@/lib/auth";
import { ORG_NAME, PRODUCT_NAME } from "@/lib/branding";
import { signOut } from "@/app/sign-in/actions";

const NAV = [
  { href: "/admin", label: "Dashboard" },
  { href: "/admin/jobs", label: "Jobs" },
  { href: "/admin/contractors", label: "Contractors" },
  { href: "/admin/messages", label: "Messages" },
  { href: "/admin/activity", label: "Activity" },
];

export default async function AdminLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const user = await requireAdmin();

  return (
    <div className="min-h-screen">
      <header className="border-b border-slate-200 bg-white">
        <div className="mx-auto flex max-w-6xl items-center justify-between gap-4 px-4 py-3">
          <Link href="/admin" className="min-w-0">
            <p className="text-[10px] font-semibold uppercase tracking-widest text-blue-700">
              {ORG_NAME}
            </p>
            <p className="truncate text-sm font-bold text-slate-900">{PRODUCT_NAME}</p>
          </Link>

          <div className="flex items-center gap-3">
            <span className="hidden text-sm text-slate-600 sm:inline">
              {user.profile.full_name}
            </span>
            <form action={signOut}>
              <button
                type="submit"
                className="rounded-lg px-3 py-2 text-sm font-medium text-slate-600 hover:bg-slate-100 hover:text-slate-900"
              >
                Sign out
              </button>
            </form>
          </div>
        </div>

        {/* Horizontally scrollable on phones rather than wrapping into a wall. */}
        <nav className="mx-auto max-w-6xl overflow-x-auto px-4">
          <ul className="flex gap-1 pb-2">
            {NAV.map((item) => (
              <li key={item.href}>
                <Link
                  href={item.href}
                  className="tap inline-flex items-center whitespace-nowrap rounded-lg px-3 py-2 text-sm font-medium text-slate-600 hover:bg-slate-100 hover:text-slate-900"
                >
                  {item.label}
                </Link>
              </li>
            ))}
          </ul>
        </nav>
      </header>

      <main className="mx-auto max-w-6xl px-4 py-6">{children}</main>
    </div>
  );
}
