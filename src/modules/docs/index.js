// 文档模块：自有 md 树 + 外部只读绑定 + 双链索引 + 绑定管理。
//
// 「描述的权威是磁盘上的 .md 文件」——本模块只做这件事：CRUD、绑定、种子、知识聚合。
// 面板编辑（DocPanel）与组详情渲染都从这里取数；`repo knowledge` 在 repos 模块
// （它属于 repo.* 命令族），聚合逻辑在 knowledge.js。
//
// resource: 'doc' 触发 CRUD 五件断言（tests/unit/registry.test.mjs）：
//   doc.list / doc.get / doc.add / doc.update / doc.remove 必须齐备且两端可调。
//
// 业务逻辑在 ./service.js（CRUD + 外部写回），附件在 ./attach.js，
// CLI 人读渲染在 ./render.js —— 本文件只剩模块声明与 action 表。
import * as seed from './seed.js';
import * as refs from './refs.js';
import * as links from './links.js';
import { addDoc, getDoc, listDocs, removeDoc, updateDoc } from './service.js';
import { attachToDoc, detachFromDoc, listDocAttachments, noteOnDoc } from './attach.js';
import {
  renderAttach,
  renderAttachments,
  renderDetach,
  renderGet,
  renderLink,
  renderList,
  renderNoteRef,
  renderRef,
  renderSeed,
  renderWritten,
} from './render.js';

