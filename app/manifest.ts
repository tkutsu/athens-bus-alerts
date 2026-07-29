import type { MetadataRoute } from "next";

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "Athens Bus Alerts",
    short_name: "Bus Alerts",
    description:
      "Nearby OASA stops, live arrivals, and one-tap notification presets.",
    start_url: "/",
    display: "standalone",
    background_color: "#f4f2ec",
    theme_color: "#f4f2ec",
    orientation: "portrait",
    icons: [
      {
        src: "/icon-192.png",
        sizes: "192x192",
        type: "image/png",
        purpose: "any",
      },
      {
        src: "/icon-512.png",
        sizes: "512x512",
        type: "image/png",
        purpose: "maskable",
      },
    ],
  };
}
