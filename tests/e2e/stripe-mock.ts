import { createHmac, randomBytes } from "node:crypto";
import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";

/**
 * A STAND-IN FOR STRIPE, for the Connect specs (playwright.connect.config.ts).
 *
 * The app talks to it instead of api.stripe.com (STRIPE_API_BASE, honoured
 * outside production builds only: lib/billing/stripe-api.ts), and the browser
 * visits it where it would visit Stripe's hosted pages. It answers just the
 * calls the app makes, in Stripe's own shapes:
 *
 *   the API      accounts, account links, checkout sessions (create, expire),
 *                refunds, balance, payouts, balance transactions
 *   the pages    onboarding (finishes at once and sends the seller back) and
 *                the payment page (a Pay link and a Cancel link)
 *   the events   a signed checkout.session.completed when a buyer pays, and
 *                `sendEvent` for anything else a spec wants delivered
 *
 * WHAT THIS PROVES, AND WHAT IT CANNOT. It proves OUR half: what we ask Stripe
 * for (the amount, our fee, whose account), what we do with what comes back,
 * and that only a correctly signed event from the right account changes an
 * order. It proves nothing about Stripe's half: that these are the parameters
 * Stripe accepts, or that its events really look like this. That needs a run
 * against Stripe's test mode with real keys.
 *
 * Lives in the SPEC's process, so a spec can read what was asked of it and
 * turn its knobs. One fixed port: the run has one worker.
 */

export const STRIPE_MOCK_PORT = 54390;
export const STRIPE_MOCK_ORIGIN = `http://127.0.0.1:${STRIPE_MOCK_PORT}`;
/** Test-mode shaped, and obviously not real. */
export const STRIPE_MOCK_KEY = "sk_test_e2e_not_a_real_key";
export const STRIPE_MOCK_WEBHOOK_SECRET = "whsec_e2e_not_a_real_secret";

/** Where the app under test listens (the e2e stack's own port). */
const APP_ORIGIN = "http://localhost:3100";
const WEBHOOK_URL = `${APP_ORIGIN}/api/payments/webhook`;

export type MockAccount = {
  id: string;
  charges_enabled: boolean;
  payouts_enabled: boolean;
  details_submitted: boolean;
  email: string | null;
};

export type MockSession = {
  id: string;
  /** The connected account it was created ON (the Stripe-Account header). */
  account: string | null;
  url: string;
  status: "open" | "complete" | "expired";
  payment_status: "unpaid" | "paid";
  payment_intent: string | null;
  client_reference_id: string | null;
  customer_email: string | null;
  amount_total: number;
  currency: string;
  application_fee_amount: number | null;
  /** What the session's metadata said, as the dashboard would show it. */
  metadata: Record<string, string>;
  /** How much of the payment has gone back. */
  amount_refunded: number;
  success_url: string;
  cancel_url: string;
  line_items: { name: string; amount: number }[];
};

/** The platform's cut of one payment: Stripe's application fee object. It
 *  lives on the PLATFORM account, and each return of it is a refund of its own. */
export type MockFee = {
  id: string;
  payment_intent: string;
  amount: number;
  amount_refunded: number;
  currency: string;
  refunds: { id: string; amount: number }[];
};

export type MockRefund = {
  id: string;
  account: string | null;
  payment_intent: string | null;
  refund_application_fee: boolean;
  /** Null for the whole payment. */
  amount: number | null;
  idempotencyKey: string | null;
};

export type StripeMock = {
  accounts: Map<string, MockAccount>;
  sessions: Map<string, MockSession>;
  refunds: MockRefund[];
  /** Application fees collected, by fee id. */
  fees: Map<string, MockFee>;
  knobs: {
    /** Whether visiting onboarding clears the account to take payments. */
    onboardingCompletes: boolean;
    /** Refuse the next refunds, the way Stripe does when it cannot make one. */
    refuseRefunds: boolean;
    /** Send the paid event when a buyer pays. Off, to watch an order wait. */
    announcePayments: boolean;
    /** Collect this many cents LESS than the fee that was asked for, to see
     *  the app follow the money rather than its own arithmetic. */
    feeShortfallCents: number;
  };
  /** The session a buyer is sent to for one of OUR checkout ids. */
  sessionFor(checkoutSessionId: string): MockSession | undefined;
  /** The fee collected on a payment, if it carried one. */
  feeFor(paymentIntent: string): MockFee | undefined;
  /**
   * A refund made in the provider's own dashboard: `amountCents` of the
   * payment (all of it when left out), our fee going back in proportion. Sends
   * the charge.refunded event and answers with the app's reply to it.
   */
  refundInDashboard(paymentIntent: string, amountCents?: number): Promise<Response>;
  /** Deliver a signed event to the app's Connect webhook. */
  sendEvent(event: {
    type: string;
    account: string | null;
    object: Record<string, unknown>;
    id?: string;
    livemode?: boolean;
    secret?: string;
  }): Promise<Response>;
  close(): Promise<void>;
};

