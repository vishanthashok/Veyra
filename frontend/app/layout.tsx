import type { Metadata, Viewport } from "next";
import { Inter, JetBrains_Mono } from "next/font/google";
import { Toaster } from "sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import "./globals.css";

const inter = Inter({ variable: "--font-inter", subsets: ["latin"], display: "swap" });
const mono = JetBrains_Mono({ variable: "--font-code", subsets: ["latin"], display: "swap" });

export const metadata: Metadata = {
  title: { default: "Veyra", template: "%s · Veyra" },
  description: "CAM pre-close audit and reconciliation readiness",
};
export const viewport: Viewport = { themeColor: "#0f1a2c" };

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en">
      <body className={`${inter.variable} ${mono.variable}`}>
        <TooltipProvider>{children}</TooltipProvider>
        <Toaster position="bottom-right" toastOptions={{ className: "!rounded-md !border-line !shadow-pop !text-sm" }} />
      </body>
    </html>
  );
}
