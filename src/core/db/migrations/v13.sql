-- schema v13：彻底删除「关系表上的业务 note」概念
--
-- 口径（2026-11-17 用户拍板，任务 #148）：note 是前期错误的设计——
--   1. 关系表（ref_bindings / ref_attach / group_refs / repo_group_members）
--      本身就表达「多对多」，不该再挂一个业务字段当说明；
--   2. 文档描述已经落到 ref 自己的 desc（v7）+ 正文标题（#168）上，
--      参考仓库的描述也走「绑定 ref 的文档列表」（v12 的 link_notes 机制），
--      note 在界面上要么被 desc 覆盖、要么根本没显示；
--   3. web 已经完全基于文档列表：note 既没有显示位、也不该当搜索依据。
-- 无效概念就该从根上删掉，而不是留着假装有用。
--
-- 本次动作：4 张关系表的 note 列直接删（DROP COLUMN）。
--   · ref_bindings.note       —— 某份文档在某个列表里的一句话（被 desc 取代）
--   · ref_attach.note         —— 附件绑定说明
--   · group_refs.note         —— 参考仓库在组/仓库里参考什么（走 link_notes 描述文档）
--   · repo_group_members.note —— 仓库在组里的说明（主体是成员关系，无显示位）
-- 历史 DDL 快照（v1/v4/v5/v6/v9/v10）保持不可变，靠本迁移 drop。
--
-- 不删（主体不是关系）：task_links.note（派生一句话）、repos.notes（仓库自身备注，
-- 但 web 的表单/展示位本轮一并移除，列暂留以兼容旧数据）、task_attach.note（任务附件说明）。
ALTER TABLE ref_bindings DROP COLUMN note;
ALTER TABLE ref_attach DROP COLUMN note;
ALTER TABLE group_refs DROP COLUMN note;
ALTER TABLE repo_group_members DROP COLUMN note;
