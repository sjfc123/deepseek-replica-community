# WebView UI 假死排查记录（0.9.1）

审计对象：`DeepSaga` Android WebView 壳与 `src/` 前端。  
触发场景：导入大量历史、单会话消息极多、长时间后台后唤醒。  
判定标准：主线程是否被同步长任务占满、DOM 是否无上限增长、锁/监听是否必然释放、是否存在全屏点击拦截层。

## 残余风险说明

本审计只覆盖审计时能复现或代码可追踪的卡顿、假死与渲染路径，不代表所有机型、WebView、模型、网关、长会话和低内存组合都不存在同类问题。现有优化通过分批处理、Worker 优先、节流、去重和缓存诊断降低主线程压力，但无法承诺彻底根治所有卡顿、白屏、闪退、滚动抖动或内存压力；真实使用中遇到性能问题，仍需在目标设备复现后定位。

## 一、海量数据同步处理

### 1. 历史导入

现状：

- `src/services/chat/backup.ts` 的 `importHistory()` 不在 UI 事件里直接解析 ZIP，而是先进入 `importOffMainThread()`。
- `src/services/chat/history/importOffMainThread.ts` 优先创建 `import.worker.ts` Worker；Worker 初始化失败才回退主线程。
- 回退路径 `src/services/chat/history/importArchive.ts` 已按批次写暂存：会话每批由 `flushSessions()` 提交，单批超过 8 MB 会等待 IndexedDB 完成；图片每 32 个或 8 MB 调用 `flushFiles()`。
- `reportRead()` 每 200 ms 让出一次事件循环，避免 ZIP 连续解压时进度条完全停住。
- `src/services/chat/db.ts` 的旧槽清理按 `CLEANUP_BATCH_SIZE = 256` 分批，并在批间 `setTimeout(30)`。

结论：主路径已经不是“一次性 for 循环写几千条消息”。残余风险只在旧 WebView 不支持本地 Worker 时，ZIP 解压与 CRC 校验会回到主线程；这条路径仍有批次写入和 200 ms 让出，但解压本身无法分片。

已做约束：

- 继续保留 Worker 优先，不把回退路径删成低质量分支。
- 新增导入任务仍走 `backupQueue` 串行，避免两个大事务同时抢 IndexedDB。

### 2. 上下文与长期记忆重组

现状：

- 发送链路 `sendMessage()` 的提示词重组在 `src/services/chat/prompt.ts` 与记忆服务中完成，长期记忆有 60 张自动配额上限；核心记忆每轮最多 6 张。
- 记忆筛选 `src/services/chat/memoryView.ts` 只遍历当前记忆池，不遍历全部历史消息。
- 会话历史进入请求前由 `prepareHistoryContext()` 做预算裁剪，不会把整个会话原样拼进 prompt。

结论：没有发现“每轮把全部历史 + 全部记忆同步重算”的实现。数据量上限由配额和 token 预算双重约束。

### 3. 防抖与节流

现状：

- 消息滚动监听全部使用 `{ passive: true }`，回到底部按钮只在布尔值变化时触发 React 更新。
- 流式输出用 `requestAnimationFrame` 合帧，后台时改为直接 `flush()`，避免隐藏页面堆积动画帧。
- 记忆搜索与筛选是本地小数组过滤，数据量上限 60 张，未发现需要额外 debounce 的高频重计算。

结论：当前没有因输入/滚动监听缺失节流而锁死主线程的路径。

## 二、DOM 节点与重排

### 1. 长列表

现状（2026-11-27 收口后）：

