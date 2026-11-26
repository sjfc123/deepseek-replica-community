# WebView UI 假死排查记录（0.9.1）

审计对象：`DeepSaga` Android WebView 壳与 `src/` 前端。  
触发场景：导入大量历史、单会话消息极多、长时间后台后唤醒。  
判定标准：主线程是否被同步长任务占满、DOM 是否无上限增长、锁/监听是否必然释放、是否存在全屏点击拦截层。

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

- 继续保留 Worker 优先，不把回退路径删成“兜底逻辑”。
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

现状：

- `MessageList` 首屏只渲染最近 `INITIAL_MESSAGES = 4` 条，向上滚动按 `OLDER_MESSAGES = 8` 条补齐。
- 但 `messageWindow.start` 只减不增，用户反复向上翻到会话开头后，DOM 会累积整个会话。
- 原实现没有真正的虚拟列表，长会话下仍是“所有已加载消息都在 DOM 中”。

已修复：

`src/components/messages/MessageList.module.css` 对每行增加：

```css
.memorySelectRow {
  position: relative;
  content-visibility: auto;
  contain-intrinsic-size: auto 180px;
}
```

作用：离屏消息跳过布局与绘制，只保留估算占位高度；滚动时按需恢复真实高度。它不能替代虚拟列表，但能把“长会话首次进入/快速滚动”的绘制成本压到视口附近。

残余：`start` 没有上限。若单会话超过数千条且用户持续向上翻，DOM 节点仍会增长。彻底方案是把 `messageWindow` 改成带上下界的窗口 + 上下 spacer，并在 `pendingJump` 时按目标索引重设窗口；这会改动滚动锚点、搜索跳转、长按选择三条链路，未在本版强行合入。

### 2. 全局状态引发全量重排

现状：

- `messages` 通过 `useMemo(() => getVisibleMessages(session), [session])` 派生。
- 会话对象更新会重建消息数组，但消息行是稳定的 `key={message.id}`；新增消息只影响尾部。
- 没有发现某个按钮 loading 状态触发整个消息树重渲染的全局 store 订阅。

结论：当前重排风险主要来自 DOM 数量，不是状态粒度。

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

## 本轮实际改动

1. `MemoryPanel.module.css`：桌面 `max-height` 从 `82vh/760px` 收到 `76vh/700px`；移动端从 `78dvh/660px` 收到 `66dvh/560px`，弹窗不再接近满屏。
2. `MessageList.module.css`：消息行启用 `content-visibility: auto` 与 `contain-intrinsic-size`，降低长会话离屏绘制成本。
3. `memoryView.ts`：兼容 `玩家提问：` / `角色回应：`，修复“有卡片但筛选为空”。
4. 角色卡来源链接链路与来源公告，见 `README.md` 与 `NOTICE.md`。

未合入的高风险改造：真正的虚拟列表窗口化。需要单独回归滚动锚点、搜索跳转、版本切换、长按多选四条链路，不能用一个 `slice` 直接替代。
