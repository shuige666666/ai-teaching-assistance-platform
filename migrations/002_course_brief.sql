SET @brief_column_exists = (
  SELECT COUNT(*)
  FROM information_schema.columns
  WHERE table_schema = DATABASE()
    AND table_name = 'courses'
    AND column_name = 'brief_json'
);

SET @brief_migration_sql = IF(
  @brief_column_exists = 0,
  'ALTER TABLE courses ADD COLUMN brief_json JSON NULL AFTER requested_scene_count',
  'SELECT 1'
);

PREPARE brief_migration_statement FROM @brief_migration_sql;
EXECUTE brief_migration_statement;
DEALLOCATE PREPARE brief_migration_statement;
