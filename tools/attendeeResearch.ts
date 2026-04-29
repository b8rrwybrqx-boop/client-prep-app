import {
  discoverLeadershipLookup,
  fetchPage,
  getCompanySiteProfile,
  searchCompanyDirectoryProfiles,
  searchPublicProfileAggregators,
  searchPublicWebMentions,
  unique
} from "./liveResearchUtils.js";
import { searchWithOpenAiWeb } from "../app/api/openaiClient.js";

const IS_VERCEL = process.env.VERCEL === "1";

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
  secondarySignals?: string[];
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

function isLikelyStandalonePersonLine(line: string): boolean {
  return /^[A-Z][a-z.'-]+(?:\s+[A-Z][a-z.'-]+){1,3}$/.test(line.trim());
}

function includesAnotherPersonName(line: string, attendeeName: string): boolean {
  const normalizedAttendee = normalizeName(attendeeName);
  const normalizedLine = normalizeName(line);

  if (normalizedLine.includes(normalizedAttendee)) {
    return false;
  }

  return /\b[A-Z][a-z.'-]+\s+[A-Z][a-z.'-]+\b/.test(line);
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

function normalizeSignalForDedup(signal: string): string {
  return signal
    .toLowerCase()
    .replace(/\s+/g, " ")
    .replace(/[^\w\s]/g, "")
    .trim();
}

function dedupNearDuplicateSignals(signals: string[]): string[] {
  const result: string[] = [];
  const fingerprints: string[] = [];

  for (const signal of signals) {
    const normalized = normalizeSignalForDedup(signal);

    if (!normalized) {
      continue;
    }

    const prefix = normalized.slice(0, 80);
    const isDuplicate = fingerprints.some(
      (existing) =>
        existing === normalized ||
        existing.startsWith(prefix) ||
        normalized.startsWith(existing.slice(0, 80))
    );

    if (isDuplicate) {
      continue;
    }

    fingerprints.push(normalized);
    result.push(signal);
  }

  return result;
}

function summarizeSecondarySignals(matches: Array<{
  source: string;
  title?: string;
  background?: string;
  location?: string;
}>): string[] {
  const formatted = matches
    .map((match) => {
      const parts = Array.from(
        new Set(
          [match.title, match.background, match.location].filter(
            (value): value is string => Boolean(value)
          )
        )
      );

      if (parts.length === 0) {
        return "";
      }

      return `${match.source}: ${parts.join("; ")}`;
    })
    .filter(Boolean);

  return dedupNearDuplicateSignals(unique(formatted)).slice(0, 4);
}

interface OpenAiAttendeeSearchResult {
  matches: Array<{
    source: string;
    url: string;
    title?: string;
    background?: string;
    location?: string;
  }>;
  citations: Array<{ url: string; title?: string }>;
}

async function searchAttendeeWithOpenAiWeb(
  name: string,
  company: string,
  refinement?: { title?: string }
): Promise<OpenAiAttendeeSearchResult> {
  try {
    const promptLines = refinement?.title
      ? [
          `Find recent public information about "${name}", ${refinement.title} at "${company}".`,
          "Prefer the last 24 months: quotes in articles, conference talks, podcast appearances, press releases, notable initiatives, or strategic priorities they have spoken to.",
          "Return up to two concise bullets summarizing distinct signals.",
          "Format:",
          "1. [signal summary]",
          "2. [signal summary]"
        ]
      : [
          `Find public indexed information for attendee "${name}" at company "${company}".`,
          "Return up to two likely traces with current or recent title/function if available.",
          "If titles conflict, include both and say current title is unconfirmed.",
          "Focus on marketing, brand, innovation, sales, commercial, finance, operations, or leadership clues.",
          "Format:",
          "1. [source summary]",
          "2. [source summary]"
        ];

    const { outputText, citations } = await searchWithOpenAiWeb(promptLines.join("\n"));

    const lines = outputText
      .split(/\r?\n/)
      .map((line) => line.replace(/^\d+\.\s*/, "").trim())
      .filter(Boolean)
      .slice(0, 2);

    const matches = lines.map((line, index) => {
      const citation = citations[index];
      const source = citation?.url
        ? new URL(citation.url).hostname.replace(/^www\./, "")
        : "web";

      return {
        source,
        url: citation?.url ?? `https://${source}`,
        title: line,
        background: line
      };
    });

    return { matches, citations };
  } catch {
    return { matches: [], citations: [] };
  }
}

function extractLinkedinUrls(
  citations: Array<{ url: string; title?: string }>
): string[] {
  return unique(
    citations
      .map((citation) => citation.url)
      .filter((url) => /linkedin\.com\/(in|pub|company)/i.test(url))
  );
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
  const exactStart = normalizedLines.findIndex((line) => line === normalizedAttendee);
  let start = exactStart;

  if (start < 0) {
    start = normalizedLines.findIndex((line) => line.includes(normalizedAttendee));
  }

  let confidence: Confidence = exactStart >= 0 ? "high" : "medium";
  let exactMatch = start >= 0;

  if (start < 0 && normalizedLastName) {
    start = normalizedLines.findIndex(
      (line) =>
        line.includes(normalizedLastName) &&
        /(chief|president|vice president|vp|director|manager|officer|commercial|marketing|sales|finance|operations)/i.test(
          line
        )
    );
    confidence = "medium";
    exactMatch = false;
  }

  if (start < 0) {
    return null;
  }

  const rawWindow = lines.slice(start, start + 8);
  const boundedWindow: string[] = [];

  for (const [index, line] of rawWindow.entries()) {
    if (
      index > 0 &&
      isLikelyStandalonePersonLine(line) &&
      normalizeName(line) !== normalizedAttendee
    ) {
      break;
    }

    boundedWindow.push(line);
  }

  if (!exactMatch) {
    return {
      title: null,
      role: null,
      background: null,
      sourceType: pageKind,
      confidence,
      note:
        pageKind === "company-news"
          ? "Attendee last name appeared on a company-owned news page, but a direct identity match was not verified."
          : "Attendee last name appeared on a company-owned leadership/team page, but a direct identity match was not verified.",
      sourceUrl: pageUrl
    };
  }

  const title =
    boundedWindow
      .slice(1)
      .find((line) =>
      /(chief|president|vice president|vp|director|manager|officer|commercial|marketing|sales|finance|operations)/i.test(
        line
      )
      ) ?? null;
  const background =
    boundedWindow
      .filter(
        (line) =>
          line !== title &&
          normalizeName(line) !== normalizedAttendee &&
          !includesAnotherPersonName(line, attendeeName) &&
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
  }).slice(0, IS_VERCEL ? 6 : 10);

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

      // Phase 2: OpenAI web search promoted to primary lookup when no direct company match.
      const primaryOpenAi =
        company && !directCompanyMatch
          ? await searchAttendeeWithOpenAiWeb(name, company)
          : { matches: [], citations: [] };

      // Phase 3: title-aware enrichment pass — runs whenever we have any title to refine on.
      const firstPassTitle =
        directCompanyMatch?.title ?? primaryOpenAi.matches[0]?.title ?? null;
      const titleEnrichedOpenAi =
        company && firstPassTitle
          ? await searchAttendeeWithOpenAiWeb(name, company, { title: firstPassTitle })
          : { matches: [], citations: [] };

      // Phase 4: legacy aggregators only as last-resort fallback.
      const haveAnyMatch = Boolean(directCompanyMatch) || primaryOpenAi.matches.length > 0;
      const directoryMatches =
        company && !haveAnyMatch
          ? await searchCompanyDirectoryProfiles(name, company)
          : [];
      const aggregatorMatches =
        company && !haveAnyMatch
          ? await searchPublicProfileAggregators(name, company)
          : [];
      const webMentionMatches =
        company && !haveAnyMatch
          ? await searchPublicWebMentions(name, company)
          : [];

      const secondaryMatch =
        primaryOpenAi.matches[0] ??
        directoryMatches[0] ??
        aggregatorMatches[0] ??
        webMentionMatches[0] ??
        null;
      const secondarySignals = summarizeSecondarySignals([
        ...primaryOpenAi.matches,
        ...titleEnrichedOpenAi.matches,
        ...directoryMatches,
        ...aggregatorMatches,
        ...webMentionMatches
      ]);
      const hasSecondaryEvidence = secondarySignals.length > 0;
      const linkedinUrls = extractLinkedinUrls([
        ...primaryOpenAi.citations,
        ...titleEnrichedOpenAi.citations
      ]);
      const allOpenAiCitations = unique(
        [...primaryOpenAi.citations, ...titleEnrichedOpenAi.citations].map(
          (citation) => citation.url
        )
      );

      const sourceType: SourceType = directCompanyMatch
        ? directCompanyMatch.sourceType
        : secondaryMatch || hasSecondaryEvidence
          ? "secondary-profile"
          : "not-found";
      const verificationLevel = directCompanyMatch
        ? "company-site"
        : secondaryMatch || hasSecondaryEvidence
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
          : hasSecondaryEvidence
            ? "low"
          : "low";
      const note =
        directCompanyMatch?.note ??
        (secondaryMatch
          ? `Company-owned pages did not surface a direct match; publicly indexed secondary sources suggest a likely attendee/company match.`
          : hasSecondaryEvidence
            ? "Company-owned pages did not surface a direct match; weaker public-profile evidence suggests a possible attendee/company connection."
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
        secondarySignals,
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
            ...secondarySignals,
            ...linkedinUrls.map((url) => `LinkedIn: ${url}`),
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
          company && !directCompanyMatch
            ? `Ran OpenAI web search as primary attendee lookup: ${name} + ${company}`
            : company
              ? "Skipped primary OpenAI web search because company-owned pages already verified the attendee."
              : "OpenAI web search skipped because company was not provided.",
          firstPassTitle
            ? `Ran title-aware OpenAI web search for enrichment: ${name} + ${firstPassTitle} + ${company ?? ""}`
            : "Skipped title-aware OpenAI enrichment because no first-pass title was available.",
          haveAnyMatch
            ? "Skipped legacy directory/aggregator/web-mention fallbacks because primary lookup succeeded."
            : company
              ? `Ran legacy directory/aggregator/web-mention fallbacks for ${name} + ${company}`
              : "Legacy directory/aggregator/web-mention fallbacks skipped because company was not provided."
        ],
        sources: unique([
          ...(homepagePage ? [homepagePage.url] : []),
          ...companyOwnedMatches.map((match) => match.sourceUrl),
          ...primaryOpenAi.matches.map((match) => match.url),
          ...titleEnrichedOpenAi.matches.map((match) => match.url),
          ...allOpenAiCitations,
          ...linkedinUrls,
          ...directoryMatches.map((match) => match.url),
          ...aggregatorMatches.map((match) => match.url),
          ...webMentionMatches.map((match) => match.url)
        ])
      };
    })
  );
}
