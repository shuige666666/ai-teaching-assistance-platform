export type PlaybackHandle = {
  done: Promise<void>;
  pause(): void;
  resume(): void;
  cancel(): void;
};

export interface SpeechAdapter {
  readonly kind: "text-only" | "browser";
  speak(text: string, rate?: number): PlaybackHandle;
}

type TimerApi = Pick<typeof globalThis, "setTimeout" | "clearTimeout">;

/** 按中文字数估算讲解时间；长段落保留阅读时间，用户可随时手动跳段。 */
export function estimateSpeechDuration(text: string, rate = 1): number {
  const visibleCharacters = text.replace(/\s/g, "").length;
  return Math.max(1200, Math.round((visibleCharacters / (5 * rate)) * 1000));
}

/** 创建可暂停的计时任务；恢复时只消费剩余时长，不会重复启动 Action。 */
export function createPausableDelay(durationMs: number, timer: TimerApi = globalThis): PlaybackHandle {
  let remainingMs = durationMs;
  let startedAt = Date.now();
  let timeout: ReturnType<typeof setTimeout> | undefined;
  let settled = false;
  let resolveDone: () => void = () => {};
  const done = new Promise<void>((resolve) => { resolveDone = resolve; });

  const finish = () => {
    if (settled) return;
    settled = true;
    timeout = undefined;
    resolveDone();
  };
  const schedule = () => {
    if (settled || timeout) return;
    startedAt = Date.now();
    timeout = timer.setTimeout(finish, remainingMs);
  };
  schedule();

  return {
    done,
    pause() {
      if (settled || !timeout) return;
      timer.clearTimeout(timeout);
      timeout = undefined;
      remainingMs = Math.max(0, remainingMs - (Date.now() - startedAt));
    },
    resume() { schedule(); },
    cancel() {
      if (timeout) timer.clearTimeout(timeout);
      timeout = undefined;
      finish();
    },
  };
}

export class TextOnlySpeechAdapter implements SpeechAdapter {
  readonly kind = "text-only" as const;

  /** 无语音环境也能按讲解文本的估算时长推进课程。 */
  speak(text: string, rate = 1): PlaybackHandle {
    return createPausableDelay(estimateSpeechDuration(text, rate));
  }
}

export class BrowserSpeechAdapter implements SpeechAdapter {
  readonly kind = "browser" as const;

  constructor(private readonly fallback: SpeechAdapter = new TextOnlySpeechAdapter()) {}

  /** 浏览器语音不可用或启动失败时回退文本计时，保证课程主循环不被 TTS 阻塞。 */
  speak(text: string, rate = 1): PlaybackHandle {
    if (!isBrowserSpeechAvailable()) return this.fallback.speak(text, rate);

    try {
      const utterance = new SpeechSynthesisUtterance(text);
      utterance.lang = "zh-CN";
      utterance.rate = rate;
      let settled = false;
      let resolveDone: () => void = () => {};
      const done = new Promise<void>((resolve) => { resolveDone = resolve; });
      const finish = () => {
        if (settled) return;
        settled = true;
        resolveDone();
      };
      utterance.onend = finish;
      utterance.onerror = finish;
      window.speechSynthesis.speak(utterance);
      return {
        done,
        pause() { if (!settled) window.speechSynthesis.pause(); },
        resume() { if (!settled) window.speechSynthesis.resume(); },
        cancel() { if (!settled) window.speechSynthesis.cancel(); finish(); },
      };
    } catch {
      return this.fallback.speak(text, rate);
    }
  }
}

export function isBrowserSpeechAvailable(): boolean {
  return typeof window !== "undefined" && "speechSynthesis" in window && typeof SpeechSynthesisUtterance !== "undefined";
}

export function createSpeechAdapter(browserSpeechEnabled: boolean): SpeechAdapter {
  return browserSpeechEnabled ? new BrowserSpeechAdapter() : new TextOnlySpeechAdapter();
}
