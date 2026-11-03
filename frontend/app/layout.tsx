import type { Metadata, Viewport } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import { Toaster } from "sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import "./globals.css";

const geist = Geist({ variable: "--font-geist", subsets: ["latin"], display: "swap" });
const mono = Geist_Mono({ variable: "--font-geist-mono", subsets: ["latin"], display: "swap" });

export const metadata: Metadata = {
  title: { default: "Veyra", template: "%s · Veyra" },
  description: "CAM pre-close audit and reconciliation readiness",
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
