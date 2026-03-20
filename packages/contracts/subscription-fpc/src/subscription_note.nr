use aztec::{
    context::{PrivateContext, PublicContext},
    keys::getters::{get_nhk_app, get_public_keys, try_get_public_keys},
    macros::notes::custom_note,
    messages::logs::partial_note::compute_partial_note_private_content_log,
    note::{note_interface::{NoteHash, NoteType}, utils::compute_note_nullifier},
    oracle::random::random,
    protocol::{
        address::AztecAddress,
        constants::{
            DOM_SEP__NOTE_HASH, DOM_SEP__PARTIAL_NOTE_VALIDITY_COMMITMENT,
            PRIVATE_LOG_SIZE_IN_FIELDS,
        },
        hash::poseidon2_hash_with_separator,
        traits::{Deserialize, FromField, Hash, Packable, Serialize, ToField},
    },
};

#[derive(Deserialize, Eq, Serialize, Packable)]
#[custom_note]
pub struct SubscriptionNote {
    pub uses: u32,
    pub max_fee: u128,
    pub config_id: Field,
    pub is_valid: bool,
}

impl NoteHash for SubscriptionNote {
    fn compute_note_hash(
        self,
        owner: AztecAddress,
        storage_slot: Field,
        randomness: Field,
    ) -> Field {
        let partial_note = PartialSubscriptionNote {
            commitment: compute_partial_commitment(
                owner,
                randomness,
                self.uses,
                self.max_fee,
                self.config_id,
            ),
        };

        partial_note.compute_complete_note_hash(storage_slot, self.is_valid)
    }

    fn compute_nullifier(
        self,
        context: &mut PrivateContext,
        owner: AztecAddress,
        note_hash_for_nullification: Field,
    ) -> Field {
        let owner_npk_m = get_public_keys(owner).npk_m;
        let owner_npk_m_hash = owner_npk_m.hash();
        let secret = context.request_nhk_app(owner_npk_m_hash);
        compute_note_nullifier(note_hash_for_nullification, [secret])
    }

    unconstrained fn compute_nullifier_unconstrained(
        self,
        owner: AztecAddress,
        note_hash_for_nullification: Field,
    ) -> Option<Field> {
        try_get_public_keys(owner).map(|public_keys| {
            let owner_npk_m = public_keys.npk_m;
            let owner_npk_m_hash = owner_npk_m.hash();
            let secret = get_nhk_app(owner_npk_m_hash);
            compute_note_nullifier(note_hash_for_nullification, [secret])
        })
    }
}

impl SubscriptionNote {
    pub fn partial(
        owner: AztecAddress,
        context: &mut PrivateContext,
        recipient: AztecAddress,
        completer: AztecAddress,
        uses: u32,
        max_fee: u128,
        config_id: Field,
    ) -> PartialSubscriptionNote {
        // Safety: We use the randomness to preserve the privacy of the note recipient by preventing brute-forcing, so
        // a malicious sender could use non-random values to make the note less private. But they already know the full
        // note pre-image anyway, and so the recipient already trusts them to not disclose this information. We can
        // therefore assume that the sender will cooperate in the random value generation.
        let randomness = unsafe { random() };

        let commitment = compute_partial_commitment(owner, randomness, uses, max_fee, config_id);
        let private_log_content =
            PartialSubscriptionNotePrivateLogContent { uses, max_fee, config_id };

        let encrypted_log = compute_partial_note_private_content_log(
            private_log_content,
            owner,
            randomness,
            recipient,
            commitment,
        );
        let length = encrypted_log.len();
        context.emit_private_log(encrypted_log, length);

        let partial_note = PartialSubscriptionNote { commitment };

        let validity_commitment = partial_note.compute_validity_commitment(completer);
        context.push_nullifier(validity_commitment);

        partial_note
    }
}

fn compute_partial_commitment(
    owner: AztecAddress,
    randomness: Field,
    uses: u32,
    max_fee: u128,
    config_id: Field,
) -> Field {
    poseidon2_hash_with_separator(
        [owner.to_field(), randomness, uses.to_field(), max_fee.to_field(), config_id.to_field()],
        DOM_SEP__NOTE_HASH,
    )
}

