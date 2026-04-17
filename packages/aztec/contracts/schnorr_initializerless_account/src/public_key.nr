use aztec::protocol::traits::{Deserialize, Serialize};

/// A public key composed of two field elements (x, y coordinates on the Grumpkin curve).
#[derive(Eq)]
pub struct PublicKey {
    pub x: Field,
    pub y: Field,
}

impl Serialize for PublicKey {
    let N: u32 = 2;

    fn serialize(self) -> [Field; Self::N] {
        [self.x, self.y]
    }

    fn stream_serialize<let K: u32>(self, writer: &mut aztec::protocol::utils::writer::Writer<K>) {
        writer.write(self.x);
        writer.write(self.y);
    }
}

impl Deserialize for PublicKey {
    let N: u32 = 2;

    fn deserialize(fields: [Field; Self::N]) -> Self {
        PublicKey { x: fields[0], y: fields[1] }
    }

    fn stream_deserialize<let K: u32>(reader: &mut aztec::protocol::utils::reader::Reader<K>) -> Self {
        let x = reader.read();
        let y = reader.read();
        PublicKey { x, y }
    }
}
