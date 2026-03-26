import {
  discoverLeadershipLookup,
  extractLeadershipLinks,
  extractLeadershipRoster,
  fetchPage,
  findLine,
  getCompanySiteProfile,
  lineAfter,
  unique
} from "./liveResearchUtils.js";

export interface CompanyResearchResult {
  company: string;
  summary: string[];
  signals: string[];
  leadership: string[];
  latestDevelopments?: string[];
  leadershipChanges?: string[];
  strategicSignals?: string[];
  keyConstraints?: string[];
  concentrationRisks?: string[];
  proofPoints?: string[];
  sourceChecks: string[];
  gaps: string[];
  sources: string[];
}

function collectMatches(lines: string[], patterns: RegExp[]): string[] {
  return unique(
    patterns
      .map((pattern) => findLine(lines, pattern))
      .filter(Boolean) as string[]
  );
}

function cleanSignals(items: string[]): string[] {
  return unique(
    items.filter(
      (item) =>
        item &&
        !/^(corporate governance|management|investor news|quarterly results)$/i.test(
          item
        ) &&
        !/^official-site signal extraction was limited/i.test(item) &&
        !/^no material portfolio change was extracted/i.test(item) &&
        !/^(chief|president|senior vice president|executive vice president|general counsel)\b/i.test(
          item
        )
    )
  );
}

