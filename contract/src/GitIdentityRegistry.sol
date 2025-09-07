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
        bytes32 fingerprint;
        bytes32 nonceHash; // keccak256(message): ensures unique claim
        bytes sig; // Signature: Git key signs "[eth pubkey] [nonce]"
        string publicKey; // Full GitHub public key (used to verify)
    }

    event GitKeyClaimed(
        address indexed claimant,
        bytes32 indexed fingerprint,
        GitKeyClaim claim
    );

    /// @notice Maps Ethereum address to their claimed Git key
    mapping(address => GitKeyClaim) public addressToKeyClaim;

    /// @notice Claim a Git key identity by proving ownership
    function claimKey(GitKeyClaim memory claim) external {
        require(claim.fingerprint != bytes32(0), "Invalid fingerprint");
        require(bytes(claim.publicKey).length > 0, "Missing public key");
        require(
            bytes(addressToKeyClaim[msg.sender].publicKey).length == 0,
            "Address already has a claimed key"
        );

        // ⚠️ Signature verification would go here in a production system

        addressToKeyClaim[msg.sender] = claim;

        emit GitKeyClaimed(msg.sender, claim.fingerprint, claim);
    }

    /// @notice Get the full Git key claim for an address
    function getKeyClaim(
        address addr
    ) external view returns (GitKeyClaim memory) {
        return addressToKeyClaim[addr];
    }
}
