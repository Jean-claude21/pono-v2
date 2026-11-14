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
  /**
   * Creates a repository in the person's own account, with its first files (phase 6); generated
   * from a starter template repository when one is named (D-016).
   */
  createRepository(
    credential: string,
    input: {
      name: string;
      private: boolean;
      description: string;
      files: Record<string, string>;
      starter?: string;
    },
  ): Promise<Repository>;
  /** The file names of a folder at a ref; empty when the folder does not exist. */
  listDirectory(credential: string, fullName: string, path: string, ref: string): Promise<string[]>;
  /**
   * How a server reaches the repository with git, for one command at a time (D-020): its address
   * and an HTTP header to pass with `git -c http.extraHeader=…`. Never written into a git config.
   */
  gitAccess(credential: string, fullName: string): { url: string; header: string };
  /**
   * Lets a host read the repository (D-037): a read-only deploy key, and a push hook that starts its
   * builds. Absent when the code host cannot; a missing permission throws a 403 ProviderError.
   */
  grantReadKey?(
    credential: string,
    fullName: string,
    title: string,
    publicKey: string,
  ): Promise<void>;
  addPushHook?(credential: string, fullName: string, url: string): Promise<void>;
  /** The repository's address for git over SSH, as a host clones it with a deploy key. */
  sshUrl?(fullName: string): string;
  /** Lets the repository serve as a starter that other repositories are generated from. */
  markAsTemplate(credential: string, fullName: string): Promise<void>;
  /** Open proposals (pull requests) towards the default branch (phase 5). */
  listProposals(credential: string, fullName: string, base: string): Promise<Proposal[]>;
  proposalFiles(credential: string, fullName: string, number: number): Promise<ChangedFile[]>;
  /** A file at a commit, or null when it does not exist. */
  fileAt(credential: string, fullName: string, path: string, ref: string): Promise<string | null>;
  /**
   * Proposes files in a pull request from `branch` (created from `base`, or updated when it exists).
   * Answers the open pull request: the person merges it, Pono never writes the base branch.
   */
  proposeFiles(
    credential: string,
    fullName: string,
    input: {
      base: string;
      branch: string;
      title: string;
      body: string;
      files: Record<string, string>;
    },
  ): Promise<{ number: number; url: string }>;
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
  /**
   * Creates the site that builds this repository (D-037), in three steps the application chains
   * with the code host: a deploy key, the site linked to the repository, its first build.
   */
  newDeployKey?(credential: string): Promise<{ id: string; publicKey: string }>;
  createSite?(
    credential: string,
    input: { name: string; gitUrl: string; branch: string; deployKeyId: string },
  ): Promise<{ site: HostedSite; pushHookUrl: string | null }>;
  startBuild?(credential: string, ref: string): Promise<void>;
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
