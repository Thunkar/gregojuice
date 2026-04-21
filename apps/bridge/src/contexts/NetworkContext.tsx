import { createNetworkContext } from "@gregojuice/common/ui";
import { type NetworkConfig, getNetworks, getDefaultNetwork } from "../config/networks";
import { NETWORK_STORAGE_KEY } from "../components/wizard/constants";

const ctx = createNetworkContext<NetworkConfig>({
  storageKey: NETWORK_STORAGE_KEY,
  getNetworks,
  getDefaultNetwork,
});

export const NetworkProvider = ctx.NetworkProvider;
export const useNetwork = ctx.useNetwork;
