# board/nx 项目组收单意图(2026-11-07)

来源:本地任务队列 `localtask list`,按看板 **board/nx**(按前缀「nx」自动归组)聚类。
本仓库(nx-kv)队列 13 条 pending + nx-as 队列 1 条;其余(sedoc-fe-8.60×15、fr/go-ac/iot-pilot×6)不属于 nx 组,不在本次范围。

## A 簇 · nx-kv UI 规范化(#91,11-07 新投)

**任务原文要点:**

1. **按钮组件统一**,收敛到 `components/button/index.jsx`:
   - 全局按钮高度 28px、字号 12px
   - 三种:主按钮(纯色块、一页一个)/ 次级按钮 / 下拉按钮(文字右侧向下箭头、hover 展开)
   - 特别关注**设置页面**,大量按钮与规范不统一
2. **面板化组件**:
   - float 面板右上角去掉【浏览器预览】【迁回主页面】两个按钮
   - 右侧边栏去掉「页签」这一行
   - 左侧面板加【撤销】【恢复】两个按钮

**边界:** 需先全局统计现状(哪些页面用了哪些按钮写法)再收敛;验收标准任务里是占位符,需与用户敲定。

## B 簇 · md 编辑器体验(#92,11-07 新投)

三个问题:
1. 划线跨行适配不好,uiux 不丝滑
2. 会莫名其妙在头部多一大段空白
3. 上下键无法准确移动光标,必须鼠标点

**边界:** 编辑器块逻辑,涉及选区/光标模型;需复现后定位。

## C 簇 · 提示词预览验收(#83)——有验收反馈待解读

- 第一轮反馈「接口不存在 POST /api/localtasks/preview」已解决(旧 serve 进程,提交 2071340,等重启重试)
- 第二轮反馈内容为「**312312321**」——疑似无效输入/误触,需用户确认:任务是否算验收通过可关闭?

## D 簇 · localtask 附件功能(#14)

整条链路中附件功能未实现,实际功能与 web 界面未对齐。
**边界:** 需先盘点 web 界面承诺了哪些附件交互、CLI/链路现状缺哪些。

## E 簇 · 测试/占位任务 ×9(建议清理,待确认)

#2、#3、#4(页签流验证)、#9(组面板建任务测试)、#10/#11/#13(CLI 工作组测试)、#28(E2E 测试)、#29(test)。
全部为机制验证用测试投递,无实质需求。

## F 簇 · nx-as 队列 ×1(#2)

「仓库和仓库组的描述不是单个 md,而是一个 md 的列表」——nx-as 仓库的任务,队列属于 nx-as 目录,非本仓库。

---

## 待用户拍板

1. 本次执行哪些簇、什么优先级?
2. E 簇 9 条测试任务:删除还是标记完成?(清理上下文,须确认)
3. C 簇「312312321」反馈如何解读,任务可否关闭?
4. F 簇是否本次处理(在 nx-as 目录处理更合适)?

---

## 用户拍板结果(2026-11-07)

1. 本次做 A 簇 #91;B 簇 #92 留队列
2. E 簇批量删除(已执行,9 条软删除落库)
3. #83 算验收通过关闭(已 restore → get 领取 → done 回填)
4. F 簇 nx-as 本次不动

## #91 实施计划(探针实证后定稿)

探针证据(隔离 store + 7878 + Playwright,截图在 temp/obs-*.png):

- **「页签行」根因**:flexlayout-react 0.11.1 的 Model **没有 getRoot()**(只有 getRootRow())。
  workspace.js:787 `model.getRoot ? ... : null` 恒 null →「ts_right 缺失现建」分支是死代码,
  首次开右栏面板掉进兜底:addTab(ts_main, right),不设 enableTabStrip、不归一宽度
  (实测 tabset attr enableTabStrip=true / weight=34,页签条 h=27 渲染)。
  手动 updateNodeAttributes({enableTabStrip:false}) 后条立即消失。
- **「浏览器预览」按钮** = flexlayout 原生浮窗头部「弹出到浏览器窗口」按钮
  (flexlayout__float_window_button),渲染条件 canPopout = isSupportsPopout() &&
  getRootRow().isAllowedInWindow(),后者读全局属性 tabEnablePopout。浮窗本身走
  enableFloat(popoutTab(id,'float')),两者独立——关掉 tabEnablePopout 不影响浮窗。
- **「迁回主页面」按钮** = App.jsx 自注入的 flx-dockback(dockFloatBack,253-284;按钮 516-528)。
- **左面板撤销/恢复已存在**:sidebar/index.jsx 208-219(↶↷,11-01 就有,useUndo 驱动);
  redo 无历史时 disabled opacity 0.4,视觉上像装饰符号——用户可能因此以为没有。

改动清单:

1. workspace.js:GLOBAL_ATTRS.tabEnablePopout true→false(浮窗原生弹窗按钮消失)
2. workspace.js:787 model.getRoot → model.getRootRow()(复活 ts_right 现建分支,
   setRightSidebarVisible 随之生效:weight 16 + enableTabStrip false → 页签行消失)
3. App.jsx:删 flx-dockback 按钮 + dockFloatBack + 相关 i18n(保留「关闭浮窗」)
4. style.css:.btn 基类统一 height 28px / font-size 12px(inline-flex + gap 适配带图标按钮);
   .btn.small 只留紧凑 padding;.rp-page .btn.small 的 12.5px 覆盖删除
5. 新建 components/button/index.jsx:Button(primary/secondary/danger)+
   DropdownButton(文字右侧向下箭头,hover 展开),配 components/button/style.css
6. 设置页按钮迁移到 <Button>(index.jsx 21 处 + prompt-templates-section 12 处 +
   task-templates-section 3 处);顺手清掉作用域外无效的 sm class
7. 单测:初始布局 fromJson(ts_right 丢失)→ openPanel(progress) → 右栏 tabset
   enableTabStrip=false / weight=16;applyGlobalAttrs 后 tabEnablePopout=false

不动 / 遗留:

- 其余 30 个文件的 .btn 由 CSS 统一立即生效,组件化迁移渐进(本次不做全量替换,303 处风险大)
- iconbtn(26×26 图标钮)、浮窗头部 22×22 图标钮、toggle 开关不属于文字按钮三分类,保持
- 左面板撤销/恢复已存在,是否要提高可见度等用户反馈
- 浮窗内部还有一条 flexlayout 自带的「设置」页签样行(浮窗内层 tabset),用户未点名,不动
