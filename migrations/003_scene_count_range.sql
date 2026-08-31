-- 新课程由领域层限制为 4～8；数据库保留 3 的下界，避免历史三场景行阻止迁移。
-- 同名约束在一条 ALTER 内替换，重复执行仍得到相同结果。
ALTER TABLE courses
  DROP CHECK chk_courses_scene_count,
  ADD CONSTRAINT chk_courses_scene_count CHECK (requested_scene_count BETWEEN 3 AND 8);
