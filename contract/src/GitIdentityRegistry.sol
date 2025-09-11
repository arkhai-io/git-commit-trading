// SPDX-License-Identifier: UNLICENSED
pragma solidity ^0.8.26;

contract GitIdentityRegistry {
    enum KeyType {
        PGPv4,
        SSHEd25519,
        SSHSecp256k1,
        X509
    }

    struct GitKeyClaim {
        KeyType keyType;
        bytes32 nonceHash; // keccak256(message): ensures unique claim
        bytes sig; // Signature: Git key signs "[eth pubkey] [nonce]"
        string publicKey; // Full GitHub public key (used to verify)
    }

    event GitKeyClaimed(address indexed claimant, GitKeyClaim claim);

    /// @notice Claim a Git key identity by proving ownership
    function claimKey(GitKeyClaim memory claim) external {
        require(bytes(claim.publicKey).length > 0, "Missing public key");

        // ⚠️ Signature verification would go here in a production system

        emit GitKeyClaimed(msg.sender, claim);
    }
}
