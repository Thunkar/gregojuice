use aztec::macros::aztec;

#[aztec]
contract EcdsaAccountDeployer {

    use aztec::{
        macros::{functions::{external, internal}, storage::storage},
        protocol::address::AztecAddress,
    };
    use ecdsa_account::EcdsaRAccount;

    #[external("private")]
    fn deploy(
        address: AztecAddress,
        nonce: Field,
        signing_pub_key_x: [u8; 32],
        signing_pub_key_y: [u8; 32],
    ) {
        self.call(EcdsaRAccount::at(address).constructor(signing_pub_key_x, signing_pub_key_y));
    }
}
