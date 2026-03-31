import type { Metadata } from "next";

import "./globals.css";

export const metadata: Metadata = {
  title: "BugFind-15",
  description: "Visual bug-finding benchmark dashboard for comparing LLMs across 15 reproducible debugging scenarios."
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
