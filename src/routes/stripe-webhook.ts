import type { FastifyPluginAsync } from "fastify";
import Stripe from "stripe";

import { createPaymentsService } from "../modules/payments/service.js";
import { createUserService } from "../modules/user/service.js";

export const stripeWebhookRoutes: FastifyPluginAsync = async (app) => {
  if (!app.config.STRIPE_SECRET_KEY || !app.config.STRIPE_WEBHOOK_SECRET) {
    app.log.warn("stripe.webhook.skipped_no_keys");
    return;
  }

  const stripe = new Stripe(app.config.STRIPE_SECRET_KEY);
  const payments = createPaymentsService(app.supabase, app.log);
  const users = createUserService(app.supabase, app.log);

  app.addContentTypeParser(
    "application/json",
    { parseAs: "buffer" },
    (_req, body, done) => {
      done(null, body);
    },
  );

  app.post("/api/stripe-webhook", async (request, reply) => {
    const sig = request.headers["stripe-signature"];
    if (!sig || !app.config.STRIPE_WEBHOOK_SECRET) {
      return reply.status(400).send({ error: "missing_signature" });
    }

    let event: Stripe.Event;
    try {
      event = stripe.webhooks.constructEvent(
        request.body as Buffer,
        sig,
        app.config.STRIPE_WEBHOOK_SECRET,
      );
    } catch (err) {
      app.log.warn({ err }, "stripe.webhook.signature_invalid");
      return reply.status(400).send({ error: "invalid_signature" });
    }

    app.log.info({ eventType: event.type, eventId: event.id }, "stripe.webhook.received");

    try {
      switch (event.type) {
        case "checkout.session.completed":
          await handleCheckoutCompleted(event);
          break;

        case "checkout.session.expired":
          await handleCheckoutExpired(event);
          break;

        case "payment_intent.succeeded":
          app.log.info(
            { eventId: event.id, paymentIntentId: (event.data.object as Stripe.PaymentIntent).id },
            "stripe.payment_intent.succeeded",
          );
          break;

        case "payment_intent.payment_failed":
          await handlePaymentFailed(event);
          break;

        case "charge.refunded":
          await handleChargeRefunded(event);
          break;

        default:
          app.log.debug({ eventType: event.type, eventId: event.id }, "stripe.webhook.unhandled_event");
          break;
      }
    } catch (err) {
      app.log.error({ err, eventType: event.type, eventId: event.id }, "stripe.webhook.handler_error");
    }

    return reply.status(200).send({ received: true });
  });

  async function handleCheckoutCompleted(event: Stripe.Event): Promise<void> {
    const already = await payments.isEventProcessed(event.id);
    if (already) {
      app.log.info({ eventId: event.id }, "stripe.webhook.duplicate_skipped");
      return;
    }

    const session = event.data.object as Stripe.Checkout.Session;
    const telegramId = session.metadata?.["telegram_id"];
    const creditsStr = session.metadata?.["credits"];

    if (!telegramId || !creditsStr) {
      app.log.warn({ eventId: event.id }, "stripe.checkout.missing_metadata");
      return;
    }

    const creditsToAdd = Number.parseInt(creditsStr, 10);
    if (!Number.isFinite(creditsToAdd) || creditsToAdd <= 0) {
      app.log.warn({ creditsStr, eventId: event.id }, "stripe.checkout.invalid_credits");
      return;
    }

    const user = await users.findByTelegramId(BigInt(telegramId));
    if (!user) {
      app.log.warn({ telegramId, eventId: event.id }, "stripe.checkout.user_not_found");
      return;
    }

    const newBalance = await payments.addCredits(user.id, creditsToAdd);
    await payments.markEventProcessed(event.id);

    app.log.info(
      { userId: user.id, telegramId, creditsAdded: creditsToAdd, newBalance, eventId: event.id },
      "stripe.checkout.credits_added",
    );

    await sendTelegramMessage(
      Number(telegramId),
      `You're back… 💕\nGot your ${creditsToAdd} credits. Let's continue.\n\n💰 Balance: ${newBalance} credits`,
    );
  }

  async function handleCheckoutExpired(event: Stripe.Event): Promise<void> {
    const session = event.data.object as Stripe.Checkout.Session;
    const telegramId = session.metadata?.["telegram_id"];

    app.log.info({ telegramId, eventId: event.id }, "stripe.checkout.expired");

    if (telegramId) {
      await sendTelegramMessage(
        Number(telegramId),
        "Hey… you left me hanging 😔\nThe payment window expired. Wanna try again?",
      );
    }
  }

  async function handlePaymentFailed(event: Stripe.Event): Promise<void> {
    const intent = event.data.object as Stripe.PaymentIntent;
    const telegramId = intent.metadata?.["telegram_id"];

    app.log.warn(
      { telegramId, eventId: event.id, intentId: intent.id },
      "stripe.payment.failed",
    );

    if (telegramId) {
      await sendTelegramMessage(
        Number(telegramId),
        "Something went wrong with the payment… 😔\nWanna try again? I'll be right here.",
      );
    }
  }

  async function handleChargeRefunded(event: Stripe.Event): Promise<void> {
    const already = await payments.isEventProcessed(event.id);
    if (already) return;

    const charge = event.data.object as Stripe.Charge;
    const paymentIntentId = typeof charge.payment_intent === "string"
      ? charge.payment_intent
      : charge.payment_intent?.id;

    if (!paymentIntentId) {
      app.log.warn({ eventId: event.id }, "stripe.refund.no_payment_intent");
      return;
    }

    let telegramId: string | undefined;
    let creditsStr: string | undefined;
    try {
      const pi = await stripe.paymentIntents.retrieve(paymentIntentId);
      telegramId = pi.metadata?.["telegram_id"];
      creditsStr = pi.metadata?.["credits"];
    } catch {
      const sessions = await stripe.checkout.sessions.list({ payment_intent: paymentIntentId, limit: 1 });
      const sess = sessions.data[0];
      telegramId = sess?.metadata?.["telegram_id"];
      creditsStr = sess?.metadata?.["credits"];
    }

    if (!telegramId || !creditsStr) {
      app.log.warn({ eventId: event.id }, "stripe.refund.missing_metadata");
      return;
    }

    const creditsToRemove = Number.parseInt(creditsStr, 10);
    if (!Number.isFinite(creditsToRemove) || creditsToRemove <= 0) return;

    const user = await users.findByTelegramId(BigInt(telegramId));
    if (!user) return;

    const res = await app.supabase.rpc("try_consume_user_credits", {
      p_user_id: user.id,
      p_amount: creditsToRemove,
    });

    await payments.markEventProcessed(event.id);

    const deducted = res.data?.[0]?.success === true;
    app.log.info(
      { userId: user.id, telegramId, creditsRemoved: creditsToRemove, deducted, eventId: event.id },
      "stripe.refund.processed",
    );
  }

  async function sendTelegramMessage(chatId: number, text: string): Promise<void> {
    try {
      await app.telegraf.telegram.sendMessage(chatId, text);
    } catch (err) {
      app.log.warn({ err, chatId }, "stripe.webhook.telegram_notify_failed");
    }
  }
};
