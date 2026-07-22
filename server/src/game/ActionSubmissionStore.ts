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

  get(playerId: string): SubmittedAction | undefined {
    return this.actions.get(playerId);
  }

  setTargets(playerId: string, targetIds: string[]): boolean {
    const action = this.actions.get(playerId);
    if (!action) return false;
    action.targetIds = [...targetIds];
    action.targetId = undefined;
    return true;
  }

  setDeferredSelection(playerId: string, targetIds: string[], power?: number, resourceSpend?: Record<string, number>): boolean {
    const action = this.actions.get(playerId);
    if (!action) return false;
    action.targetIds = [...targetIds];
    action.targetId = undefined;
    action.power = power ?? action.power;
    action.resourceSpend = resourceSpend ?? action.resourceSpend;
    return true;
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
