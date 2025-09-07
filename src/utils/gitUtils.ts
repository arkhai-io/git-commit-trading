export interface GitHubCommitSignature {
    signature: string;
    payload: string;
    reason: string;
    verified: boolean;
}

interface GitHubCommitResponse {
    commit: {
        verification?: {
            verified: boolean;
            reason: string;
            signature: string;
            payload: string;
        }
    }
}

export async function getSigningKeyFromGitHubCommit(
    repoUrl: string,
    commitSha: string,
    githubToken?: string // optional for private repos
): Promise<GitHubCommitSignature> {
    const match = repoUrl.match(/github\.com\/([^\/]+)\/([^\/]+?)(?:\.git)?$/);

    if (!match) {
        throw new Error(`Invalid GitHub repo URL: ${repoUrl}`);
    }

    const [, owner, repo] = match;
    const apiUrl = `https://api.github.com/repos/${owner}/${repo}/commits/${commitSha}`;

    const headers: Record<string, string> = {
        Accept: "application/vnd.github+json",
        "User-Agent": "git-sig-checker",
    };

    if (githubToken) {
        headers["Authorization"] = `Bearer ${githubToken}`;
    }

    const res = await fetch(apiUrl, { headers });

    if (!res.ok) {
        const body = await res.text();
        throw new Error(`GitHub API error: ${res.status} ${res.statusText}\n${body}`);
    }

    const data = await res.json() as GitHubCommitResponse;
    if (!data.commit.verification) {
        throw new Error("Commit has no verification data");
    }

    const { verified, signature, payload, reason } = data.commit.verification;

    if (!verified || !signature || !payload) {
        throw new Error(`Commit is not fully signed or verified (reason: ${reason})`);
    }

    return {
        signature,
        payload,
        reason,
        verified
    };
}
