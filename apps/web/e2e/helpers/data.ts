/** Test data helpers. Unique-per-run identities keep specs isolated on the shared Postgres. */

export interface TestUser {
  email: string;
  password: string;
  name: string;
}

let counter = 0;

/** A fresh, unique user each call (timestamp + counter — fine in Playwright, unlike workflows). */
export function makeUser(): TestUser {
  counter += 1;
  const stamp = `${Date.now().toString(36)}-${counter}`;
  return {
    email: `e2e-${stamp}@tendto.test`,
    password: "e2e-password-123",
    name: `e2e-${stamp}`,
  };
}
