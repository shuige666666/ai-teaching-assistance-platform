"use client";

import { useEffect, useMemo, useReducer, useRef } from "react";
import type { Action, Scene } from "@/lib/domain/schemas";
import { createPlaybackState, playbackReducer } from "./playback-machine";
import { createPausableDelay, createSpeechAdapter, type PlaybackHandle, type SpeechAdapter } from "./speech-adapters";

type ActiveExecution = { sceneId: string; actionIndex: number; runId: number; handle: PlaybackHandle };

/** 把 Scene Action 转换为可取消的浏览器执行任务，并暴露课堂控制命令。 */
export function usePlaybackController(scene: Scene, browserSpeechEnabled: boolean, autoPlay: boolean) {
  // 仅比较当前页的可播放内容；同 ID、同段落数的修订也会重置，其他页保存不会干扰。
  const sceneVersion = useMemo(() => JSON.stringify([scene.content, scene.actions]), [scene.content, scene.actions]);
  const [state, dispatch] = useReducer(playbackReducer, createPlaybackState(scene.id, scene.actions.length, sceneVersion));
  const isCurrentScene = state.sceneId === scene.id && state.sceneVersion === sceneVersion;
  const activeRef = useRef<ActiveExecution | undefined>(undefined);
  // 1. 保存当前正在执行的语音或计时器。
  const adapterRef = useRef<SpeechAdapter>(createSpeechAdapter(browserSpeechEnabled));

  const cancelActive = () => {
    const active = activeRef.current;
    activeRef.current = undefined;
    active?.handle.cancel();
  };

  useEffect(() => {
    // 2. 用户切换朗读方式后，更新后续讲解动作使用的语音工具。
    adapterRef.current = createSpeechAdapter(browserSpeechEnabled);
  }, [browserSpeechEnabled]);

  useEffect(() => {
    // 3. 切页或当前页修订后停止旧语音和计时器，再载入新内容。
    cancelActive();
    dispatch({ type: "LOAD_SCENE", sceneId: scene.id, actionCount: scene.actions.length, sceneVersion });
    return cancelActive;
  }, [scene.id, scene.actions.length, sceneVersion]);

  useEffect(() => {
    // 4. 连续播放时，自动开始新场景。
    if (autoPlay && isCurrentScene && state.status === "idle") dispatch({ type: "PLAY" });
  }, [autoPlay, isCurrentScene, state.status]);

  useEffect(() => {
    // LOAD_SCENE 的状态尚未提交时，不按旧段落下标执行新页面。
    if (!isCurrentScene) return;
    // 5. 取出当前要执行的动作。
    const action = scene.actions[state.actionIndex];
    const current = activeRef.current;

    if (state.status === "paused") {
      current?.handle.pause();
      return;
    }
    if (state.status !== "playing" || state.sceneId !== scene.id || !action) return;
    if (action.type === "pause" && action.reason === "learner") {
      // 6. 遇到测验暂停时，等待用户提交答案。
      dispatch({ type: "AWAIT_LEARNER", sceneId: scene.id, actionIndex: state.actionIndex, runId: state.runId });
      return;
    }
    if (current?.sceneId === scene.id && current.actionIndex === state.actionIndex && current.runId === state.runId) {
      current.handle.resume();
      return;
    }

    // 7. 开始执行当前动作。
    cancelActive();
    const handle = executeAction(action, adapterRef.current);
    const execution = { sceneId: scene.id, actionIndex: state.actionIndex, runId: state.runId, handle };
    activeRef.current = execution;
    void handle.done.then(() => {
      // 8. 当前动作结束后，切换到下一个动作。
      if (activeRef.current !== execution) return;
      activeRef.current = undefined;
      dispatch({ type: "ACTION_COMPLETED", sceneId: execution.sceneId, actionIndex: execution.actionIndex, runId: execution.runId });
    });
  }, [scene, isCurrentScene, state.actionIndex, state.runId, state.sceneId, state.status]);

  const currentAction = isCurrentScene ? scene.actions[state.actionIndex] : undefined;
  const progress = state.actionCount === 0 ? 100 : Math.min(100, Math.round((state.actionIndex / state.actionCount) * 100));

  return useMemo(() => ({
    state: isCurrentScene ? state : createPlaybackState(scene.id, scene.actions.length, sceneVersion),
    currentAction,
    progress: isCurrentScene ? progress : 0,
    focusElementIds: isCurrentScene && ["playing", "paused"].includes(state.status) && currentAction?.type === "speech"
      ? currentAction.focusElementIds ?? [] : [],
    play: () => dispatch({ type: "PLAY" }),
    pause: () => dispatch({ type: "PAUSE" }),
    resume: () => dispatch({ type: "RESUME" }),
    replay: () => { cancelActive(); dispatch({ type: "REPLAY" }); },
    // 定位保留播放/暂停状态；显式 play 用于“重听本段”。
    seekToAction: (actionIndex: number, play?: boolean) => {
      if (!isCurrentScene || !Number.isInteger(actionIndex) || actionIndex < 0 || actionIndex >= scene.actions.length) return;
      cancelActive();
      dispatch({ type: "SEEK", actionIndex, play });
    },
    completeLearner: () => {
      // 用户可能在讲解仍播放时完成测验，先取消旧语音或计时器再结束场景。
      cancelActive();
      dispatch({ type: "LEARNER_COMPLETED", sceneId: state.sceneId, actionIndex: state.actionIndex, runId: state.runId });
    },
  }), [currentAction, progress, state, isCurrentScene, scene.id, scene.actions.length, sceneVersion]);
}

/** speech 交给适配器；timed pause 使用同样可暂停、可取消的任务契约。 */
function executeAction(action: Action, speechAdapter: SpeechAdapter): PlaybackHandle {
  // 9. speech 调用语音工具，pause 启动计时器。
  if (action.type === "speech") return speechAdapter.speak(action.text, action.rate);
  return createPausableDelay(action.durationMs ?? 0);
}
