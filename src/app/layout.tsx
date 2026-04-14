import type { Metadata } from "next";
import { Inter, JetBrains_Mono } from "next/font/google";
import { Providers } from "@/components/providers";
import { Toaster } from "sonner";
import { NavigationProgress } from "@/components/navigation-progress";
import "./globals.css";

const inter = Inter({
  variable: "--font-sans",
  subsets: ["latin"],
});

const jetbrains = JetBrains_Mono({
  variable: "--font-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "Projectoolbox — AI Project Management",
  description: "Deploy autonomous AI project managers that plan, track, and deliver. Built for PMOs that demand governance.",
  icons: {
    icon: [
      { url: "/favicon.ico", sizes: "any" },
      { url: "/pt-logo.png", type: "image/png", sizes: "512x512" },
    ],
    apple: "/pt-logo.png",
  },
  metadataBase: new URL("https://www.projectoolbox.com"),
  alternates: { canonical: "/" },
  openGraph: {
    type: "website",
    url: "https://www.projectoolbox.com",
    title: "Projectoolbox — AI Project Management",
    description: "Deploy autonomous AI project managers that plan, track, and deliver. Built for PMOs that demand governance.",
    siteName: "Projectoolbox",
    images: [{ url: "/og-image.png", width: 1200, height: 630, alt: "Projectoolbox — AI Project Management" }],
  },
  twitter: {
    card: "summary_large_image",
    title: "Projectoolbox — AI Project Management",
    description: "Deploy autonomous AI project managers that plan, track, and deliver. Built for PMOs that demand governance.",
    images: ["/og-image.png"],
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" suppressHydrationWarning className={`${inter.variable} ${jetbrains.variable}`}>
      <body className="min-h-screen antialiased">
        <Providers>
          <NavigationProgress />
          {children}
        </Providers>
        <Toaster richColors position="top-right" />
      </body>
    </html>
  );
}

