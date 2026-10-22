export const actors = [
  {
    id: "website-content",
    name: "Page Text Harvester",
    category: "Web scraping",
    color: "green",
    description:
      "Turn websites into clean, structured text. Collect page content for research, knowledge bases, and AI workflows.",
  },
  {
    id: "contact-extractor",
    name: "Public Contact Finder",
    category: "Lead generation",
    color: "pink",
    description:
      "Find publicly listed email addresses, phone numbers, and social links on websites.",
  },
  {
    id: "website-links",
    name: "Site Link Mapper",
    category: "Web scraping",
    color: "blue",
    description:
      "Discover links across a website. Map pages and find resources.",
  },
  {
    id: "metadata-extractor",
    name: "Page Metadata Reader",
    category: "SEO",
    color: "orange",
    description:
      "Collect page titles, descriptions, canonical URLs, and Open Graph tags.",
  },
  {
    id: "google-maps",
    name: "Local Business Leads",
    category: "Lead generation",
    color: "blue",
    description:
      "A provider template. A supported provider connection is required before this can run.",
    status: "requires-provider",
  },
  {
    id: "social-profiles",
    name: "Social Profile Research",
    category: "Social media",
    color: "purple",
    description:
      "A provider template for public social profile research. Not runnable in this release.",
    status: "requires-provider",
  },
].map((a) => ({
  ...a,
  slug: `leeds/${a.id}`,
  owner: "Leeds Harvester",
  status: a.status || "ready",
}));