const id = (prefix: string) => `${prefix}${randomBytes(12).toString("hex")}`;

/** How long after answering a refund the stand-in reports it, like Stripe:
 *  after the caller has its answer, never before. */
const REFUND_EVENT_DELAY_MS = 400;

function json(response: ServerResponse, status: number, body: unknown) {
  response.writeHead(status, { "content-type": "application/json" });
  response.end(JSON.stringify(body));
}

function stripeError(response: ServerResponse, status: number, code: string, message: string) {
  json(response, status, { error: { type: "invalid_request_error", code, message } });
}

function redirect(response: ServerResponse, to: string) {
  response.writeHead(302, { location: to });
  response.end();
}

async function readForm(request: IncomingMessage): Promise<URLSearchParams> {
  const chunks: Buffer[] = [];
  for await (const chunk of request) chunks.push(chunk as Buffer);
  return new URLSearchParams(Buffer.concat(chunks).toString("utf8"));
}

/** A session as the API returns it: Stripe's fields, none of the mock's own. */
function publicSession(session: MockSession) {
  return {
    id: session.id,
    object: "checkout.session",
    url: session.status === "open" ? session.url : null,
    status: session.status,
    payment_status: session.payment_status,
    payment_intent: session.payment_intent,
    client_reference_id: session.client_reference_id,
    customer_email: session.customer_email,
    amount_total: session.amount_total,
    currency: session.currency,
  };
}

