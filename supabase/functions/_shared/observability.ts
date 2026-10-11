/**
 * Error reporting (Sentry) for edge functions. Inert until SENTRY_DSN is set:
 * without it nothing is imported, nothing is sent, and a thrown error still
 * becomes a plain 500 with no detail.
 *
 *   Deno.serve(withObservability("stripe-webhook", handler));
 *
 * Never attach request bodies, Stripe payloads or emails to events. Webhook
 * errors should carry only the event id and type.
 */

import { bearchartEnv, type EnvGet } from "./env.ts";

type Handler = (req: Request) => Promise<Response>;

/** The slice of @sentry/deno this module uses (lets tests pass a fake). */
export interface SentryLike {
  init(options: Record<string, unknown>): void;
  setTag(key: string, value: string): void;
  withScope(
    cb: (scope: { setTag(key: string, value: string): void }) => void,
  ): void;
  captureException(e: unknown): void;
  flush(timeoutMs?: number): Promise<boolean>;
}

export interface ObservabilityDeps {
  /** Defaults to Deno.env, read lazily on the first request. */
  env?: EnvGet;
  /** Defaults to a dynamic import of @sentry/deno, only when a DSN is set. */
  loadSentry?: () => Promise<SentryLike>;
}

const denoEnv: EnvGet = (k) => Deno.env.get(k);
const importSentry = async (): Promise<SentryLike> =>
  (await import("@sentry/deno")) as unknown as SentryLike;

const INTERNAL_ERROR = () =>
  new Response(JSON.stringify({ error: "internal error" }), {
    status: 500,
    headers: { "content-type": "application/json" },
  });

export function withObservability(
  fn: string,
  handler: Handler,
  deps: ObservabilityDeps = {},
): Handler {
  const env = deps.env ?? denoEnv;
  const load = deps.loadSentry ?? importSentry;
  let sentry: Promise<SentryLike | null> | null = null;

  function init(): Promise<SentryLike | null> {
    if (sentry) return sentry;
    const dsn = env("SENTRY_DSN");
    if (!dsn) return (sentry = Promise.resolve(null)); // inert until configured
    sentry = load().then((S) => {
      S.init({
        dsn,
        environment: bearchartEnv(env),
        release: env("BEARCHART_RELEASE") || undefined,
        defaultIntegrations: false, // shared isolate: no global scope leakage
        tracesSampleRate: 0,
        sendDefaultPii: false,
      });
      S.setTag("function", fn);
      S.setTag("region", env("SB_REGION") ?? "unknown");
      return S;
    }).catch((e) => {
      console.error(
        "observability: Sentry failed to load:",
        (e as Error).message,
      );
      return null;
    });
    return sentry;
  }

  return async (req: Request): Promise<Response> => {
    try {
      return await handler(req);
    } catch (e) {
      console.error(
        `${fn}: unhandled error:`,
        (e as Error)?.message ?? String(e),
      );
      const S = await init();
      if (S) {
        S.withScope((scope) => {
          scope.setTag("function", fn);
          S.captureException(e);
        });
        await S.flush(2000);
      }
      return INTERNAL_ERROR();
    }
  };
}
