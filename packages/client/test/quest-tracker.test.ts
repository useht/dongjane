import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { CHANT_MS, CUSHION_COUNT, KST_OFFSET_MS, type Quest, dailyQuests, questDay } from "@dongjane/shared";
import { QuestTracker, type QuestView, questSummary } from "../src/game/quest-tracker.ts";
import { loadQuestProgress } from "../src/storage.ts";

const DAY = 24 * 60 * 60 * 1000;
const NOON = Date.UTC(2026, 9, 30, 3, 0);
const DAY_NUMBER = questDay(NOON);
const [PLACE, ANYWHERE, CHANT] = dailyQuests(DAY_NUMBER) as [Quest, Quest, Quest];
const SEAT = PLACE.cushionId as number;
const OTHER_SEAT = (SEAT + 1) % CUSHION_COUNT;
const CHANT_START = NOON - 60_000;
const NO_CHANT = { startsAt: NOON + 10 * 60_000, durationMs: CHANT_MS };
const ACTIVE_CHANT = { startsAt: CHANT_START, durationMs: CHANT_MS };

const storage = new Map<string, string>();

beforeEach(() => {
  storage.clear();
  globalThis.localStorage = {
    getItem: (key: string) => storage.get(key) ?? null,
    setItem: (key: string, value: string) => void storage.set(key, value),
    removeItem: (key: string) => void storage.delete(key),
  } as Storage;
});

afterEach(() => {
  Reflect.deleteProperty(globalThis, "localStorage");
});

const at = (serverTime: number, chant = NO_CHANT) => ({ serverTime, chant });
const bows = (bowCount: number, cushionId = SEAT) => ({ bowCount, cushionId });

function counts(tracker: QuestTracker, serverTime = NOON): number[] {
  return tracker.view(serverTime).map((view) => view.count);
}

