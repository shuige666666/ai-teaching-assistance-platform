export type PlaybackStatus = "idle" | "playing" | "paused" | "awaitingLearner" | "completed";

export type PlaybackState = {
  sceneId: string;
  sceneVersion: string;
  status: PlaybackStatus;
  actionIndex: number;
  actionCount: number;
  runId: number;
};

export type PlaybackEvent =
  | { type: "LOAD_SCENE"; sceneId: string; actionCount: number; sceneVersion?: string }
  | { type: "PLAY" }
  | { type: "PAUSE" }
  | { type: "RESUME" }
  | { type: "REPLAY" }
  | { type: "SEEK"; actionIndex: number; play?: boolean }
  | { type: "ACTION_COMPLETED"; sceneId: string; actionIndex: number; runId: number }
  | { type: "AWAIT_LEARNER"; sceneId: string; actionIndex: number; runId: number }
  | { type: "LEARNER_COMPLETED"; sceneId: string; actionIndex: number; runId: number };

/** 为指定场景创建确定性的播放器初始状态。 */
export function createPlaybackState(sceneId: string, actionCount: number, sceneVersion = ""): PlaybackState {
  return { sceneId, sceneVersion, actionCount, actionIndex: 0, status: "idle", runId: 0 };
}

function matchesCurrentRun(state: PlaybackState, event: { sceneId: string; actionIndex: number; runId: number }) {
  return state.sceneId === event.sceneId && state.actionIndex === event.actionIndex && state.runId === event.runId;
}

function advance(state: PlaybackState): PlaybackState {
  const nextIndex = state.actionIndex + 1;
  return nextIndex >= state.actionCount
    ? { ...state, actionIndex: state.actionCount, status: "completed" }
    : { ...state, actionIndex: nextIndex, status: "playing" };
}

/** 只接受当前 scene/run/action 的完成事件，防止快速切页后的迟到回调污染新场景。 */
export function playbackReducer(state: PlaybackState, event: PlaybackEvent): PlaybackState {
  switch (event.type) {
    case "LOAD_SCENE":
      // 同页修订也开启新一轮执行，旧语音的回调不能推进新讲稿。
      return { ...createPlaybackState(event.sceneId, event.actionCount, event.sceneVersion), runId: state.runId + 1 };
    case "PLAY":
      return state.status === "idle" ? { ...state, status: state.actionCount === 0 ? "completed" : "playing" } : state;
    case "PAUSE":
      return state.status === "playing" ? { ...state, status: "paused" } : state;
    case "RESUME":
      return state.status === "paused" ? { ...state, status: "playing" } : state;
    case "REPLAY":
      return { ...state, actionIndex: 0, status: state.actionCount === 0 ? "completed" : "playing", runId: state.runId + 1 };
    case "SEEK": {
      if (!Number.isInteger(event.actionIndex) || event.actionIndex < 0 || event.actionIndex >= state.actionCount) return state;
      const playing = event.play ?? state.status === "playing";
      return { ...state, actionIndex: event.actionIndex, status: playing ? "playing" : "paused", runId: state.runId + 1 };
    }
    case "ACTION_COMPLETED":
      return state.status === "playing" && matchesCurrentRun(state, event) ? advance(state) : state;
    case "AWAIT_LEARNER":
      return state.status === "playing" && matchesCurrentRun(state, event) ? { ...state, status: "awaitingLearner" } : state;
    case "LEARNER_COMPLETED":
      // 测验允许在讲解前或讲解中直接作答；提交完成后直接结束当前 quiz 场景。
      return matchesCurrentRun(state, event) && ["idle", "playing", "paused", "awaitingLearner"].includes(state.status)
        ? { ...state, actionIndex: state.actionCount, status: "completed" }
        : state;
  }
}
