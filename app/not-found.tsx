import Link from "next/link";
import { StatePage } from "@/components/layout/state-page";

export default function NotFound() {
  return (
    <StatePage
      kind="not-found"
      eyebrow="404"
      title="页面不存在"
      description="链接可能已失效，或页面已被移动。"
      actions={<Link className="btn btn--primary" href="/">返回课程库</Link>}
    />
  );
}
