export interface CompanySiteProfile {
  company: string;
  baseUrl: string;
  homepageUrl: string;
  visionUrl?: string;
  brandsUrl?: string;
  peopleUrl?: string;
  newsUrls?: string[];
  attendeeDirectoryUrls?: string[];
  managementUrl?: string;
}

interface FetchedPage {
  url: string;
  html: string;
  lines: string[];
}

export interface PublicProfileMatch {
  source: string;
  url: string;
  title?: string;
  background?: string;
  location?: string;
}

export interface LeadershipLookupResult {
  homepageUrl?: string;
  leadershipPageUrl?: string;
  newsUrls?: string[];
}

function slugify(value: string): string {
  return value
    .toLowerCase()
    .replace(/&/g, " and ")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

function compactSlug(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, "");
}

function domainRootLabel(url: string): string | null {
  try {
    const hostname = new URL(url).hostname.replace(/^www\./, "");
    const [label] = hostname.split(".");
    return label || null;
  } catch {
    return null;
  }
}

const companyProfiles: CompanySiteProfile[] = [];

const entityMap: Record<string, string> = {
  "&amp;": "&",
  "&quot;": "\"",
  "&#39;": "'",
  "&nbsp;": " ",
  "&rsquo;": "'",
  "&ndash;": "-",
  "&mdash;": "-",
  "&reg;": "",
  "&trade;": ""
};

function decodeEntities(value: string): string {
  const decoded = Object.entries(entityMap).reduce(
    (output, [entity, replacement]) => output.replaceAll(entity, replacement),
    value
  );

  return decoded.replace(/&#(\d+);/g, (_, code) =>
    String.fromCharCode(Number(code))
  );
}

function htmlToLines(html: string): string[] {
  const withBreaks = html
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<(br|\/p|\/div|\/section|\/article|\/li|\/h\d)>/gi, "\n")
    .replace(/<[^>]+>/g, " ");

  return decodeEntities(withBreaks)
    .split(/\r?\n/)
    .map((line) => line.replace(/\s+/g, " ").trim())
    .filter(Boolean);
}

export function getCompanySiteProfile(company: string): CompanySiteProfile | null {
  const normalized = company.trim().toLowerCase();

  return (
    companyProfiles.find(
      (profile) => profile.company.trim().toLowerCase() === normalized
    ) ?? null
  );
}

function extractCandidateLinks(
  html: string,
  baseUrl: string,
  pattern: RegExp,
  limit = 6
): string[] {
  const links = Array.from(
    html.matchAll(/<a[^>]+href="([^"]+)"/gi),
    (match) => decodeEntities(match[1]).trim()
  );

  return unique(
    links
      .map((href) => {
        try {
          return new URL(href, baseUrl).toString();
        } catch {
          return "";
        }
      })
      .filter((url) => pattern.test(url))
  ).slice(0, limit);
}

function companyBaseCandidates(company: string, profile: CompanySiteProfile | null): string[] {
  const slug = slugify(company);
  const compact = compactSlug(company);

  return unique([
    profile?.baseUrl ?? "",
    `https://www.${compact}.com`,
    `https://${compact}.com`,
    `https://www.${slug}.com`,
    `https://${slug}.com`
  ]);
}

export async function fetchPage(url: string): Promise<FetchedPage | null> {
  try {
    const response = await fetch(url, {
      headers: {
        "User-Agent": "TPGClientPrepAssistant/0.1"
      }
    });

    if (!response.ok) {
      return null;
    }

    const html = await response.text();

    return {
      url,
      html,
      lines: htmlToLines(html)
    };
  } catch {
    return null;
  }
}

export async function discoverLeadershipLookup(
  company: string
): Promise<LeadershipLookupResult> {
  const profile = getCompanySiteProfile(company);
  const mappedLeadershipUrl = profile?.peopleUrl ?? profile?.managementUrl;

  if (mappedLeadershipUrl) {
    return {
      homepageUrl: profile?.homepageUrl,
      leadershipPageUrl: mappedLeadershipUrl
    };
  }

  const homepageCandidates = companyBaseCandidates(company, profile);
  let homepage: FetchedPage | null = null;

  for (const candidate of homepageCandidates) {
    homepage = await fetchPage(candidate);

    if (homepage) {
      break;
    }
  }

  if (!homepage) {
    return {};
  }

  const commonLeadershipPaths = [
    "/company/leadership",
    "/our-company/leadership",
    "/company/our-leadership",
    "/leadership",
    "/leadership-team",
    "/our-leadership",
    "/management",
    "/executive-team",
    "/about/leadership",
    "/investors/corporate-governance"
  ];
  const discoveredLinks = extractLeadershipLinks(homepage.html, homepage.url);
  const commonLinks = commonLeadershipPaths.map((path) =>
    new URL(path, homepage!.url).toString()
  );
  const leadershipCandidates = unique([...discoveredLinks, ...commonLinks]);
  const newsUrls = extractCandidateLinks(
    homepage.html,
    homepage.url,
    /news|press|release|investor|financial|quarterly|results|stories/i,
    6
  );

  for (const candidate of leadershipCandidates) {
    const page = await fetchPage(candidate);

    if (page && /leadership|management|executive|chief|president|officer/i.test(page.lines.join(" "))) {
      return {
        homepageUrl: homepage.url,
        leadershipPageUrl: page.url,
        newsUrls
      };
    }
  }

  return {
    homepageUrl: homepage.url,
    newsUrls
  };
}

