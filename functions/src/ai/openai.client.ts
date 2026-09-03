import OpenAI from 'openai'
import { defineSecret } from 'firebase-functions/params'

/**
 * The OpenAI transport.
 *
 * The key is a Firebase secret, resolved at runtime inside the function
 * container — it is never bundled, never in `.env`, and never reachable from
 * the browser. Set it with:
 *
 *   firebase functions:secrets:set OPENAI_API_KEY
 *
 * This module is the *only* place the OpenAI SDK is constructed. Everything
 * else in MARKA talks to the orchestrator.
 */
export const OPENAI_API_KEY = defineSecret('OPENAI_API_KEY')

let client: OpenAI | null = null

export function isConfigured(): boolean {
  return Boolean(safeSecretValue())
}

function safeSecretValue(): string | undefined {
  // `.value()` throws outside a request context (e.g. during deploy analysis),
  // so treat that as "not configured" rather than crashing the container.
  try {
    return OPENAI_API_KEY.value() || process.env.OPENAI_API_KEY
  } catch {
    return process.env.OPENAI_API_KEY
  }
}

export function getOpenAI(): OpenAI {
  const apiKey = safeSecretValue()
  if (!apiKey) {
    throw new Error('OPENAI_API_KEY is not set.')
  }
  // Cached across warm invocations; the key does not change within a container.
  // The values below are only defaults: every orchestrator call passes the
  // timeout and retry budget for its own tier, because a reasoning task and a
  // chat turn have nothing useful in common here.
  if (!client) {
    client = new OpenAI({ apiKey, timeout: 60_000, maxRetries: 2 })
  }
  return client
}
