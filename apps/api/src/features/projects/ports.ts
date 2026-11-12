import type { DeploymentStatus, LinkStatus } from './domain/state.js';

/** Every port takes the opened credential of its connection; adapters never keep it. */

export interface Repository {
  fullName: string;
  name: string;
  defaultBranch: string;
  url: string;
  private: boolean;
  pushedAt: Date | null;
}

export interface CodeHost {
  readonly id: string;
  listRepositories(credential: string): Promise<Repository[]>;
  repository(credential: string, fullName: string): Promise<Repository | null>;
  /** Creates a repository in the person's own account, with its first files (phase 6). */
  createRepository(
    credential: string,
    input: { name: string; private: boolean; description: string; files: Record<string, string> },
  ): Promise<Repository>;
}

export interface HostedSite {
  ref: string;
  productionUrl: string | null;
  productionBranch: string | null;
  /** When the provider last deployed it, to choose between two sites of one repository. */
  updatedAt: Date | null;
}

export interface Deployment {
  externalId: string;
  environment: 'production' | 'preview';
  status: DeploymentStatus;
  url: string | null;
  commitSha: string | null;
  createdAt: Date;
}

export interface Hosting {
  readonly id: string;
  /** The site built from this repository, or null when none is. */
  findSite(credential: string, repository: Repository): Promise<HostedSite | null>;
  site(credential: string, ref: string): Promise<HostedSite | null>;
  deployments(credential: string, ref: string): Promise<Deployment[]>;
}

export interface Database {
  readonly id: string;
  /** The database project named like the repository, or null. */
  findProject(credential: string, name: string): Promise<{ ref: string } | null>;
}

export interface LinkChecker {
  check(url: string): Promise<LinkStatus>;
}

export interface WorkshopAdapters {
  codeHosts: CodeHost[];
  hostings: Hosting[];
  databases: Database[];
  links: LinkChecker;
}
