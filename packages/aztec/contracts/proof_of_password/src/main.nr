mod test;

use aztec::macros::aztec;

#[aztec]
pub contract ProofOfPassword {

    use aztec::{
        macros::{functions::{external, initializer, only_self}, storage::storage},
        oracle::notes::set_sender_for_tags,
        protocol::{address::AztecAddress, hash::poseidon2_hash, traits::{Serialize, ToField}},
        state_vars::PublicImmutable,
    };
    use compressed_string::FieldCompressedString;
    use token::Token;

    #[storage]
    struct Storage<Context> {
        grego_coin_address: PublicImmutable<AztecAddress, Context>,
        password_hash: PublicImmutable<Field, Context>,
    }

    #[initializer]
    #[external("private")]
    fn constructor(grego_coin_address: AztecAddress, password: str<31>) {
        let field_compressed_str = FieldCompressedString::from_string(password);
        let password_hash = poseidon2_hash(field_compressed_str.serialize());
        self.enqueue(ProofOfPassword::at(self.address)._init_storage(
            grego_coin_address,
            password_hash,
        ));
    }

    #[external("public")]
    #[only_self]
    fn _init_storage(grego_coin_address: AztecAddress, password_hash: Field) {
        self.storage.grego_coin_address.initialize(grego_coin_address);
        self.storage.password_hash.initialize(password_hash);
    }

    #[external("private")]
    fn check_password_and_mint(password: str<31>, to: AztecAddress) {
        let field_compressed_str = FieldCompressedString::from_string(password);
        let password_hash = self.storage.password_hash.read();
        assert(
            poseidon2_hash(field_compressed_str.serialize()) == password_hash,
            f"Invalid password {password}",
        );

        // Safety: PXE will enforce a sender for the tags of the notes created
        // in the Token.mint function, but this particular function is intended to be called by anyone
        // that knows the password, not necessarily the recipient. In particular, chances are this fn
        // will be invoked by the MultiCallEntrypoint protocol contract,
        // which does not set a sender for tags.
        // We intend the "to" of this function to claim the notes, so we're just calling
        // the oracle for its side effects, therefore making it safe to call
        unsafe {
            set_sender_for_tags(to);
        }

        let address = self.storage.grego_coin_address.read();
        self.call(Token::at(address).mint_to_private(to, 1000));

        // Derive nullifier from sender and password. This is a privacy leak, since
        // knowing the password and an address is sufficient to know if someone has used this
        // contract or not. But at least, they need the password
        let nullifier = poseidon2_hash([to.to_field(), field_compressed_str.serialize()[0]]);
        self.context.push_nullifier(nullifier);
    }
}
