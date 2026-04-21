use super::ProofOfPassword;
use aztec::{protocol::address::AztecAddress, test::helpers::test_environment::TestEnvironment};
use token::Token;

global PASSWORD: str<31> = "potato0000000000000000000000000";

pub unconstrained fn setup() -> (TestEnvironment, AztecAddress, AztecAddress, AztecAddress) {
    // Setup env, generate keys
    let mut env = TestEnvironment::new();

    let owner = env.create_light_account();
    let recipient = env.create_light_account();

    // Deploy token contract
    let token_initializer_call_interface = Token::interface().constructor(
        owner,
        "TestToken0000000000000000000000",
        "TT00000000000000000000000000000",
        18,
    );

    let token_contract_address = env.deploy("@token_contract/Token").with_public_initializer(
        owner,
        token_initializer_call_interface,
    );

    let initializer_call_interface =
        ProofOfPassword::interface().constructor(token_contract_address, PASSWORD);
    let pop_contract_address =
        env.deploy("ProofOfPassword").with_private_initializer(owner, initializer_call_interface);

    let _ = env.call_public(
        owner,
        Token::at(token_contract_address).set_minter(pop_contract_address, true),
    );

    (env, pop_contract_address, token_contract_address, recipient)
}

#[test]
unconstrained fn mints_on_correct_password() {
    let (env, pop_contract_address, token_contract_address, recipient) = setup();

    let pop = ProofOfPassword::at(pop_contract_address);

    env.call_private(recipient, pop.check_password_and_mint(PASSWORD, recipient));

    let token = Token::at(token_contract_address);

    let balance = env.execute_utility(token.balance_of_private(recipient));

    assert(balance == 1000, "Token was not minted")
}

#[test(should_fail_with = "Assertion failed: Invalid password 1234000000000000000000000000000")]
unconstrained fn fails_on_incorrect_password() {
    let (env, pop_contract_address, _, recipient) = setup();

    let pop = ProofOfPassword::at(pop_contract_address);

    env.call_private(
        recipient,
        pop.check_password_and_mint("1234000000000000000000000000000", recipient),
    );
}

#[test(should_fail_with = "Attempted to emit duplicate siloed nullifier")]
unconstrained fn fails_on_double_dip() {
    let (env, pop_contract_address, _, recipient) = setup();

    let pop = ProofOfPassword::at(pop_contract_address);

    env.call_private(recipient, pop.check_password_and_mint(PASSWORD, recipient));
    env.call_private(recipient, pop.check_password_and_mint(PASSWORD, recipient));
}
