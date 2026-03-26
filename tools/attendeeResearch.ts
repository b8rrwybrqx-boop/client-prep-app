import {
  discoverLeadershipLookup,
  fetchPage,
  getCompanySiteProfile,
  searchCompanyDirectoryProfiles,
  searchPublicProfileAggregators,
  unique
} from "./liveResearchUtils.js";

type SourceType =
  | "company-page"
  | "company-news"
  | "secondary-profile"
  | "inferred"
  | "not-found";

type Confidence = "high" | "medium" | "low";

interface CompanyPageCandidate {
  kind: "company-page" | "company-news";
  url: string;
}

interface CompanyMatch {
  title: string | null;
  role: string | null;
  background: string | null;
  sourceType: "company-page" | "company-news";
  confidence: Confidence;
  note: string | null;
  sourceUrl: string;
}

export interface AttendeeResearchResult {
  name: string;
  verifiedTitle: string | null;
  verifiedRole: string | null;
  background: string | null;
  sourceType: SourceType;
  confidence: Confidence;
  note: string | null;
  inferredPriorities: string[];
  title?: string;
  verificationLevel: "company-site" | "secondary-public-profile" | "unverified";
  titleEvidence?: string;
  notes: string[];
  sourceChecks: string[];
  sources: string[];
}

const companyOwnedPathPattern =
  /(about|about-us|our-people|leadership|leadership-team|executive-team|management|team|company|who-we-are|board|investor-relations|management-team|news|press-releases)/i;

const newsroomPathPattern = /(news|press|release|investor|stories|media)/i;

