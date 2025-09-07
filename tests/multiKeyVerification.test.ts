import { describe, test, expect } from "bun:test";
import { verifyCommitSignature } from "../src/utils/sshSignatureUtils";
import { KeyType } from "../src/clients/gitIdentityRegistry";

describe("Multi-Key Type Verification", () => {
    const mockGitMetadata = {
        signature: "-----BEGIN SSH SIGNATURE-----\nU1NIU0lHAAAAAQAAADMAAAALc3NoLWVkMjU1MTkAAAAgOk46AC0stT9fvYWS76eaYCGB5c\nYPN8Xux1hGLLFLtC0AAAADZ2l0AAAAAAAAAAZzaGE1MTIAAABTAAAAC3NzaC1lZDI1NTE5\nAAAAQPTt//j5UwhdriFOK+dt3a1wFXnHZMKsuBRfeb7iSvDaRjCXFXn5erxOs5dfBy8Ima\nSemrfZG3EBIJMZ6Lp9EwA=\n-----END SSH SIGNATURE-----",
        payload: "tree 28a760cd0799ad5bd92bbb4c189fc84726bd431e\nparent 41f6ba57da47dafe669efb3f918ea290e4f6ca29\nauthor thanhngoc541 <ngochc1@gmail.com> 1757063310 +0700\ncommitter thanhngoc541 <ngochc1@gmail.com> 1757063310 +0700\n\nAdd test command\n",
        verified: true
    };

    test("SSH Ed25519 verification", () => {
        const gitKeyClaim = {
            keyType: KeyType.SSHEd25519,
            fingerprint: "0xe49369c35cbe4d28532112f23af38ee79bea8b324b49677a229e6b6e126a6a1d" as `0x${string}`,
            nonceHash: "0x1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef" as `0x${string}`,
            sig: "0xfedcba0987654321fedcba0987654321fedcba0987654321fedcba0987654321" as `0x${string}`,
            publicKey: "AAAAC3NzaC1lZDI1NTE5AAAAIDpOOgAtLLU/X72Fku+nmmAhgeXGDzfF7sdYRiyxS7Qt"
        };

        const result = verifyCommitSignature(mockGitMetadata, gitKeyClaim);
        expect(result).toBe(true);
    });

    test("PGP verification (fallback to GitHub)", () => {
        const pgpGitMetadata = {
            signature: "-----BEGIN PGP SIGNATURE-----\nVersion: GnuPG v1\n\niQIcBAABCAAGBQJXYBSIAAoJEBLX...",
            payload: "tree 28a760cd0799ad5bd92bbb4c189fc84726bd431e\nparent 41f6ba57da47dafe669efb3f918ea290e4f6ca29\nauthor thanhngoc541 <ngochc1@gmail.com> 1757063310 +0700\ncommitter thanhngoc541 <ngochc1@gmail.com> 1757063310 +0700\n\nAdd test command\n",
            verified: true
        };

        const gitKeyClaim = {
            keyType: KeyType.PGPv4,
            fingerprint: "0x1234567890abcdef1234567890abcdef12345678" as `0x${string}`,
            nonceHash: "0x1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef" as `0x${string}`,
            sig: "0xfedcba0987654321fedcba0987654321fedcba0987654321fedcba0987654321" as `0x${string}`,
            publicKey: "mQINBFWMQw4BEADOqQQGY9gP..."
        };

        const result = verifyCommitSignature(pgpGitMetadata, gitKeyClaim);
        expect(result).toBe(true);
    });

    test("SSH Secp256k1 verification (fallback to GitHub)", () => {
        const gitKeyClaim = {
            keyType: KeyType.SSHSecp256k1,
            fingerprint: "0xabcdef1234567890abcdef1234567890abcdef12" as `0x${string}`,
            nonceHash: "0x1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef" as `0x${string}`,
            sig: "0xfedcba0987654321fedcba0987654321fedcba0987654321fedcba0987654321" as `0x${string}`,
            publicKey: "AAAAB3NzaC1yc2EAAAADAQABAAABAQC..."
        };

        const result = verifyCommitSignature(mockGitMetadata, gitKeyClaim);
        expect(result).toBe(true);
    });

    test("X509 verification (fallback to GitHub)", () => {
        const gitKeyClaim = {
            keyType: KeyType.X509,
            fingerprint: "0x567890abcdef1234567890abcdef1234567890ab" as `0x${string}`,
            nonceHash: "0x1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef" as `0x${string}`,
            sig: "0xfedcba0987654321fedcba0987654321fedcba0987654321fedcba0987654321" as `0x${string}`,
            publicKey: "MIIBIjANBgkqhkiG9w0BAQEFAAOCAQ8AMIIBCgK..."
        };

        const result = verifyCommitSignature(mockGitMetadata, gitKeyClaim);
        expect(result).toBe(true);
    });

    test("Unsupported key type", () => {
        const gitKeyClaim = {
            keyType: 999, // Unsupported type
            fingerprint: "0x567890abcdef1234567890abcdef1234567890ab" as `0x${string}`,
            nonceHash: "0x1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef" as `0x${string}`,
            sig: "0xfedcba0987654321fedcba0987654321fedcba0987654321fedcba0987654321" as `0x${string}`,
            publicKey: "invalid"
        };

        const result = verifyCommitSignature(mockGitMetadata, gitKeyClaim);
        expect(result).toBe(false);
    });
});
