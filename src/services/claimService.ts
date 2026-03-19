import type { Wallet } from "@aztec/aztec.js/wallet";
import type { ClaimCredentials } from "./bridgeService";
import { FeeJuiceContract } from "@aztec/aztec.js/protocol";
import { AztecAddress } from "@aztec/stdlib/aztec-address";
import { Fr } from "@aztec/foundation/curves/bn254";

/**
 * Claims fee juice for a target address using an external wallet.
 * The external wallet's account pays gas; the claimed fee juice goes to the target.
 */
export async function claimFeeJuiceWithExternalWallet(
  wallet: Wallet,
  claim: ClaimCredentials,
  targetAddress: string,
  callerAddress: string,
) {
  const fj = FeeJuiceContract.at(wallet);
  const target = AztecAddress.fromString(targetAddress);
  const caller = AztecAddress.fromString(callerAddress);

  return fj.methods
    .claim(
      target,
      BigInt(claim.claimAmount),
      Fr.fromHexString(claim.claimSecret),
      Fr.fromHexString(
        `0x${BigInt(claim.messageLeafIndex).toString(16).padStart(64, "0")}`,
      ),
    )
    .send({ from: caller });
}