function normalizeSearchUrl(url: string): string | null {
  try {
    const parsed = new URL(url);
    const uddg = parsed.searchParams.get("uddg");

    return uddg ? decodeURIComponent(uddg) : url;
  } catch {
    return null;
  }
}

async function searchDomain(
  name: string,
  company: string,
  domain: string
): Promise<string[]> {
  const query = `"${name}" "${company}" site:${domain}`;
  const url = `https://html.duckduckgo.com/html/?q=${encodeURIComponent(query)}`;
  const page = await fetchPage(url);

  if (!page) {
    return [];
  }

  const links = Array.from(
    page.html.matchAll(/<a[^>]+class="[^"]*result__a[^"]*"[^>]+href="([^"]+)"/gi),
    (match) => normalizeSearchUrl(decodeEntities(match[1]))
  ).filter(Boolean) as string[];

  return unique(
    links.filter((link) => {
      try {
        return new URL(link).hostname.includes(domain);
      } catch {
        return false;
      }
    })
  ).slice(0, 2);
}

function exactNameAndCompanyMatch(
  lines: string[],
  name: string,
  company: string
): boolean {
  const joined = lines.join(" ").toLowerCase();
  return (
    joined.includes(name.trim().toLowerCase()) &&
    joined.includes(company.trim().toLowerCase())
  );
}

function extractProfileDetails(
  lines: string[],
  name: string,
  company: string
): Pick<PublicProfileMatch, "title" | "background" | "location"> {
  const lowerName = name.trim().toLowerCase();
  const lowerCompany = company.trim().toLowerCase();

  const titleLine =
    lines.find(
      (line) =>
        line.toLowerCase().includes(lowerName) &&
        line.toLowerCase().includes(lowerCompany)
    ) ??
    lines.find(
      (line) =>
        line.toLowerCase().includes(lowerCompany) &&
        /(vp|vice president|general manager|director|sales|marketing|business development|chief)/i.test(
          line
        )
    );

  const locationLine = lines.find((line) =>
    /united states|, tn|, ny|, nj|, ca|nashville|seattle|chicago|dallas|atlanta/i.test(
      line
    )
  );

  const backgroundLines = lines.filter(
    (line) =>
      !line.toLowerCase().includes(lowerCompany) &&
      /(ex-|former|previous|prior|university|school|mars|chewy|smiledirectclub)/i.test(
        line
      )
  );

  return {
    title: titleLine,
    background: backgroundLines.slice(0, 3).join(" ").trim() || undefined,
    location: locationLine
  };
}

export async function searchCompanyDirectoryProfiles(
  name: string,
  company: string
): Promise<PublicProfileMatch[]> {
  const profile = getCompanySiteProfile(company);
  const companySlug = slugify(company);
  const compactCompanySlug = compactSlug(company);
  const domainSlug = profile?.baseUrl ? domainRootLabel(profile.baseUrl) : null;
  const candidateUrls = unique([
    ...(profile?.attendeeDirectoryUrls ?? []),
    `https://www.signalhire.com/overview/${companySlug}/email-format`,
    `https://www.signalhire.com/overview/${compactCompanySlug}/email-format`,
    domainSlug ? `https://www.signalhire.com/overview/${domainSlug}/email-format` : "",
    `https://rocketreach.co/${companySlug}-profile_b5c0000000000000`,
    `https://rocketreach.co/${compactCompanySlug}-profile_b5c0000000000000`,
    `https://contactout.com/company/${companySlug}`,
    `https://contactout.com/company/${compactCompanySlug}`
  ]);

  if (candidateUrls.length === 0) {
    return [];
  }

  const pages = await Promise.all(candidateUrls.map((url) => fetchPage(url)));

  return pages
    .filter(Boolean)
    .flatMap((page) => {
      const current = page!;
      const start = current.lines.findIndex(
        (line) => line.trim().toLowerCase() === name.trim().toLowerCase()
      );

      if (start < 0) {
        return [];
      }

      const window = current.lines.slice(start, start + 10);
      const titleLine = window.find((line) =>
        /(vp|vice president|general manager|director|sales|marketing|business development|manager|chief)/i.test(
          line
        )
      );
      const locationLine = window.find((line) =>
        /united states|, tn|, ny|, nj|, ca|nashville|seattle|chicago|dallas|atlanta/i.test(
          line
        )
      );

      return [
        {
          source: new URL(current.url).hostname,
          url: current.url,
          title: titleLine,
          location: locationLine
        }
      ];
    })
    .slice(0, 2);
}

