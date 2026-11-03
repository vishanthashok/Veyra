import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import "./globals.css";

const sans = Geist({ variable: "--font-geist-sans", subsets: ["latin"] });
const mono = Geist_Mono({ variable: "--font-geist-mono", subsets: ["latin"] });

export const metadata: Metadata = {
  title: { default: "Veyra | Financial clarity for real estate", template: "%s | Veyra" },
  applicationName: "Veyra",
  description: "Commercial real estate financial operations: CAM reconciliation, expense auditing, and financial accuracy.",
  manifest: "/brand/site.webmanifest",
  icons: {
    icon: [
      { url: "/brand/veyra-favicon.ico", sizes: "16x16 32x32 48x48 64x64 128x128 256x256", type: "image/x-icon" },
      { url: "/brand/veyra-favicon-32.png", sizes: "32x32", type: "image/png" },
      { url: "/brand/veyra-icon.svg", type: "image/svg+xml" },
    ],
    apple: [{ url: "/brand/veyra-icon-180.png", sizes: "180x180", type: "image/png" }],
  },
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en">
      <body className={`${sans.variable} ${mono.variable} antialiased`}>{children}</body>
    </html>
  );
}

