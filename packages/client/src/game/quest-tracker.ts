import { type Quest, chantPhase, dailyQuests, questDay, questMatches } from "@dongjane/shared";
import { type QuestProgress, loadQuestProgress, saveQuestProgress } from "../storage.ts";

export interface QuestView {
  text: string;
  target: number;
  count: number;
  done: boolean;
}

export interface QuestClock {
  serverTime: number;
  chant: { startsAt: number; durationMs: number };
}

// Counts completed bows of the self monk from server state only, so inputs the server rejected never advance a quest.
export class QuestTracker {
  private saved: QuestProgress | null = loadQuestProgress();
  private day: number | null = null;
  private quests: Quest[] = [];
  private counts: Record<string, number> = {};
  private baseline: { sessionId: string; bowCount: number } | null = null;
  private seatedAt: number | null = null;

  observe(sessionId: string, monk: { bowCount: number; cushionId: number }, state: QuestClock): Quest[] {
    this.sync(state.serverTime);
    const baseline = this.baseline;
    this.baseline = { sessionId, bowCount: monk.bowCount };
    if (baseline?.sessionId !== sessionId) this.seatedAt = null;
    if (monk.cushionId >= 0) this.seatedAt = monk.cushionId;
    if (!baseline || baseline.sessionId !== sessionId || monk.bowCount <= baseline.bowCount) return [];

    const bows = monk.bowCount - baseline.bowCount;
    const cushionId = monk.cushionId >= 0 ? monk.cushionId : (this.seatedAt ?? -1);
    const bow = { cushionId, duringChant: chantPhase(state.chant, state.serverTime) === "active" };
    const completed: Quest[] = [];
    let changed = false;
    for (const quest of this.quests) {
      const before = this.counts[quest.id] ?? 0;
      if (before >= quest.target || !questMatches(quest, bow)) continue;
      const after = Math.min(quest.target, before + bows);
      this.counts[quest.id] = after;
      changed = true;
      if (after >= quest.target) completed.push(quest);
    }
    if (changed) this.persist();
    return completed;
  }

  view(serverTime: number): QuestView[] {
    this.sync(serverTime);
    return this.quests.map((quest) => {
      const count = this.counts[quest.id] ?? 0;
      return { text: quest.text, target: quest.target, count, done: count >= quest.target };
    });
  }

  private sync(serverTime: number): void {
    const day = questDay(serverTime);
    if (day === this.day) return;
    this.day = day;
    this.quests = dailyQuests(day);
    this.counts = {};
    if (this.saved?.day !== day) return;
    for (const quest of this.quests) {
      const stored = this.saved.counts[quest.id];
      if (stored) this.counts[quest.id] = Math.min(stored, quest.target);
    }
  }

  private persist(): void {
    if (this.day === null) return;
    this.saved = { day: this.day, counts: { ...this.counts } };
    saveQuestProgress(this.saved);
  }
}