export async function companyResearch(
  company: string
): Promise<CompanyResearchResult> {
  const profile = getCompanySiteProfile(company);
  const discovery = await discoverLeadershipLookup(company);
  const homepageUrl = profile?.homepageUrl ?? discovery.homepageUrl;
  const leadershipUrl =
    profile?.managementUrl ?? profile?.peopleUrl ?? discovery.leadershipPageUrl;
  const newsUrls = unique([...(profile?.newsUrls ?? []), ...(discovery.newsUrls ?? [])]);

  if (!homepageUrl) {
    return {
      company,
      summary: [
        `${company} homepage could not be discovered automatically.`,
        "Add the company URL in meeting notes or extend the generic lookup if needed."
      ],
      signals: ["No live company-site facts were collected."],
      leadership: [],
      latestDevelopments: [],
      leadershipChanges: [],
      strategicSignals: [],
      keyConstraints: [],
      concentrationRisks: [],
      proofPoints: [],
      sourceChecks: [
        "Official-site lookup could not find a reachable company homepage."
      ],
      gaps: [
        "Scale, revenue, strategic priorities, and brand portfolio still need live sources."
      ],
      sources: []
    };
  }

  const [homepage, visionPage, newsPages, mappedLeadershipPage] = await Promise.all([
    fetchPage(homepageUrl),
    profile?.visionUrl ? fetchPage(profile.visionUrl) : Promise.resolve(null),
    Promise.all(newsUrls.map((url) => fetchPage(url))),
    leadershipUrl ? fetchPage(leadershipUrl) : Promise.resolve(null)
  ]);
  const validNewsPages = newsPages.filter(Boolean);

  const discoveredLeadershipUrls =
    homepage ? extractLeadershipLinks(homepage.html, homepageUrl) : [];
  const leadershipCandidates = unique([
    mappedLeadershipPage?.url ?? "",
    ...discoveredLeadershipUrls
  ]);
  const leadershipPages = [
    ...(mappedLeadershipPage ? [mappedLeadershipPage] : []),
    ...(
      await Promise.all(
        leadershipCandidates
          .filter((url) => url !== mappedLeadershipPage?.url)
          .slice(0, 2)
          .map((url) => fetchPage(url))
      )
    ).filter(Boolean)
  ];

  const sources = unique(
    [
      homepage?.url,
      visionPage?.url,
      ...validNewsPages.map((page) => page?.url ?? ""),
      ...leadershipPages.map((page) => page?.url ?? "")
    ].filter(Boolean) as string[]
  );
  const summary = unique(
    [
      lineAfter(visionPage?.lines ?? [], "Built to bridge the gap between innovation and solutions."),
      ...validNewsPages.flatMap((page) =>
        collectMatches(page?.lines ?? [], [
          /focused on over-the-counter .* personal care products/i,
          /focused on building a market-leading portfolio/i,
          /consumer products|consumer health|revenue growth|portfolio/i
        ])
      )
    ].filter(Boolean) as string[]
  );
  const signals = unique(
    [
      findLine(
        homepage?.lines ?? [],
        /more than [0-9]+ million households/i
      ),
      findLine(
        homepage?.lines ?? [],
        /new products developed in less than 4 years/i
      ),
      findLine(
        homepage?.lines ?? [],
        /nearly half of our brands rank #1/i
      ),
      ...validNewsPages.flatMap((page) =>
        collectMatches(page?.lines ?? [], [
          /plans to expand our portfolio through additional acquisitions/i,
          /net sales|adjusted ebitda|gross margin|capacity/i,
          /retail locations|households|distribution/i
        ])
      )
    ].filter(Boolean) as string[]
  );
  const leadership = unique(
    leadershipPages.flatMap((page) => extractLeadershipRoster(page?.lines ?? []))
  );
  const newsLines = validNewsPages.flatMap((page) => page?.lines ?? []);
  const allLines = [
    ...(homepage?.lines ?? []),
    ...(visionPage?.lines ?? []),
    ...newsLines,
    ...leadershipPages.flatMap((page) => page?.lines ?? [])
  ];
  const latestDevelopments = cleanSignals(collectMatches(allLines, [
    /acquires|acquisition|appoints .* ceo|new ceo|capacity expansion|expansion/i,
    /manufacturing|engineering|new facility|new kitchen|innovation center/i,
    /investor relations|activist|board refresh|governance/i,
    /reports .* financial results|strengthens leadership team|strategic appointments/i
  ]));
  const leadershipChanges = cleanSignals(collectMatches(newsLines, [
    /appoints .* ceo/i,
    /succeeds /i,
    /joins as /i,
    /named .* chief/i,
    /strengthens leadership team|strategic appointments/i
  ]));
  const strategicSignals = cleanSignals(collectMatches(allLines, [
    /omnichannel|distribution expansion|scalable infrastructure|innovation/i,
    /portfolio|acquisitions|buy-and-build|category expansion/i,
    /food safety|quality assurance|manufacturing & engineering/i
  ]));
  const keyConstraints = cleanSignals(collectMatches(allLines, [
    /capacity|throughput|inventory|supply/i,
    /food safety|quality assurance|cold chain|manufacturing/i,
    /retailer|distribution|service/i
  ])).filter((item) => !/strengthens leadership team|reports .* financial results/i.test(item));
  const concentrationRisks = cleanSignals(collectMatches(allLines, [
    /major customer|customer concentration|concentration/i,
    /retailer|mass|grocery|pet specialty/i
  ]));
  const proofPoints = cleanSignals(collectMatches(allLines, [
    /more than [0-9]+ million households/i,
    /new products developed in less than [0-9]+ years/i,
    /nearly half of our brands rank #1/i,
    /[0-9]{2},?[0-9]{3}\+? retail locations/i
  ]));

  return {
    company,
    summary:
      summary.length > 0
        ? summary
        : [
            `${company} official site was checked, but a clean business summary was not extracted automatically.`
          ],
    signals:
      signals.length > 0
        ? signals
        : ["Official-site signal extraction was limited; review source pages directly."],
    leadership,
    latestDevelopments,
    leadershipChanges,
    strategicSignals,
    keyConstraints,
    concentrationRisks,
    proofPoints,
    sourceChecks: [
      `Checked homepage: ${homepageUrl}`,
      profile?.visionUrl ? `Checked vision page: ${profile.visionUrl}` : "",
      ...validNewsPages.map((page) => `Checked news / investor page: ${page?.url}`),
      ...leadershipPages.map((page) => `Checked leadership / management page: ${page?.url}`)
    ].filter(Boolean),
    gaps: [
      "Public revenue and company scale remain limited on the official site.",
      "Strategic priorities beyond official messaging may still need additional source checks.",
      leadership.length === 0
        ? "Leadership roster was not extracted automatically from the official site."
        : ""
    ].filter(Boolean),
    sources
  };
}
