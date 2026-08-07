import type { Metadata, Viewport } from "next";
import { APP_TITLE, ORG_NAME } from "@/lib/branding";
import "./globals.css";

export const metadata: Metadata = {
  title: APP_TITLE,
  description: `Private job dispatch for ${ORG_NAME} field installations.`,
  // This is a private contractor tool, not a public listing site.
  robots: { index: false, follow: false },
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
  themeColor: "#1e3a8a",
};

export default function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en">
      <body className="min-h-full antialiased">{children}</body>
    </html>
  );
}
