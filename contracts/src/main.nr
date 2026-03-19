use aztec::macros::aztec;

#[aztec]
contract SubscriptionFPC {

    use aztec::{
        macros::{functions::{allow_phase_change, external, initializer}, storage::storage},
        protocol::{
            abis::function_selector::FunctionSelector, address::AztecAddress, traits::Packable,
        },
        state_vars::{Map, PublicImmutable},
    };

    #[derive(Packable)]
    struct Subscription {
        usages: u32,
        l2GasLimit: u32,
        daGasLimit: u32,
    }

    #[storage]
    struct Storage<Context> {
        admin: PublicImmutable<AztecAddress, Context>,
        apps: Map<AztecAddress, Map<FunctionSelector, PublicImmutable<Subscription, Context>, Context>, Context>,
    }

    #[initializer]
    #[external("public")]
    fn constructor(admin: AztecAddress) {
        self.storage.admin.initialize(admin);
    }

    #[external("private")]
    #[allow_phase_change]
    fn sponsor(app: AztecAddress, selector: FunctionSelector) {}
}
