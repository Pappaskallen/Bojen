import type { MetadataRoute } from "next";
import { sv } from "@bojen/core/i18n/sv";

/** The web app manifest: the mechanic's day view can be added to the home screen (step 5.5b). */
export default function manifest(): MetadataRoute.Manifest {
  return {
    name: sv.app.name,
    short_name: sv.app.name,
    description: "Dagens besök för mekanikern",
    start_url: "/idag",
    scope: "/",
    display: "standalone",
    background_color: "#ffffff",
    theme_color: "#0a4d68",
    lang: "sv",
    icons: [
      { src: "/icon.svg", sizes: "any", type: "image/svg+xml", purpose: "any" },
      { src: "/icon.svg", sizes: "any", type: "image/svg+xml", purpose: "maskable" },
    ],
  };
}
