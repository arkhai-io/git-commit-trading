// SPDX-License-Identifier: UNLICENSED
pragma solidity ^0.8.26;

import {Script, console} from "forge-std/Script.sol";
import {GitIdentityRegistry} from "../src/GitIdentityRegistry.sol";
import {CommitObligation} from "../src/obligations/CommitObligation.sol";
import {IEAS} from "@eas/IEAS.sol";
import {ISchemaRegistry} from "@eas/ISchemaRegistry.sol";

contract DeployEthSepoliaScript is Script {
    // Ethereum Sepolia EAS contract addresses
    address constant SEPOLIA_EAS = 0xC2679fBD37d54388Ce493F1DB75320D236e1815e;
    address constant SEPOLIA_SCHEMA_REGISTRY = 0x0a7E2Ff54e76B8E6659aedc9103FB21c038050D0;

    function run() external {
        string memory privateKeyStr = vm.envString("PRIVATE_KEY");
        uint256 deployerPrivateKey;

        if (bytes(privateKeyStr).length == 66 &&
            bytes(privateKeyStr)[0] == '0' &&
            bytes(privateKeyStr)[1] == 'x') {
            deployerPrivateKey = vm.envUint("PRIVATE_KEY");
        } else {
            string memory prefixedKey = string.concat("0x", privateKeyStr);
            deployerPrivateKey = vm.parseUint(prefixedKey);
        }

        address deployer = vm.addr(deployerPrivateKey);

        console.log("Deploying contracts to Ethereum Sepolia...");
        console.log("Deployer address:", deployer);
        console.log("Deployer balance:", deployer.balance);

        vm.startBroadcast(deployerPrivateKey);

        // Deploy GitIdentityRegistry
        console.log("Deploying GitIdentityRegistry...");
        GitIdentityRegistry gitRegistry = new GitIdentityRegistry();
        console.log("GitIdentityRegistry deployed at:", address(gitRegistry));

        // Deploy CommitObligation
        console.log("Deploying CommitObligation...");
        CommitObligation commitObligation = new CommitObligation(
            IEAS(SEPOLIA_EAS),
            ISchemaRegistry(SEPOLIA_SCHEMA_REGISTRY)
        );
        console.log("CommitObligation deployed at:", address(commitObligation));

        vm.stopBroadcast();

        string memory deploymentInfo = string.concat(
            "Deployment completed on Ethereum Sepolia:\n",
            "GitIdentityRegistry: ", vm.toString(address(gitRegistry)), "\n",
            "CommitObligation: ", vm.toString(address(commitObligation)), "\n",
            "Deployer: ", vm.toString(deployer), "\n",
            "Block: ", vm.toString(block.number)
        );

        console.log(deploymentInfo);

        vm.writeFile(
            "./deployments/sepolia.json",
            string.concat(
                "{\n",
                '  "gitIdentityRegistry": "', vm.toString(address(gitRegistry)), '",\n',
                '  "commitObligation": "', vm.toString(address(commitObligation)), '",\n',
                '  "deployer": "', vm.toString(deployer), '",\n',
                '  "blockNumber": ', vm.toString(block.number), ',\n',
                '  "timestamp": ', vm.toString(block.timestamp), ',\n',
                '  "easRegistry": "', vm.toString(SEPOLIA_EAS), '",\n',
                '  "schemaRegistry": "', vm.toString(SEPOLIA_SCHEMA_REGISTRY), '",\n',
                '  "network": "sepolia",\n',
                '  "chainId": 11155111\n',
                "}"
            )
        );

        console.log("Deployment info saved to ./deployments/sepolia.json");
    }
}
