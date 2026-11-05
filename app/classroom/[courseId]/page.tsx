import Link from "next/link";
import { ClassroomWorkspace } from "@/components/course/classroom-workspace";
import { StatePage } from "@/components/layout/state-page";
import { getCourseRepository } from "@/lib/repository";
import { mapRepositoryError } from "@/lib/repository/error-response";

export const dynamic = "force-dynamic";

export default async function ClassroomPage({ params }: { params: Promise<{ courseId: string }> }) {
  const { courseId } = await params;
  let course;
  try {
    course = await getCourseRepository().get(courseId);
  } catch (error) {
    const message = mapRepositoryError(error).body.error.message;
    return (
      <StatePage
        kind="database"
        eyebrow="数据库暂不可用"
        title="暂时无法加载课堂"
        description={message}
        actions={<>
          <Link className="btn btn--primary" href={`/classroom/${courseId}`}>重新加载</Link>
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
        title="无法加载课堂"
        description="课程不存在或已经被删除。"
        actions={<Link className="btn btn--primary" href="/">返回课程库</Link>}
      />
    );
  }
  // 至少一个场景成功保存后即可增量预览；ready 仍只表示整门课程全部生成完成。
  if (course.scenes.length === 0) {
    return (
      <StatePage
        kind="pending"
        eyebrow="课堂尚未就绪"
        title="场景还没有生成完成"
        description="至少生成一个场景后才能进入课堂。请返回制作页继续生成待处理场景，或重试失败场景。"
        actions={<Link className="btn btn--primary" href={`/generation/${course.id}`}>返回制作页</Link>}
      />
    );
  }

  return <ClassroomWorkspace course={course} />;
}
