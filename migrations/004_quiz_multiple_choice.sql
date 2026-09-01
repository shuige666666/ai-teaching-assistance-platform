SET @answer_array_column_exists = (
  SELECT COUNT(*) FROM information_schema.columns
  WHERE table_schema = DATABASE() AND table_name = 'quiz_attempts' AND column_name = 'selected_option_ids_json'
);

SET @answer_array_migration_sql = IF(
  @answer_array_column_exists = 0,
  'ALTER TABLE quiz_attempts ADD COLUMN selected_option_ids_json JSON NULL AFTER question_id',
  'SELECT 1'
);

PREPARE answer_array_migration_statement FROM @answer_array_migration_sql;
EXECUTE answer_array_migration_statement;
DEALLOCATE PREPARE answer_array_migration_statement;

ALTER TABLE quiz_attempts MODIFY COLUMN selected_option_id CHAR(36) NULL;

UPDATE quiz_attempts
SET selected_option_ids_json = JSON_ARRAY(selected_option_id)
WHERE selected_option_ids_json IS NULL AND selected_option_id IS NOT NULL;

ALTER TABLE quiz_attempts
  MODIFY COLUMN selected_option_ids_json JSON NOT NULL;
