import { lookup } from "node:dns/promises";
import http from "node:http";
import https from "node:https";
import { isIP } from "node:net";
import * as cheerio from "cheerio";

export function isPublicIPv4(address) {
  if (isIP(address) !== 4) return false;
  const [a, b, c] = address.split(".").map(Number);
  return !(
    a === 0 ||
    a === 10 ||
    a === 127 ||
    a >= 224 ||
    (a === 100 && b >= 64 && b <= 127) ||
    (a === 169 && b === 254) ||
    (a === 172 && b >= 16 && b <= 31) ||
    (a === 192 && (b === 168 || b === 0 || b === 2)) ||
    (a === 198 && (b === 18 || b === 19 || (b === 51 && c === 100))) ||
    (a === 203 && b === 0 && c === 113)
  );
}
export function validateUrl(value) {
  if (typeof value !== "string" || value.length > 2048)
    throw new Error("A public HTTP(S) URL is required");
  let u;
  try {
    u = new URL(value);
  } catch {
    throw new Error("Invalid URL");
  }
  if (
    !["http:", "https:"].includes(u.protocol) ||
    u.username ||
    u.password ||
    (u.port && !["80", "443"].includes(u.port)) ||
    u.hostname.includes(":")
  )
    throw new Error("Only public HTTP(S) URLs on standard ports are supported");
  if (isIP(u.hostname) && !isPublicIPv4(u.hostname))
    throw new Error("Private and reserved network addresses are blocked");
  if (
    u.hostname === "localhost" ||
    u.hostname.endsWith(".localhost") ||
    u.hostname.endsWith(".local") ||
    !u.hostname.includes(".")
  )
    throw new Error("Private network names are blocked");
  u.hash = "";
  return u;
}
export async function publicAddress(u) {
  const answers = await lookup(u.hostname, { all: true, family: 4 });
  if (!answers.length || answers.some((x) => !isPublicIPv4(x.address)))
    throw new Error("Target resolves to a private or reserved network address");
  return answers[0].address;
}
export async function fetchPublicPage(
  value,
  { signal, maxBytes = 2 * 1024 * 1024 } = {},
) {
  let u = validateUrl(value);
  for (let redirects = 0; redirects <= 5; redirects++) {
    const address = await publicAddress(u);
    const response = await new Promise((resolve, reject) => {
      const request = (u.protocol === "https:" ? https : http).get(
        u,
        {
          signal,
          // One socket per request: no pooled socket outlives a rejected response.
          agent: false,
          timeout: 15000,
          lookup: (_host, opts, cb) =>
            cb(null, opts?.all ? [{ address, family: 4 }] : address, 4),
          headers: {
            "User-Agent": "LeedsHarvester/0.1 (+local public-page collector)",
            Accept: "text/html,application/xhtml+xml",
          },
        },
        (res) => {
          // Unused bodies are discarded by closing the socket, never drained.
          const discard = (error, value) => {
            res.destroy();
            if (error) reject(error);
            else resolve(value);
          };
          if ([301, 302, 303, 307, 308].includes(res.statusCode)) {
            if (!res.headers.location)
              discard(new Error("Redirect is missing a Location header"));
            else discard(null, { redirect: res.headers.location });
            return;
          }
          if (res.statusCode < 200 || res.statusCode >= 300) {
            discard(new Error(`HTTP ${res.statusCode}`));
            return;
          }
          if (
            !/text\/html|application\/xhtml\+xml/i.test(
              res.headers["content-type"] || "",
            )
          ) {
            discard(new Error("Target is not an HTML page"));
            return;
          }
          let size = 0;
          const chunks = [];
          res.on("data", (chunk) => {
            size += chunk.length;
            if (size > maxBytes) {
              res.destroy(new Error("Page exceeds 2 MB limit"));
            } else chunks.push(chunk);
          });
          res.on("error", reject);
          res.on("close", () => {
            if (!res.complete)
              reject(new Error("Connection closed before the page completed"));
          });
          res.on("end", () =>
            resolve({
              html: Buffer.concat(chunks).toString("utf8"),
              url: u.href,
              bytes: size,
            }),
          );
        },
      );
      request.on("timeout", () =>
        request.destroy(new Error("Page request timed out")),
      );
      request.on("error", reject);
    });
    if (response.redirect) {
      u = validateUrl(new URL(response.redirect, u).href);
      continue;
    }
    return response;
  }
  throw new Error("Redirect limit exceeded");
}
// Bounded quantifiers keep matching linear; an unbounded `+@` scan is quadratic
// on long runs of address characters.
const EMAIL =
  /[A-Z0-9._%+-]{1,64}@[A-Z0-9-]{1,63}(?:\.[A-Z0-9-]{1,63}){0,8}\.[A-Z]{2,24}/gi;
// Every extracted string is capped so stored results stay proportional to the page.
const clip = (value, max = 2048) =>
  typeof value === "string" ? value.trim().slice(0, max) : null;
export function extractPage(html, url, actorId) {
  const $ = cheerio.load(html);
  $("script,style,noscript,iframe,template").remove();
  const title = clip($("title").first().text(), 1000) ?? "";
  const links = [
    ...new Set(
      $("a[href]")
        .map((_, a) => {
          try {
            const u = new URL($(a).attr("href"), url);
            u.hash = "";
            return ["http:", "https:"].includes(u.protocol) &&
              u.href.length <= 2048
              ? u.href
              : null;
          } catch {
            return null;
          }
        })
        .get()
        .filter(Boolean),
    ),
  ].slice(0, 500);
  const base = { sourceUrl: url, title, collectedAt: new Date().toISOString() };
  let record;
  if (actorId === "contact-extractor") {
    const text = $("body").text();
    const mailto = $('a[href^="mailto:"]')
      .map((_, a) => clip($(a).attr("href").slice(7).split("?")[0], 254))
      .get()
      .filter(Boolean);
    record = {
      ...base,
      emails: [
        ...new Set([
          ...mailto,
          ...(text.match(EMAIL) || []),
        ]),
      ].slice(0, 100),
      phones: [
        ...new Set(
          $('a[href^="tel:"]')
            .map((_, a) => clip($(a).attr("href").slice(4), 64))
            .get()
            .filter(Boolean),
        ),
      ].slice(0, 100),
      socialLinks: links
        .filter((v) =>
          /https?:\/\/(www\.)?(linkedin\.com|facebook\.com|instagram\.com|x\.com|twitter\.com)\//i.test(
            v,
          ),
        )
        .slice(0, 100),
    };
  } else if (actorId === "website-links") record = { ...base, links };
  else if (actorId === "metadata-extractor")
    record = {
      ...base,
      description: clip($('meta[name="description"]').attr("content")) || null,
      canonical: clip($('link[rel="canonical"]').attr("href")) || null,
      openGraph: Object.fromEntries(
        $('meta[property^="og:"]')
          .slice(0, 50)
          .map((_, m) => [
            [clip($(m).attr("property"), 100), clip($(m).attr("content")) ?? ""],
          ])
          .get(),
      ),
    };
  else
    record = {
      ...base,
      text: $("body").text().replace(/\s+/g, " ").trim().slice(0, 100000),
    };
  return { record, links };
}