describe("QuestTracker", () => {
  it("shows today's quests with no progress", () => {
    const tracker = new QuestTracker();
    expect(tracker.view(NOON)).toEqual(
      [PLACE, ANYWHERE, CHANT].map((quest) => ({ text: quest.text, target: quest.target, count: 0, done: false })),
    );
  });

  it("counts nothing on the first observation, whatever the bow count", () => {
    const tracker = new QuestTracker();
    expect(tracker.observe("me", bows(7), at(NOON))).toEqual([]);
    expect(counts(tracker)).toEqual([0, 0, 0]);
  });

  it("counts each new bow at the named cushion toward the location and anywhere quests", () => {
    const tracker = new QuestTracker();
    tracker.observe("me", bows(4), at(NOON));
    tracker.observe("me", bows(5), at(NOON + 50));
    tracker.observe("me", bows(7), at(NOON + 100));
    expect(counts(tracker)).toEqual([3, 3, 0]);
  });

  it("does not count a bow at another cushion for the location quest", () => {
    const tracker = new QuestTracker();
    tracker.observe("me", bows(0, OTHER_SEAT), at(NOON));
    tracker.observe("me", bows(1, OTHER_SEAT), at(NOON + 50));
    expect(counts(tracker)).toEqual([0, 1, 0]);
  });

  it("credits a bow to the cushion it was made on when the snapshot already shows the monk standing", () => {
    const tracker = new QuestTracker();
    tracker.observe("me", bows(4, SEAT), at(NOON));
    tracker.observe("me", bows(5, -1), at(NOON + 50));
    expect(counts(tracker)).toEqual([1, 1, 0]);
  });

  it("does not carry the last seat over to a new session", () => {
    const tracker = new QuestTracker();
    tracker.observe("old", bows(0, SEAT), at(NOON));
    tracker.observe("new", bows(0, -1), at(NOON + 50));
    tracker.observe("new", bows(1, -1), at(NOON + 100));
    expect(counts(tracker)).toEqual([0, 1, 0]);
  });

  it("counts toward the chant quest only while the chant is active", () => {
    const tracker = new QuestTracker();
    tracker.observe("me", bows(0), at(NOON));
    tracker.observe("me", bows(1), at(NOON + 50, NO_CHANT));
    expect(counts(tracker)).toEqual([1, 1, 0]);
    tracker.observe("me", bows(2), at(NOON + 100, ACTIVE_CHANT));
    expect(counts(tracker)).toEqual([2, 2, 1]);
    tracker.observe("me", bows(3), at(CHANT_START + CHANT_MS + 1, ACTIVE_CHANT));
    expect(counts(tracker, CHANT_START + CHANT_MS + 1)).toEqual([3, 3, 1]);
  });

  it("treats a changed session as a fresh baseline", () => {
    const tracker = new QuestTracker();
    tracker.observe("old", bows(0), at(NOON));
    tracker.observe("old", bows(2), at(NOON + 50));
    tracker.observe("new", bows(9), at(NOON + 100));
    expect(counts(tracker)).toEqual([2, 2, 0]);
    tracker.observe("new", bows(10), at(NOON + 150));
    expect(counts(tracker)).toEqual([3, 3, 0]);
  });

  it("re-baselines when the bow count drops within the same session id", () => {
    const tracker = new QuestTracker();
    tracker.observe("solo", bows(5), at(NOON));
    tracker.observe("solo", bows(0), at(NOON + 50));
    tracker.observe("solo", bows(1), at(NOON + 100));
    expect(counts(tracker)).toEqual([1, 1, 0]);
  });

  it("reports a quest as completed exactly once and caps its count at the target", () => {
    const tracker = new QuestTracker();
    tracker.observe("me", bows(0), at(NOON));
    const reported: string[] = [];
    for (let step = 1; step <= 40; step += 1) {
      for (const quest of tracker.observe("me", bows(step), at(NOON + step * 50))) reported.push(quest.id);
    }
    expect(reported).toEqual([PLACE.id, ANYWHERE.id]);

    const view = tracker.view(NOON);
    expect(view[0]).toMatchObject({ count: PLACE.target, done: true });
    expect(view[1]).toMatchObject({ count: ANYWHERE.target, done: true });
    expect(view[2]).toMatchObject({ count: 0, done: false });
  });

  it("completes several quests in one observation", () => {
    const tracker = new QuestTracker();
    tracker.observe("me", bows(0), at(NOON));
    const finished = tracker.observe("me", bows(20), at(NOON + 50, ACTIVE_CHANT));
    expect(finished.map((quest) => quest.id)).toEqual([PLACE.id, ANYWHERE.id, CHANT.id]);
    expect(tracker.view(NOON).every((view) => view.done)).toBe(true);
  });

  it("keeps progress across tracker instances on the same day", () => {
    const first = new QuestTracker();
    first.observe("me", bows(0), at(NOON));
    first.observe("me", bows(2), at(NOON + 50));
    expect(loadQuestProgress()).toEqual({ day: DAY_NUMBER, counts: { [PLACE.id]: 2, [ANYWHERE.id]: 2 } });

    const second = new QuestTracker();
    expect(counts(second)).toEqual([2, 2, 0]);
    second.observe("me", bows(0), at(NOON + 100));
    second.observe("me", bows(1), at(NOON + 150));
    expect(counts(second)).toEqual([3, 3, 0]);
  });

  it("does not report quests that were already finished in an earlier instance", () => {
    const first = new QuestTracker();
    first.observe("me", bows(0), at(NOON));
    first.observe("me", bows(20), at(NOON + 50, ACTIVE_CHANT));

    const second = new QuestTracker();
    second.observe("me", bows(0), at(NOON + 100, ACTIVE_CHANT));
    expect(second.observe("me", bows(1), at(NOON + 150, ACTIVE_CHANT))).toEqual([]);
  });

  it("discards stored progress from a previous day", () => {
    const yesterday = new QuestTracker();
    yesterday.observe("me", bows(0), at(NOON - DAY));
    yesterday.observe("me", bows(3), at(NOON - DAY + 50));
    expect(loadQuestProgress()?.day).toBe(DAY_NUMBER - 1);

    const today = new QuestTracker();
    expect(counts(today)).toEqual([0, 0, 0]);
    today.observe("me", bows(0), at(NOON));
    today.observe("me", bows(1), at(NOON + 50));
    expect(counts(today)).toEqual([1, 1, 0]);
    expect(loadQuestProgress()?.day).toBe(DAY_NUMBER);
  });

  it("switches to the new day's quests when server time crosses KST midnight", () => {
    const midnight = Math.ceil((NOON + KST_OFFSET_MS) / DAY) * DAY - KST_OFFSET_MS;
    const tracker = new QuestTracker();
    tracker.observe("me", bows(0), at(midnight - 100));
    tracker.observe("me", bows(1), at(midnight - 50));
    expect(counts(tracker, midnight - 1)).toEqual([1, 1, 0]);

    const next = dailyQuests(DAY_NUMBER + 1);
    expect(tracker.view(midnight).map((view) => view.text)).toEqual(next.map((quest) => quest.text));
    expect(counts(tracker, midnight)).toEqual([0, 0, 0]);

    tracker.observe("me", bows(2, next[0]!.cushionId as number), at(midnight + 50));
    expect(counts(tracker, midnight + 50)).toEqual([1, 1, 0]);
  });

  it("starts from nothing when the stored progress is unreadable", () => {
    storage.set("dongjane:quests", "{not json");
    expect(counts(new QuestTracker())).toEqual([0, 0, 0]);
    storage.set("dongjane:quests", JSON.stringify({ day: DAY_NUMBER, counts: { [PLACE.id]: 999, [ANYWHERE.id]: "x" } }));
    expect(counts(new QuestTracker())).toEqual([PLACE.target, 0, 0]);
  });
});

describe("questSummary", () => {
  const view = (text: string, count: number, target: number): QuestView => ({ text, target, count, done: count >= target });

  it("leads with the first unfinished quest and the finished tally", () => {
    const summary = questSummary([view("첫째", 3, 3), view("둘째", 2, 5), view("셋째", 0, 2)]);
    expect(summary).toEqual({ title: "오늘의 퀘스트 1/3", line: "둘째 · 2/5" });
  });

  it("formats the line as text · count/target", () => {
    expect(questSummary([view("방석 어디에서든 절 8번 하기", 0, 8)])).toEqual({
      title: "오늘의 퀘스트 0/1",
      line: "방석 어디에서든 절 8번 하기 · 0/8",
    });
  });

  it("says everything is done once every quest is", () => {
    expect(questSummary([view("첫째", 3, 3), view("둘째", 5, 5)])).toEqual({
      title: "오늘의 퀘스트 2/2",
      line: "오늘의 퀘스트를 모두 끝냈어요",
    });
  });

  it("has nothing to show without quests", () => {
    expect(questSummary([])).toBeNull();
  });

  it("follows a tracker's view", () => {
    const tracker = new QuestTracker();
    const [place] = dailyQuests(DAY_NUMBER);
    expect(questSummary(tracker.view(NOON))).toEqual({ title: "오늘의 퀘스트 0/3", line: `${place!.text} · 0/${place!.target}` });
  });
});
