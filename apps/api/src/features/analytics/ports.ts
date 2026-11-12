/** A period of site metrics; every figure is measured at the provider, or the whole is unavailable. */
export interface SiteStats {
  pageviews: number;
  visitors: number;
  visits: number;
  /** Share of visits that saw one page, 0 to 1; null when the provider does not say. */
  bounceRate: number | null;
  topPages: { path: string; views: number }[];
  topReferrers: { source: string; visits: number }[];
}

export interface Site {
  ref: string;
  name: string;
  domain: string | null;
}

/** Where a project's visits are counted (D-017). Takes the opened credential; keeps nothing. */
export interface SiteAnalytics {
  readonly id: string;
  listSites(credential: string): Promise<Site[]>;
  /** Creates the site and answers how to count it; null when the provider cannot create one. */
  createSite(
    credential: string,
    input: { name: string; domain: string },
  ): Promise<(Site & { script: string }) | null>;
  stats(credential: string, site: string, range: { from: Date; to: Date }): Promise<SiteStats>;
}
