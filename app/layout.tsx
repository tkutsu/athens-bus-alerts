import type { Metadata, Viewport } from "next";
import { StartupSplash } from "@/components/startup-screen";
import "./globals.css";

const themeInitializationScript = `
  (() => {
    let theme = "light";
    try {
      const storedTheme = window.localStorage.getItem("oasa-theme");
      theme = storedTheme === "light" || storedTheme === "dark"
        ? storedTheme
        : window.matchMedia("(prefers-color-scheme: dark)").matches
          ? "dark"
          : "light";
    } catch {
      theme = window.matchMedia("(prefers-color-scheme: dark)").matches
        ? "dark"
        : "light";
    }
    document.documentElement.dataset.theme = theme;
  })();
`;

export const metadata: Metadata = {
  title: "My Pocket Bus: Athens",
  description:
    "A compact personal ticker for nearby OASA stops and live arrivals.",
  applicationName: "My Pocket Bus: Athens",
  appleWebApp: {
    capable: true,
    statusBarStyle: "default",
    title: "My Pocket Bus",
  },
  icons: {
    icon: [
      { url: "/icon.svg", type: "image/svg+xml" },
      { url: "/icon-192.png", sizes: "192x192", type: "image/png" },
    ],
    apple: "/apple-touch-icon.png",
  },
};

export const viewport: Viewport = {
  themeColor: "#e5562f",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" suppressHydrationWarning>
      <head>
        <script
          dangerouslySetInnerHTML={{ __html: themeInitializationScript }}
        />
      </head>
      <body>
        {children}
        <StartupSplash />
      </body>
    </html>
  );
}
