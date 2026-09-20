import type { MetadataRoute } from "next";

// Lets the site be installed to a phone's home screen
export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "Myna — Burmese speech to text",
    short_name: "Myna",
    description: "Speak Burmese, English or Mandarin and see it as text.",
    start_url: "/",
    display: "standalone",
    background_color: "#ffffff",
    theme_color: "#0a0a0a",
    icons: [
      { src: "/icon-192.png", sizes: "192x192", type: "image/png" },
      { src: "/icon-512.png", sizes: "512x512", type: "image/png" },
      { src: "/icon-512.png", sizes: "512x512", type: "image/png", purpose: "maskable" },
    ],
  };
}
