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
            note_getter_options::NoteGetterOptions, note_interface::NoteProperties,
            note_viewer_options::NoteViewerOptions,
        },
        protocol::{
            abis::{function_selector::FunctionSelector, gas_settings::GasSettings},
            address::AztecAddress,
            hash::poseidon2_hash,
            traits::{Packable, ToField},
        },
        state_vars::{Owned, PrivateSet, PublicImmutable},
        utils::comparison::Comparator,
    };
    use aztec::oracle::notes::set_sender_for_tags;

    /// Bounds FPC liability before `set_as_fee_payer()` commits. Protocol guarantees
    /// `actual_fee <= (gas_limits + teardown_gas_limits).compute_fee(max_fees_per_gas)`,
    /// so asserting that product `<= max_fee` here makes the subscription's per-tx cap
    /// a hard gate: if it fails the circuit proves nothing and the tx never reaches
    /// a sequencer, so the FPC is never charged.
    #[contract_library_method]
    fn assert_fee_within_max(gas_settings: GasSettings, max_fee: u128) {
        let total_gas = gas_settings.gas_limits + gas_settings.teardown_gas_limits;
        let max_possible_fee: u128 =
            (total_gas.da_gas as u128) * gas_settings.max_fees_per_gas.fee_per_da_gas
            + (total_gas.l2_gas as u128) * gas_settings.max_fees_per_gas.fee_per_l2_gas;
        assert(max_possible_fee <= max_fee, "Gas settings exceed subscription max_fee");
    }

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
        users: u32,
    }
    #[storage]
    struct Storage<Context> {
        admin: PublicImmutable<AztecAddress, Context>,
        subscriptions: Owned<PrivateSet<SubscriptionNote, Context>, Context>,
        slots: Owned<PrivateSet<SlotNote, Context>, Context>,
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
        // Safety: The sender for tags is only used to compute unconstrained shared secrets for emitting logs.
        // Since this value is only used for unconstrained tagging and not for any constrained logic,
        // it is safe to set from a constrained context.
        unsafe {
            set_sender_for_tags(self.address);
        }

        self
            .storage
            .slots
            .at(self.address)
            .insert(SlotNote { config_id, max_uses, max_fee, users: max_users })
            .deliver(MessageDelivery.ONCHAIN_UNCONSTRAINED);
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
        assert(subscription.len() > 0, "No active subscription found for this user and function");
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

        assert_fee_within_max(self.context.gas_settings(), subscription.max_fee);

        // We are convinced, sponsor the fee and end setup
        self.context.set_as_fee_payer();
        self.context.end_setup();

        self.internal._call_sponsored_fn(call);
    }

    #[internal("private")]
    fn _call_sponsored_fn(call: FunctionCall) {
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

        // Safety: The sender for tags is only used to compute unconstrained shared secrets for emitting logs.
        // Since this value is only used for unconstrained tagging and not for any constrained logic,
        // it is safe to set from a constrained context.
        unsafe {
            set_sender_for_tags(self.address);
        }

        let options = NoteGetterOptions::new().set_limit(1).select(
            SlotNote::properties().config_id,
            Comparator.EQ,
            config_id,
        );
        let slots = self.storage.slots.at(self.address).pop_notes(options);
        assert(slots.len() > 0, "No subscription slots available for this function. The operator must call sign_up first.");
        let slot = slots.get(0);
        if slot.users > 0 {
            self
                .storage
                .slots
                .at(self.address)
                .insert(
                    SlotNote {
                        users: slot.users - 1,
                        max_uses: slot.max_uses,
                        max_fee: slot.max_fee,
                        config_id,
                    },
                )
                .deliver(MessageDelivery.ONCHAIN_UNCONSTRAINED)
        }

        assert_fee_within_max(self.context.gas_settings(), slot.max_fee);

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
        self.internal._call_sponsored_fn(call);
    }

    #[external("utility")]
    unconstrained fn count_available_slots(config_id: Field) -> u32 {
        let options = NoteViewerOptions::new()
            .select(SlotNote::properties().config_id, Comparator.EQ, config_id)
            .set_limit(1);
        let notes = self.storage.slots.at(self.address).view_notes(options);
        if notes.len() > 0 {
            notes.get_unchecked(0).users
        } else {
            0
        }
    }

    #[external("utility")]
    unconstrained fn get_subscription_info(user: AztecAddress, config_id: Field) -> (bool, u32) {
        let options = NoteViewerOptions::new()
            .select(SubscriptionNote::properties().config_id, Comparator.EQ, config_id)
            .set_limit(1);
        let notes = self.storage.subscriptions.at(user).view_notes(options);
        if notes.len() > 0 {
            (true, notes.get_unchecked(0).uses)
        } else {
            (false, 0)
        }
    }

}