- `MessageList` 首屏只挂载尾部 `INITIAL_VISIBLE_MESSAGES = 40` 条；跟随底部时窗口随新消息整体后移，DOM 始终约 40 条。
- 向上查看历史改为显式“显示更早消息”按钮，每次向前扩 `LOAD_EARLIER_MESSAGES = 20` 条，窗口总数硬上限 `MAX_VISIBLE_MESSAGES = 80`；超过上限后丢弃已离开视口的尾部旧消息。
- 搜索跳转只在目标前后取 `SEARCH_WINDOW_BEFORE = 2 / SEARCH_WINDOW_AFTER = 26` 条的临时窗口，定位后固化为非跟随窗口，不为一条旧消息挂载整段历史。
- 已移除滚动与 ResizeObserver 自动无限补历史的逻辑；“回到底部”先恢复尾部窗口，再在下一帧滚到底。

旧审计记录的修正：早期版本 `messageWindow.start` 只减不增，新会话从 `start = 0` 开始就会自然累积整个会话，并不需要用户先向上翻到开头；这一点在 2026-11-26 的根因审计中已确认。当前实现用带上下界的切片窗口取代了单调 `start`。

样式层补充：`src/components/messages/MessageList.module.css` 对每行保留 `content-visibility: auto` 与 `contain-intrinsic-size`，离屏消息不参与布局与绘制。该属性只省绘制与布局，不减少 React 组件、DOM 节点、Markdown AST 与事件监听；工作集封顶由上面的切片窗口负责。

残余：还不是真正的虚拟列表（上下 spacer + 只挂载视口附近 ± 一屏）。窗口达到 80 条后，单会话消息量极大时仍只在 80 条以内工作；彻底方案需要同时处理滚动锚点、搜索跳转、长按多选、版本切换四条链路，列入后续版本。

### 2. 全局状态引发全量重排

现状（2026-11-27 收口后）：

- `messages` 通过 `useMemo(() => getVisibleMessages(session), [session])` 派生。
- 会话对象更新会重建消息数组，但消息行是稳定的 `key={message.id}`；新增消息只影响尾部。
- 旧实现中每条 `AssistantMessage` 都订阅整个 `sessionCache[sessionId]`：流式逐帧生成新 session 对象后，`memo` 被整表新引用击穿，所有历史助手行都重渲染，成本随消息数线性增长。该订阅已移除，角色卡、头像、角色名由 `MessageList` 统一解析后作为稳定 props 下传；历史行的 `memo` 在流式期间不再被整表更新击穿，只有正在输出的最后一行重渲染。
- `buildMessageVersions` 在兄弟版本列表未变化时复用旧版本对象与索引，历史行的版本 prop 引用保持稳定。

结论：重排风险已从“整棵消息树每帧重渲染”收敛为“最后一行 + 列表容器更新”；剩余的整表 `map` 与整份 IndexedDB 持久化列入后续增量改造。

## 三、内存泄漏、桥接与状态锁

### 1. 监听与定时器

现状：

- `Modal` 的 `keydown`、`MessageList` 的 `scroll/touch/pointer`、`ResizeObserver` 都在 `useEffect` 返回值里清理。
- 搜索高亮定时器在组件卸载时 `clearTimeout`。
- 长按编辑的全局监听按 `editingMessageId` 依赖挂载/卸载，未发现跨会话残留。

### 2. Android Bridge

现状：

- `MainActivity.DeviceBridge` 的 UI 操作统一 `runOnUiThread`，JS 调用立即返回，不等待主线程结果。
- `openExternalUrl()` 只做 scheme 校验后投递 `ACTION_VIEW`，不阻塞 WebView 线程。
- `prepareMicrophone()` 是唯一同步等待主线程的桥：`CountDownLatch.await(500ms)`，有硬超时，不会无限等待。
- 历史导出 `requestHistoryExport()` 只拉起系统文件选择器，写入由 `writeHistoryExport()` 分片完成。

结论：没有发现无限等待的 JS Bridge 调用。

### 3. 流式请求状态锁

现状：

- `store.ts` 在请求开始时写入 `streaming[sessionId] = controller`。
- 请求主体包在 `try/finally`，`finally` 无条件删除该 session 的 controller，并 `persist(sessionId)`。
- `abort` 通过 `controller.signal` 进入 `settleLocal(reply, 'stopped')`，不会把 `streaming` 留在 store 里。
- 导入替换/合并的 `importingHistory` 也在 `finally` 中复位，并重试保存、恢复详情读取。

