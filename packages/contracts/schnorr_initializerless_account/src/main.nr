mod public_key;

use aztec::macros::aztec;

#[aztec]
pub contract SchnorrInitializerlessAccount {
    use aztec::{
        authwit::{
            account::AccountActions,
            auth::{compute_authwit_message_hash, compute_authwit_nullifier},
            entrypoint::app::AppPayload,
        },
        context::PrivateContext,
        hash::compute_siloed_nullifier,
        macros::functions::{allow_phase_change, external, view},
        oracle::{
            auth_witness::get_auth_witness,
            get_nullifier_membership_witness::get_low_nullifier_membership_witness,
            notes::set_sender_for_tags,
        },
        protocol::address::AztecAddress,
    };

    use crate::public_key::PublicKey;

    use immutables::immutables;

    #[immutables]
    pub struct Immutables {
        pub public_key: PublicKey,
    }

    #[external("utility")]
    unconstrained fn store_immutables(capsule_data: [Field; 3]) {
        Immutables::store(self.context, capsule_data);
    }

    #[external("private")]
    #[allow_phase_change]
    fn entrypoint(app_payload: AppPayload, fee_payment_method: u8, cancellable: bool) {
        // Safety: set_sender_for_tags is an oracle call that registers this account
        // as the sender for private note delivery in nested calls.
        unsafe { set_sender_for_tags(self.address) };

        let actions = AccountActions::init(self.context, is_valid_impl);
        actions.entrypoint(app_payload, fee_payment_method, cancellable);
    }

    #[external("private")]
    #[view]
    fn verify_private_authwit(inner_hash: Field) -> Field {
        let actions = AccountActions::init(self.context, is_valid_impl);
        actions.verify_private_authwit(inner_hash)
    }

    #[contract_library_method]
    fn is_valid_impl(context: &mut PrivateContext, outer_hash: Field) -> bool {
        let immutables = Immutables::init(context);
        let public_key = immutables.public_key;

        // Safety: The witness is only used as a "magical value" that makes the
        // signature verification below pass.
        let witness: [Field; 64] = unsafe { get_auth_witness(outer_hash) };
        let mut signature: [u8; 64] = [0; 64];
        for i in 0..64 {
            signature[i] = witness[i] as u8;
        }

        let pub_key = std::embedded_curve_ops::EmbeddedCurvePoint {
            x: public_key.x,
            y: public_key.y,
            is_infinite: false,
        };

        schnorr::verify_signature(pub_key, signature, outer_hash.to_be_bytes::<32>())
    }

    #[external("utility")]
    unconstrained fn lookup_validity(consumer: AztecAddress, inner_hash: Field) -> bool {
        let immutables = Immutables::init_unconstrained(self.context);
        let public_key = immutables.public_key;

        let message_hash = compute_authwit_message_hash(
            consumer,
            self.context.chain_id(),
            self.context.version(),
            inner_hash,
        );

        let witness: [Field; 64] = get_auth_witness(message_hash);
        let mut signature: [u8; 64] = [0; 64];
        for i in 0..64 {
            signature[i] = witness[i] as u8;
        }

        let pub_key = std::embedded_curve_ops::EmbeddedCurvePoint {
            x: public_key.x,
            y: public_key.y,
            is_infinite: false,
        };

        let valid_in_private =
            schnorr::verify_signature(pub_key, signature, message_hash.to_be_bytes::<32>());

        let nullifier = compute_authwit_nullifier(self.address, inner_hash);
        let siloed_nullifier = compute_siloed_nullifier(consumer, nullifier);
        let lower_wit =
            get_low_nullifier_membership_witness(self.context.block_header(), siloed_nullifier);
        let is_spent = lower_wit.leaf_preimage.nullifier == siloed_nullifier;

        !is_spent & valid_in_private
    }

    /// Returns the signing public key (for testing).
    #[external("private")]
    fn get_signing_public_key() -> pub (Field, Field) {
        let immutables = Immutables::init(self.context);
        let public_key = immutables.public_key;
        (public_key.x, public_key.y)
    }
}
