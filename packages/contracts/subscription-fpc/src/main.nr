use aztec::macros::aztec;
mod subscription_note;

#[aztec]
contract SubscriptionFPC {

    use super::subscription_note::{PartialSubscriptionNote, SubscriptionNote};
    use aztec::{
        authwit::entrypoint::FunctionCall,
        macros::{
            functions::{allow_phase_change, external, initializer, internal, only_self},
            notes::note,
            storage::storage,
        },
        messages::message_delivery::MessageDelivery,
        note::{note_getter_options::NoteGetterOptions, note_interface::NoteProperties},
        protocol::{
            abis::function_selector::FunctionSelector,
            address::AztecAddress,
            hash::poseidon2_hash,
            traits::{Packable, ToField},
        },
        state_vars::{
            Map, Owned, PrivateSet, PublicImmutable, PublicMutable, SingleUseClaim, StateVariable,
        },
        utils::comparison::Comparator,
    };
    use aztec::oracle::notes::set_sender_for_tags;

    #[derive(Packable, Eq)]
    struct SubscriptionConfig {
        max_uses: u32,
        max_users: u32,
        max_fee: u128,
    }
    #[storage]
    struct Storage<Context> {
        admin: PublicImmutable<AztecAddress, Context>,
        config: Map<Field, PublicImmutable<SubscriptionConfig, Context>, Context>,
        subscriptions: Owned<PrivateSet<SubscriptionNote, Context>, Context>,
        subscription_claims: Map<Field, Owned<SingleUseClaim<Context>, Context>, Context>,
        subscription_users: Map<Field, PublicMutable<u32, Context>, Context>,
    }

    #[internal("public")]
    fn safe_cast_to_u128(field: Field) -> u128 {
        field.assert_max_bit_size::<128>();
        field as u128
    }

    #[initializer]
    #[external("public")]
    fn constructor(admin: AztecAddress) {
        self.storage.admin.initialize(admin);
    }

    #[external("private")]
    fn sign_up(
        app: AztecAddress,
        selector: FunctionSelector,
        current_index: u32,
        max_uses: u32,
        max_fee: u128,
        max_users: u32,
    ) {
        assert(
            self.msg_sender() == self.storage.admin.read(),
            "Only the admin can add sponsored apps",
        );
        let config_id = poseidon2_hash([
            app.to_field(),
            selector.to_field(),
            current_index.to_field(),
        ]);

        self.enqueue_self._initialize_config(config_id, max_fee, max_uses, max_users);
    }

    #[external("public")]
    #[only_self]
    fn _initialize_config(config_id: Field, max_fee: u128, max_uses: u32, max_users: u32) {
        self.storage.config.at(config_id).initialize(
            SubscriptionConfig { max_fee, max_uses, max_users },
        )
    }

    #[external("public")]
    #[only_self]
    fn _complete_subscription(config_id: Field, partial_note: PartialSubscriptionNote) {
        let config = self.storage.config.at(config_id).read();
        let current_users = self.storage.subscription_users.at(config_id).read();
        assert(
            current_users < config.max_users,
            "The subscription is complete and no more users can join",
        );
        self.storage.subscription_users.at(config_id).write(current_users + 1);
        partial_note.complete(
            self.context,
            self.address,
            self.storage.subscriptions.get_storage_slot(),
            true,
        )
    }

    #[external("private")]
    #[allow_phase_change]
    fn sponsor(call: FunctionCall, current_index: u32, user: AztecAddress) {
        // Assert we're at the top of the stack
        assert(
            self.context.maybe_msg_sender() == Option::none(),
            "msg_sender must be none for sponsored calls",
        );

        let config_id = poseidon2_hash([
            call.target_address.to_field(),
            call.function_selector.to_field(),
            current_index.to_field(),
        ]);

        // Safety: The sender for tags is only used to compute unconstrained shared secrets for emitting logs.
        // Since this value is only used for unconstrained tagging and not for any constrained logic,
        // it is safe to set from a constrained context.
        unsafe {
            set_sender_for_tags(user);
        }

        // Assert the user still has an active subscription
        let options = NoteGetterOptions::new().set_limit(1).select(
            SubscriptionNote::properties().config_id,
            Comparator.EQ,
            config_id,
        );
        let subscription = self.storage.subscriptions.at(user).pop_notes(options);
        let subscription = subscription.get(0);
        if subscription.uses > 0 {
            self
                .storage
                .subscriptions
                .at(user)
                .insert(
                    SubscriptionNote {
                        uses: subscription.uses - 1,
                        max_fee: subscription.max_fee,
                        config_id,
                        is_valid: true,
                    },
                )
                .deliver(MessageDelivery.ONCHAIN_UNCONSTRAINED)
        }

        // We are convinced, sponsor the fee and end setup
        self.context.set_as_fee_payer();
        self.context.end_setup();

        self.internal._call_sponsored_fn(call, subscription.max_fee);
    }

    #[internal("private")]
    fn _call_sponsored_fn(call: FunctionCall, max_fee: u128) {
        if call.is_public {
            self.context.call_public_function_with_calldata_hash(
                call.target_address,
                call.args_hash,
                call.is_static,
                call.hide_msg_sender,
            );
        } else {
            assert(
                !call.hide_msg_sender,
                "Incompatible flag. `hide_msg_sender = true` is only available for public calls.",
            );
            let _result = self.context.call_private_function_with_args_hash(
                call.target_address,
                call.function_selector,
                call.args_hash,
                call.is_static,
            );
        }

        self.set_as_teardown(SubscriptionFPC::at(self.address)._ensure_max_fee(max_fee));
    }

    #[external("public")]
    fn _ensure_max_fee(max_fee: u128) {
        let actual_fee = self.internal.safe_cast_to_u128(self.context.transaction_fee());
        assert(actual_fee <= max_fee, "Max fee exceeds subscription limit");
    }

    #[external("private")]
    #[allow_phase_change]
    fn subscribe(call: FunctionCall, current_index: u32, user: AztecAddress) {
        // Assert we're at the top of the stack
        assert(
            self.context.maybe_msg_sender() == Option::none(),
            "msg_sender must be none for sponsored calls",
        );

        let config_id = poseidon2_hash([
            call.target_address.to_field(),
            call.function_selector.to_field(),
            current_index.to_field(),
        ]);

        // Assert the user does not already have an active subscription
        // We only give users one shot at subscribing
        self.storage.subscription_claims.at(config_id).at(user).claim();

        // At this point, we've done the minimal amount of stuff we want to be included on setup
        // We're bearing the cost of inserting the claim, which could drain the FPC in the event
        // the subscription is full but someone creates infinite accounts. This should be prevented
        // by enforcing some sort of check on the subscribing account
        self.context.set_as_fee_payer();
        self.context.end_setup();

        // Safety: The sender for tags is only used to compute unconstrained shared secrets for emitting logs.
        // Since this value is only used for unconstrained tagging and not for any constrained logic,
        // it is safe to set from a constrained context.
        unsafe {
            set_sender_for_tags(user);
        }

        let config = self.storage.config.at(config_id).read();

        // We use partial notes because we have to ensure we haven't surpassed the
        // subscription limit per app and that's stored in public.
        let partial_note = SubscriptionNote::partial(
            user,
            self.context,
            user,
            self.address,
            config.max_uses - 1,
            config.max_fee,
            config_id,
        );

        // This function will complete the partial note if the subscription is within limits
        self.enqueue_self._complete_subscription(config_id, partial_note);

        // We allow calling the sponsored function in the same tx as the subscription
        self.internal._call_sponsored_fn(call, config.max_fee);
    }

}
