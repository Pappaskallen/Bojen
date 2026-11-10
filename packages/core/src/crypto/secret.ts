const REDACTED = "[redacted]";

/**
 * A decrypted access code or key location. It cannot be logged by mistake: printing it,
 * turning it into a string or into JSON only gives `[redacted]`. Call `reveal()` at the
 * single place where the value is shown to the mechanic.
 */
export class Secret {
  readonly #value: string;

  constructor(value: string) {
    this.#value = value;
  }

  reveal(): string {
    return this.#value;
  }

  toString(): string {
    return REDACTED;
  }

  toJSON(): string {
    return REDACTED;
  }

  [Symbol.for("nodejs.util.inspect.custom")](): string {
    return `Secret(${REDACTED})`;
  }
}
