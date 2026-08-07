import type { Metadata } from "next";
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
  title: "Athens Bus Tracker",
  description:
    "A compact personal ticker for nearby OASA stops and live arrivals.",
  applicationName: "Athens Bus Tracker",
  appleWebApp: {
    capable: true,
    statusBarStyle: "default",
    title: "Bus Tracker",
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
      <head>
        <script
          dangerouslySetInnerHTML={{ __html: themeInitializationScript }}
        />
      </head>
      <body>{children}</body>
    </html>
  );
}
