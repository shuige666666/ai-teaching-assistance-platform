import { HomeWorkspace } from "@/components/course/home-workspace";
import { getCourseFolderRepository, getCourseRepository } from "@/lib/repository";
import { mapRepositoryError } from "@/lib/repository/error-response";
import type { CourseSummary } from "@/lib/domain/schemas";
import type { CourseFolder, CourseFolderMembership } from "@/lib/domain/course-folder";

export const dynamic = "force-dynamic";

export default async function HomePage() {
  let courses: CourseSummary[] = [];
  let folders: CourseFolder[] = [];
  let memberships: CourseFolderMembership[] = [];
  let initialError: string | null = null;
  try {
    const folderRepository = getCourseFolderRepository();
    [courses, folders, memberships] = await Promise.all([
      getCourseRepository().list(),
      folderRepository.list(),
      folderRepository.listMemberships(),
    ]);
  } catch (error) {
    initialError = mapRepositoryError(error).body.error.message;
  }
  return <HomeWorkspace initialCourses={courses} initialFolders={folders} initialMemberships={memberships} initialError={initialError} />;
}
