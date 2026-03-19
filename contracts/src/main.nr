use aztec::macros::aztec;

#[aztec]
contract SubscriptionFPC {

    use aztec::{
        authwit::auth::assert_current_call_valid_authwit,
        macros::{
            functions::{allow_phase_change, authorize_once, external, initializer},
            notes::note,
            storage::storage,
        },
        messages::message_delivery::MessageDelivery,
        protocol::{
            abis::function_selector::FunctionSelector, address::AztecAddress, traits::Packable,
        },
        state_vars::{Map, Owned, PrivateSet, PublicImmutable},
    };
    use aztec::note::note_getter_options::NoteGetterOptions;

    #[derive(Packable, Eq)]
    #[note]
    struct SubscriptionNote {}

    #[derive(Packable, Eq)]
    struct Subscription {
        usages: u32,
        l2GasLimit: u32,
        daGasLimit: u32,
    }

    #[storage]
    struct Storage<Context> {
        admin: PublicImmutable<AztecAddress, Context>,
        apps: Map<AztecAddress, Map<FunctionSelector, PublicImmutable<Subscription, Context>, Context>, Context>,
        subscriptions: Owned<PrivateSet<SubscriptionNote, Context>, Context>,
    }

    #[initializer]
    #[external("public")]
    fn constructor(admin: AztecAddress) {
        self.storage.admin.initialize(admin);
    }

    #[external("private")]
    #[allow_phase_change]
    fn subscribe(app: AztecAddress, selector: FunctionSelector, user: AztecAddress) {
        // Assert we're at the top of the stack
        assert(
            self.context.maybe_msg_sender() == Option::none(),
            "msg_sender must be none for sponsored calls",
        );
        // Assert the caller authorizes the sponsorship via an authwit.
        // This function is specialized over the number of arguments. It is usually injected
        // by the `#[authorize_once]` macro, but here we use it directly since msg_sender
        // MUST always be none, rather than the user that wants to be sponsored.
        assert_current_call_valid_authwit::<4>(self.context, user);

        // Assert the user does not already have an active subscription
        let options = NoteGetterOptions::new().set_limit(0);
        let _ = self.storage.subscriptions.at(user).pop_notes(options);

        let usages = self.storage.apps.at(app).at(selector).read().usages;
        for _ in 0..usages {
            self.storage.subscriptions.at(user).insert(SubscriptionNote {}).deliver(
                MessageDelivery.ONCHAIN_UNCONSTRAINED,
            );
        }

        // Pay for the subscription fee, this will be included in the deal between the dapp and the FPC operator
        self.context.set_as_fee_payer();
        self.context.end_setup();
    }

    #[external("private")]
    #[allow_phase_change]
    fn sponsor(app: AztecAddress, selector: FunctionSelector, user: AztecAddress, nonce: Field) {
        // Assert we're at the top of the stack
        assert(
            self.context.maybe_msg_sender() == Option::none(),
            "msg_sender must be none for sponsored calls",
        );
        // Assert the caller authorizes the sponsorship via an authwit.
        // This function is specialized over the number of arguments. It is usually injected
        // by the `#[authorize_once]` macro, but here we use it directly since msg_sender
        // MUST always be none, rather than the user that wants to be sponsored.
        assert_current_call_valid_authwit::<4>(self.context, user);

        // Assert the user still has an active subscription
        let options = NoteGetterOptions::new().set_limit(1);
        let _ = self.storage.subscriptions.at(user).pop_notes(options);

        // We are convinced, sponsor the fee and end setup
        self.context.set_as_fee_payer();
        self.context.end_setup();
    }
}
