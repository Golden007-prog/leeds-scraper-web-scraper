// The catalog owns every scraper's identity, status and input fields. The API
// validates input against these fields and the UI renders its forms from them.
const urls = (help = "One public http(s) URL per line.", max = 20) => ({
  name: "urls",
  type: "urls",
  label: "Start URLs",
  required: true,
  max,
  placeholder: "https://example.com",
  help,
});
const maxPages = {
  name: "maxPages",
  type: "number",
  label: "Maximum pages",
  min: 1,
  max: 20,
  help: "Pages to collect, including every start URL. Extra pages are found by following links on the same site.",
};
const respectRobots = {
  name: "respectRobots",
  type: "boolean",
  label: "Respect robots.txt",
  default: true,
  help: "Skip pages the site asks crawlers not to visit.",
};
const crawl = (extra = []) => [urls(), maxPages, ...extra, respectRobots];

export const LOCAL_BUSINESS_CATEGORIES = {
  restaurant: ["Restaurants", "amenity", "restaurant"],
  cafe: ["Cafés", "amenity", "cafe"],
  bar: ["Bars", "amenity", "bar"],
  "fast-food": ["Fast food", "amenity", "fast_food"],
  dentist: ["Dentists", "amenity", "dentist"],
  doctors: ["Doctors", "amenity", "doctors"],
  clinic: ["Clinics", "amenity", "clinic"],
  pharmacy: ["Pharmacies", "amenity", "pharmacy"],
  veterinary: ["Veterinarians", "amenity", "veterinary"],
  bank: ["Banks", "amenity", "bank"],
  school: ["Schools", "amenity", "school"],
  hotel: ["Hotels", "tourism", "hotel"],
  guesthouse: ["Guest houses", "tourism", "guest_house"],
  supermarket: ["Supermarkets", "shop", "supermarket"],
  bakery: ["Bakeries", "shop", "bakery"],
  hairdresser: ["Hairdressers", "shop", "hairdresser"],
  beauty: ["Beauty salons", "shop", "beauty"],
  "car-repair": ["Car repair", "shop", "car_repair"],
  hardware: ["Hardware stores", "shop", "hardware"],
  gym: ["Gyms", "leisure", "fitness_centre"],
  lawyer: ["Lawyers", "office", "lawyer"],
  accountant: ["Accountants", "office", "accountant"],
  "estate-agent": ["Estate agents", "office", "estate_agent"],
  "it-company": ["IT companies", "office", "it"],
};

