import type { MetadataRoute } from "next";

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "My Pocket Bus: Athens",
    short_name: "My Pocket Bus",
    description:
      "Nearby OASA stops, live arrivals, and one-tap notification presets.",
    start_url: "/",
    display: "standalone",
    background_color: "#e5562f",
    theme_color: "#e5562f",
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