结论：未发现“请求中断后全局 loading 锁不解除”的代码路径。

## 四、UI 遮挡与 GPU

现状：

- `TokenLimitDialog`、`SessionActionDialog`、`MemoryPanel` 等全屏层都是条件渲染；关闭即卸载，不会留下透明 `div`。
- `DragMask`、抽屉遮罩、消息高亮层均显式 `pointer-events: none`，不吞点击。
- 全局只有语音通话与拖拽遮罩使用 `backdrop-filter: blur()`，没有在长列表上批量叠毛玻璃。
- 抽屉动画只在展开/拖动期间提升合成层，静止时 `will-change: auto`。

结论：未发现“透明遮罩残留”或“长列表批量滤镜导致 GPU OOM”的具体代码点。

## 2026-11-27 性能收口与缺陷修复

### 已落地的性能改动

1. 消息窗口封顶（`MessageList.tsx`）：尾部 40 条起步，主动查看更早最多扩到 80 条；搜索跳转使用目标附近 2 / 26 条临时窗口；取消滚动自动无限补历史；回到底部先恢复尾部窗口。
2. 流式订阅隔离（`AssistantMessage.tsx` / `UserMessage.tsx`）：移除每条助手消息对整个 `sessionCache[sessionId]` 的订阅；角色卡、头像、角色名由列表统一取值后下传；版本表在结构未变时复用旧对象。
3. 诊断热路径（`diagnostics.ts`）：`recordStall` 只排队写轻量快照，卡顿当下不再同步调用 `deviceStats()`；目录递归扫描改为手动诊断强制刷新 + 10 分钟缓存，并带重入保护；30 秒定时落盘只写 localStorage 小快照。
4. 自动备份避让（`autoBackup.ts`）：流式输出期间跳过全量导出；`requestIdleCallback` 排队后、真正执行前再检查一次流式状态；`onPause` 触发的备份同样受该守卫保护。
5. 每帧派生减负：顶栏记忆计数改为直接遍历计数；token 用量改为流式结束后算一次，提醒 effect 依赖消息数量而非整个 session 对象；角色卡解析改为 `useMemo`；记忆选择回调与轮次 id 计算改为稳定 `useCallback`。

### 本轮修复的缺陷

1. `roleplay.ts` 的 `resolveSessionCharacterCard`：`session` 为 `null`（尚未落库的新会话）时被提前返回，导致空白新会话无法继承全局启用卡。已改为仅当会话存在且已有消息时不回填全局卡；`session = null` 与空消息数组一样允许继承全局卡。对应 `scripts/test-default-prompt.mjs` 的会话绑定优先 / 全局继承两条断言。
2. `MessageList.tsx`：版本切换与新消息到达的 `useLayoutEffect` 读取了 `messages.length` 但未列入依赖数组，已补齐，避免依赖漏项导致的窗口状态滞后。

### 验证结果

- `pnpm type`、`pnpm lint`（0 warning / 0 error）通过。
- `test:system`、`test:roleplay`、`test:story`、`test:auto-backup`、`test:data`、`test:prompt`、`test:memory`、`test:memory-routing`、`test:memory-view`、`test:memory-layers`、`test:groups`、`test:suggestions`、`test:cache` 全部通过。
- `pnpm build`（Rspack）通过；`./gradlew assembleRelease`（JDK 21、AGP 9.4.0、Gradle 9.7.1）通过。
- 尚未完成：真机 30 分钟以上连续角色扮演、500 / 1000 条消息窗口实测、流式滚动与重渲染的帧率与 JS 堆观测；这些需要中低配真机环境，见交接待办。

### 未合入的后续改造（P3）

