import Link from "next/link";
import { ClassroomWorkspace } from "@/components/course/classroom-workspace";
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
    return <main className="missing-state"><p className="eyebrow">DATABASE UNAVAILABLE</p><h1>暂时无法加载课堂</h1><p>{message}</p><Link className="button button--dark" href="/">返回首页</Link></main>;
  }

  if (!course) {
    return <main className="missing-state"><p className="eyebrow">COURSE NOT FOUND</p><h1>无法加载课堂</h1><p>课程不存在或已经被删除。</p><Link className="button button--dark" href="/">返回首页</Link></main>;
  }
  // 至少一个场景成功保存后即可增量预览；ready 仍只表示整门课程全部生成完成。
  if (course.scenes.length === 0) {
    return <main className="missing-state"><p className="eyebrow">COURSE NOT READY</p><h1>场景还没有生成完成</h1><p>请返回生成页继续处理待生成场景，或重试失败场景。</p><Link className="button button--dark" href={`/generation/${course.id}`}>返回生成页</Link></main>;
  }

  return <ClassroomWorkspace course={course} />;
}
