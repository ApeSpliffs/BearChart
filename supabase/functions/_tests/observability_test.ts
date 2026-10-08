// Runs with no permissions: withObservability must not touch Deno.env when
// an env getter is injected, and must not load Sentry without a DSN.
import { assertEquals } from "@std/assert";
import {
  type SentryLike,
  withObservability,
} from "../_shared/observability.ts";

const req = () => new Request("http://local/fn", { method: "POST" });
const noEnv = () => undefined;
const quiet = <T>(fn: () => Promise<T>) => async () => {
  const orig = console.error;
  console.error = () => {};
  try {
    return await fn();
  } finally {
    console.error = orig;
  }
};

class FakeSentry implements SentryLike {
  inits: Record<string, unknown>[] = [];
  captured: unknown[] = [];
  tags: Record<string, string> = {};
  init(o: Record<string, unknown>) {
    this.inits.push(o);
  }
  setTag(k: string, v: string) {
    this.tags[k] = v;
  }
  withScope(cb: (s: { setTag(k: string, v: string): void }) => void) {
    cb(this);
  }
  captureException(e: unknown) {
    this.captured.push(e);
  }
  flush() {
    return Promise.resolve(true);
  }
}

Deno.test("a successful response passes through untouched", async () => {
  const h = withObservability(
    "t",
    () => Promise.resolve(new Response("ok", { status: 201 })),
    { env: noEnv },
  );
  const res = await h(req());
  assertEquals(res.status, 201);
  assertEquals(await res.text(), "ok");
});

Deno.test(
  "a thrown error becomes a bare 500 and Sentry stays unloaded without a DSN",
  quiet(async () => {
    let loads = 0;
    const h = withObservability(
      "t",
      () => Promise.reject(new Error("secret detail")),
      {
        env: noEnv,
        loadSentry: () => {
          loads++;
          return Promise.resolve(new FakeSentry());
        },
      },
    );
    const res = await h(req());
    assertEquals(res.status, 500);
    assertEquals(await res.json(), { error: "internal error" });
    assertEquals(loads, 0);
  }),
);

Deno.test(
  "with a DSN the error is captured once Sentry is initialised",
  quiet(async () => {
    const fake = new FakeSentry();
    const env = (k: string) =>
      ({
        SENTRY_DSN: "https://k@o1.ingest.us.sentry.io/1",
        BEARCHART_ENV: "preview",
      } as Record<string, string>)[k];
    const boom = new Error("boom");
    const h = withObservability("stripe-webhook", () => Promise.reject(boom), {
      env,
      loadSentry: () => Promise.resolve(fake),
    });
    assertEquals((await h(req())).status, 500);
    assertEquals((await h(req())).status, 500);
    assertEquals(fake.inits.length, 1, "initialised once per isolate");
    assertEquals(fake.inits[0].environment, "preview");
    assertEquals(fake.inits[0].sendDefaultPii, false);
    assertEquals(fake.tags.function, "stripe-webhook");
    assertEquals(fake.captured, [boom, boom]);
  }),
);
