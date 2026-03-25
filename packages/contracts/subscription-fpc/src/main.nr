use aztec::macros::aztec;

#[aztec]
contract SubscriptionFPC {

    use aztec::{
        authwit::entrypoint::FunctionCall,
        macros::{
            functions::{allow_phase_change, external, initializer, internal},
            notes::note,
            storage::storage,
        },
        messages::message_delivery::MessageDelivery,
        note::{
            note_getter_options::NoteGetterOptions,
            note_interface::NoteProperties,
            note_viewer_options::NoteViewerOptions,
        },
        protocol::{
            abis::function_selector::FunctionSelector,
            address::AztecAddress,
            constants::{MAX_NOTE_HASHES_PER_CALL},
            hash::poseidon2_hash,
            traits::{Packable, ToField},
        },
        state_vars::{Owned, PrivateSet, PublicImmutable},
        utils::comparison::Comparator,
    };
    use aztec::oracle::notes::set_sender_for_tags;

    #[derive(Packable, Eq)]
    #[note]
    struct SubscriptionNote {
        uses: u32,
        max_fee: u128,
        config_id: Field,
    }

    #[derive(Packable, Eq)]
    #[note]
    struct SlotNote {
        config_id: Field,
        max_fee: u128,
        max_uses: u32,
    }
    #[storage]
    struct Storage<Context> {
        admin: PublicImmutable<AztecAddress, Context>,
        subscriptions: Owned<PrivateSet<SubscriptionNote, Context>, Context>,
        slots: Owned<PrivateSet<SlotNote, Context>, Context>,
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
        assert(
            max_users <= MAX_NOTE_HASHES_PER_CALL,
            "Cannot sign up more than 16 users at a time",
        );
        // Safety: The sender for tags is only used to compute unconstrained shared secrets for emitting logs.
        // Since this value is only used for unconstrained tagging and not for any constrained logic,
        // it is safe to set from a constrained context.
        unsafe {
            set_sender_for_tags(self.address);
        }
        for i in 0..MAX_NOTE_HASHES_PER_CALL {
            if i < max_users {
                self
                    .storage
                    .slots
                    .at(self.address)
                    .insert(SlotNote { config_id, max_uses, max_fee })
                    .deliver(MessageDelivery.ONCHAIN_UNCONSTRAINED);
            }
        }
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

        let options = NoteGetterOptions::new().set_limit(1).select(
            SlotNote::properties().config_id,
            Comparator.EQ,
            config_id,
        );
        let slots = self.storage.slots.at(self.address).pop_notes(options);
        let slot = slots.get(0);

        // We are convinced, sponsor the fee and end setup
        self.context.set_as_fee_payer();
        self.context.end_setup();

        // Safety: The sender for tags is only used to compute unconstrained shared secrets for emitting logs.
        // Since this value is only used for unconstrained tagging and not for any constrained logic,
        // it is safe to set from a constrained context.
        unsafe {
            set_sender_for_tags(user);
        }

        self
            .storage
            .subscriptions
            .at(user)
            .insert(SubscriptionNote { uses: slot.max_uses - 1, max_fee: slot.max_fee, config_id })
            .deliver(MessageDelivery.ONCHAIN_UNCONSTRAINED);

        // We allow calling the sponsored function in the same tx as the subscription
        self.internal._call_sponsored_fn(call, slot.max_fee);
    }


    #[external("utility")]
    unconstrained fn count_available_slots(config_id: Field) -> u32 {
        let options = NoteViewerOptions::new().select(
            SlotNote::properties().config_id,
            Comparator.EQ,
            config_id,
        );
        let slots = self.storage.slots.at(self.address).view_notes(options);
        slots.len()
    }

    #[external("utility")]
    unconstrained fn get_subscription_info(
        user: AztecAddress,
        config_id: Field,
    ) -> (bool, u32) {
        let options = NoteViewerOptions::new()
            .select(
                SubscriptionNote::properties().config_id,
                Comparator.EQ,
                config_id,
            )
            .set_limit(1);
        let subs = self.storage.subscriptions.at(user).view_notes(options);
        if subs.len() > 0 {
            (true, subs.get_unchecked(0).uses)
        } else {
            (false, 0)
        }
    }

}
