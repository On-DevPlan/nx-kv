-- schema v7：refs 增加描述字段（desc）
--
-- 口径（任务 #97）：ref 是 DB 实体（id + desc + 正文 + 归属），不再是实体文件。
-- desc 是「快速定位」用的短描述，列表与提示词模板都以它为主标签；
-- 本轮不新增任何路径 / 文件名字段，也不改 ref_bodies / ref_attach。
--
-- desc 是 SQL 关键字，DDL 与查询一律加双引号。
ALTER TABLE refs ADD COLUMN "desc" TEXT NOT NULL DEFAULT '';
