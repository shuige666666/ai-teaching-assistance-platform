import { afterEach, describe, expect, it, vi } from "vitest";
import { createPlaybackState, playbackReducer } from "@/lib/playback/playback-machine";
import { BrowserSpeechAdapter, createPausableDelay, TextOnlySpeechAdapter, type PlaybackHandle, type SpeechAdapter } from "@/lib/playback/speech-adapters";

describe("playback reducer", () => {
  it("覆盖 idle、playing、paused、awaitingLearner 和 completed", () => {
    let state = createPlaybackState("scene-1", 2);
    state = playbackReducer(state, { type: "PLAY" });
    expect(state.status).toBe("playing");
    state = playbackReducer(state, { type: "PAUSE" });
    expect(state.status).toBe("paused");
    state = playbackReducer(state, { type: "RESUME" });
    state = playbackReducer(state, { type: "ACTION_COMPLETED", sceneId: "scene-1", actionIndex: 0, runId: 0 });
    state = playbackReducer(state, { type: "AWAIT_LEARNER", sceneId: "scene-1", actionIndex: 1, runId: 0 });
    expect(state.status).toBe("awaitingLearner");
    state = playbackReducer(state, { type: "LEARNER_COMPLETED", sceneId: "scene-1", actionIndex: 1, runId: 0 });
    expect(state).toMatchObject({ status: "completed", actionIndex: 2 });
  });

  it("忽略快速切页后旧场景和旧 run 的完成事件", () => {
    let state = playbackReducer(createPlaybackState("scene-1", 1), { type: "PLAY" });
    state = playbackReducer(state, { type: "LOAD_SCENE", sceneId: "scene-2", actionCount: 1 });
    state = playbackReducer(state, { type: "PLAY" });
    const unchanged = playbackReducer(state, { type: "ACTION_COMPLETED", sceneId: "scene-1", actionIndex: 0, runId: 0 });
    expect(unchanged).toEqual(state);
    const replayed = playbackReducer(state, { type: "REPLAY" });
    expect(playbackReducer(replayed, { type: "ACTION_COMPLETED", sceneId: "scene-2", actionIndex: 0, runId: 0 })).toEqual(replayed);
  });

  it("允许测验在讲解前或讲解中直接提交并完成场景", () => {
    const idle = createPlaybackState("quiz-1", 2);
    expect(playbackReducer(idle, { type: "LEARNER_COMPLETED", sceneId: "quiz-1", actionIndex: 0, runId: 0 }))
      .toMatchObject({ status: "completed", actionIndex: 2 });

    const playing = playbackReducer(createPlaybackState("quiz-1", 2), { type: "PLAY" });
    expect(playbackReducer(playing, { type: "LEARNER_COMPLETED", sceneId: "quiz-1", actionIndex: 0, runId: 0 }))
      .toMatchObject({ status: "completed", actionIndex: 2 });
  });
});

describe("speech adapters", () => {
  afterEach(() => vi.useRealTimers());

  it("暂停和恢复只消费剩余计时，不重复完成 Action", async () => {
    vi.useFakeTimers();
    const handle = createPausableDelay(1000);
    let completions = 0;
    void handle.done.then(() => { completions += 1; });
    await vi.advanceTimersByTimeAsync(400);
    handle.pause();
    await vi.advanceTimersByTimeAsync(1000);
    expect(completions).toBe(0);
    handle.resume();
    await vi.advanceTimersByTimeAsync(600);
    expect(completions).toBe(1);
    handle.resume();
    await vi.runAllTimersAsync();
    expect(completions).toBe(1);
  });

  it("浏览器语音不可用时回退 TextOnly 契约", () => {
    let fallbackCalls = 0;
    const finished: PlaybackHandle = { done: Promise.resolve(), pause() {}, resume() {}, cancel() {} };
    const fallback: SpeechAdapter = { kind: "text-only", speak() { fallbackCalls += 1; return finished; } };
    expect(new BrowserSpeechAdapter(fallback).speak("讲解文本")).toBe(finished);
    expect(fallbackCalls).toBe(1);
    expect(new TextOnlySpeechAdapter().kind).toBe("text-only");
  });
});
