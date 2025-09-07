// SPDX-License-Identifier: UNLICENSED
pragma solidity ^0.8.26;

import {Attestation} from "@eas/Common.sol";
import {IEAS, AttestationRequest, AttestationRequestData} from "@eas/IEAS.sol";
import {ISchemaRegistry} from "@eas/ISchemaRegistry.sol";
import {BaseObligation} from "alkahest-mocks/BaseObligationNew.sol";

contract CommitObligation is BaseObligation {
    enum CommitAlgo {
        Sha1,
        Sha256
    }

    struct ObligationData {
        string commitHash;
        CommitAlgo commitAlgo;
        string[] hosts; // optional if communicated out of band
        address sender; // automatically filled with msg.sender
    }

    // Input struct for doObligation function (without sender)
    struct ObligationInput {
        string commitHash;
        CommitAlgo commitAlgo;
        string[] hosts;
    }

    constructor(
        IEAS _eas,
        ISchemaRegistry _schemaRegistry
    )
        BaseObligation(
            _eas,
            _schemaRegistry,
            "string commitHash,uint8 commitAlgo,string[] hosts,address sender",
            true
        )
    {}

    function doObligation(
        ObligationInput calldata data,
        bytes32 refUID
    ) public returns (bytes32 uid_) {
        // Create a new ObligationData with the sender automatically filled
        ObligationData memory dataWithSender = ObligationData({
            commitHash: data.commitHash,
            commitAlgo: data.commitAlgo,
            hosts: data.hosts,
            sender: msg.sender
        });

        bytes memory encodedData = abi.encode(dataWithSender);
        uid_ = this.doObligationForRaw(
            encodedData,
            0,
            msg.sender,
            msg.sender,
            refUID
        );
    }

    function getObligationData(
        bytes32 uid
    ) public view returns (ObligationData memory) {
        Attestation memory attestation = _getAttestation(uid);
        return abi.decode(attestation.data, (ObligationData));
    }

    function decodeObligationData(
        bytes calldata data
    ) public pure returns (ObligationData memory) {
        return abi.decode(data, (ObligationData));
    }
}
