import { type GitHubApp, GitHubError } from './app'

export type GitHubErrorCode = 'github_not_configured' | 'github_not_installed' | 'github_error'

/** Maps GitHub failures to API error codes the UI can translate. */
export function githubFailure(err: unknown): {
  error: GitHubErrorCode
  status: 400 | 502
  message: string
} {
  if (err instanceof GitHubError) {
    if (err.code === 'not_installed') {
      return { error: 'github_not_installed', status: 400, message: err.message }
    }
    return { error: 'github_error', status: 502, message: err.message }
  }
  throw err
}

export type RepoLink =
  | { ok: true; repoId: number; repoFullName: string; branch: string }
  | {
      ok: false
      error: GitHubErrorCode | 'repo_not_accessible' | 'branch_not_found'
      status: 400 | 502
    }

/**
 * Validates that the app can access `repoId` and that `branch` exists (the
 * repo's default branch when omitted), returning what to store on the site.
 */
export async function resolveRepoLink(
  github: GitHubApp | null,
  repoId: number,
  branch?: string,
): Promise<RepoLink> {
  if (!github) return { ok: false, error: 'github_not_configured', status: 400 }
  try {
    let repo = (await github.listRepositories()).find((r) => r.id === repoId)
    repo ??= (await github.listRepositories({ refresh: true })).find((r) => r.id === repoId)
    if (!repo) return { ok: false, error: 'repo_not_accessible', status: 400 }

    const target = branch ?? repo.defaultBranch
    try {
      await github.repo(repo.id).branchHead(repo.fullName, target)
    } catch (err) {
      if (err instanceof GitHubError && err.status === 404) {
        return { ok: false, error: 'branch_not_found', status: 400 }
      }
      throw err
    }
    return { ok: true, repoId: repo.id, repoFullName: repo.fullName, branch: target }
  } catch (err) {
    const failure = githubFailure(err)
    return { ok: false, error: failure.error, status: failure.status }
  }
}