#[derive(Packable)]
struct PartialSubscriptionNotePrivateLogContent {
    uses: u32,
    max_fee: u128,
    config_id: Field,
}

impl NoteType for PartialSubscriptionNotePrivateLogContent {
    fn get_id() -> Field {
        SubscriptionNote::get_id()
    }
}

#[derive(Packable, Serialize, Deserialize, Eq)]
pub struct PartialSubscriptionNote {
    commitment: Field,
}
// docs:end:partial_uint_note_def

global NOTE_COMPLETION_LOG_LENGTH: u32 = 3;

impl PartialSubscriptionNote {
    /// Completes the partial note, creating a new note that can be used like any other SubscriptionNote.
    pub fn complete(
        self,
        context: PublicContext,
        completer: AztecAddress,
        storage_slot: Field,
        is_valid: bool,
    ) {
        assert(is_valid, "Cannot complete an invalid PartialSubscriptionNote");

        let validity_commitment = self.compute_validity_commitment(completer);

        assert(
            context.nullifier_exists_unsafe(validity_commitment, context.this_address()),
            "Invalid partial note or completer",
        );

        context.emit_public_log(self.compute_note_completion_log(storage_slot, is_valid));
        context.push_note_hash(self.compute_complete_note_hash(storage_slot, is_valid));
    }

    pub fn compute_validity_commitment(self, completer: AztecAddress) -> Field {
        poseidon2_hash_with_separator(
            [self.commitment, completer.to_field()],
            DOM_SEP__PARTIAL_NOTE_VALIDITY_COMMITMENT,
        )
    }

    fn compute_note_completion_log(
        self,
        storage_slot: Field,
        is_valid: bool,
    ) -> [Field; NOTE_COMPLETION_LOG_LENGTH] {
        [self.commitment, storage_slot, is_valid.to_field()]
    }

    fn compute_note_completion_log_padded_for_private_log(
        self,
        storage_slot: Field,
        is_valid: bool,
    ) -> [Field; PRIVATE_LOG_SIZE_IN_FIELDS] {
        let note_completion_log = self.compute_note_completion_log(storage_slot, is_valid);
        let padding = [0; PRIVATE_LOG_SIZE_IN_FIELDS - NOTE_COMPLETION_LOG_LENGTH];
        note_completion_log.concat(padding)
    }

    fn compute_complete_note_hash(self, storage_slot: Field, is_valid: bool) -> Field {
        poseidon2_hash_with_separator(
            [self.commitment, storage_slot, is_valid.to_field()],
            DOM_SEP__NOTE_HASH,
        )
    }
    // docs:end:compute_complete_note_hash
}

impl ToField for PartialSubscriptionNote {
    fn to_field(self) -> Field {
        self.commitment
    }
}

impl FromField for PartialSubscriptionNote {
    fn from_field(field: Field) -> Self {
        Self { commitment: field }
    }
}

mod test {
    use super::{compute_partial_commitment, PartialSubscriptionNote, SubscriptionNote};
    use aztec::{
        note::note_interface::NoteHash,
        protocol::{address::AztecAddress, traits::FromField},
    };

    global randomness: Field = 42;
    global owner: AztecAddress = AztecAddress::from_field(50);
    global storage_slot: Field = 13;
    global uses: u32 = 5;
    global max_fee: u128 = 23;
    global config_id: Field = 11111;

    #[test]
    fn note_hash_matches_completed_partial_note_hash() {
        // Tests that a SubscriptionNote has the same note hash as a PartialSubscriptionNote created and then completed with the same
        // private values. This requires for the same hash function to be used in both flows, with the fields in the
        // same order.
        let note = SubscriptionNote { uses, max_fee, config_id, is_valid: true };
        let note_hash = note.compute_note_hash(owner, storage_slot, randomness);

        let partial_note = PartialSubscriptionNote {
            commitment: compute_partial_commitment(owner, randomness, uses, max_fee, config_id),
        };
        let completed_partial_note_hash =
            partial_note.compute_complete_note_hash(storage_slot, true);

        assert_eq(note_hash, completed_partial_note_hash);
    }
}
