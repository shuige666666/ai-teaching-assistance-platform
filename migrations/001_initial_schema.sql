CREATE TABLE IF NOT EXISTS courses (
  id CHAR(36) NOT NULL,
  schema_version SMALLINT UNSIGNED NOT NULL,
  revision BIGINT UNSIGNED NOT NULL,
  topic VARCHAR(500) NOT NULL,
  title VARCHAR(120) NOT NULL,
  status VARCHAR(32) NOT NULL,
  requested_scene_count TINYINT UNSIGNED NOT NULL,
  outlines_json JSON NOT NULL,
  scenes_json JSON NOT NULL,
  scene_progress_json JSON NOT NULL,
  outline_generation_json JSON NULL,
  active_operation_json JSON NULL,
  last_error_json JSON NULL,
  created_at BIGINT UNSIGNED NOT NULL,
  updated_at BIGINT UNSIGNED NOT NULL,
  PRIMARY KEY (id),
  INDEX idx_courses_updated_at (updated_at),
  INDEX idx_courses_status (status),
  CONSTRAINT chk_courses_scene_count CHECK (requested_scene_count BETWEEN 3 AND 5),
  CONSTRAINT chk_courses_revision CHECK (revision >= 0)
) ENGINE=InnoDB DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_ai_ci;

CREATE TABLE IF NOT EXISTS quiz_attempts (
  id CHAR(36) NOT NULL,
  course_id CHAR(36) NOT NULL,
  scene_id CHAR(36) NOT NULL,
  question_id CHAR(36) NOT NULL,
  selected_option_id CHAR(36) NOT NULL,
  correct BOOLEAN NOT NULL,
  submitted_at BIGINT UNSIGNED NOT NULL,
  PRIMARY KEY (id),
  INDEX idx_quiz_attempts_course_id (course_id),
  CONSTRAINT fk_quiz_attempts_course
    FOREIGN KEY (course_id) REFERENCES courses(id)
    ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_ai_ci;
