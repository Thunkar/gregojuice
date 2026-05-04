import { createNetworkContext } from "@aztec-kit/common/ui";
import { type NetworkConfig, getNetworks, getDefaultNetwork } from "../../config/networks";

const ctx = createNetworkContext<NetworkConfig>({
  storageKey: "goswap_network",
  getNetworks,
  getDefaultNetwork,
});

export const NetworkProvider = ctx.NetworkProvider;
export const useNetwork = ctx.useNetwork;