- 真正的虚拟列表：上下 spacer + 只挂载视口附近 ± 一屏，需单独回归滚动锚点、搜索跳转、版本切换、长按多选四条链路。
- 会话结构版本号与增量持久化：减少每帧 O(n) 扫描和整份 IndexedDB PUT。
- 流式状态独立 slice：进一步降低 `sessionCache` 整表更新成本。
- 诊断日志分级采样与自动上报。

## 2026-11-27 基础扮演拆分与新会话角色提示（第二轮）

### 业务拆分

1. **基础扮演与出戏压制解耦**：旧设计里「出戏压制」开关同时承担基础扮演门控和元叙述压制两个职责。本轮把基础扮演拆成独立持久化开关 `basicRoleplayEnabled`（KEY `replica:basic-roleplay-enabled`），出戏压制 `suppressMetaTalk` 只负责在角色对话末尾追加演出约束；两者在设置页分属「基础扮演模式」「出戏压制」两组。
2. **统一判定口径**：抽出纯函数 `basicRoleplayActive({ basicRoleplayEnabled, promptEmpty, promptIsDefault, hasActiveCard })`（`systemPrompt.ts`），store 发送链路、建议生成、输入框、消息列表四处共用同一条口径，消除重复条件与判定漂移。
3. **预设升级**：`DEFAULT_SUPPRESSION_PERSONA` 在保留「沈知夏 / 青梅竹马 / 有时黏人 / 不要客服腔」既有契约 token 的前提下，新增「与既有设定的关系」分区（角色卡、基础档案、世界书、场景、长期记忆、本轮上下文优先级高于本预设，冲突以既有描述为准，不用本预设改掉既有身份/经历/关系/外貌/性格/禁忌）与「连续性与边界」分区；基础扮演提示词与系统提示词同级装配。
4. **迁移口径**：新键缺失时从旧 `suppressMetaTalk` 取值，避免老用户基础扮演被静默关闭。

### 新会话角色提示

- `store.newChat()` 在全局角色卡启用并成功创建绑定卡的会话后，通过 toast 提示「已开启『{name}』角色的新对话」；文案走 i18n（`newChatWithCard`，中英两语）。

### 本轮修复的缺陷

1. **记忆池口径不一致**：`MessageList.tsx` 本地 `characterMemoryActive` 原先用 `Boolean(systemPrompt.trim())` 判断，基础扮演接管空/默认提示词的会话在保存记忆弹窗里会错误默认落到普通池。已改为 `suppressionActive || memoryPoolForDisplayName(...)`，与 store 发送链路一致。

### 验证结果

- `pnpm type`、`pnpm lint`（0 warning / 0 error）通过；13 个已挂载回归脚本全部通过；`pnpm build`（Rspack）与 `./gradlew assembleRelease` 通过。
- `test-default-prompt.mjs` 新增 5 条 `basicRoleplayActive` 判定用例与预设 token 断言。
- 未纳入维护回归集的补充脚本（`test-content-search` / `test-context-compaction` / `test-history-merge` / `test-android-onboarding`）受 Node strip-only 模式不支持构造参数属性所限，在基线即无法通过加载器执行，与本轮改动无关。
- 真机长时角色扮演、大消息窗口、流式帧率与堆观测仍待中低配真机环境闭环。

## 2026-11-27 真实接口对话实测（第三轮）

- 以临时密钥对应用默认 Anthropic Messages 链路（`deepseek-flash`）做普通助手与基础扮演两轮实测。普通助手问答的功能分组、页签、按钮与操作步骤均与真实 UI 一致，未发现编造入口或未实现能力；能力边界（智能搜索仅默认端点、配图需自配绘图接口、API Key 不进备份）表述准确。
- 基础扮演（沈知夏）5 轮居家对话保持第一人称、动作单星号、内心圆括号，前后文连续；逐轮建议的 detail/emotion/action/aside 方向错开，target 为本场角色，落点贴合当前台词与站位，未提前点破后续线索。
- 修正建议提示词数量口径：`SUGGESTION_SYSTEM` 原写「四个对象」，与代码最终只展示 3 条不一致；已改为「3 条候选对象（可再备 1 条富余）」，ask 约束同步对齐为「3 到 4 条候选」。
- 缓存：静态 system 前缀与轮次动态内容（记忆/场景/世界书/提醒）分离，动态上下文只挂最后一条用户消息尾部；预热后多轮缓存命中率约 88%–95%，未见前缀逐轮漂移导致的整段失效或消耗暴涨。`cacheDiagnostics` 已能识别 system 指纹变化与命中率骤降。

