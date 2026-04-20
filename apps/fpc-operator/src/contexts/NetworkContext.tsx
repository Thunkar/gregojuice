import { createNetworkContext } from "@gregojuice/common/ui";
import { type NetworkConfig, getNetworks, getDefaultNetwork } from "../config/networks";

const ctx = createNetworkContext<NetworkConfig>({
  storageKey: "gregojuice_network",
  getNetworks,
  getDefaultNetwork,
});

export const NetworkProvider = ctx.NetworkProvider;
export const useNetwork = ctx.useNetwork;
