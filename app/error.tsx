"use client";

import Link from "next/link";
import { useEffect } from "react";
import { StatePage } from "@/components/layout/state-page";

/** 路由级兜底：渲染异常时给出可重试入口，并保留服务端日志对应的 digest。 */
export default function RouteError({ error, retry }: { error: Error & { digest?: string }; retry: () => void }) {
  useEffect(() => {
    console.error(error);
  }, [error]);

  return (
    <StatePage
      kind="error"
      eyebrow="页面出错了"
      title="这个页面暂时无法显示"
      description="可能是网络波动或服务暂时不可用。可以先重试；如果问题持续出现，请凭下方编号检查服务端日志。"
      actions={<>
        <button className="btn btn--primary" type="button" onClick={() => retry()}>重试</button>
        <Link className="btn btn--secondary" href="/">返回课程库</Link>
      </>}
    >
      {error.digest ? <code className="state-card__code">错误编号：{error.digest}</code> : null}
    </StatePage>
  );
}
