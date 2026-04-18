function trimOrigin(s: string | undefined): string | undefined {
  if (!s) return undefined;
  const x = s.trim().replace(/\/+$/, "");
  return x.length > 0 ? x : undefined;
}

/**
 * Public HTTPS origin for links shown in Telegram (e.g. /buy).
 * Prefers explicit config; on Render, `RENDER_EXTERNAL_URL` is set automatically.
 * Also reads `process.env` so this works even if a key is missing from Fastify config.
 */
export function resolvePublicAppBaseUrl(params: {
  webhookUrl?: string;
  publicAppUrl?: string;
  renderExternalUrl?: string;
  port: string;
}): string {
  const candidates = [
    trimOrigin(params.webhookUrl ?? process.env["WEBHOOK_URL"]),
    trimOrigin(params.publicAppUrl ?? process.env["PUBLIC_APP_URL"]),
    trimOrigin(params.renderExternalUrl ?? process.env["RENDER_EXTERNAL_URL"]),
  ];

  for (const url of candidates) {
    if (url && /^https:\/\//i.test(url)) {
      return url;
    }
  }

  return `http://localhost:${params.port}`;
}