function normalizeName(value: string): string {
  return value
    .toLowerCase()
    .replace(/[.,']/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

function lastName(value: string): string {
  const parts = normalizeName(value).split(" ");
  return parts[parts.length - 1] ?? "";
}

function inferRoleFromTitle(title: string | null): string | null {
  if (!title) {
    return null;
  }

  if (/commercial|sales|revenue|customer/i.test(title)) {
    return "Commercial / customer leadership";
  }

  if (/marketing|brand/i.test(title)) {
    return "Marketing / brand leadership";
  }

  if (/finance|cfo|accounting/i.test(title)) {
    return "Finance leadership";
  }

  if (/operations|supply chain|manufacturing/i.test(title)) {
    return "Operations / supply chain leadership";
  }

  if (/chief|ceo|president/i.test(title)) {
    return "Enterprise leadership";
  }

  return null;
}

function inferPriorities(title: string | null, company?: string): string[] {
  const priorities: string[] = [];

  if (!title) {
    priorities.push("Clarify functional scope, decision rights, and meeting objectives early.");
    priorities.push("Test whether the discussion is anchored on growth, margin, or organizational execution.");
    return priorities;
  }

  if (/commercial|sales|customer|revenue/i.test(title)) {
    priorities.push("Customer growth, channel performance, and retailer execution.");
    priorities.push("Pricing, mix, and commercial initiatives with clear near-term revenue impact.");
  }

  if (/marketing|brand/i.test(title)) {
    priorities.push("Brand growth, portfolio priorities, and demand generation effectiveness.");
  }

  if (/finance|cfo|accounting/i.test(title)) {
    priorities.push("Margin improvement, capital allocation, and measurable P&L impact.");
  }

  if (/operations|supply chain|manufacturing/i.test(title)) {
    priorities.push("Service reliability, productivity, and operational risk reduction.");
  }

  if (/chief|ceo|president/i.test(title)) {
    priorities.push("Enterprise priorities, portfolio focus, and transformation sequencing.");
  }

  if (priorities.length === 0) {
    priorities.push(
      `Likely focused on practical initiatives that can move growth, margin, or execution outcomes at ${company ?? "the company"}.`
    );
  }

  return unique(priorities);
}

function extractLinks(html: string, baseUrl: string, pattern: RegExp, limit = 12): string[] {
  const links = Array.from(
    html.matchAll(/<a[^>]+href="([^"]+)"/gi),
    (match) => match[1].trim()
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

function companyCandidates(homepageUrl: string, homepageHtml: string): CompanyPageCandidate[] {
  const commonPaths = [
    "/about",
    "/about-us",
    "/our-people",
    "/leadership",
    "/leadership-team",
    "/executive-team",
    "/management",
    "/team",
    "/company",
    "/who-we-are",
    "/board",
    "/investor-relations",
    "/management-team",
    "/news",
    "/press-releases"
  ];

  const linkedUrls = extractLinks(homepageHtml, homepageUrl, companyOwnedPathPattern, 16);
  const commonUrls = commonPaths.map((path) => new URL(path, homepageUrl).toString());

  return unique([...linkedUrls, ...commonUrls]).map((url) => ({
    kind: newsroomPathPattern.test(url) ? "company-news" : "company-page",
    url
  }));
}

function findCompanyMatch(
  lines: string[],
  attendeeName: string,
  pageKind: "company-page" | "company-news",
  pageUrl: string
): CompanyMatch | null {
  const normalizedAttendee = normalizeName(attendeeName);
  const normalizedLastName = lastName(attendeeName);
  const normalizedLines = lines.map((line) => normalizeName(line));
  let start = normalizedLines.findIndex((line) => line === normalizedAttendee);

  if (start < 0) {
    start = normalizedLines.findIndex((line) => line.includes(normalizedAttendee));
  }

  let confidence: Confidence = "high";

  if (start < 0 && normalizedLastName) {
    start = normalizedLines.findIndex(
      (line) =>
        line.includes(normalizedLastName) &&
        /(chief|president|vice president|vp|director|manager|officer|commercial|marketing|sales|finance|operations)/i.test(
          line
        )
    );
    confidence = "medium";
  }

  if (start < 0) {
    return null;
  }

  const window = lines.slice(Math.max(0, start - 1), start + 8);
  const title =
    window.find((line) =>
      /(chief|president|vice president|vp|director|manager|officer|commercial|marketing|sales|finance|operations)/i.test(
        line
      )
    ) ?? null;
  const background =
    window
      .filter(
        (line) =>
          line !== title &&
          normalizeName(line) !== normalizedAttendee &&
          !/^(about|leadership|management|team|news|press releases)$/i.test(line)
      )
      .slice(0, pageKind === "company-news" ? 3 : 2)
      .join(" ")
      .trim() || null;

  return {
    title,
    role: inferRoleFromTitle(title),
    background,
    sourceType: pageKind,
    confidence,
    note:
      pageKind === "company-news"
        ? "Matched on a company-owned news or announcement page."
        : confidence === "medium"
          ? "Matched on a company-owned leadership/team page using last-name confirmation."
          : "Matched on a company-owned leadership/team/about page.",
    sourceUrl: pageUrl
  };
}

// Search workflow:
// 1. Company leadership/about/team pages
// 2. Investor/management pages for public companies
// 3. Company-owned press releases / announcements
// 4. Secondary public profiles as fallback
// 5. Return best useful partial result with explicit confidence and notes
export async function attendeeResearch(
  attendees: string[],
  company?: string
): Promise<AttendeeResearchResult[]> {
  const profile = company ? getCompanySiteProfile(company) : null;
  const discoveredLookup = company ? await discoverLeadershipLookup(company) : {};
  const homepageUrl = profile?.homepageUrl ?? discoveredLookup.homepageUrl;
  const homepagePage = homepageUrl ? await fetchPage(homepageUrl) : null;
  const likelyCompanyPages = homepagePage
    ? companyCandidates(homepagePage.url, homepagePage.html)
    : [];

  const seededPages = unique([
    profile?.peopleUrl ?? "",
    profile?.managementUrl ?? "",
    discoveredLookup.leadershipPageUrl ?? "",
    ...(discoveredLookup.newsUrls ?? [])
  ]).map((url) => ({
    kind: newsroomPathPattern.test(url) ? ("company-news" as const) : ("company-page" as const),
    url
  }));

  const companyPagesToCheck = unique(
    [...seededPages, ...likelyCompanyPages].map((page) => `${page.kind}::${page.url}`)
  ).map((key) => {
    const [kind, url] = key.split("::");
    return { kind: kind as "company-page" | "company-news", url };
  });

  const fetchedPages = await Promise.all(
    companyPagesToCheck.map(async (page) => ({
      ...page,
      content: await fetchPage(page.url)
    }))
  );

  return Promise.all(
    attendees.map(async (name) => {
      const companyOwnedMatches = fetchedPages
        .filter((page) => page.content)
        .map((page) =>
          findCompanyMatch(page.content!.lines, name, page.kind, page.url)
        )
        .filter(Boolean) as CompanyMatch[];

      const directCompanyMatch =
        companyOwnedMatches.find((match) => match.sourceType === "company-page") ??
        companyOwnedMatches[0] ??
        null;

      const directoryMatches =
        company && !directCompanyMatch
          ? await searchCompanyDirectoryProfiles(name, company)
          : [];
      const aggregatorMatches =
        company && !directCompanyMatch
          ? await searchPublicProfileAggregators(name, company)
          : [];
      const secondaryMatch = directoryMatches[0] ?? aggregatorMatches[0] ?? null;

      const sourceType: SourceType = directCompanyMatch
        ? directCompanyMatch.sourceType
        : secondaryMatch
          ? "secondary-profile"
          : "not-found";
      const verificationLevel = directCompanyMatch
        ? "company-site"
        : secondaryMatch
          ? "secondary-public-profile"
          : "unverified";
      const verifiedTitle = directCompanyMatch?.title ?? secondaryMatch?.title ?? null;
      const verifiedRole =
        directCompanyMatch?.role ??
        inferRoleFromTitle(secondaryMatch?.title ?? null);
      const background =
        directCompanyMatch?.background ??
        secondaryMatch?.background ??
        null;
      const confidence: Confidence = directCompanyMatch
        ? directCompanyMatch.confidence
        : secondaryMatch
          ? "medium"
          : "low";
      const note =
        directCompanyMatch?.note ??
        (secondaryMatch
          ? `Company-owned pages did not surface a direct match; using secondary public-profile evidence from ${secondaryMatch.source}.`
          : company
            ? `No attendee match found on company-owned pages for ${company}; secondary-profile fallback also did not return a confident match.`
            : "No attendee match was found automatically.");
      const inferredPriorities = inferPriorities(verifiedTitle, company);
      const titleEvidence = directCompanyMatch
        ? `Verified on company-owned page: ${directCompanyMatch.sourceUrl}`
        : secondaryMatch
          ? `Secondary public-profile source (${secondaryMatch.source}) suggests this current title.`
          : undefined;

      return {
        name,
        verifiedTitle,
        verifiedRole,
        background,
        sourceType,
        confidence,
        note,
        inferredPriorities,
        title: verifiedTitle ?? "Title lookup pending",
        verificationLevel,
        titleEvidence,
        notes: unique(
          [
            titleEvidence,
            background,
            note,
            secondaryMatch?.location ? `Location: ${secondaryMatch.location}` : ""
          ].filter(Boolean) as string[]
        ),
        sourceChecks: [
          homepagePage
            ? `Checked company homepage for leadership/about/team/news links: ${homepagePage.url}`
            : company
              ? "Attempted company homepage discovery for leadership/about/team/news links."
              : "Company homepage discovery skipped because company was not provided.",
          ...companyPagesToCheck.map(
            (page) =>
              `Checked company-owned ${page.kind === "company-news" ? "news" : "leadership/about/team"} page: ${page.url}`
          ),
          company
            ? `Checked known public-profile directory pages for ${company}`
            : "Known public-profile directory lookup skipped because company was not provided.",
          company
            ? `Checked public-profile aggregators for exact name + company match: ${name} + ${company}`
            : "Public-profile aggregator lookup skipped because company was not provided."
        ],
        sources: unique([
          ...(homepagePage ? [homepagePage.url] : []),
          ...companyOwnedMatches.map((match) => match.sourceUrl),
          ...directoryMatches.map((match) => match.url),
          ...aggregatorMatches.map((match) => match.url)
        ])
      };
    })
  );
}