export async function startStripeMock(): Promise<StripeMock> {
  const accounts = new Map<string, MockAccount>();
  const sessions = new Map<string, MockSession>();
  const refunds: MockRefund[] = [];
  const fees = new Map<string, MockFee>();
  /** Idempotency-Key to the answer first given for it, like Stripe's. */
  const answered = new Map<string, unknown>();
  const knobs = { onboardingCompletes: true, refuseRefunds: false, announcePayments: true, feeShortfallCents: 0 };

  const sessionOfPayment = (paymentIntent: string | null) =>
    paymentIntent ? [...sessions.values()].find((session) => session.payment_intent === paymentIntent) : undefined;
  const feeOfPayment = (paymentIntent: string | null) =>
    paymentIntent ? [...fees.values()].find((fee) => fee.payment_intent === paymentIntent) : undefined;
  /** A charge as far as the app reads one. */
  const chargeOf = (session: MockSession) => ({
    id: `ch_${session.id.slice(-20)}`,
    object: "charge",
    payment_intent: session.payment_intent,
    amount: session.amount_total,
    amount_refunded: session.amount_refunded,
    refunded: session.amount_refunded >= session.amount_total,
    application_fee: feeOfPayment(session.payment_intent)?.id ?? null,
    application_fee_amount: session.application_fee_amount,
  });

  /**
   * Take `amountCents` of a payment back (all that is left when null), and
   * with `withFee` the same share of our fee, the way Stripe does it.
   */
  function applyRefund(session: MockSession, amountCents: number | null, withFee: boolean) {
    const left = session.amount_total - session.amount_refunded;
    const refunded = Math.min(left, amountCents ?? left);
    session.amount_refunded += refunded;
    const fee = feeOfPayment(session.payment_intent);
    if (withFee && fee && refunded > 0) {
      const whole = session.amount_refunded >= session.amount_total;
      const share = whole
        ? fee.amount - fee.amount_refunded
        : Math.min(fee.amount - fee.amount_refunded, Math.round((fee.amount * refunded) / session.amount_total));
      if (share > 0) {
        fee.amount_refunded += share;
        fee.refunds.push({ id: id("fr_e2e"), amount: share });
      }
    }
  }

  async function sendEvent(event: {
    type: string;
    account: string | null;
    object: Record<string, unknown>;
    id?: string;
    livemode?: boolean;
    secret?: string;
  }): Promise<Response> {
    const body = JSON.stringify({
      id: event.id ?? id("evt_e2e"),
      type: event.type,
      livemode: event.livemode ?? false,
      account: event.account,
      data: { object: event.object },
    });
    const timestamp = Math.floor(Date.now() / 1000);
    const signature = createHmac("sha256", event.secret ?? STRIPE_MOCK_WEBHOOK_SECRET)
      .update(`${timestamp}.${body}`)
      .digest("hex");
    return fetch(WEBHOOK_URL, {
      method: "POST",
      headers: { "content-type": "application/json", "stripe-signature": `t=${timestamp},v1=${signature}` },
      body,
    });
  }

  async function api(request: IncomingMessage, response: ServerResponse, path: string, query: URLSearchParams) {
    if (request.headers.authorization !== `Bearer ${STRIPE_MOCK_KEY}`) {
      return stripeError(response, 401, "api_key_invalid", "Invalid API key provided");
    }
    const onAccount = (request.headers["stripe-account"] as string | undefined) ?? null;
    const idempotencyKey = (request.headers["idempotency-key"] as string | undefined) ?? null;
    const form = request.method === "POST" ? await readForm(request) : query;
    const replay = idempotencyKey ? answered.get(idempotencyKey) : undefined;
    if (replay) return json(response, 200, replay);
    const answer = (body: unknown) => {
      if (idempotencyKey) answered.set(idempotencyKey, body);
      json(response, 200, body);
    };

    if (request.method === "POST" && path === "/accounts") {
      const account: MockAccount = {
        id: id("acct_e2e"),
        charges_enabled: false,
        payouts_enabled: false,
        details_submitted: false,
        email: form.get("email"),
      };
      accounts.set(account.id, account);
      return answer(account);
    }

    const accountMatch = /^\/accounts\/(acct_[A-Za-z0-9]+)$/.exec(path);
    if (request.method === "GET" && accountMatch) {
      const account = accounts.get(accountMatch[1]);
      return account ? answer(account) : stripeError(response, 404, "resource_missing", "No such account");
    }

    if (request.method === "POST" && path === "/account_links") {
      const account = form.get("account") ?? "";
      if (!accounts.has(account)) return stripeError(response, 404, "resource_missing", "No such account");
      const back = encodeURIComponent(form.get("return_url") ?? "");
      return answer({ object: "account_link", url: `${STRIPE_MOCK_ORIGIN}/connect/onboarding?account=${account}&return=${back}` });
    }

    if (request.method === "POST" && path === "/checkout/sessions") {
      if (!onAccount || !accounts.get(onAccount)?.charges_enabled) {
        return stripeError(response, 400, "account_invalid", "This account cannot take payments");
      }
      const lines: { name: string; amount: number }[] = [];
      for (let index = 0; form.has(`line_items[${index}][quantity]`); index += 1) {
        lines.push({
          name: form.get(`line_items[${index}][price_data][product_data][name]`) ?? "",
          amount:
            Number(form.get(`line_items[${index}][price_data][unit_amount]`)) *
            Number(form.get(`line_items[${index}][quantity]`)),
        });
      }
      const sessionId = id("cs_test_e2e");
      const fee = form.get("payment_intent_data[application_fee_amount]");
      const metadata: Record<string, string> = {};
      for (const [key, value] of form) {
        const name = /^metadata\[([a-z_]+)\]$/.exec(key)?.[1];
        if (name) metadata[name] = value;
      }
      const session: MockSession = {
        id: sessionId,
        account: onAccount,
        url: `${STRIPE_MOCK_ORIGIN}/pay/${sessionId}`,
        status: "open",
        payment_status: "unpaid",
        payment_intent: null,
        client_reference_id: form.get("client_reference_id"),
        customer_email: form.get("customer_email"),
        amount_total: lines.reduce((sum, line) => sum + line.amount, 0),
        currency: form.get("line_items[0][price_data][currency]") ?? "",
        application_fee_amount: fee === null ? null : Number(fee),
        metadata,
        amount_refunded: 0,
        success_url: form.get("success_url") ?? "",
        cancel_url: form.get("cancel_url") ?? "",
        line_items: lines,
      };
      sessions.set(sessionId, session);
      return answer(publicSession(session));
    }

    const expireMatch = /^\/checkout\/sessions\/(cs_[A-Za-z0-9_]+)\/expire$/.exec(path);
    if (request.method === "POST" && expireMatch) {
      const session = sessions.get(expireMatch[1]);
      if (!session || session.account !== onAccount) {
        return stripeError(response, 404, "resource_missing", "No such checkout session");
      }
      // Stripe's own rule, and the one the cancel route leans on: only an open
      // session can be expired, so a paid one is never released.
      if (session.status !== "open") {
        return stripeError(response, 400, "checkout_session_not_open", "Only open sessions can be expired");
      }
      session.status = "expired";
      return answer(publicSession(session));
    }

    if (request.method === "POST" && path === "/refunds") {
      if (knobs.refuseRefunds) {
        return stripeError(response, 400, "insufficient_funds", "Insufficient funds in the account");
      }
      const amount = form.get("amount");
      const refund: MockRefund = {
        id: id("re_e2e"),
        account: onAccount,
        payment_intent: form.get("payment_intent"),
        refund_application_fee: form.get("refund_application_fee") === "true",
        amount: amount === null ? null : Number(amount),
        idempotencyKey,
      };
      refunds.push(refund);
      const refunded = sessionOfPayment(refund.payment_intent);
      if (refunded && refunded.account === onAccount) {
        applyRefund(refunded, refund.amount, refund.refund_application_fee);
        // Stripe tells the platform about it a moment AFTER answering.
        setTimeout(() => {
          sendEvent({ type: "charge.refunded", account: refunded.account, object: chargeOf(refunded) }).catch(
            (error) => console.error("[stripe mock] charge.refunded was not delivered", error),
          );
        }, REFUND_EVENT_DELAY_MS);
      }
      return answer({ id: refund.id, object: "refund", status: "succeeded" });
    }

    // The payment behind an order, with its charge: where the app learns
    // which fee object is ours. On the seller's account only.
    const intent = /^\/payment_intents\/(pi_[A-Za-z0-9_]+)$/.exec(path);
    if (request.method === "GET" && intent) {
      const session = sessionOfPayment(intent[1]);
      if (!session || session.account !== onAccount) {
        return stripeError(response, 404, "resource_missing", `No such payment_intent: ${intent[1]}`);
      }
      return answer({ id: intent[1], object: "payment_intent", latest_charge: chargeOf(session) });
    }

    // Our cut of a payment, and each return of it. The PLATFORM's objects: a
    // request made on a connected account does not find them.
    const feePath = /^\/application_fees\/(fee_[A-Za-z0-9_]+)(\/refunds)?$/.exec(path);
    if (request.method === "GET" && feePath) {
      const fee = onAccount === null ? fees.get(feePath[1]) : undefined;
      if (!fee) return stripeError(response, 404, "resource_missing", `No such application fee: ${feePath[1]}`);
      if (feePath[2]) {
        return answer({
          object: "list",
          has_more: false,
          data: fee.refunds.map((refund) => ({ ...refund, object: "fee_refund", fee: fee.id })),
        });
      }
      return answer({
        id: fee.id,
        object: "application_fee",
        amount: fee.amount,
        amount_refunded: fee.amount_refunded,
        currency: fee.currency,
        livemode: false,
      });
    }

    // What the Payments tab reads, worked out from the payments made here.
    const paid = [...sessions.values()].filter(
      (session) => session.account === onAccount && session.payment_status === "paid",
    );
    if (request.method === "GET" && path === "/balance") {
      const net = paid.reduce((sum, session) => sum + session.amount_total - (session.application_fee_amount ?? 0), 0);
      return answer({ object: "balance", available: [], pending: [{ amount: net, currency: "eur" }] });
    }
    if (request.method === "GET" && path === "/payouts") {
      return answer({ object: "list", data: [], has_more: false });
    }
    if (request.method === "GET" && path === "/balance_transactions") {
      return answer({
        object: "list",
        has_more: false,
        data: paid.map((session) => ({
          id: `txn_${session.id.slice(-20)}`,
          type: "charge",
          amount: session.amount_total,
          fee: session.application_fee_amount ?? 0,
          net: session.amount_total - (session.application_fee_amount ?? 0),
          currency: session.currency,
          description: session.line_items[0]?.name ?? null,
          created: Math.floor(Date.now() / 1000),
          status: "pending",
        })),
      });
    }

    return stripeError(response, 404, "url_invalid", `Unrecognized request URL (${request.method} ${path})`);
  }

  async function pages(response: ServerResponse, path: string, query: URLSearchParams) {
    // Onboarding: over in one visit. The seller is sent straight back, cleared
    // to take payments or not, as the knob says.
    if (path === "/connect/onboarding") {
      const account = accounts.get(query.get("account") ?? "");
      if (!account) return json(response, 404, { error: "no such account" });
      if (knobs.onboardingCompletes) {
        account.charges_enabled = true;
        account.payouts_enabled = true;
        account.details_submitted = true;
      }
      return redirect(response, query.get("return") ?? APP_ORIGIN);
    }

    const pay = /^\/pay\/(cs_[A-Za-z0-9_]+)(\/complete|\/cancel)?$/.exec(path);
    const session = pay ? sessions.get(pay[1]) : undefined;
    if (!pay || !session) return json(response, 404, { error: "no such page" });

    if (!pay[2]) {
      response.writeHead(200, { "content-type": "text/html; charset=utf-8" });
      return response.end(
        `<!doctype html><title>Stripe (simulated)</title>
         <main data-stripe-page="${session.status}" data-stripe-amount="${session.amount_total}">
           <h1>Pay ${session.amount_total} ${session.currency}</h1>
           <ul>${session.line_items.map((line) => `<li>${line.name}: ${line.amount}</li>`).join("")}</ul>
           <a id="pay" href="/pay/${session.id}/complete">Pay</a>
           <a id="cancel" href="/pay/${session.id}/cancel">Back</a>
         </main>`,
      );
    }
    if (pay[2] === "/cancel") return redirect(response, session.cancel_url);

    // Paying. An expired page takes no money, as Stripe's would not.
    if (session.status !== "open") return json(response, 410, { error: "this payment page has expired" });
    session.status = "complete";
    session.payment_status = "paid";
    session.payment_intent = id("pi_e2e");
    // Our cut, collected with the payment. No fee asked, no fee object.
    const collected = Math.max(0, (session.application_fee_amount ?? 0) - knobs.feeShortfallCents);
    if ((session.application_fee_amount ?? 0) > 0) {
      const fee: MockFee = {
        id: id("fee_e2e"),
        payment_intent: session.payment_intent,
        amount: collected,
        amount_refunded: 0,
        currency: session.currency,
        refunds: [],
      };
      fees.set(fee.id, fee);
    }
    if (knobs.announcePayments) {
      await sendEvent({
        type: "checkout.session.completed",
        account: session.account,
        object: publicSession(session),
      });
    }
    return redirect(response, session.success_url);
  }

  const server: Server = createServer((request, response) => {
    const url = new URL(request.url ?? "/", STRIPE_MOCK_ORIGIN);
    const work = url.pathname.startsWith("/v1/")
      ? api(request, response, url.pathname.slice(3), url.searchParams)
      : pages(response, url.pathname, url.searchParams);
    work.catch((error) => {
      console.error("[stripe mock]", error);
      if (!response.headersSent) json(response, 500, { error: { type: "api_error", message: String(error) } });
    });
  });
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(STRIPE_MOCK_PORT, "127.0.0.1", resolve);
  });

  return {
    accounts,
    sessions,
    refunds,
    fees,
    knobs,
    sessionFor: (checkoutSessionId) =>
      [...sessions.values()].find((session) => session.client_reference_id === checkoutSessionId),
    feeFor: (paymentIntent) => feeOfPayment(paymentIntent),
    refundInDashboard: async (paymentIntent, amountCents) => {
      const session = sessionOfPayment(paymentIntent);
      if (!session) throw new Error(`no payment ${paymentIntent} to refund`);
      applyRefund(session, amountCents ?? null, true);
      return sendEvent({ type: "charge.refunded", account: session.account, object: chargeOf(session) });
    },
    sendEvent,
    close: () =>
      new Promise<void>((resolve) => {
        server.closeAllConnections();
        server.close(() => resolve());
      }),
  };
}
