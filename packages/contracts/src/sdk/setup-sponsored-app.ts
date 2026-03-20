import type { AztecNode } from "@aztec/aztec.js/node";
import type { EmbeddedWallet } from "@aztec/wallets/embedded";
import { NO_FROM } from "@aztec/aztec.js/account";
import { Gas } from "@aztec/stdlib/gas";
import { computeVarArgsHash } from "@aztec/stdlib/hash";
import { HashedValues } from "@aztec/stdlib/tx";
import { SubscriptionFPCContract } from "../../artifacts/SubscriptionFPC.js";
import { buildNoirFunctionCall } from "./build-noir-function-call.js";
import type { FunctionCall } from "@aztec/aztec.js/abi";
import type { AztecAddress } from "@aztec/aztec.js/addresses";

const MAX_U128 = 2n ** 128n - 1n;

export async function setupSponsoredApp(params: {
  /** Wallet with the admin account, used to send sign_up txs */
  adminWallet: EmbeddedWallet;
  /** Address of the admin account in adminWallet */
  adminAddress: AztecAddress;
  /** Wallet for the dummy user, must have sponsored app + FPC contracts registered */
  userWallet: EmbeddedWallet;
  /** Address of a dummy user account in userWallet */
  userAddress: AztecAddress;
  /** Aztec node client */
  node: AztecNode;
  /** Address of the already-deployed and funded SubscriptionFPC contract */
  fpcAddress: AztecAddress;
  /** A sample FunctionCall for the sponsored method (from getFunctionCall()) */
  sampleCall: FunctionCall;
  /** Max uses per subscription (default 1) */
  maxUses?: number;
  /** Max concurrent subscribers (default 1) */
  maxUsers?: number;
  /** Fee safety multiplier on currentFees (default 10) */
  feeMultiplier?: number;
}): Promise<{
  maxFee: bigint;
  gasLimits: Gas;
  teardownGasLimits: Gas;
}> {
  const {
    adminWallet,
    adminAddress,
    userWallet,
    userAddress,
    node,
    fpcAddress,
    sampleCall,
    maxUses = 1,
    maxUsers = 1,
    feeMultiplier = 10,
  } = params;

  const appAddress = sampleCall.to;
  const selector = sampleCall.selector;

  // Instantiate the FPC for each wallet
  const adminFpc = SubscriptionFPCContract.at(fpcAddress, adminWallet);
  const userFpc = SubscriptionFPCContract.at(fpcAddress, userWallet);

  // --- Step 1: Calibration sign_up (index 0, MAX fee) ---
  await adminFpc.methods
    .sign_up(appAddress, selector, 0, 1, MAX_U128, 1)
    .send({ from: adminAddress });

  // --- Step 2: Subscribe dummy user ---
  await userFpc.methods
    .subscribe(appAddress, selector, 0, userAddress)
    .send({ from: NO_FROM });

  // --- Step 3: Simulate sponsor to measure gas ---
  const noirCall = await buildNoirFunctionCall(sampleCall);

  const { estimatedGas } = await userFpc.methods
    .sponsor(noirCall, 0, userAddress)
    .with({
      extraHashedArgs: [
        new HashedValues(
          sampleCall.args,
          await computeVarArgsHash(sampleCall.args),
        ),
      ],
    })
    .simulate({
      from: NO_FROM,
      fee: { estimateGas: true, estimatedGasPadding: 0 },
      additionalScopes: [userAddress],
    });

  // --- Step 4: Compute tight max_fee ---
  const currentFees = await node.getCurrentMinFees();
  const maxFee = estimatedGas.gasLimits
    .add(estimatedGas.teardownGasLimits)
    .computeFee(currentFees.mul(feeMultiplier))
    .toBigInt();

  // --- Step 5: Production sign_up (index 1) ---
  await adminFpc.methods
    .sign_up(appAddress, selector, 1, maxUses, maxFee, maxUsers)
    .send({ from: adminAddress });

  return {
    maxFee,
    gasLimits: estimatedGas.gasLimits,
    teardownGasLimits: estimatedGas.teardownGasLimits,
  };
}
