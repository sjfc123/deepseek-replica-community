# System 前缀链路与缓存不变量

这份说明对应 0.8.76，只讲一件事：一条聊天请求里的 system 从哪里来、经过哪些步骤、为什么它能跨轮保持逐字稳定，以及哪些改动会故意让它变化。

## 一句话结论

system 在进入请求之前就固定下来，只由「启用中的角色卡 + 手写提示词 + 固定演出规则」组成。记忆、场景、世界书、日期地点提醒全部接在当前 user 消息末尾，不进 system。角色卡开场白现在始终留在 system 内，只靠文字约束“第一条回复使用”，不再按消息条数动态增删。

## 装配顺序

1. **读取设置**：`initialSystemPrompt()` 读 `replica:system-prompt` 与 `replica:system-prompt-empty`。
   - 键不存在：新用户，使用 `DEFAULT_SYSTEM_PROMPT`。
   - 清空标记为 `1`：返回空字符串，不注入 system。
   - 键存在但只有空白：按主动清空处理，返回空字符串。
   - 读到旧版公司身份提示词：迁移为新默认人格。
   - 其他内容：原样返回。
2. **拼角色卡**：角色扮演开启且启用卡存在时，`formatCharacterCard(card, userName)` 按固定字段拼姓名、身份、关系、说话方式、小习惯、别忘的事、开场参考。
3. **拼提示词**：`composeSystemPrompt()` 返回手写提示词或默认人格，按需追加 `META_TALK_GUARD`，再统一追加 `ASIDE_AND_ADDRESS_GUARD`。
4. **替换占位符**：`applyPlaceholders()` 把 `{{user}}` 换成用户名；`{{char}}` 使用当前卡名或手写角色名，二者都为空时回退为 `AI`。
5. **写入请求**：`CreateMessageRequest.system` 保存最终字符串。此时本轮记忆、场景、世界书、日期地点提醒还没有接进来。
6. **协议序列化**：按接口格式落到对应字段，见下表。

## 四种协议的位置

| 接口格式 | system 的实际位置 |
| --- | --- |
| OpenAI Chat Completions | `messages[0] = { role: 'system', content: system }` |
| OpenAI Responses | 顶层 `instructions` |
| Anthropic Messages / 自定义 Messages | 顶层 `system` |
| 官方 DeepSeek Chat | 仍是 `messages[0]` 的 system 消息；`latest_reminder` 作为独立角色消息跟在后面 |

空白 system 在序列化阶段统一不发送：Chat 不插入 system 消息，Responses 不写空 `instructions`，Messages 不写空 `system`。这样“清空提示词”就是真正无 system，而不是发一条只有空格的消息。

## 跨轮不变量

同一会话里，只要下面这些设置不变，system 必须逐字相同：

- 启用中的角色卡 id 与卡内字段；
- 角色扮演开关；
- 手写提示词与清空标记；
- 手写角色名；
- “抑制元叙述”开关。

因此，**角色卡开场白不能按 `visibleForRoleplay.length` 或消息条数决定是否进入 system**。0.8.76 之前它在第一轮进入、第二轮消失，system 前缀在第二轮整体变化，角色卡与历史的前缀缓存随之失效。现在开场白始终在 system 内，文案明确“只在第一条回复使用，后续自然延续，不要重复开口”；模型是否重复由文字约束，不再由请求结构改变。

## 故意会让 system 变化的情况

- 切换或关闭角色卡；
- 修改手写提示词、清空提示词、恢复默认；
- 修改手写角色名；
- 打开或关闭“抑制元叙述”。

这些是用户主动改设定，system 变化属于预期。除这些之外，不应该因为轮数、记忆新增、场景更新、世界书命中、日期变化而改动 system。

## 0.8.76 修了什么

1. 角色卡开场白固定留在 system，去掉消息条数依赖，消除第二轮前缀变化。
2. `composeSystemPrompt` 把纯空白提示词按清空处理，不再落回默认人格。
3. `initialSystemPrompt` 区分“键不存在”和“键存在但为空白”：前者给默认人格，后者保持空。
4. 手写角色名为空时 `{{char}}` 回退为 `AI`，避免字面占位符进入 system 或背景资料。
5. 默认人格与演出规则对“括号内心活动”的矛盾统一：旁白、分析、写作计划禁止；角色主观心理活动允许放进圆括号。
6. 三种协议在序列化时统一拦截空白 system。

## 验证方式

- `pnpm test:system`：断言角色卡前缀逐字稳定、开场白始终存在、Chat 的 system 位于首条、Responses 的 system 位于 `instructions`、空 system 不生成 system 消息。
- 本地 8095 + 8097/8099 mock：同一角色卡连续三轮发送，抓取请求体，比较 `messages[0].content` 的 SHA-256；三轮必须一致，且包含开场白、不含 `{{char}}`/`{{user}}`。
- 关闭角色卡：system 只含手写提示词，不含卡身份、关系、说话方式、世界书、场景。
- 清空提示词：请求体第一条就是 user，没有 system 消息。
- 纯空白提示词：与清空一致，不发空 system。
- 新用户无提示词键：仍然拿到默认人格。

## 边界

请求体逐字稳定只证明客户端没有制造前缀差异，不等于服务商一定命中缓存。实际缓存还取决于服务商策略、模型、账号与计费口径；本项目只保证发出去的 system 前缀本身没有随机变化。
