use aztec::macros::aztec;

#[aztec]
contract SubscriptionFPC {

    use aztec::macros::functions::{external, initializer};
    use aztec::{
        macros::storage::storage, protocol::address::AztecAddress, state_vars::PublicImmutable,
    };

    #[storage]
    struct Storage<Context> {
        admin: PublicImmutable<AztecAddress, Context>,
    }

    #[initializer]
    #[external("public")]
    fn constructor(admin: AztecAddress) {
        self.storage.admin.initialize(admin);
    }
}
