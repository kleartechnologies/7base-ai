import { lookup } from 'node:dns/promises'
import { isBlockedIpAddress } from './url'

/**
 * The network half of the SSRF defence.
 *
 * `url.ts` proves the address *looks* like a public website. This module
 * proves it *resolves* to one: a domain the attacker controls can point at
 * 127.0.0.1 or 169.254.169.254, and only DNS reveals that.
 *
 * Known limitation, accepted deliberately: between this lookup and the socket
 * connecting, a hostile DNS server could return a different address (a DNS
 * rebind). Fully closing that needs a custom agent that pins the resolved IP,
 * which the global `fetch` does not expose. The exposure is narrowed by
 * re-checking every redirect hop, refusing non-HTML responses, capping the
 * body, and never returning the raw response to the caller — so a successful
 * rebind yields text from an internal page rather than a request that acts on
 * one. Revisit if MARKA ever fetches with credentials attached.
 */

export class BlockedHostError extends Error {
  constructor(readonly hostname: string) {
    super(`Refusing to fetch a non-public host: ${hostname}`)
    this.name = 'BlockedHostError'
  }
}

/** Throws `BlockedHostError` unless every resolved address is public. */
export async function assertResolvesToPublicAddress(hostname: string): Promise<void> {
  let addresses: { address: string }[]
  try {
    addresses = await lookup(hostname, { all: true, verbatim: true })
  } catch {
    // A hostname that does not resolve is unreachable, not blocked — the
    // caller reports it as "could not access this website".
    throw new UnresolvableHostError(hostname)
  }

  if (addresses.length === 0) throw new UnresolvableHostError(hostname)

  for (const entry of addresses) {
    if (isBlockedIpAddress(entry.address)) {
      throw new BlockedHostError(hostname)
    }
  }
}

export class UnresolvableHostError extends Error {
  constructor(readonly hostname: string) {
    super(`Could not resolve host: ${hostname}`)
    this.name = 'UnresolvableHostError'
  }
}
