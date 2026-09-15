CREATE TABLE IF NOT EXISTS course_folders (
  id CHAR(36) NOT NULL,
  name VARCHAR(80) NOT NULL,
  sort_order INT UNSIGNED NOT NULL DEFAULT 0,
  created_at BIGINT UNSIGNED NOT NULL,
  updated_at BIGINT UNSIGNED NOT NULL,
  PRIMARY KEY (id),
  UNIQUE KEY uq_course_folders_name (name),
  INDEX idx_course_folders_order (sort_order, created_at)
) ENGINE=InnoDB DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_ai_ci;

CREATE TABLE IF NOT EXISTS course_folder_memberships (
  course_id CHAR(36) NOT NULL,
  folder_id CHAR(36) NOT NULL,
  moved_at BIGINT UNSIGNED NOT NULL,
  PRIMARY KEY (course_id),
  INDEX idx_course_folder_memberships_folder (folder_id, moved_at),
  CONSTRAINT fk_course_folder_memberships_course
    FOREIGN KEY (course_id) REFERENCES courses(id)
    ON DELETE CASCADE,
  CONSTRAINT fk_course_folder_memberships_folder
    FOREIGN KEY (folder_id) REFERENCES course_folders(id)
    ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_ai_ci;
