/**
 * Plain async function for the bridge action.
 * Extracted from useBridgeWizard to keep the hook focused on state.
 */

import { formatUnits, parseUnits, type Hex } from "viem";
import {
  bridgeFeeJuice,
  bridgeMultiple,
  type L1Addresses,
} from "../../services";
import type { AztecAddress } from "@aztec/stdlib/aztec-address";
import { EPHEMERAL_CLAIM_GAS_FJ } from "./constants";
import type { BridgeStep, BridgeAction, RecipientChoice } from "./types";

interface HandleBridgeParams {
  account: Hex;
  l1Addresses: L1Addresses & { l1ChainId: number };
  recipients: Array<{ address: string; amount: string }>;
  recipientChoice: RecipientChoice;
  balance: { balance: bigint; formatted: string; decimals: number } | null;
  faucetLocked: boolean;
  needsMultiBridge: boolean;
  aztecAddress: AztecAddress | null;
  mintAmountValue: bigint | null;
  activeNetwork: { l1RpcUrl: string };
  onStep: (step: BridgeStep, label?: string) => void;
  dispatch: (action: BridgeAction) => void;
  setError: (error: string | null) => void;
  refreshBalance: () => Promise<void>;
}

export async function handleBridge(params: HandleBridgeParams): Promise<void> {
  const {
    l1Addresses,
    recipients,
    recipientChoice,
    balance,
    faucetLocked,
    needsMultiBridge,
    aztecAddress,
    mintAmountValue,
    activeNetwork,
    onStep,
    dispatch,
    setError,
    refreshBalance,
  } = params;

  setError(null);

  try {
    if (!recipients.every((r) => r.address.length >= 10)) {
      setError("Invalid recipient address");
      return;
    }
    if (!recipients.every((r) => r.amount)) {
      setError("Please enter an amount for each recipient");
      return;
    }

    const parsedRecipients = recipients.map((r) => ({
      address: r.address,
      amount: parseUnits(r.amount, balance?.decimals ?? 18),
    }));

    if (parsedRecipients.some((r) => r.amount <= 0n)) {
      setError("Amounts must be greater than 0");
      return;
    }

    const totalAmount = parsedRecipients.reduce((sum, r) => sum + r.amount, 0n);
    const onPending = (pending: {
      l1TxHash: string;
      secrets: Array<{ secret: string; secretHash: string }>;
      recipients: string[];
      amounts: string[];
    }) => dispatch({ type: "BRIDGE_STARTED", pendingBridge: pending });

    if (parsedRecipients.length === 1 && recipientChoice === "self") {
      if (!faucetLocked && balance && totalAmount > balance.balance) {
        setError("Insufficient balance");
        return;
      }
      const result = await bridgeFeeJuice({
        l1RpcUrl: activeNetwork.l1RpcUrl,
        chainId: l1Addresses.l1ChainId,
        addresses: l1Addresses,
        aztecRecipient: parsedRecipients[0].address,
        amount: parsedRecipients[0].amount,
        mint: faucetLocked,
        onStep,
        onPending,
      });
      dispatch({
        type: "L1_CONFIRMED",
        allCredentials: [result],
        claimKind: "bootstrap",
      });
    } else if (needsMultiBridge && aztecAddress) {
      const ephAmount =
        faucetLocked && mintAmountValue
          ? mintAmountValue
          : parseUnits(EPHEMERAL_CLAIM_GAS_FJ, 18);
      const totalNeeded = totalAmount + (faucetLocked ? 0n : ephAmount);
      if (!faucetLocked && balance && totalNeeded > balance.balance) {
        setError(
          `Insufficient balance. Need ${formatUnits(totalNeeded, balance.decimals)}`,
        );
        return;
      }
      const allCredentials = await bridgeMultiple({
        l1RpcUrl: activeNetwork.l1RpcUrl,
        chainId: l1Addresses.l1ChainId,
        addresses: l1Addresses,
        recipients: [
          { address: aztecAddress.toString(), amount: ephAmount },
          ...parsedRecipients,
        ],
        mint: faucetLocked,
        onStep,
        onPending,
      });
      dispatch({
        type: "L1_CONFIRMED",
        allCredentials,
        claimKind: "bootstrap",
      });
    } else {
      if (!faucetLocked && balance && totalAmount > balance.balance) {
        setError("Insufficient balance");
        return;
      }
      if (parsedRecipients.length === 1) {
        const result = await bridgeFeeJuice({
          l1RpcUrl: activeNetwork.l1RpcUrl,
          chainId: l1Addresses.l1ChainId,
          addresses: l1Addresses,
          aztecRecipient: parsedRecipients[0].address,
          amount: parsedRecipients[0].amount,
          mint: faucetLocked,
          onStep,
          onPending,
        });
        dispatch({
          type: "L1_CONFIRMED",
          allCredentials: [result],
          claimKind: "batch",
        });
      } else {
        const allCredentials = await bridgeMultiple({
          l1RpcUrl: activeNetwork.l1RpcUrl,
          chainId: l1Addresses.l1ChainId,
          addresses: l1Addresses,
          recipients: parsedRecipients,
          mint: faucetLocked,
          onStep,
          onPending,
        });
        dispatch({ type: "L1_CONFIRMED", allCredentials, claimKind: "batch" });
      }
    }
    await refreshBalance();
  } catch (err: unknown) {
    dispatch({
      type: "ERROR",
      message: err instanceof Error ? err.message : "Bridge failed",
    });
  }
}
