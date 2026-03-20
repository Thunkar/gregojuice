import { FunctionType } from "@aztec/aztec.js/abi";
import type { FunctionCall } from "@aztec/aztec.js/abi";
import { computeVarArgsHash } from "@aztec/stdlib/hash";

/**
 * Converts a TS FunctionCall into the Noir FunctionCall struct shape
 * expected by the SubscriptionFPC's `sponsor` method.
 */
export async function buildNoirFunctionCall(call: FunctionCall) {
  return {
    args_hash: await computeVarArgsHash(call.args),
    function_selector: call.selector.toField(),
    hide_msg_sender: call.hideMsgSender,
    is_static: call.isStatic,
    target_address: call.to,
    is_public: call.type === FunctionType.PUBLIC,
  };
}
