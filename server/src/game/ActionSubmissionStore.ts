import type { SubmittedAction } from './RoundResolver.js';

export class ActionSubmissionStore {
  private readonly actions = new Map<string, SubmittedAction>();

  submit(playerId: string, action: SubmittedAction): boolean {
    if (this.actions.has(playerId)) return false;
    this.actions.set(playerId, action);
    return true;
  }

  cancel(playerId: string): boolean {
    return this.actions.delete(playerId);
  }

  has(playerId: string): boolean {
    return this.actions.has(playerId);
  }

  allSubmitted(playerIds: Iterable<string>): boolean {
    for (const playerId of playerIds) if (!this.actions.has(playerId)) return false;
    return true;
  }

  clear(): void {
    this.actions.clear();
  }

  asReadonlyMap(): ReadonlyMap<string, SubmittedAction> {
    return this.actions;
  }
}
