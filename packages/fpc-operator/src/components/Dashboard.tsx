import { useState } from "react";
import { Box, Tabs, Tab } from "@mui/material";
import type { AztecAddress } from "@aztec/aztec.js/addresses";
import type { SubscriptionFPCContract } from "@gregojuice/contracts/artifacts/SubscriptionFPC";
import { AppSignUp } from "./AppSignUp";
import { AppList } from "./AppList";
import { BridgeFunding } from "./BridgeFunding";
import { useNetwork } from "../contexts/NetworkContext";

interface DashboardProps {
  fpc: SubscriptionFPCContract;
  adminAddress: AztecAddress;
  fpcAddress: string;
}

export function Dashboard({ fpc, adminAddress, fpcAddress }: DashboardProps) {
  const { activeNetwork } = useNetwork();
  const [tab, setTab] = useState(0);
  const [listKey, setListKey] = useState(0);
  const bridgeUrl = import.meta.env.VITE_BRIDGE_URL ?? "http://localhost:5173";

  return (
    <Box>
      <Tabs
        value={tab}
        onChange={(_, v) => setTab(v)}
        sx={{ mb: 3, borderBottom: 1, borderColor: "divider" }}
      >
        <Tab label="Sign Up App" />
        <Tab label="Registered Apps" />
        <Tab label="Fund FPC" />
      </Tabs>

      {tab === 0 && (
        <AppSignUp
          fpc={fpc}
          adminAddress={adminAddress}
          fpcAddress={fpcAddress}
          onSignedUp={() => setListKey((k) => k + 1)}
        />
      )}
      {tab === 1 && <AppList key={listKey} fpc={fpc} fpcAddress={fpcAddress} />}
      {tab === 2 && (
        <BridgeFunding
          recipient={fpcAddress}
          networkId={activeNetwork.id}
          bridgeUrl={bridgeUrl}
        />
      )}
    </Box>
  );
}
