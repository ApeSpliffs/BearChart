/**
 * HTTP edge of the Stripe webhook.
 *
 * Rule 1: verify the signature before reading anything in the body. An
 * unverified webhook is an open endpoint that hands out memberships; the
 * signature is the only proof Stripe sent it. The RAW body is required - any
 * reserialisation changes the bytes the signature was computed over.
 */

import type { Logger } from "./ports.ts";
import type { BillingService } from "./service.ts";
import type { BillingEvent } from "./types.ts";

export type VerifyEvent = (
  body: string,
  signature: string,
) => Promise<BillingEvent>;

export interface WebhookHandlerDeps {
  verify: VerifyEvent;
  service: BillingService;
  log: Logger;
}

const okJson = (body: unknown) =>
  new Response(JSON.stringify(body), {
    status: 200,
    headers: { "content-type": "application/json" },
  });

export function createWebhookHandler(deps: WebhookHandlerDeps) {
  const { verify, service, log } = deps;
  return async (req: Request): Promise<Response> => {
    if (req.method !== "POST") {
      return new Response("method not allowed", { status: 405 });
    }
    const sig = req.headers.get("stripe-signature");
    if (!sig) return new Response("missing signature", { status: 400 });

    const body = await req.text();
    let event: BillingEvent;
    try {
      event = await verify(body, sig);
    } catch (err) {
      // Never log the body: an unverified payload is attacker-controlled.
      log.error(`signature verification failed: ${(err as Error)?.message}`);
      return new Response("invalid signature", { status: 400 });
    }

    try {
      const result = await service.handle(event);
      return result.status === "duplicate"
        ? okJson({ ok: true, duplicate: true })
        : okJson({ ok: true });
    } catch (err) {
      // Event id and type only - never the payload.
      log.error(`handling ${event.type} failed: ${(err as Error)?.message}`, {
        id: event.id,
      });
      return new Response("handler error", { status: 500 });
    }
  };
}
