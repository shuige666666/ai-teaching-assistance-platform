import { courseRepositoryContract } from "./course-repository-contract";
import { InMemoryCourseRepository } from "@/lib/repository/in-memory-course-repository";

courseRepositoryContract("InMemory", () => new InMemoryCourseRepository());
