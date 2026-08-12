import type { MetadataRoute } from "next";

export default function sitemap(): MetadataRoute.Sitemap {
  const base = "https://sscprephub.in";
  const now = new Date();
  return [
    { url: base, lastModified: now },
    { url: `${base}/dashboard`, lastModified: now },
    { url: `${base}/discover`, lastModified: now },
    { url: `${base}/question-bank`, lastModified: now },
    { url: `${base}/sectional`, lastModified: now },
    { url: `${base}/cgl-test`, lastModified: now },
    { url: `${base}/quiz`, lastModified: now },
    { url: `${base}/pricing`, lastModified: now },
    { url: `${base}/study-plan`, lastModified: now },
    { url: `${base}/weak-topics`, lastModified: now },
    { url: `${base}/results`, lastModified: now },
    { url: `${base}/leaderboard`, lastModified: now },
  ];
}