const definitions = [
  {
    id: "website-content",
    name: "Page Text Harvester",
    category: "Web scraping",
    color: "green",
    description:
      "Turn websites into clean text. Collect page content for research, knowledge bases and AI workflows.",
    fields: crawl(),
  },
  {
    id: "page-markdown",
    name: "Page to Markdown",
    category: "AI & data",
    color: "purple",
    description:
      "Convert pages into clean Markdown with headings, lists, links and tables, ready for LLMs and notes.",
    fields: crawl(),
  },
  {
    id: "contact-extractor",
    name: "Public Contact Finder",
    category: "Lead generation",
    color: "pink",
    description:
      "Find publicly listed emails, phone numbers, social profiles and contact pages, including schema.org contact data.",
    fields: crawl(),
  },
  {
    id: "local-business-leads",
    name: "Local Business Leads",
    category: "Lead generation",
    color: "blue",
    mode: "source",
    deadlineMs: 120000,
    description:
      "Find businesses by category and place from OpenStreetMap open data: name, address, phone, website, hours and coordinates. Optionally visit websites for emails.",
    fields: [
      {
        name: "category",
        type: "select",
        label: "Business type",
        required: true,
        options: [
          ...Object.entries(LOCAL_BUSINESS_CATEGORIES).map(([value, [label]]) => ({
            value,
            label,
          })),
          { value: "custom", label: "Custom OpenStreetMap tag…" },
        ],
        default: "restaurant",
      },
      {
        name: "customTag",
        type: "text",
        label: "Custom tag",
        maxLength: 100,
        placeholder: "craft=brewery",
        help: "Used when the business type is custom. Format key=value, e.g. shop=florist.",
      },
      {
        name: "place",
        type: "text",
        label: "City or area",
        required: true,
        maxLength: 120,
        placeholder: "Leeds, United Kingdom",
      },
      { name: "limit", type: "number", label: "Maximum businesses", min: 1, max: 200, default: 50 },
      {
        name: "findEmails",
        type: "boolean",
        label: "Visit websites for emails",
        default: false,
        help: "Checks the homepages of up to 15 businesses that list a website.",
      },
    ],
  },
  {
    id: "website-links",
    name: "Site Link Mapper",
    category: "Web scraping",
    color: "blue",
    description: "Discover links across a website. Map pages and find resources.",
    fields: crawl(),
  },
  {
    id: "metadata-extractor",
    name: "Page Metadata Reader",
    category: "SEO",
    color: "orange",
    description:
      "Collect titles, descriptions, canonical URLs, language, robots directives, H1s, Open Graph and Twitter Card tags.",
    fields: crawl(),
  },
  {
    id: "structured-data",
    name: "Structured Data Reader",
    category: "SEO",
    color: "orange",
    description:
      "Extract JSON-LD, microdata, Open Graph and Twitter Card data: products, articles, events, organizations and more.",
    fields: crawl(),
  },
  {
    id: "product-data",
    name: "Product Data Extractor",
    category: "E-commerce",
    color: "green",
    description:
      "Collect product names, prices, currency, availability, ratings, SKUs and images from shop pages that publish product data.",
    fields: crawl(),
  },
  {
    id: "table-extractor",
    name: "Table Extractor",
    category: "Web scraping",
    color: "blue",
    description:
      "Turn HTML tables into rows keyed by their headers: prices, statistics, schedules, rankings and listings.",
    fields: crawl(),
  },
  {
    id: "custom-selectors",
    name: "Custom Selector Scraper",
    category: "Web scraping",
    color: "purple",
    description:
      "Pick exactly the fields you need with CSS selectors. Collect repeating items such as listings, posts or search results.",
    fields: crawl([
      {
        name: "itemSelector",
        type: "text",
        label: "Item selector",
        maxLength: 300,
        placeholder: ".product-card",
        help: "Optional. Each match becomes one record; leave empty for one record per page.",
      },
      {
        name: "selectors",
        type: "textarea",
        label: "Fields",
        required: true,
        maxLength: 6000,
        placeholder: "title: h2\nprice: .price\nlink: a @href\ntags[]: .tag",
        help: "One field per line: name: CSS selector. Add @attribute to read an attribute, and [] after the name to collect every match.",
      },
    ]),
  },
  {
    id: "feed-reader",
    name: "Feed & Sitemap Reader",
    category: "Web scraping",
    color: "orange",
    description:
      "Read RSS, Atom and RDF news feeds and XML sitemaps into clean items with titles, links, dates and summaries.",
    accept: "feed",
    // Sitemap files may legitimately be several megabytes.
    maxBytes: 10 * 1024 * 1024,
    fields: crawl().map((f) =>
      f.name === "urls"
        ? urls("Feed or sitemap URLs, one per line.")
        : f.name === "maxPages"
          ? {
              ...f,
              label: "Maximum files",
              help: "Feeds and sitemaps to read, including every start URL. Raise it to follow the sitemaps listed in a sitemap index on the same site.",
            }
          : f,
    ),
  },
  {
    id: "social-embeds",
    name: "Social Post Reader",
    category: "Social media",
    color: "pink",
    mode: "source",
    description:
      "Read public metadata for YouTube, TikTok, Vimeo, X, Reddit, Spotify, SoundCloud and Dailymotion posts through their official oEmbed endpoints.",
    fields: [
      urls(
        "Public post or video URLs, one per line. Only supported providers are read; no sign-in is used.",
        50,
      ),
    ],
  },
  {
    id: "ai-extract",
    name: "AI Data Extractor",
    category: "AI & data",
    color: "purple",
    deadlineMs: 180000,
    requires: "llm",
    description:
      "Describe the data you want in plain language and an AI model returns it as JSON. Uses your own OpenAI-compatible model endpoint.",
    fields: crawl([
      {
        name: "prompt",
        type: "textarea",
        label: "What to extract",
        required: true,
        maxLength: 2000,
        placeholder: "List each product with its name, price and whether it is in stock.",
      },
    ]).map((f) => (f.name === "maxPages" ? { ...f, max: 5 } : f)),
  },
];

// Status depends on configuration: a scraper that needs a provider is listed
// but cannot run until that provider is configured.
export function buildCatalog({ llmConfigured = false } = {}) {
  return definitions.map((actor) => {
    const ready = actor.requires !== "llm" || llmConfigured;
    return {
      ...actor,
      mode: actor.mode ?? "crawl",
      slug: `leeds/${actor.id}`,
      owner: "Leeds Harvester",
      status: ready ? "ready" : "requires-provider",
      notice: ready
        ? null
        : "Set LEEDS_LLM_BASE_URL and LEEDS_LLM_MODEL (and LEEDS_LLM_API_KEY if your provider needs one), then restart the server.",
    };
  });
}
