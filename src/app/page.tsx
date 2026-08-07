import { redirect } from "next/navigation";
import { getSessionUser, homePathFor } from "@/lib/auth";

/** Send everyone to the surface that belongs to them. */
export default async function RootPage() {
  const user = await getSessionUser();
  redirect(user ? homePathFor(user.profile.role) : "/sign-in");
}
