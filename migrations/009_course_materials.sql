-- 材料按课程归属保存；原文与 courses 中的生成内容分离，删除课程时同步清理。
CREATE TABLE IF NOT EXISTS course_materials (
  id CHAR(36) NOT NULL PRIMARY KEY,
  course_id CHAR(36) NOT NULL,
  position TINYINT UNSIGNED NOT NULL,
  document_json JSON NOT NULL,
  UNIQUE KEY uq_course_material_position (course_id, position),
  CONSTRAINT fk_course_material_course FOREIGN KEY (course_id) REFERENCES courses(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_ai_ci;
