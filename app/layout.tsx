import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Athens Bus Alerts",
  description:
    "A compact personal ticker for nearby OASA stops and live arrivals.",
  applicationName: "Athens Bus Alerts",
  appleWebApp: {
    capable: true,
    statusBarStyle: "default",
    title: "Bus Alerts",
  },
  icons: {
    icon: [
      { url: "/icon.svg", type: "image/svg+xml" },
      { url: "/icon-192.png", sizes: "192x192", type: "image/png" },
    ],
    apple: "/apple-touch-icon.png",
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" suppressHydrationWarning>
      <body>{children}</body>
    </html>
  );
}
