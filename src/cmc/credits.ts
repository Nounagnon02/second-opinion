/**
 * Credit counter and per-run ceiling (CMC_CREDIT_BUDGET).
 * Before a paid call is sent, its expected cost is reserved; a call that would take the run past the budget is
 * refused without touching the network. When the answer arrives, the reservation is replaced by the
 * `status.credit_count` it reports. Reserving first keeps the ceiling exact when calls run in parallel (D1).
 */
import { CmcError } from './errors.js';

export interface CreditUsage {
  budget: number;
  /** Credits reported by the API (`status.credit_count`). */
  charged: number;
  /** Credits of attempts whose cost is unknown (timeout, network error, no status block), counted at their estimate. */
  unconfirmed: number;
  /** Credits reserved by calls still in flight. */
  reserved: number;
  remaining: number;
  /** Attempts that reached the network, cached answers excluded. */
  requests: number;
  /** Reported credits per endpoint ID. */
  byEndpoint: Record<string, number>;
}

export interface Reservation {
  readonly endpoint: string;
  readonly estimate: number;
}

export class CreditMeter {
  private charged = 0;
  private unconfirmed = 0;
  private reserved = 0;
  private requests = 0;
  private readonly byEndpoint: Record<string, number> = {};
  private readonly open = new Set<Reservation>();

  constructor(readonly budget: number) {
    if (!Number.isInteger(budget) || budget < 0) {
      throw new CmcError('config', `The credit budget must be a non-negative integer, got ${budget}.`);
    }
  }

  private spent(): number {
    return this.charged + this.unconfirmed + this.reserved;
  }

  /** Reserves the expected cost of one attempt, or throws a `budget` error. Free calls are always allowed. */
  reserve(endpoint: string, estimate: number): Reservation {
    if (estimate > 0 && this.spent() + estimate > this.budget) {
      throw new CmcError(
        'budget',
        `${endpoint} not sent: it needs ${estimate} credit(s) and the run has ${Math.max(0, this.budget - this.spent())} ` +
          `left of its budget of ${this.budget} (CMC_CREDIT_BUDGET).`,
        { endpoint },
      );
    }
    const reservation: Reservation = { endpoint, estimate };
    this.open.add(reservation);
    this.reserved += estimate;
    this.requests += 1;
    return reservation;
  }

  /** Closes a reservation with the cost the API reported, or `null` when it is unknown. */
  settle(reservation: Reservation, reported: number | null): void {
    if (!this.open.delete(reservation)) throw new Error('This reservation is already settled.');
    this.reserved -= reservation.estimate;
    if (reported === null) {
      this.unconfirmed += reservation.estimate;
      return;
    }
    this.charged += reported;
    this.byEndpoint[reservation.endpoint] = (this.byEndpoint[reservation.endpoint] ?? 0) + reported;
  }

  /** Closes a reservation whose attempt never reached the API (replay miss): no credit and no request counted. */
  release(reservation: Reservation): void {
    if (!this.open.delete(reservation)) throw new Error('This reservation is already settled.');
    this.reserved -= reservation.estimate;
    this.requests -= 1;
  }

  usage(): CreditUsage {
    return {
      budget: this.budget,
      charged: this.charged,
      unconfirmed: this.unconfirmed,
      reserved: this.reserved,
      remaining: Math.max(0, this.budget - this.spent()),
      requests: this.requests,
      byEndpoint: { ...this.byEndpoint },
    };
  }
}
