import type { ChangedFile } from '../releases/guards.js';
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
  /** Open proposals (pull requests) towards the default branch (phase 5). */
  listProposals(credential: string, fullName: string, base: string): Promise<Proposal[]>;
  proposalFiles(credential: string, fullName: string, number: number): Promise<ChangedFile[]>;
  /** A file at a commit, or null when it does not exist. */
  fileAt(credential: string, fullName: string, path: string, ref: string): Promise<string | null>;
  /** The `pono/release` status on a commit: the code host blocks the merge on it. */
  setReleaseStatus(
    credential: string,
    fullName: string,
    sha: string,
    state: 'success' | 'failure' | 'pending',
    description: string,
  ): Promise<void>;
  /** Merges exactly this commit; refuses when the head moved. */
  merge(credential: string, fullName: string, number: number, sha: string): Promise<void>;
  /** Requires `pono/release` on the production branch, admins included. */
  protect(
    credential: string,
    fullName: string,
    branch: string,
  ): Promise<'protected' | 'unavailable_on_plan'>;
}

export interface Proposal {
  number: number;
  title: string;
  headSha: string;
  branch: string;
  url: string;
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
  /** Puts the previous production deployment back online (phase 5). */
  rollback(credential: string, ref: string): Promise<void>;
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
