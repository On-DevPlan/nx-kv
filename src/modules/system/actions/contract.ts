// system.contract —— 契约快照端点：`GET /api/contract`（CLI：`nx-kv contract`）。
//
// 这是端侧「我这份生成物还认不认得服务端」的唯一依据：
//   · hash 对账：生成物里写死的 contractHash 与这里返回的 hash 比
//   · 结构包含：端侧只做「我声明的字段 ⊆ 服务端声明的字段」判定，不追求完全相等
//     （服务端加字段是兼容变更，不该让所有端侧立刻红）
//
// 快照由 runtime/registry 在装配期 publish（core/contract-snapshot.ts），本文件只读：
// registry → modules → 本文件 → registry 会成环，而模块也够不着 runtime。
// 这份「发布格子」与 bootstrap 读命令表是同一套模式，代价只是「读快照而非实时算」。
import { z } from 'zod';
import { action } from '../../../runtime/action-decorator.js';
import { ActionBase, type ActionInput } from '../../../runtime/action-base.js';
import { contractSnapshot } from '../../../core/contract-snapshot.js';

/** system.contract 的入参契约。 */
const input = z.object({});

/**
 * 出参视图：**故意写得浅**。
 *
 * 快照里的 `output` 是递归类型树，用 zod 精确描述它需要 z.lazy 自引用，
 * 而 describeOutput 会把 union/lazy 一律降级成 dynamic——写精确了也拿不到类型，
 * 反而让生成物里多一个自指的怪模型。所以这里只声明端侧真正要用的三样：
 * 版本、指纹、action 清单（id + 路由），类型树原样透传成 dynamic。
 */
const output = z.object({
  app: z.string(),
  version: z.string(),
  hash: z.string().describe('契约指纹（stableStringify 的 sha256 前 16 位）'),
  actions: z.array(
    z.object({
      id: z.string(),
      http: z.string().nullable().describe('`METHOD /path`；纯 CLI 命令为 null'),
      summary: z.string().optional(),
      output: z.unknown().describe('出参类型树（IR 原样透传，端侧通常不解析）'),
    }),
  ),
});

export class ContractAction extends ActionBase<typeof input> {
  @action({
    id: 'system.contract',
    cli: ['contract'],
    http: ['GET', '/api/contract'],
    summary: '契约快照：带 output 的 action + 指纹（端侧据此对账自己是不是旧契约）',
    input,
    output,
  })
  override async run(_ctx: ActionInput<this['_input']>) {
    const snap = contractSnapshot();
    if (!snap) {
      // 只有「没经过 registry 装配」的裸调用才会走到这里（正常启动/HTTP/CLI 都不会）
      throw new Error('契约快照尚未发布：请通过 registry / 服务启动后再调用 contract');
    }
    return snap;
  }
}
