import assert from "node:assert/strict";
import { describe, test } from "node:test";

import {
  assertTestAuthEnvironmentSafety,
  isTestAuthRuntimeEnabled,
  readTestAuthOverrideFromReaders,
  readTestAuthOverrideFromRequest,
  type TestAuthGuardEnv,
} from "@/lib/server/test-auth-guard";

function makeEnv(overrides: Partial<TestAuthGuardEnv> = {}): TestAuthGuardEnv {
  return {
    TEST_AUTH_MODE: "1",
    TEST_AUTH_SECRET: "top-secret",
    NEXT_PUBLIC_TEST_AUTH_MODE: "1",
    VERCEL: undefined,
    VERCEL_ENV: undefined,
    ...overrides,
  };
}

describe("isTestAuthRuntimeEnabled", () => {
  test("enables overrides in local runtime when TEST_AUTH_MODE=1", () => {
    assert.equal(isTestAuthRuntimeEnabled(makeEnv()), true);
  });

  test("disables overrides when TEST_AUTH_MODE is not enabled", () => {
    assert.equal(
      isTestAuthRuntimeEnabled(makeEnv({ TEST_AUTH_MODE: "0" })),
      false,
    );
  });

  test("disables overrides when running on Vercel", () => {
    assert.equal(isTestAuthRuntimeEnabled(makeEnv({ VERCEL: "1" })), false);
  });

  test("disables overrides for Vercel preview env", () => {
    assert.equal(
      isTestAuthRuntimeEnabled(makeEnv({ VERCEL_ENV: "preview" })),
      false,
    );
  });

  test("disables overrides for Vercel production env", () => {
    assert.equal(
      isTestAuthRuntimeEnabled(makeEnv({ VERCEL_ENV: "production" })),
      false,
    );
  });
});

describe("assertTestAuthEnvironmentSafety", () => {
  test("allows test-auth env vars outside preview/production", () => {
    assert.doesNotThrow(() => {
      assertTestAuthEnvironmentSafety(makeEnv({ VERCEL_ENV: "development" }));
    });
  });

  test("throws when test-auth env is set in preview", () => {
    assert.throws(() => {
      assertTestAuthEnvironmentSafety(makeEnv({ VERCEL_ENV: "preview" }));
    }, /forbidden in Vercel preview\/production/i);
  });

  test("throws when NEXT_PUBLIC_TEST_AUTH_MODE is set in production", () => {
    assert.throws(() => {
      assertTestAuthEnvironmentSafety(
        makeEnv({
          VERCEL_ENV: "production",
          TEST_AUTH_MODE: undefined,
          TEST_AUTH_SECRET: undefined,
          NEXT_PUBLIC_TEST_AUTH_MODE: "1",
        }),
      );
    }, /forbidden in Vercel preview\/production/i);
  });
});

describe("readTestAuthOverrideFromReaders", () => {
  test("accepts a valid header override with matching secret", () => {
    const override = readTestAuthOverrideFromReaders(
      {
        getHeader(name) {
          const table: Record<string, string> = {
            "x-test-auth-secret": "top-secret",
            "x-test-user-id": "user_test_host",
            "x-test-user-email": "ADMIN@EXAMPLE.COM",
          };
          return table[name] ?? null;
        },
        getCookie() {
          return null;
        },
      },
      makeEnv(),
    );

    assert.deepEqual(override, {
      userId: "user_test_host",
      userEmail: "admin@example.com",
    });
  });

  test("rejects override when secret is missing", () => {
    const override = readTestAuthOverrideFromReaders(
      {
        getHeader(name) {
          const table: Record<string, string> = {
            "x-test-user-id": "user_test_host",
          };
          return table[name] ?? null;
        },
        getCookie() {
          return null;
        },
      },
      makeEnv(),
    );

    assert.equal(override, null);
  });

  test("rejects override when secret mismatches", () => {
    const override = readTestAuthOverrideFromReaders(
      {
        getHeader(name) {
          const table: Record<string, string> = {
            "x-test-auth-secret": "wrong-secret",
            "x-test-user-id": "user_test_host",
          };
          return table[name] ?? null;
        },
        getCookie() {
          return null;
        },
      },
      makeEnv(),
    );

    assert.equal(override, null);
  });

  test("accepts cookie-based override for browser contexts", () => {
    const override = readTestAuthOverrideFromReaders(
      {
        getHeader() {
          return null;
        },
        getCookie(name) {
          const table: Record<string, string> = {
            test_auth_secret: "top-secret",
            test_user_id: "user_cookie_player",
            test_user_email: "player@example.com",
          };
          return table[name] ?? null;
        },
      },
      makeEnv(),
    );

    assert.deepEqual(override, {
      userId: "user_cookie_player",
      userEmail: "player@example.com",
    });
  });
});

describe("readTestAuthOverrideFromRequest", () => {
  test("ignores override in preview/prod-like envs", () => {
    const request = new Request("https://example.test", {
      headers: {
        cookie: "test_auth_secret=top-secret; test_user_id=user_from_cookie",
      },
    });

    const override = readTestAuthOverrideFromRequest(
      request,
      makeEnv({ VERCEL_ENV: "preview" }),
    );

    assert.equal(override, null);
  });
});
