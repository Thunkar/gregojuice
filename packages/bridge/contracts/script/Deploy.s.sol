// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Script} from "forge-std/Script.sol";
import {GregoJuiceBridge} from "../src/GregoJuiceBridge.sol";

contract DeployScript is Script {
    function run() external returns (GregoJuiceBridge) {
        vm.startBroadcast();
        GregoJuiceBridge bridge = new GregoJuiceBridge();
        vm.stopBroadcast();
        return bridge;
    }
}
