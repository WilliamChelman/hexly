/** Liveness payload exchanged between the API and the web client. */
export type HealthState = 'ok';

export interface HealthStatus {
  /** Current liveness state of the service. */
  status: HealthState;
  /** Identifier of the service reporting health, e.g. `"api"`. */
  service: string;
}

/** Narrow predicate so consumers don't compare the magic string themselves. */
export function isHealthy(status: HealthStatus): boolean {
  return status.status === 'ok';
}
