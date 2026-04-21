export class BigDecimal {
  // Configuration: private constants
  static #DECIMALS = 18; // Number of decimals on all instances
  static #SHIFT = 10n ** BigInt(BigDecimal.#DECIMALS); // Derived constant
  static #fromBigInt = Symbol(); // Secret to allow construction with given #n value
  #n; // the BigInt that will hold the BigDecimal's value multiplied by #SHIFT
  constructor(value, convert?) {
    if (value instanceof BigDecimal) return value;
    if (convert === BigDecimal.#fromBigInt) {
      // Can only be used within this class
      this.#n = value;
      return;
    }
    const [ints, decis] = String(value).split(".").concat("");
    this.#n = BigInt(ints + decis.padEnd(BigDecimal.#DECIMALS, "0").slice(0, BigDecimal.#DECIMALS));
  }
  divide(num) {
    return new BigDecimal(
      (this.#n * BigDecimal.#SHIFT) / new BigDecimal(num).#n,
      BigDecimal.#fromBigInt,
    );
  }
  toString() {
    let s = this.#n
      .toString()
      .replace("-", "")
      .padStart(BigDecimal.#DECIMALS + 1, "0");
    s = (s.slice(0, -BigDecimal.#DECIMALS) + "." + s.slice(-BigDecimal.#DECIMALS)).replace(
      /(\.0*|0+)$/,
      "",
    );
    return this.#n < 0 ? "-" + s : s;
  }
}