export default {
  id: 'docs',
  title: '文档（自有 md 树：项目/组介绍、组内描述、双链、外部只读绑定）',
  order: 12,
  // 面板入口在组详情页与工作区 doc 页签（DocPanel），不占独立视图

  resource: 'doc',

  actions: [
    {
      id: 'doc.list',
      cli: ['docs', 'list'],
      http: ['GET', '/api/docs'],
      summary: '文档树索引（自有 + 可选外部；零副作用，双链解析的数据源）',
      flags: {
        external: { type: 'boolean', hint: '附带外部绑定闭包内的文档与绑定清单' },
      },
      run: (ctx) => listDocs(ctx),
      render: renderList,
    },
    {
      id: 'doc.get',
      cli: ['docs', 'get'],
      http: ['GET', '/api/docs/item'],
      summary: '读文档全文：rel:<路径>（或裸相对路径）= 自有；path:<绝对路径> = 外部（须在绑定闭包内）；约定路径缺失时惰性播种',
      args: ['ref'],
      run: (ctx) => getDoc(ctx),
      render: renderGet,
    },
    {
      id: 'doc.add',
      cli: ['docs', 'add'],
      http: ['POST', '/api/docs/item'],
      summary: '新建自有文档（--body 给 Markdown 正文；--body-file <文件> / - 读管道；已存在则报冲突）',
      args: ['rel'],
      flags: {
        body: { type: 'string', hint: 'Markdown 正文' },
        bodyFile: { type: 'string', hint: '从文件读正文（--body 优先）；`-` = 读标准输入' },
        'body-file': { type: 'string', hint: '同 --bodyFile（连字符写法）' },
      },
      run: (ctx, opts) =>
        addDoc(
          { rel: ctx.rel, body: ctx.body, bodyFile: opts && opts.transport === 'http' ? undefined : (ctx.bodyFile ?? ctx['body-file']) },
          opts
        ),
      render: renderWritten,
    },
    {
      id: 'doc.update',
      cli: ['docs', 'set'],
      http: ['PATCH', '/api/docs/item'],
      summary: '写文档正文（面板保存走这里；自有走 own 树、外部走绑定闭包内原文件；写盘后摘要回写 desc / 组内 note）',
      args: ['ref'],
      flags: {
        body: { type: 'string', hint: 'Markdown 全文' },
        bodyFile: { type: 'string', hint: '从文件读全文（--body 优先）；`-` = 读标准输入' },
        'body-file': { type: 'string', hint: '同 --bodyFile（连字符写法）' },
      },
      run: (ctx, opts) =>
        updateDoc(
          { ref: ctx.ref, body: ctx.body, bodyFile: opts && opts.transport === 'http' ? undefined : (ctx.bodyFile ?? ctx['body-file']) },
          opts
        ),
      render: renderWritten,
    },
    {
      id: 'doc.remove',
      cli: ['docs', 'remove'],
      http: ['DELETE', '/api/docs/item'],
      summary: '删除自有文档（外部绑定不可删）',
      args: ['ref'],
      run: (ctx) => removeDoc(ctx),
      render: (d) => `已删除: ${d.rel}`,
    },

    {
      id: 'doc.attachments',
      cli: ['docs', 'attachments'],
      http: ['GET', '/api/docs/attachments'],
      summary: '这篇文档用了哪些资源（ref_attach：图片/文件/URL/内部 task、ref 引用）',
      args: ['ref'],
      run: (ctx) => listDocAttachments(ctx),
      render: renderAttachments,
    },
    {
      id: 'doc.attach',
      cli: ['docs', 'attach'],
      http: ['POST', '/api/docs/attach'],
      summary:
        '给文档挂资源：--path / --fileId / --url / --task / --doc 之一；默认追加进正文，--no-embed 只挂附件区（不写正文）',
      args: ['ref'],
      flags: {
        path: { type: 'string', hint: '本机文件路径（落本机附件仓）' },
        fileId: { type: 'string', hint: '已有附件 id' },
        url: { type: 'string', hint: '外部链接（http/https）' },
        task: { type: 'string', hint: '任务全局 id（kind=task）' },
        doc: { type: 'string', hint: '另一篇文档的 ref/path（kind=ref）' },
        name: { type: 'string', hint: '显示名（默认取文件名/原名）' },
        note: { type: 'string', hint: '附件区备注' },
        noEmbed: { type: 'boolean', hint: '只写 ref_attach（role=attach），不改正文' },
        'no-embed': { type: 'boolean', hint: '同 --noEmbed' },
      },
      run: attachToDoc,
      render: renderAttach,
    },
    {
      // #168：改一条绑定的说明（desc）——面板里 ref 条目「✎ 说明」的落点
      id: 'doc.attach-note',
      cli: ['docs', 'attach-note'],
      http: ['PATCH', '/api/docs/attach-note'],
      summary: '改一条附件绑定的说明（desc）：--attachment <资源 id> --note <说明>（只动说明，角色/位置不变）',
      args: ['ref'],
      flags: {
        attachment: { type: 'string', required: true, hint: '资源 id（见 docs attachments）' },
        note: { type: 'string', hint: '说明文字（留空 = 清掉）' },
      },
      run: (ctx) => noteOnDoc({ ref: ctx.ref, attachment: ctx.attachment, note: ctx.note }),
      render: (d) => `已更新 ${d.attachment} 的说明：${d.note || '（清空）'}`,
    },
    {
      id: 'doc.detach',
      cli: ['docs', 'detach'],
      http: ['DELETE', '/api/docs/attach'],
      summary: '解除文档与附件的关系（默认只解除关系）；--purge 无人引用时连资源行与本机字节一起删',
      args: ['ref'],
      flags: {
        attachment: { type: 'string', required: true, hint: '资源 id（见 docs attachments）' },
        purge: { type: 'boolean', hint: '连资源与字节一起删（仍被引用时拒绝）' },
      },
      run: detachFromDoc,
      render: renderDetach,
    },
    {
      id: 'docs.seed',
      cli: ['docs', 'seed'],
      http: ['POST', '/api/docs/seed'],
      summary: '把仓库 desc / 看板 desc / 组内 note 字符串播种成约定路径的 md（缺省预览，--apply 执行；幂等）',
      flags: {
        apply: { type: 'boolean', hint: '执行播种（缺省只预览）' },
      },
      run: (ctx) => (ctx.apply ? seed.seedApply() : seed.seedPlan()),
      render: renderSeed,
    },
    {
      id: 'docs.bind',
      cli: ['docs', 'bind'],
      http: ['POST', '/api/docs/bind'],
      summary: '绑定项目/组介绍的文档覆盖（--repo 或 --board 二选一 + --rel <自有路径> | --path <外部文件/目录>；--reset 拆回约定路径）',
      flags: {
        repo: { type: 'string', hint: '仓库（id / key / 路径 / 名称）' },
        board: { type: 'string', hint: '看板（id / key / 名称）' },
        rel: { type: 'string', hint: '自有树内路径（如 repo/github.com/me/x.md）' },
        path: { type: 'string', hint: '外部文件/目录绝对路径（如 Obsidian vault；只读，不进 zip）' },
        reset: { type: 'boolean', hint: '拆掉覆盖，回到约定路径' },
      },
      run: (ctx) => refs.setDocRef(ctx),
      render: renderRef,
    },
    {
      id: 'docs.notebind',
      cli: ['docs', 'note-bind'],
      http: ['POST', '/api/docs/note-bind'],
      summary: '绑定组内仓库描述的文档覆盖（--board <看板> --repo <仓库> + --rel/--path/--reset；仓库须为该组成员）',
      args: ['board'],
      flags: {
        repo: { type: 'string', required: true, hint: '仓库（id / key / 路径 / 名称）' },
        rel: { type: 'string', hint: '自有树内路径' },
        path: { type: 'string', hint: '外部文件/目录绝对路径（只读）' },
        reset: { type: 'boolean', hint: '拆掉覆盖，回到约定路径' },
      },
      run: (ctx) => refs.setNoteDocRef(ctx),
      render: renderNoteRef,
    },
    {
      id: 'docs.link',
      cli: ['docs', 'link'],
      http: ['POST', '/api/docs/link'],
      summary: '维护组的附加文档列表（--doc <自有路径|绝对路径> + --note/--tag；--remove <序号> 移除；--before <序号> 插位；同 doc 重复添加 = 更新）',
      args: ['board'],
      flags: {
        doc: { type: 'string', hint: '自有树路径 = 自有文档；盘符/绝对路径 = 外部只读引用' },
        note: { type: 'string', hint: '条目说明' },
        tag: { type: 'string', hint: '分类标签（如 qa；简介行渲染成小 chip；空串 = 清掉）' },
        remove: { type: 'number', hint: '移除第 N 条（1 起）' },
        before: { type: 'number', hint: '插到第 N 条之前（缺省追加到末尾）' },
      },
      run: (ctx) => refs.setDocLink(ctx),
      render: renderLink,
    },
    {
      id: 'docs.index',
      cli: ['docs', 'index'],
      http: ['GET', '/api/docs/index'],
      summary: '双链索引（docId + 文件名；前端点击 [[..]] 前拉一次；解析规则见 core/wikilink.js）',
      run: async () => ({ index: await links.buildIndex() }),
      render: (d) => d.index.map((x) => `  ${x.name}  →  ${x.docId}`).join('\n') || '（空）',
    },
  ],
};
