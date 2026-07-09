import type { Metadata } from "next";
import "./globals.css";
import { OrgProvider } from "@/lib/org-context";

export const metadata: Metadata = {
  title: "Payment Proofs",
  description: "Payment proof processing dashboard",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>
        <OrgProvider>{children}</OrgProvider>
      </body>
    </html>
  );
}
