import type { Metadata, Viewport } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import { Toaster } from "sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import "./globals.css";

const geist = Geist({ variable: "--font-geist", subsets: ["latin"], display: "swap" });
const mono = Geist_Mono({ variable: "--font-geist-mono", subsets: ["latin"], display: "swap" });

export const metadata: Metadata = {
  title: { default: "Veyra", template: "%s · Veyra" },
  applicationName: "Veyra",
  description: "CAM pre-close audit and reconciliation readiness",
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
export const viewport: Viewport = { themeColor: "#121417" };

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en">
      <body className={`${geist.variable} ${mono.variable}`}>
        <TooltipProvider>{children}</TooltipProvider>
        <Toaster position="bottom-right" toastOptions={{ className: "!rounded-[10px] !border-line !shadow-pop !text-sm !font-sans" }} />
      </body>
    </html>
  );
}
