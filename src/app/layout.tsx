import type { Metadata, Viewport } from "next";
import type { ReactNode } from "react";
import { Geist_Mono, Inter } from "next/font/google";
import "./globals.css";

const sans = Inter({ variable: "--font-inter", subsets: ["latin"] });
const mono = Geist_Mono({ variable: "--font-geist-mono", subsets: ["latin"] });

const SITE = process.env.RENDER_EXTERNAL_URL ?? "https://routed-kt93.onrender.com";
const TITLE = "Fanpoint: tour routing desk for booking agents, built on Qloo taste intelligence";
const DESCRIPTION = "Fill the empty nights between an act's booked shows. Booking agents and promoters get Qloo-ranked fan cities, rooms, openers and cross-domain sponsor hooks, with touring rules enforced in code, the empty-night cost avoided, a CSV export and hold requests.";
export const metadata: Metadata = {
  metadataBase: new URL(SITE),
  title: TITLE,
  description: DESCRIPTION,
  keywords: ["tour routing", "booking agent", "promoter", "empty nights", "Qloo", "taste intelligence", "cross-domain audience", "tour planning", "routing desk"],
  openGraph: { type: "website", siteName: "Fanpoint", title: TITLE, description: DESCRIPTION, url: "/", images: [{ url: "/og.png", width: 1200, height: 630, alt: "Fanpoint routing desk: fill the empty nights between booked shows with Qloo fan data (mock data shown)" }] },
  twitter: { card: "summary_large_image", title: TITLE, description: DESCRIPTION, images: ["/og.png"] },
};
export const viewport: Viewport = { themeColor: "#0f1115", width: "device-width", initialScale: 1 };

export default function RootLayout({ children }: Readonly<{ children: ReactNode }>) {
  return (
    <html lang="en" className={`${sans.variable} ${mono.variable} h-full antialiased`}>
      <body className="min-h-full flex flex-col">{children}</body>
    </html>
  );
}
