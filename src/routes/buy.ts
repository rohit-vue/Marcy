import type { FastifyPluginAsync } from "fastify";
import Stripe from "stripe";

import { CREDIT_PACKS } from "../modules/payments/service.js";

export const buyRoutes: FastifyPluginAsync = async (app) => {
  app.get<{ Querystring: { tid?: string } }>("/buy", async (request, reply) => {
    const tid = request.query.tid;
    if (!tid) {
      return reply.status(400).type("text/html").send("<h1>Invalid link</h1>");
    }
    return reply.type("text/html").send(buildPricingHtml(tid));
  });

  app.get<{ Querystring: { tid?: string; pack?: string } }>(
    "/api/create-checkout",
    async (request, reply) => {
      const { tid, pack } = request.query;

      if (!tid || pack === undefined) {
        return reply.status(400).send({ error: "missing_params" });
      }

      if (!app.config.STRIPE_SECRET_KEY) {
        return reply.status(503).send({ error: "payments_not_configured" });
      }

      const packIndex = Number.parseInt(pack, 10);
      const creditPack = CREDIT_PACKS[packIndex];
      if (!creditPack) {
        return reply.status(400).send({ error: "invalid_pack" });
      }

      const stripe = new Stripe(app.config.STRIPE_SECRET_KEY);
      const botUsername = app.config.BOT_USERNAME;

      try {
        const session = await stripe.checkout.sessions.create({
          mode: "payment",
          expires_at: Math.floor(Date.now() / 1000) + 1800,
          line_items: [
            {
              price_data: {
                currency: "usd",
                unit_amount: creditPack.priceUsdCents,
                product_data: {
                  name: `${creditPack.credits} Credits`,
                  description: `Top up ${creditPack.credits} credits for your AI companion`,
                },
              },
              quantity: 1,
            },
          ],
          metadata: {
            telegram_id: tid,
            credits: String(creditPack.credits),
          },
          success_url: botUsername
            ? `https://t.me/${botUsername}?start=paid`
            : "https://t.me",
          cancel_url: botUsername
            ? `https://t.me/${botUsername}`
            : "https://t.me",
        });

        if (!session.url) {
          app.log.error({ tid, packIndex }, "buy.checkout.no_url");
          return reply.status(500).send({ error: "checkout_failed" });
        }

        return reply.redirect(session.url);
      } catch (err) {
        app.log.error({ err, tid, packIndex }, "buy.checkout.create_failed");
        return reply.status(500).type("text/html").send(
          "<h1>Something went wrong</h1><p>Please go back and try again.</p>",
        );
      }
    },
  );
};

function formatPrice(cents: number): string {
  return `$${(cents / 100).toFixed(2)}`;
}

function buildPricingHtml(tid: string): string {
  const safeTid = tid.replace(/[^a-zA-Z0-9_-]/g, "");

  const cards = CREDIT_PACKS.map((pack, i) => {
    const popular = i === 1;
    return `
      <a href="/api/create-checkout?tid=${safeTid}&pack=${i}" class="card${popular ? " popular" : ""}">
        ${popular ? '<span class="badge">Most Popular</span>' : ""}
        <span class="credits">${pack.credits}</span>
        <span class="label">credits</span>
        <span class="price">${formatPrice(pack.priceUsdCents)}</span>
        <span class="per">${formatPrice(Math.round(pack.priceUsdCents / pack.credits * 100) / 100)} per credit</span>
        <span class="cta">Choose${popular ? " 💕" : ""}</span>
      </a>`;
  }).join("\n");

  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>Get Credits</title>
<style>
  *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }
  body {
    font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
    background: linear-gradient(135deg, #0f0c29, #302b63, #24243e);
    color: #e8e6f0;
    min-height: 100vh;
    display: flex;
    flex-direction: column;
    align-items: center;
    padding: 2rem 1rem 3rem;
  }
  h1 {
    font-size: 1.6rem;
    font-weight: 700;
    margin-bottom: 0.3rem;
    text-align: center;
  }
  .subtitle {
    color: #b0a8d0;
    font-size: 0.95rem;
    margin-bottom: 2rem;
    text-align: center;
  }
  .cards {
    display: flex;
    flex-direction: column;
    gap: 1rem;
    width: 100%;
    max-width: 360px;
  }
  .card {
    position: relative;
    display: flex;
    flex-direction: column;
    align-items: center;
    padding: 1.5rem 1rem 1.2rem;
    border-radius: 16px;
    background: rgba(255,255,255,0.06);
    border: 1px solid rgba(255,255,255,0.08);
    text-decoration: none;
    color: inherit;
    transition: transform 0.15s, border-color 0.2s;
  }
  .card:hover, .card:active {
    transform: translateY(-2px);
    border-color: rgba(200,170,255,0.35);
  }
  .card.popular {
    border-color: #a78bfa;
    background: rgba(167,139,250,0.1);
  }
  .badge {
    position: absolute;
    top: -10px;
    background: linear-gradient(90deg, #a78bfa, #7c3aed);
    color: #fff;
    font-size: 0.7rem;
    font-weight: 700;
    padding: 3px 12px;
    border-radius: 20px;
    text-transform: uppercase;
    letter-spacing: 0.5px;
  }
  .credits {
    font-size: 2.4rem;
    font-weight: 800;
    line-height: 1;
    margin-top: 0.2rem;
  }
  .label {
    font-size: 0.85rem;
    color: #b0a8d0;
    margin-bottom: 0.5rem;
  }
  .price {
    font-size: 1.4rem;
    font-weight: 700;
  }
  .per {
    font-size: 0.75rem;
    color: #8b83a8;
    margin-top: 0.15rem;
    margin-bottom: 0.7rem;
  }
  .cta {
    display: inline-block;
    width: 100%;
    text-align: center;
    padding: 0.65rem 0;
    border-radius: 10px;
    background: linear-gradient(90deg, #a78bfa, #7c3aed);
    color: #fff;
    font-weight: 600;
    font-size: 0.95rem;
  }
  .card.popular .cta {
    background: linear-gradient(90deg, #c084fc, #9333ea);
  }
  .footer {
    margin-top: 2rem;
    font-size: 0.75rem;
    color: #6b6485;
    text-align: center;
    line-height: 1.5;
  }
</style>
</head>
<body>
  <h1>Stay With Me 💕</h1>
  <p class="subtitle">Pick a credit pack to continue</p>
  <div class="cards">
    ${cards}
  </div>
  <p class="footer">Secure payment via Stripe<br />Credits are added instantly after payment</p>
</body>
</html>`;
}
