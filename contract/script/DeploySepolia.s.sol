// SPDX-License-Identifier: UNLICENSED
pragma solidity ^0.8.26;

import {Script, console} from "forge-std/Script.sol";
import {GitIdentityRegistry} from "../src/GitIdentityRegistry.sol";
import {CommitObligation} from "../src/obligations/CommitObligation.sol";
import {IEAS} from "@eas/IEAS.sol";
import {ISchemaRegistry} from "@eas/ISchemaRegistry.sol";

contract DeployBaseSepoliaScript is Script {
    // Base Sepolia EAS contract addresses
    address constant BASE_SEPOLIA_EAS = 0x4200000000000000000000000000000000000021;
    address constant BASE_SEPOLIA_SCHEMA_REGISTRY = 0x4200000000000000000000000000000000000020;

    function run() external {
        // Read private key as string first, then convert to uint256
        string memory privateKeyStr = vm.envString("PRIVATE_KEY");
        uint256 deployerPrivateKey;
        
        // Handle both formats: with or without 0x prefix
        if (bytes(privateKeyStr).length == 66 && 
            bytes(privateKeyStr)[0] == '0' && 
            bytes(privateKeyStr)[1] == 'x') {
            // Has 0x prefix, use vm.envUint
            deployerPrivateKey = vm.envUint("PRIVATE_KEY");
        } else {
            // No 0x prefix, add it and parse
            string memory prefixedKey = string.concat("0x", privateKeyStr);
            deployerPrivateKey = vm.parseUint(prefixedKey);
        }
        
        address deployer = vm.addr(deployerPrivateKey);
        
        console.log("Deploying contracts to Base Sepolia...");
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
            IEAS(BASE_SEPOLIA_EAS),
            ISchemaRegistry(BASE_SEPOLIA_SCHEMA_REGISTRY)
        );
        console.log("CommitObligation deployed at:", address(commitObligation));

        vm.stopBroadcast();

        // Save deployment info
        string memory deploymentInfo = string.concat(
            "Deployment completed on Base Sepolia:\n",
            "GitIdentityRegistry: ", vm.toString(address(gitRegistry)), "\n",
            "CommitObligation: ", vm.toString(address(commitObligation)), "\n",
            "Deployer: ", vm.toString(deployer), "\n",
            "Block: ", vm.toString(block.number)
        );
        
        console.log(deploymentInfo);
        
        // Write deployment addresses to file
        // Note: If this fails due to permissions, the deploy.sh script will handle it
        vm.writeFile(
            "./deployments/base-sepolia.json",
            string.concat(
                "{\n",
                '  "gitIdentityRegistry": "', vm.toString(address(gitRegistry)), '",\n',
                '  "commitObligation": "', vm.toString(address(commitObligation)), '",\n',
                '  "deployer": "', vm.toString(deployer), '",\n',
                '  "blockNumber": ', vm.toString(block.number), ',\n',
                '  "timestamp": ', vm.toString(block.timestamp), ',\n',
                '  "easRegistry": "', vm.toString(BASE_SEPOLIA_EAS), '",\n',
                '  "schemaRegistry": "', vm.toString(BASE_SEPOLIA_SCHEMA_REGISTRY), '",\n',
                '  "network": "base-sepolia",\n',
                '  "chainId": 84532\n',
                "}"
            )
        );
        
        console.log("Deployment info saved to ./deployments/base-sepolia.json");
    }
}