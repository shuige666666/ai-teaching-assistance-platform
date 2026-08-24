import { HomeWorkspace } from "@/components/course/home-workspace";
import { getCourseRepository } from "@/lib/repository";
import { mapRepositoryError } from "@/lib/repository/error-response";
import type { CourseSummary } from "@/lib/domain/schemas";

export const dynamic = "force-dynamic";

export default async function HomePage() {
  let courses: CourseSummary[] = [];
  let initialError: string | null = null;
  try {
    courses = await getCourseRepository().list();
  } catch (error) {
    initialError = mapRepositoryError(error).body.message;
  }
  return <HomeWorkspace initialCourses={courses} initialError={initialError} />;
}