## 2026-11-27 长会话缓存实测与提示词互斥隔离（第四轮）

- 合并用户分卷导出（`.z01` + `.zip`），还原出完整对话备份；挑一条 176 轮长会话取最近 16 轮作为测试窗口（约 6.4 万字符），分三组各两轮：普通助手+深度思考开、普通助手+深度思考关、基础扮演（沈知夏）+思考关。
- 缓存结果：冷启动首轮未命中属正常（建立缓存）；预热第二轮命中率 99.0%–99.3%，system 前缀与更早历史均被命中，未见前缀被逐轮内容污染导致整段失效或消耗暴涨。关闭思考时不产生思考块；长历史里既有角色人设会被模型延续，属历史连续性，不是前缀问题。
- 提示词互斥隔离：表达提示词（手写系统提示词）与基础扮演预设同级互斥。基础扮演接管时，手写系统提示词不进入 system（compose 收到空提示词），只保留预设/档案身份；存在非默认手写提示词时 `basicRoleplayActive` 返回 false，预设不注入。二者不再同时拼进同一段 system，避免两段身份左右互搏；角色卡、档案、世界书、场景、记忆等既有设定仍按既有优先级叠加。
- 回归：`pnpm type`、`pnpm lint` 0 警告 0 错误；13 个已挂载脚本全部通过；`test-default-prompt.mjs` 新增强制扮演剥离手写提示词的断言。

## 2026-11-28 WebView 长会话首开与历史结算

### 1. Android 历史消息 Markdown 解析

- `src/components/markdown/Markdown.tsx` 在 Android WebView 下，历史消息与流式消息统一交给 `parseOffMainThread()` Worker 解析；首次打开长会话先渲染纯文本占位，Worker 返回 AST 后再替换为正式排版，主线程不执行整屏同步解析。
- Worker 初始化失败时置 `workerFailed` 并回退 `toMdAst()` 同步路径；回退只发生在 Worker 不可用或初始化失败后，不在每条消息上重复探测。
- `src/components/markdown/useThrottleMarkdownRender.ts` 按上次渲染耗时 × 2 计算下次允许更新时间，最长等待 2 秒；Android 流式最小间隔 50 ms，连续增量合并为最新内容，避免每个 token 都重建 AST。

### 2. 会话持久化

- `src/services/chat/store.ts` 的 `persist()` 用 `WeakSet` 记录已成功写入的会话对象；同一对象且无待写入附件时直接跳过，避免发送前快照与落盘连续触发重复结构化克隆。
- 附件仍按 `pendingFiles` 合并，首次写盘后清除；会话对象变化或附件变化时才重新写入。

### 3. 历史结算

- `src/services/chat/historyAudit.ts` 按 `AUDIT_CHUNK = 24` 条分批统计，批间 `setTimeout(0)` 让出事件循环；结果缓存上限 8 条，按会话 id、更新时间与存储消息数失效。
- 结算只读当前分支可见消息，统计字符、分词 Token、接口 usage 与最重消息；不写数据库、不发请求，不改变请求上下文。

### 4. 验证结果

- `pnpm type`、`pnpm lint`（0 warning / 0 error）与 `pnpm build` 通过。
- `test:system`、`test:roleplay`、`test:story`、`test:auto-backup`、`test:data`、`test:import-attach`、`test:prompt`、`test:memory`、`test:memory-routing`、`test:memory-view`、`test:memory-layers`、`test:groups`、`test:suggestions`、`test:cache`、`test:balance` 共 15 项通过。
