import type { MetadataRoute } from "next";

/** What a browser shows when Novera is installed or pinned: name, colours and the logomark. */
export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "Novera",
    short_name: "Novera",
    description: "Evidence that an AI support agent behaves as its written policy requires.",
    start_url: "/dashboard",
    display: "standalone",
    background_color: "#09090b",
    theme_color: "#09090b",
    icons: [
      { src: "/icon.svg", sizes: "any", type: "image/svg+xml" },
      { src: "/apple-icon", sizes: "180x180", type: "image/png" },
    ],
  };
}
