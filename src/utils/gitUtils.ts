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




/**
 * Extract just the base64 key material from SSH public key
 * @param sshPublicKey - The full SSH public key string
 * @returns Just the base64-encoded key material (without algorithm prefix or comment)
 */
export function extractSSHKeyMaterial(sshPublicKey: string): string {
    const parts = sshPublicKey.trim().split(' ');
    if (parts.length < 2) {
        throw new Error('Invalid SSH public key format');
    }

    const base64Key = parts[1];

    if (!base64Key) {
        throw new Error('Invalid SSH public key format - missing key data');
    }

    return base64Key;
}

