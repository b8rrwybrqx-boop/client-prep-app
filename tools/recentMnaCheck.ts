import {
  discoverLeadershipLookup,
  fetchPage,
  findLine,
  getCompanySiteProfile,
  unique
} from "./liveResearchUtils.js";

export interface RecentMnaResult {
  company: string;
  items: string[];
  notes: string[];
  sourceChecks: string[];
  sources: string[];
}

export async function recentMnaCheck(company: string): Promise<RecentMnaResult> {
  const profile = getCompanySiteProfile(company);
  const discovery = await discoverLeadershipLookup(company);
  const newsUrls = unique([...(profile?.newsUrls ?? []), ...(discovery.newsUrls ?? [])]);

  // Keep this lightweight for now:
  // future live checks should cover acquisitions, divestitures, portfolio simplification,
  // restructuring programs, and governance / activist signals rather than only classic M&A.
  if (!newsUrls.length) {
    return {
      company,
      items: [],
      notes: [
        `No investor/news URLs were discovered automatically for ${company}.`,
        "Add a news or investor URL if you want more deterministic development and M&A capture."
      ],
      sourceChecks: ["Press release / investor lookup did not find a usable news page automatically."],
      sources: []
    };
  }

  const pages = await Promise.all(newsUrls.map((url) => fetchPage(url)));
  const validPages = pages.filter(Boolean);
  const items = unique(
    validPages.flatMap((page) => {
      const lines = page?.lines ?? [];
      const acquisition = findLine(
        lines,
        /acquires |acquisition of |acquired |divest|ownership change|portfolio|brand sale|portfolio simplification|spin/i
      );
      const ceoChange = findLine(
        lines,
        /appoints .* ceo|new ceo|succeeds .* ceo|named .* chief/i
      );

      return [acquisition, ceoChange].filter(Boolean) as string[];
    })
  );

  const notes = unique(
    validPages.flatMap((page) => {
      const lines = page?.lines ?? [];

      return [
        findLine(lines, /fourth acquisition since .* inception/i),
        findLine(lines, /plans to expand .* through additional acquisitions/i),
        findLine(lines, /succeeds /i),
        findLine(lines, /capacity|investment|expansion|board refresh|activist|restructur|simplification|turnaround|transformation/i)
      ].filter(Boolean) as string[];
    })
  );

  return {
    company,
    items,
    notes:
      notes.length > 0
        ? notes
        : ["No material portfolio change was extracted from the discovered official news pages."],
    sourceChecks: newsUrls.map((url) => `Checked news source: ${url}`),
    sources: unique(newsUrls)
  };
}
