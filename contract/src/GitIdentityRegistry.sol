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
        bytes32 nonceHash; // keccak256(message)
        bytes sig; // Git key signature over: "[eth pubkey] [nonce]"
    }

    event GitKeyClaimed(address indexed claimant, GitKeyClaim claim);

    /// @notice Maps Git key fingerprint to Ethereum address that claimed it
    mapping(bytes32 => address) public fingerprintToAddress;

    /// @notice Claim a Git key by proving you own both Git key and ETH address
    function claimKey(GitKeyClaim memory claim) public {
        require(
            fingerprintToAddress[claim.fingerprint] == address(0),
            "Already claimed"
        );

        fingerprintToAddress[claim.fingerprint] = msg.sender;

        emit GitKeyClaimed(msg.sender, claim);
    }

    /// @notice Return the ETH address that claimed a Git fingerprint
    function getClaimant(bytes32 fingerprint) public view returns (address) {
        return fingerprintToAddress[fingerprint];
    }
}
