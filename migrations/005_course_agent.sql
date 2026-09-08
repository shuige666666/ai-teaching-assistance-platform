CREATE TABLE IF NOT EXISTS agent_sessions (
  id CHAR(36) NOT NULL,
  course_id CHAR(36) NOT NULL,
  title VARCHAR(120) NOT NULL,
  status VARCHAR(32) NOT NULL,
  created_at BIGINT UNSIGNED NOT NULL,
  updated_at BIGINT UNSIGNED NOT NULL,
  PRIMARY KEY (id),
  INDEX idx_agent_sessions_course_updated (course_id, updated_at),
  CONSTRAINT fk_agent_sessions_course FOREIGN KEY (course_id) REFERENCES courses(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_ai_ci;

CREATE TABLE IF NOT EXISTS agent_runs (
  id CHAR(36) NOT NULL,
  session_id CHAR(36) NOT NULL,
  status VARCHAR(32) NOT NULL,
  base_revision BIGINT UNSIGNED NOT NULL,
  final_revision BIGINT UNSIGNED NULL,
  deadline_at BIGINT UNSIGNED NOT NULL,
  error_text VARCHAR(1000) NULL,
  created_at BIGINT UNSIGNED NOT NULL,
  finished_at BIGINT UNSIGNED NULL,
  PRIMARY KEY (id),
  INDEX idx_agent_runs_session_created (session_id, created_at),
  INDEX idx_agent_runs_active (session_id, status, deadline_at),
  CONSTRAINT fk_agent_runs_session FOREIGN KEY (session_id) REFERENCES agent_sessions(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_ai_ci;

CREATE TABLE IF NOT EXISTS agent_messages (
  id CHAR(36) NOT NULL,
  session_id CHAR(36) NOT NULL,
  run_id CHAR(36) NULL,
  sequence_no INT UNSIGNED NOT NULL,
  role VARCHAR(16) NOT NULL,
  content_json JSON NOT NULL,
  created_at BIGINT UNSIGNED NOT NULL,
  PRIMARY KEY (id),
  UNIQUE KEY uq_agent_messages_sequence (session_id, sequence_no),
  INDEX idx_agent_messages_session (session_id, sequence_no),
  CONSTRAINT fk_agent_messages_session FOREIGN KEY (session_id) REFERENCES agent_sessions(id) ON DELETE CASCADE,
  CONSTRAINT fk_agent_messages_run FOREIGN KEY (run_id) REFERENCES agent_runs(id) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_ai_ci;

CREATE TABLE IF NOT EXISTS agent_confirmations (
  id CHAR(36) NOT NULL,
  session_id CHAR(36) NOT NULL,
  run_id CHAR(36) NOT NULL,
  call_id VARCHAR(120) NOT NULL,
  tool_name VARCHAR(80) NOT NULL,
  status VARCHAR(32) NOT NULL,
  base_revision BIGINT UNSIGNED NOT NULL,
  payload_json JSON NOT NULL,
  result_json JSON NULL,
  summary VARCHAR(500) NOT NULL,
  expires_at BIGINT UNSIGNED NOT NULL,
  created_at BIGINT UNSIGNED NOT NULL,
  updated_at BIGINT UNSIGNED NOT NULL,
  PRIMARY KEY (id),
  UNIQUE KEY uq_agent_confirmations_call (session_id, call_id),
  INDEX idx_agent_confirmations_pending (session_id, status, expires_at),
  CONSTRAINT fk_agent_confirmations_session FOREIGN KEY (session_id) REFERENCES agent_sessions(id) ON DELETE CASCADE,
  CONSTRAINT fk_agent_confirmations_run FOREIGN KEY (run_id) REFERENCES agent_runs(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_ai_ci;