export async function searchPublicProfileAggregators(
  name: string,
  company: string
): Promise<PublicProfileMatch[]> {
  const domains = ["signalhire.com", "rocketreach.co", "contactout.com"];
  const candidateUrls = unique(
    (
      await Promise.all(domains.map((domain) => searchDomain(name, company, domain)))
    ).flat()
  ).slice(0, 5);

  const pages = await Promise.all(candidateUrls.map((url) => fetchPage(url)));

  return pages
    .filter(Boolean)
    .flatMap((page) => {
      const current = page!;

      if (!exactNameAndCompanyMatch(current.lines, name, company)) {
        return [];
      }

      const details = extractProfileDetails(current.lines, name, company);

      return [
        {
          source: new URL(current.url).hostname,
          url: current.url,
          title: details.title,
          background: details.background,
          location: details.location
        }
      ];
    })
    .slice(0, 2);
}

export function extractLeadershipLinks(html: string, baseUrl: string): string[] {
  const links = Array.from(
    html.matchAll(/<a[^>]+href="([^"]+)"/gi),
    (match) => decodeEntities(match[1]).trim()
  );

  const candidates = links
    .map((href) => {
      try {
        return new URL(href, baseUrl).toString();
      } catch {
        return "";
      }
    })
    .filter((url) =>
      /leadership|management|people|team|executive|governance/i.test(url)
    );

  return unique(candidates).slice(0, 5);
}

export function unique(items: string[]): string[] {
  const seen = new Set<string>();
  const output: string[] = [];

  for (const item of items.map((value) => value.trim()).filter(Boolean)) {
    const key = item.toLowerCase();

    if (seen.has(key)) {
      continue;
    }

    seen.add(key);
    output.push(item);
  }

  return output;
}

export function lineAfter(lines: string[], label: string): string | null {
  const index = lines.findIndex((line) => line === label);
  return index >= 0 ? lines[index + 1] ?? null : null;
}

export function findLine(lines: string[], pattern: RegExp): string | null {
  return lines.find((line) => pattern.test(line)) ?? null;
}

export function extractImageAltNames(html: string): string[] {
  const matches = Array.from(
    html.matchAll(/alt="([^"]+)"/gi),
    (match) => decodeEntities(match[1]).trim()
  );

  const normalizedNames = matches
    .map((name) => {
      if (name.toLowerCase() === "eco nugenics") {
        return "ecoNugenics";
      }

      return name;
    })
    .filter((name) => {
      if (!name) {
        return false;
      }

      const lowered = name.toLowerCase();
      return ![
        "our brands",
        "our people",
        "our vision",
        "company logo",
        "logo",
        "back to top"
      ].includes(lowered);
    });

  return unique(normalizedNames);
}

export function extractPersonBlock(
  lines: string[],
  personName: string
): { title?: string; background?: string } | null {
  const normalizedName = personName.trim().toLowerCase();
  const start = lines.findIndex(
    (line) =>
      line.toLowerCase() === normalizedName ||
      line.toLowerCase().includes(normalizedName)
  );

  if (start < 0) {
    return null;
  }

  const nearbyLines = lines.slice(start, start + 5);
  const title =
    nearbyLines.find((line) =>
      /(chief|president|vice president|vp|director|manager|commercial|marketing|sales|finance|operations|officer|general counsel)/i.test(
        line
      )
    ) ?? lines[start + 1];
  const priorExperienceIndex = lines.findIndex(
    (line, index) => index > start && line === "Prior Experience"
  );

  let background = "";

  if (priorExperienceIndex > -1) {
    const buffer: string[] = [];

    for (let index = priorExperienceIndex + 1; index < lines.length; index += 1) {
      const line = lines[index];

      if (
        line.startsWith("What do you love about working at Bridges?") ||
        /^([A-Z][a-z]+ ){1,3}[A-Z][a-z]+$/.test(line)
      ) {
        break;
      }

      buffer.push(line);
    }

    background = buffer.join(" ").trim();
  }

  return {
    title: title?.trim(),
    background: background || undefined
  };
}

export function extractLeadershipRoster(lines: string[]): string[] {
  const titles: string[] = [];

  for (let index = 1; index < lines.length; index += 1) {
    const line = lines[index];

    if (
      /(Chief Executive Officer|Chief Financial Officer|Chief Operating Officer|Chief Human Resources Officer|Chief Accounting Officer|General Counsel|President|Executive Vice President|Senior Vice President)/i.test(
        line
      )
    ) {
      const name = lines[index - 1];

      if (/^[A-Z][A-Za-z.' -]+$/.test(name)) {
        titles.push(`${name} - ${line}`);
      }
    }
  }

  return unique(titles).slice(0, 10);
}
