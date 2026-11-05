import Link from "next/link";
import { GenerationWorkspace } from "@/components/course/generation-workspace";
import { StatePage } from "@/components/layout/state-page";
import { getCourseRepository } from "@/lib/repository";
import { mapRepositoryError } from "@/lib/repository/error-response";

// 表示这个页面强制动态渲染
export const dynamic = "force-dynamic";

export default async function GenerationPage({ params }: { params: Promise<{ courseId: string }> }) {
  const { courseId } = await params;
  let course;
  try {
    // 在服务端渲染页面之前，先异步获取数据
    course = await getCourseRepository().get(courseId);
  } catch (error) {
    const message = mapRepositoryError(error).body.error.message;
    return (
      <StatePage
        kind="database"
        eyebrow="数据库暂不可用"
        title="暂时无法读取课程"
        description={message}
        actions={<>
          <Link className="btn btn--primary" href={`/generation/${courseId}`}>重新加载</Link>
          <Link className="btn btn--secondary" href="/">返回课程库</Link>
        </>}
      />
    );
  }

  if (!course) {
    return (
      <StatePage
        kind="not-found"
        eyebrow="课程不存在"
        title="没有找到这门课程"
        description="它可能已被删除，或链接不完整。回到课程库可以查看现有课程，或创建一门新课程。"
        actions={<Link className="btn btn--primary" href="/">返回课程库</Link>}
      />
    );
  }

  return <GenerationWorkspace initialCourse={course} />;
}
