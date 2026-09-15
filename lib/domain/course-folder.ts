import { z } from "zod";

export const CourseFolderNameSchema = z.string().trim().min(1, "文件夹名称不能为空").max(80, "文件夹名称不能超过 80 个字符");

export const CourseFolderSchema = z.object({
  id: z.string().uuid(),
  name: CourseFolderNameSchema,
  order: z.number().int().nonnegative(),
  createdAt: z.number().int().nonnegative(),
  updatedAt: z.number().int().nonnegative(),
}).strict();

export const CourseFolderMembershipSchema = z.object({
  courseId: z.string().uuid(),
  folderId: z.string().uuid(),
  movedAt: z.number().int().nonnegative(),
}).strict();

export type CourseFolder = z.infer<typeof CourseFolderSchema>;
export type CourseFolderMembership = z.infer<typeof CourseFolderMembershipSchema>;
