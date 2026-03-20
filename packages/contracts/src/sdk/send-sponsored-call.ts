import { NO_FROM } from "@aztec/aztec.js/account";
import type { FunctionCall } from "@aztec/aztec.js/abi";
import type { AztecAddress } from "@aztec/aztec.js/addresses";
import { computeVarArgsHash } from "@aztec/stdlib/hash";
import { HashedValues } from "@aztec/stdlib/tx";
import type { SubscriptionFPCContract } from "../../artifacts/SubscriptionFPC.js";
import { buildNoirFunctionCall } from "./build-noir-function-call.js";

/**
 * Sends a sponsored call through the SubscriptionFPC.
 *
 * Handles the boilerplate of converting the FunctionCall to the Noir struct,
 * attaching extra hashed args, and sending with the right options.
 */
export async function sendSponsoredCall(params: {
  /** SubscriptionFPC contract instance (connected to the user's wallet) */
  fpc: SubscriptionFPCContract;
  /** The FunctionCall to sponsor (from .getFunctionCall()) */
  call: FunctionCall;
  /** The config index for the sponsored app */
  configIndex: number;
  /** The subscribing user's address */
  userAddress: AztecAddress;
}) {
  const { fpc, call, configIndex, userAddress } = params;

  const noirCall = await buildNoirFunctionCall(call);

  return fpc.methods
    .sponsor(noirCall, configIndex, userAddress)
    .with({
      extraHashedArgs: [
        new HashedValues(call.args, await computeVarArgsHash(call.args)),
      ],
    })
    .send({
      from: NO_FROM,
      additionalScopes: [userAddress],
    });
}
