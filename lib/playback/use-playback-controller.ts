"use client";

import { useEffect, useMemo, useReducer, useRef } from "react";
import type { Action, Scene } from "@/lib/domain/schemas";
import { createPlaybackState, playbackReducer } from "./playback-machine";
import { createPausableDelay, createSpeechAdapter, type PlaybackHandle, type SpeechAdapter } from "./speech-adapters";

type ActiveExecution = { sceneId: string; actionIndex: number; runId: number; handle: PlaybackHandle };

/** 把 Scene Action 转换为可取消的浏览器执行任务，并暴露课堂控制命令。 */
export function usePlaybackController(scene: Scene, browserSpeechEnabled: boolean, autoPlay: boolean) {
  const [state, dispatch] = useReducer(playbackReducer, createPlaybackState(scene.id, scene.actions.length));
  const activeRef = useRef<ActiveExecution | undefined>(undefined);
  const adapterRef = useRef<SpeechAdapter>(createSpeechAdapter(browserSpeechEnabled));

  const cancelActive = () => {
    const active = activeRef.current;
    activeRef.current = undefined;
    active?.handle.cancel();
  };

  useEffect(() => {
    adapterRef.current = createSpeechAdapter(browserSpeechEnabled);
  }, [browserSpeechEnabled]);

  useEffect(() => {
    cancelActive();
    dispatch({ type: "LOAD_SCENE", sceneId: scene.id, actionCount: scene.actions.length });
    return cancelActive;
  }, [scene.id, scene.actions.length]);

  useEffect(() => {
    if (autoPlay && state.sceneId === scene.id && state.status === "idle") dispatch({ type: "PLAY" });
  }, [autoPlay, scene.id, state.sceneId, state.status]);

  useEffect(() => {
    const action = scene.actions[state.actionIndex];
    const current = activeRef.current;

    if (state.status === "paused") {
      current?.handle.pause();
      return;
    }
    if (state.status !== "playing" || state.sceneId !== scene.id || !action) return;
    if (action.type === "pause" && action.reason === "learner") {
      dispatch({ type: "AWAIT_LEARNER", sceneId: scene.id, actionIndex: state.actionIndex, runId: state.runId });
      return;
    }
    if (current?.sceneId === scene.id && current.actionIndex === state.actionIndex && current.runId === state.runId) {
      current.handle.resume();
      return;
    }

    cancelActive();
    const handle = executeAction(action, adapterRef.current);
    const execution = { sceneId: scene.id, actionIndex: state.actionIndex, runId: state.runId, handle };
    activeRef.current = execution;
    void handle.done.then(() => {
      if (activeRef.current !== execution) return;
      activeRef.current = undefined;
      dispatch({ type: "ACTION_COMPLETED", sceneId: execution.sceneId, actionIndex: execution.actionIndex, runId: execution.runId });
    });
  }, [scene, state.actionIndex, state.runId, state.sceneId, state.status]);

  const currentAction = scene.actions[state.actionIndex];
  const progress = state.actionCount === 0 ? 100 : Math.min(100, Math.round((state.actionIndex / state.actionCount) * 100));

  return useMemo(() => ({
    state,
    currentAction,
    progress,
    play: () => dispatch({ type: "PLAY" }),
    pause: () => dispatch({ type: "PAUSE" }),
    resume: () => dispatch({ type: "RESUME" }),
    replay: () => { cancelActive(); dispatch({ type: "REPLAY" }); },
    completeLearner: () => {
      // 用户可能在讲解仍播放时完成测验，先取消旧语音或计时器再结束场景。
      cancelActive();
      dispatch({ type: "LEARNER_COMPLETED", sceneId: state.sceneId, actionIndex: state.actionIndex, runId: state.runId });
    },
  }), [currentAction, progress, state]);
}

/** speech 交给适配器；timed pause 使用同样可暂停、可取消的任务契约。 */
function executeAction(action: Action, speechAdapter: SpeechAdapter): PlaybackHandle {
  if (action.type === "speech") return speechAdapter.speak(action.text, action.rate);
  return createPausableDelay(action.durationMs ?? 0);
}
