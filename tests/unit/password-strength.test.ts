// @vitest-environment node
import { describe, expect, it } from "vitest";
import {
  PASSWORD_MAX_LENGTH,
  PASSWORD_MIN_LENGTH,
  passwordProblem,
} from "@/lib/auth/password";

/** A password that satisfies every rule, for "the gate opens" assertions. */
const GOOD = "Tr0ubador-Kettle";

describe("passwordProblem - length", () => {
  it("rejects anything under the minimum", () => {
    expect(passwordProblem("Ab1!def")).toMatch(/at least 8 characters/i);
    expect(passwordProblem("")).toMatch(/at least 8 characters/i);
  });

  it("measures the bcrypt cap in BYTES, not characters", () => {
    // bcrypt truncates at 72 BYTES. 72 multi-byte characters is well past the
    // limit, and silently ignoring the tail is worse than refusing it.
    const seventyTwoAscii = `Aa1!${"x".repeat(68)}`;
    expect(seventyTwoAscii.length).toBe(PASSWORD_MAX_LENGTH);
    expect(passwordProblem(seventyTwoAscii)).toBeNull();

    const seventyTwoEmoji = "😀".repeat(72); // 288 bytes
    expect(seventyTwoEmoji.length).toBeGreaterThanOrEqual(PASSWORD_MAX_LENGTH);
    expect(passwordProblem(seventyTwoEmoji)).toMatch(/under 72 characters/i);
  });

  it("exports the bounds it enforces", () => {
    expect(PASSWORD_MIN_LENGTH).toBe(8);
    expect(PASSWORD_MAX_LENGTH).toBe(72);
  });
});

describe("passwordProblem - guessability", () => {
  it("rejects the passwords tried first in any real attack", () => {
    for (const bad of ["password", "password123", "12345678", "qwertyuiop", "iloveyou"]) {
      expect(passwordProblem(bad), bad).toMatch(/too common|keyboard sequence|Mix in/i);
    }
  });

  it("sees through leet substitutions", () => {
    // P@ssw0rd passes a naive "has upper, lower, digit and symbol" check, which
    // is exactly why a class count alone is not a strength test.
    for (const bad of ["P@ssw0rd", "p@ssword", "Passw0rd"]) {
      expect(passwordProblem(bad), bad).toMatch(/too common/i);
    }
  });

  it("rejects this product's own name", () => {
    expect(passwordProblem("squareshare")).toMatch(/too common/i);
    expect(passwordProblem("Squareshare123")).toMatch(/too common/i);
  });

  it("rejects one character repeated, however long", () => {
    expect(passwordProblem("aaaaaaaaaaaaaaaaaaaa")).toMatch(/easy to guess/i);
  });

  it("rejects embedded keyboard runs even inside a longer password", () => {
    expect(passwordProblem("Xy!qwertyui-Zz")).toMatch(/keyboard sequence/i);
    expect(passwordProblem("Boat12345678!x")).toMatch(/keyboard sequence/i);
  });
});

describe("passwordProblem - character mix", () => {
  it("requires a mix below the passphrase length", () => {
    expect(passwordProblem("kettleboat")).toMatch(/Mix in/i);
    expect(passwordProblem("kettleboat1")).toMatch(/Mix in/i); // only 2 classes
  });

  it("accepts three classes at short length", () => {
    expect(passwordProblem("Kettleboat1")).toBeNull();
  });

  it("lets a long passphrase skip the mix entirely", () => {
    // "correct horse battery staple" must not be the thing we reject.
    expect(passwordProblem("correct horse battery staple")).toBeNull();
    expect(passwordProblem("kettle boat lantern")).toBeNull();
  });
});

describe("passwordProblem - the user's own identity", () => {
  it("refuses a password that restates the username", () => {
    // The handle is PUBLIC, so this is an attacker's first free guess.
    expect(passwordProblem("Builderboy-99", { username: "builderboy" })).toMatch(
      /must not contain your email address or username/i,
    );
  });

  it("refuses a password that restates the email local part", () => {
    expect(passwordProblem("Adrian!2345", { email: "adrian@studio.com" })).toMatch(
      /must not contain your email address or username/i,
    );
  });

  it("catches it through leet substitutions too", () => {
    expect(passwordProblem("Bu1lderb0y!x", { username: "builderboy" })).toMatch(
      /must not contain your email address or username/i,
    );
  });

  it("ignores identities too short to mean anything", () => {
    // A 3-character handle would otherwise ban half the dictionary.
    expect(passwordProblem("Boathouse-1", { username: "abc" })).toBeNull();
  });

  it("does not fire when the identity is absent", () => {
    expect(passwordProblem(GOOD)).toBeNull();
    expect(passwordProblem(GOOD, {})).toBeNull();
  });
});

describe("passwordProblem - the happy path", () => {
  it("accepts a reasonable password", () => {
    for (const good of [GOOD, "Kettle-Boat-99", "n0rthern lights over ice"]) {
      expect(passwordProblem(good), good).toBeNull();
    }
  });

  it("returns exactly one message, never a lecture", () => {
    // "password" breaks several rules at once; the form shows one line.
    const problem = passwordProblem("password");
    expect(typeof problem).toBe("string");
    expect(problem!.split("\n")).toHaveLength(1);
  });
});
