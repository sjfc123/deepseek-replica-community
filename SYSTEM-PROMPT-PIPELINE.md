# System 前缀链路与缓存边界

这份说明对应 0.8.79，只回答三个问题：一条聊天请求里的 system 从哪里来、哪些东西不会进入 system、哪些操作会改变请求前缀但不会改动 system。

## 一句话结论

system 在进入请求之前固定，只由「启用中的角色卡 + 手写提示词 + 固定演出规则」组成。记忆、场景和本轮世界书作为 `turnContext` 接在当前 user 消息的内容末尾；`latest_reminder` 是单独的提醒消息，插在当前 user 之前。两者都不进入 system。

## 装配顺序

1. **读取设置**：`initialSystemPrompt()` 读 `replica:system-prompt` 与 `replica:system-prompt-empty`。
   - 键不存在：新用户，使用 `DEFAULT_SYSTEM_PROMPT`。
   - 清空标记为 `1`：返回空字符串，不注入 system。
   - 键存在但只有空白：按主动清空处理，返回空字符串。
   - 读到旧版公司身份提示词：迁移为新默认人格。
   - 其他内容：原样返回。
2. **拼角色卡**：角色扮演开启且启用卡存在时，`formatCharacterCard(card, userName)` 按固定字段拼姓名、身份、关系、说话方式、小习惯、别忘的事、开场参考。
3. **拼提示词**：`composeSystemPrompt()` 返回手写提示词或默认人格，按需追加 `META_TALK_GUARD`，再统一追加 `ASIDE_AND_ADDRESS_GUARD`。手写提示词为空且没有启用角色卡时，整个 system 保持为空。
4. **替换占位符**：`applyPlaceholders()` 把 `{{user}}` 换成用户名；`{{char}}` 使用当前卡名或手写角色名，二者都为空时回退为 `AI`。
5. **写入请求**：`CreateMessageRequest.system` 保存最终字符串。此时本轮记忆、场景、世界书和 `latest_reminder` 都还没有进入 system。
6. **协议序列化**：按接口格式落到对应字段，见下表。

## 各协议的位置

| 接口格式 | system 的实际位置 | `latest_reminder` |
| --- | --- | --- |
| OpenAI Chat Completions（官方 DeepSeek Chat） | `messages[0] = { role: 'system', content: system }` | 作为独立 `latest_reminder` 消息，插在对应 user 之前 |
| OpenAI Responses | 顶层 `instructions` | 序列化时丢弃 |
| Anthropic Messages（官方兼容层） | 顶层 `system` | 原数组保留；是否接受由兼容层决定 |
| 自定义 Chat / Responses | 对应协议的 system 字段 | 默认不生成；即使生成也在序列化时丢弃 |
| 自定义 Messages | 顶层 `system` | 序列化时丢弃 |

空白 system 在序列化阶段统一不发送：Chat 不插入 system 消息，Responses 不写空 `instructions`，Messages 不写空 `system`。这样“清空提示词”就是真正无 system，而不是发一条只有空格的消息。

## `latest_reminder` 的位置

`createLatestReminder()` 只生成日期、星期、大致地点、平台 `Web` 和语言快照，不含具体时刻。它不是 system 的一部分，也不是当前 user 正文的一部分：

- 当前轮：`appendReminder(latestReminder)` 在当前 user 之前插入一条 `{ role: 'latest_reminder' }`；
- 历史轮：每条 assistant 回复保存生成时的快照，序列化历史时插在对应 user 之前；
- 去重：与上一条快照相同就不重复插入，所以同一天内容稳定时不会每轮新增一条；
- 范围：自定义接口默认不生成；关闭“上下文提醒”后也不生成。

因此，把 `latest_reminder` 放进 system 会改变整个 system 前缀，让所有依赖 system 的缓存收口失效；当前实现刻意把它留在独立提醒消息里。它的内容变化会改变请求前缀，但只影响插入点及其后的消息，不改 system。

## 跨轮不变量

同一会话里，只要下面这些设置不变，普通轮次的 system 必须逐字相同：

- 启用中的角色卡 id 与卡内字段；
- 角色扮演开关；
- 手写提示词与清空标记；
- 手写角色名；
- “抑制元叙述”开关。

角色卡开场白固定留在 system，不按 `visibleForRoleplay.length` 或消息条数决定去留。0.8.76 之前它在第一轮进入、第二轮消失，system 前缀在第二轮整体变化，角色卡与历史的前缀缓存随之失效。现在开场白始终在 system 内，文案明确“只在第一条回复使用，后续自然延续，不要重复开口”；模型是否重复由文字约束，不再由请求结构改变。

## 会改变 system 的情况

- 切换或关闭角色卡；
- 修改手写提示词、清空提示词、恢复默认；
- 修改手写角色名；
- 打开或关闭“抑制元叙述”。

这四项是用户主动改设定，system 变化属于预期。除这些之外，不应该因为轮数、记忆新增、场景更新、世界书命中或日期变化而改动 system。

## 会改变请求前缀、但不改 system 的情况

“system 不变”不等于“整个请求前缀不变”。下面这些操作会改动请求里的历史或尾部，缓存可能因此从变化点开始失效：

1. **自动压缩 / 预算裁剪**：`prepareHistoryContext()` 在预算不足时丢弃最旧轮次。开启自动压缩时还会生成摘要，`includeContextSummary()` 把摘要插入请求中的首条 user 消息。即使关闭自动压缩，预算裁剪仍会丢弃旧轮，只是不生成摘要。
2. **编辑或删除历史消息、切换分支、导入历史**：会话数组本身变了，序列化出的 messages 也会变。
3. **拒答上下文开关**：被拒轮次是否重新进入历史，会改变后续请求的消息数量。
4. **`latest_reminder` 变化**：日期、星期、地点、Web 或语言变化时，插入点和后续消息都会变；同一天内容稳定时通常不新增。

## 0.8.76 / 0.8.77 改了什么

**0.8.76**

1. 角色卡开场白固定留在 system，去掉消息条数依赖，消除第二轮前缀变化。
2. `composeSystemPrompt` 把纯空白提示词按清空处理，不再落回默认人格。
3. `initialSystemPrompt` 区分“键不存在”和“键存在但为空白”：前者给默认人格，后者保持空。
4. 手写角色名为空时 `{{char}}` 回退为 `AI`，避免字面占位符进入 system 或背景资料。
5. 默认人格与演出规则对“括号内心活动”的矛盾统一：旁白、分析、写作计划禁止；角色主观心理活动允许放进圆括号。
6. 三种协议在序列化时统一拦截空白 system。

**0.8.77**

1. README 与本文改为同一套口径：system 只含角色卡、手写提示词和演出规则；记忆、场景、世界书在本轮 user 尾部；`latest_reminder` 在当前 user 之前；自动压缩和历史编辑会改变请求前缀。

## 验证方式

- `pnpm test:system`：断言角色卡前缀逐字稳定、开场白始终存在、Chat 的 system 位于首条、Responses 的 system 位于 `instructions`、空 system 不生成 system 消息。
- 本地 8095 + mock：同一角色卡连续三轮发送，抓取请求体，比较 `messages[0].content` 的 SHA-256；三轮必须一致，且包含开场白、不含 `{{char}}`/`{{user}}`。
- 关闭角色卡：system 只含手写提示词，不含卡身份、关系、说话方式、世界书、场景。
- 清空提示词：请求体第一条就是 user，没有 system 消息。
- 纯空白提示词：与清空一致，不发空 system。
