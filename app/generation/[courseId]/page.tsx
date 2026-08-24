import Link from "next/link";
import { GenerationWorkspace } from "@/components/course/generation-workspace";
import { getCourseRepository } from "@/lib/repository";
import { mapRepositoryError } from "@/lib/repository/error-response";

export const dynamic = "force-dynamic";

export default async function GenerationPage({ params }: { params: Promise<{ courseId: string }> }) {
  const { courseId } = await params;
  let course;
  try {
    course = await getCourseRepository().get(courseId);
  } catch (error) {
    const message = mapRepositoryError(error).body.error.message;
    return <main className="missing-state"><p className="eyebrow">DATABASE UNAVAILABLE</p><h1>暂时无法读取课程</h1><p>{message}</p><Link className="button button--dark" href="/">返回首页</Link></main>;
  }

  if (!course) {
    return <main className="missing-state"><p className="eyebrow">COURSE NOT FOUND</p><h1>这门课程不存在</h1><p>它可能已被删除。返回首页可以创建一门新课程。</p><Link className="button button--dark" href="/">返回首页</Link></main>;
  }

  return <GenerationWorkspace initialCourse={course} />;
}
