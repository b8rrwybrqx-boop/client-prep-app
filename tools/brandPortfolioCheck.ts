import {
  extractImageAltNames,
  fetchPage,
  getCompanySiteProfile,
  unique
} from "./liveResearchUtils.js";

export interface BrandPortfolioResult {
  company: string;
  brands: string[];
  notes: string[];
  sourceChecks: string[];
  sources: string[];
}

export async function brandPortfolioCheck(
  company: string
): Promise<BrandPortfolioResult> {
  const profile = getCompanySiteProfile(company);

  if (!profile?.brandsUrl) {
    return {
      company,
      brands: ["Primary brand information pending"],
      notes: [
        `${company} brand and portfolio details are not mapped to an official brands page yet.`,
        "Add a brands URL in tools/liveResearchUtils.ts to enable live brand extraction."
      ],
      sourceChecks: ["Brands / portfolio page lookup skipped because no profile is configured."],
      sources: []
    };
  }

  const brandsPage = await fetchPage(profile.brandsUrl);
  const brands = brandsPage ? extractImageAltNames(brandsPage.html) : [];

  return {
    company,
    brands:
      brands.length > 0
        ? brands
        : ["Primary brand information pending"],
    notes:
      brands.length > 0
        ? [
            `${company} brands were pulled from the official portfolio page.`,
            `Extracted ${brands.length} brand names from the current site content.`
          ]
        : [
            `${company} brands page was checked, but brand extraction was incomplete.`,
            "Review the official brands page structure if additional parsing is needed."
          ],
    sourceChecks: [`Checked brands page: ${profile.brandsUrl}`],
    sources: unique([profile.brandsUrl])
  };
}
