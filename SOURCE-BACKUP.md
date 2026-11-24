# 源码留存说明 · 0.8.85

这份说明跟着源码包一起放，不是发布公告。它只回答四个问题：这是哪个版本、包里有什么、缺了什么、后来的人怎么把它跑起来。

## 版本

- 版本号：0.8.85
- 开发阶段的 versionCode：131
- 覆盖版包名：`io.github.lijiahua1024.dsreplica`
- 并存版包名：`io.github.lijiahua1024.dsreplica.rp`
- 前端版本标记：`dist/index.html` 里的 `application-version=0.8.85`

## 包里有什么

- `src/`：React + TypeScript 前端源码
- `android/`：Android 容器、Java 源码和 Gradle 工程
- `scripts/`、`rspack.config.ts`、`tsconfig.json`：构建与测试脚本
- `package.json`、`pnpm-lock.yaml`：依赖和锁定版本
- `README.md`、`NOTICE.md`、`LICENSE`、`SYSTEM-PROMPT-PIPELINE.md`、本说明：来源、许可、System 前缀链路和使用边界

## 包里没有什么

- `node_modules/`：按 `pnpm-lock.yaml` 重新安装
- `dist/`：按源码重新构建
- APK、签名文件、`debug.keystore`、`release.jks`
- 打包中间产物、测试演练页、个人备份

这些不是遗漏，是故意不放进源码包。APK 和签名文件由构建者自己生成、自己保管；具体边界写在 README 的“编译、签名与分发”一节，NOTICE 里也有说明。别人转发的 APK 不代表这个仓库，也无法证明没有被改过。

## 0.8.85 本版改动

- `android/.../AutoBackup.java` 改为两阶段写入：先写应用缓存中的 `.part` 文件，关闭后核对 `expectedSize` 与临时文件长度，再用 `ZipFile` 打开中央目录确认 ZIP 完整。校验通过后才复制到 `MediaStore Downloads`，复制字节数与临时文件不一致时删除 pending 条目，下载目录不会出现半截文件。
- `AutoBackup.begin()` 增加预期字节数参数，`MainActivity` 的 `beginAutoBackup(String, long)` 同步；`append()` 在超过预期大小时立即失败，`finish()` 校验失败会清理临时文件并返回 false。
- `status()` 与 `prune()` 只查询 `IS_PENDING = 0` 的条目，并检查文件头 `PK\x03\x04` 与末尾 EOCD `PK\x05\x06`；空文件、截断文件、pending 残留和超出保留数量的文件会被删除。目录匹配改为 `%DeepSeek Replica/自动备份%`，兼容带或不带 `Download` 前缀、末尾斜杠不同的设备。
- 新增 `src/services/chat/backupName.ts`，备份名改为 `deepseek_data-YYYY-MM-DD-HHMMSS.zip`；同一天多次备份不再产生同名副本，`backup.ts` 统一使用该生成器。
- `runAutoBackup` 增加单飞锁 `inFlight`：自动备份与手动「立即备份」同时触发时复用同一次执行，避免同一秒发布两份同名文件。
- `runAutoBackup` 支持 `notify`：定时、启动和回到前台触发的成功/失败分别派发 `replica:auto-backup-success` / `replica:auto-backup-failed`；`App.tsx` 监听后 toast 提示「自动备份完成：N 个对话，文件已校验」或「失败，下载目录不会留下不完整文件」。
- 手动备份提示与失败文案同步：补上「文件已校验」；区分 `verify`（完整性校验失败）与 `finish`（发布未确认），不再显示“文件已写入但系统未确认”的旧口径。
- 设置页状态与说明更新：上次校验仅在 `meta.name` 与当前最新备份同名时展示，避免旧指纹误导；数据页文案说明临时文件、校验、发布和清理顺序。
- 新增 `scripts/test-auto-backup.mjs` 与 `pnpm test:auto-backup`，断言文件名精确到秒、同日不同秒不重名、不含路径分隔符。
- 公告、README、本说明同步到 0.8.85。

## 0.8.84 历史改动

- `CharacterProfile` 从 12 个字段扩到 32 个，新增 `age`、`gender`、`pronouns`、`species`、`height`、`weight`、`birthday`、`occupation`、`residence`、`languages`、`favoriteFoods`、`dislikedFoods`、`favoriteDrinks`、`hobbies`、`dailyRoutine`、`possessions`、`pet`、`values`、`petPeeves`、`boundaries`、`cooperation`。`origin` 收窄为出处与身份；`appearance` 只写外貌，不再包含身高体重；`habits` 拆成食物、饮品、兴趣、作息、随身物与宠物。
- `CHARACTER_PROFILE_FIELDS` 增加 `group`，四组为 `core`、`body`、`personality`、`story`；`CHARACTER_PROFILE_GROUPS` 提供分组标题与说明。`normalizeCharacterProfile` 同步归一化 32 个字段，旧档案缺字段补空串。
- `formatCharacterProfile` 按四组固定顺序装配；有任一固定字段时追加固定事实声明，结尾追加配合推进与不承认模型/助手的规则。规则文本与 `roleplay.ts` 的 `ROLEPLAY_*_RULE` 逐字一致，回归测试直接比较。
- `Settings` 新增 `profileEnabled`，存储键 `replica:character-profile-enabled`，默认开启；新增 `setCharacterProfileEnabled`，复位角色页时恢复开启。
- `streamReply` 改为 `profileEnabled && !activeCard && characterProfileHasContent()` 才装配档案；关闭后只走表达提示词与固定演出规则。
- `AndroidSettings` 新增「读取基础档案」开关；关闭后 32 个字段与角色名 `readOnly` 并置灰，重新开启才能编辑。页面由单组改为四组，根页状态显示「已关闭」。搜索索引同步新字段。
- `AndroidSettings.module.css` 新增 `.profileNotice`、`.profileGroupHint` 与 `.profileField[data-disabled]`、`.profileInput[data-disabled]`、`.inlineInput[data-disabled]`。
- 设定存档新增 `profileEnabled`；`buildSettingArchive` 写入，`parseSettingArchive` 兼容旧档按开启处理，`applySettingArchive` 通过 `saveProfileEnabled` 恢复。
- 公告、README、`SYSTEM-PROMPT-PIPELINE.md` 与旧 12 项说明同步替换；删除“档案和提示词一起进入”等过期口径。
- `scripts/test-roleplay.mjs` 新增 32 字段计数、固定参数顺序、固定事实声明、配合与身份规则、档案与卡片规则逐字一致、四组顺序断言。

## 0.8.83 本版改动

- `CharacterCard` 新增 22 个字符串字段：`age`、`gender`、`pronouns`、`species`、`height`、`weight`、`birthday`、`occupation`、`residence`、`languages`、`favoriteFoods`、`dislikedFoods`、`favoriteDrinks`、`hobbies`、`dailyRoutine`、`possessions`、`pet`、`temperament`、`values`、`petPeeves`、`boundaries`、`cooperation`。字段顺序固定，旧卡缺字段时补空串。
- `formatCharacterCard` 改为先输出固定参数，再输出生活细节、性格边界与剧情表达；有任一固定字段时追加固定事实声明，结尾固定追加配合规则与“不承认模型、程序、助手”的身份规则。
- 角色卡编辑器重排为「基本档案」「身体与生活」「性格与边界」「剧情与表达」四组；完整度计数从 15 项扩到 37 项。`CARD_EXAMPLES` 八套模板全部补齐新字段，切换模板时保留 id 与创建时间，其余整组重置。
- `CharacterCard` 导入增加 `race`、`job`、`home`、`language`、`likes`、`dislikes`、`items` 等外部键名映射；旧版 V2 的 `personality` 只进入 `style`，不再复制到 `temperament`。
- 六张内置卡补齐固定参数与生活细节，拆出原先写在 `identity` / `appearance` 里的年龄、身高与体重；删除“被问是不是 AI 时照实回答”一类旧说明。
- `WorldbookEntry` 新增必填 `authority`：`canon`（硬设定）、`local`（局部事实）、`rumor`（传闻）；默认 `canon`。`formatWorldbookBlock` 前缀改为「分类·可信度」并解释三者差别。
- 新增 `dedupeWorldbookEntries`：按 `cardId + kind + authority + 小写标题 + 正文` 合并，关键词去重拼接、启用与每轮注入取或、权重与更新时间取最大。`normalizeWorldbook` 与 `saveWorldbookEntry` 都会调用；编辑器保存前拦截完全重复，并提示同角色、同分类、同标题、同正文。
- 世界书编辑器新增可信度下拉与说明，列表新增可信度标签；同名条目在同范围内出现时给出重复提示。
- `DEFAULT_SYSTEM_PROMPT` 新增“在人物逻辑里配合推进”段落，纯基础档案路径也有同样的配合约束。
- `scripts/test-roleplay.mjs` 新增 22 字段保留与旧卡补空、固定事实顺序、配合规则、身份规则、可信度默认值、世界书可信度前缀与完全重复合并断言。

## 0.8.82 本版改动

- 设置根页入口「角色设定」改为「角色档案与表达」，页面拆成「角色设定 · 基础档案」「头像与显示」「表达提示词」三部分；根页状态显示已填档案项数与提示词状态。
- 新增 `src/services/chat/characterProfile.ts`：`CharacterProfile` 当时固定 12 字段（0.8.84 已扩到 32 并加开关），`CHARACTER_PROFILE_FIELDS` 定义顺序、标签、提示与占位，`normalizeCharacterProfile` 丢弃未知键，`characterProfileFieldCount` 计数，`formatCharacterProfile` 生成 system 片段。
- `Settings` 新增 `characterProfile`，存储键 `replica:character-profile`；逐字段写入、整体替换、清空三个接口都在 `settings.ts`。角色名字仍在 `character-name`，不并入档案 JSON。
- `streamReply` 的 system 选择改为「有当前人物卡用卡，否则有档案用档案」；两者互斥，不叠加。提示词为空但档案有内容时仍保留档案。
- 基础档案支持 `{{user}}` / `{{char}}`，装配时统一替换；空字段整行跳过，不生成“字段：无”。
- 设定存档新增 `profile`；`parseSettingArchive` 的空判断包含档案。导入场景改用 `replaceScene(scene)`，一次写入完整 11 字段，修掉此前只写回 5 个旧字段的问题。
- `DEFAULT_SYSTEM_PROMPT` 改为读取角色卡与基础档案；`resetCharacterSettings` 一并清空档案。
- `scripts/test-roleplay.mjs` 新增基础档案归一化、计数、空 system、占位符替换和稳定性断言。

## 0.8.81 本版改动

- 角色卡新增题材、玩法、外貌、过往、情景、目标、秘密、对白示例和卡内系统指令；补充设定取消字数限制，归一化不再截断；模板从三套扩到八套。
- 世界书新增分类、整段历史扫描和避触词，正文上限从 1,500 提到 4,000 字；导入同步读取 `kind/scope/excludeKeywords`。
- 场景从 5 个字段扩到 11 个，新增天气、氛围与感官、在场人物、当前目标、冲突与悬念、关键物件；自动提取提示词和快照按字段动态生成。
- 请求改按会话绑定人物解析：`Session.characterId` 优先，其次才看全局启用卡；旧会话按首条助手消息与卡内开场白匹配。关闭全局开关只影响新会话，消息气泡、记忆面板和语音通话同步。
- 新增内置卡 `builtin:jianghu`（顾长风）、`builtin:xianxia`（云岫）、`builtin:urban`（许棠），内置总数改为 6。
- 新增 `scripts/test-roleplay.mjs` 与 `pnpm test:roleplay`，覆盖内置卡、字段拼装、中文标签映射、会话绑定、世界书避触和场景解析。

## 0.8.80 本版改动

- 修复角色扮演世界书命中预览的 Hook 依赖：由只看“角色扮演总开关”改为按当前实际可用的角色卡状态重算，切换或清空启用卡后不再保留旧命中。
- 修复长期记忆注入预览的 Hook 依赖：角色扮演开关变化后会重新计算角色/普通记忆注入，不再沿用旧结果。
- 清理 23 条历史静态检查错误：移除对象型本地设置的动态删除、补齐会话复制和单会话包导入的 ID 映射校验、统一条件分支花括号与 Hook 依赖；诊断日志保留并做定点说明。
- 本版未改动 system 与请求前缀链路。

## 0.8.77 本版改动

- 校正 README 与 `SYSTEM-PROMPT-PIPELINE.md`：system 只含角色卡、手写提示词和固定演出规则；记忆、场景、本轮世界书以 `turnContext` 接在当前 user 末尾；`latest_reminder` 是当前 user 前的独立提醒消息；自动压缩、历史编辑和分支会改变请求前缀，但不改 system。

## 0.8.76 本版改动

- 角色卡开场白不再按消息条数进入或退出 system：`formatCharacterCard` 去掉 `includeGreeting` 参数，开场白始终作为卡字段保留，文案改为“只在第一条回复使用，后续自然延续”。同一张卡从第一轮起 system 逐字一致，消除第二轮前缀变化。
- `composeSystemPrompt` 对纯空白提示词返回空字符串；`initialSystemPrompt` 区分“键不存在”（新用户，给默认人格）与“键存在但只有空白”（主动清空，保持空）。
- 手写角色名与卡名都为空时，`{{char}}` 回退为 `AI`，避免字面占位符进入 system 或背景资料。
- 默认人格与 `META_TALK_GUARD` / `ASIDE_AND_ADDRESS_GUARD` 对括号内容的表述统一：禁止旁白、分析、推理步骤和写作计划；允许角色主观心理活动放进圆括号。
- Chat、Responses、自定义 Messages 三种序列化统一拦截空白 system。
- 新增 `scripts/test-system-prompt.mjs` 与 `pnpm test:system`，固定角色卡前缀、开场白存在性、Chat/Responses 的 system 位置与空 system 行为；新增 `SYSTEM-PROMPT-PIPELINE.md` 说明装配顺序和缓存不变量。

## 0.8.75 本版改动

- 修复网页版会话历史“更多”菜单的透明底：此前网页端没有套用侧栏菜单的滚动和高度规则，菜单容器只画到内容高度，后几项溢出到底板外，透出页面背景。
- `Menu` 底板统一加 `overflow-y: auto` 与 `overscroll-behavior: contain`，任何超过最大高度的菜单都在容器内滚动。
- 会话菜单在网页端也按侧栏菜单计算高度，九项内容按可用空间完整展开；窄屏不足时菜单内部滚动。
- 用户消息和助手消息的长按菜单复用同一底板规则，避免同类透明溢出。

## 0.8.74 本版改动

- 角色名与角色卡解耦：启用、改名或保存角色卡不再写入 `replica:character-name`；聊天、语音和角色设定页名字栏在角色扮演开启时按当前启用卡显示卡名（名字栏只读，避免误写手写名），关闭后回到手写角色名和手写头像。
- 兼容旧版本残留：启动时如果手写角色名与当前启用卡同名，视为旧版覆盖值并清空一次；无法反推出被覆盖前的原名字，需要重新填写。
- `streamReply` 的 system 只在该卡真正启用时拼入 `formatCharacterCard`；关闭后 `{{char}}` 使用手写角色名，世界书、场景、角色记忆和角色扮演生成参数一并停用。
- 语音页移除“卡名即通用标题”的启发式；手写名字即使与某张卡同名也照常显示。
- 角色卡设置页、关闭提示、根页状态和 README 统一改为“关闭后卡暂停，不注入卡设定”的口径。

## 0.8.73 本版改动

- 关闭角色扮演或角色卡后，语音通话不再沿用角色卡名字和头像；角色扮演开启且启用卡存在时才用卡身份，关闭后使用提示词侧角色名字/头像，名字仍为卡名残留时显示“语音通话”。
- 鲸鱼图标点击改成随机牌堆：单次点击必换一句，快速点击连续切换，10 句全部用完后短暂冷却并重新洗牌，不再出现点几次后永久静默。
- 维护说明：作者可能利用闲余时间继续更新，也可能不更新，更新与否随缘；如果项目已有人接手，以接手方的仓库和发布页为准。本项目不承诺固定更新节奏。

## 0.8.72 本版改动

- 移除普通记忆顶部重复的“全部 / 对话 / 代码 / 用户原话 / AI 原话”子分类行；“全部 / 生效中 / 手动 / 已归档”状态筛选保留。
- 底部“自动识别 / 对话 / 代码 / 用户原话 / AI 原话”保留，继续决定手动补卡写入哪个子分类；已有卡片归类、搜索与注入顺序不变。
- 补卡区改为纵向排列：标题、分类、输入框、添加按钮自上而下，输入框占满整行并修正 390px 视口下向左溢出的问题；添加按钮移到下一行右侧，不再压住输入框边框。

## 0.8.71 本版改动

- 长期记忆面板宽度上限从 640px 提到 720px；窄屏外边距收至 6px，左右内边距收至 14px，正文可用宽度增加。
- 面板改为整块滚动：标题 sticky 在顶部、补卡区 sticky 在底部，列表不再单独滚动；在面板边框或卡片外空白处下滑也能浏览长对话。
- 卡片头只保留分类、来源和时间；已启用、置顶移到卡片底部操作行，与编辑、删除排在一起，减少顶部拥挤。
- 移除补卡区上方重复的“角色记忆 / 普通记忆”选择；手动补卡跟随顶部当前分类，切换分类会清空未提交草稿，避免写错池。
- 主界面 `PeakWindowHint` 改为高峰红色、空闲绿色，圆点、文字和浅色边框一起跟随；深色主题用更亮的红绿。

## 0.8.70 本版改动

- 设置页转场锁 `exiting.current` 增加超时收尾：动画 Promise 完成、取消、抛错或超过约 0.9 秒都会释放，不再出现“点着点着按钮全部无响应、返回也没用”。
- 旧 WebView 缺少 `Element.animate` 或调用抛错时，设置页直接无动画切换，避免 `e.animate is not a function` 崩溃页。
- 导出、备份等待原生文件选择时不再阻止返回；只有导入、删除这类改动本机数据的动作继续锁返回。
- ZIP 导出按分片和会话批次让出主线程，减少长归档写入期间按钮与返回一起卡住。
- 标题栏、子页和弹窗里重复的“返回”仍按层级处理；快速点击在 300ms 转场内可能被忽略，但不会永久锁死。

## 0.8.69 本版改动

- 角色扮演开启时，长按消息保存与记忆面板手动补卡锁定角色记忆；普通记忆暂停写入，代码块不再预选普通分类。写入层同样强制角色池，避免旧状态或绕过界面时把代码落进普通记忆。
- 角色扮演关闭后，角色池里带三连反引号代码块的角色卡不再注入普通对话；剧情、关系与时间线卡照常注入，避免角色写出的命令和开发日志污染普通问答。
- 记忆面板同步说明：角色扮演中普通 Tab 标注暂停写入、补卡框与添加按钮禁用；关闭角色后注入预览会显示“已排除带代码块的角色卡”。

## 0.8.68 本版改动

- 修复记忆面板分类联动：顶部从普通记忆切回角色记忆时，底部手动补卡同步回到角色记忆，普通子分类按钮收起，不再出现“上面是角色、下面还在补普通卡”的错位。
- 保留 0.8.67 的缓存前缀修复：稳定 system 放角色卡与人设，记忆、场景、世界书接在本轮发言末尾。

## 0.8.67 本版改动

- 修复长对话缓存命中率异常偏低。根因是每轮都把当前长期记忆、场景和关键词世界书拼进 `system` 开头，前缀从第一个变化处失效，后面的历史全部按未命中计费。
- `system` 现在只保留跨轮稳定的角色卡、人设和手写提示词；记忆、场景、世界书移到本轮发言末尾，作为背景资料发送，不写回历史原文。
- 每轮把 `system`、本轮背景和上下文提醒一起计入上下文预算，避免背景很多时低估输入。
- 逐条用量行的“未命中”现在包含写入缓存的输入，使“输入 = 未命中 + 缓存命中”在 Anthropic/OpenAI 两种 usage 口径下都能对平。

## 0.8.66 本版改动

- 长期记忆增加“普通记忆 / 角色记忆”双分类。旧卡没有分类字段，统一按角色记忆读取，不改原文、不破坏时间线与注入。
- 普通记忆分“对话 / 代码 / 用户说的话 / AI 说的话”，每条消息独立成卡；面板支持双 Tab、子分类、跨分类搜索、代码块展示与按分类清空。
- 消息长按保存弹窗和手动补卡支持分类选择；三连反引号代码块自动预选普通-代码，非角色扮演回复里的代码块会自动入库。
- 普通记忆与角色记忆各自有卡片上限、字数上限和注入开关；普通记忆只做关键词检索，角色扮演开启时不注入，避免污染人设。
- 记忆导出支持全部 / 仅普通 / 仅角色，普通可再选四个子分类；导入按原分类合并。

## 跑起来

```bash
pnpm install
pnpm type
pnpm build
```

前端产物输出到 `dist/`。Android 工程用 `android/gradlew` 构建；Gradle 9.7.1、AGP 9.4.0、compileSdk 37 是当前工程配置，环境不一致时自行调整。签名要自己生成，不要把密钥提交进来。

如果只是想看界面，`pnpm dev` 起本地开发服务即可。真正装到设备上、接自己的 API Key、处理系统权限和 ROM 差异，是另一段工作，源码只能把起点交给你。

### 网页版

`pnpm build` 生成的 `dist/` 本身就是可部署的静态站点，不需要额外改接口。当前网页版发布在 `gh-pages` 分支，地址 `https://sjfc123.github.io/deepseek-replica-community/`。更新源码后，重新 build 再用独立临时仓库推送该分支：

```bash
pnpm build
rm -rf /tmp/ghp && mkdir -p /tmp/ghp
cp -R dist/. /tmp/ghp/
touch /tmp/ghp/.nojekyll
cd /tmp/ghp
git init -b gh-pages
git add -A && git commit -m "web: static build"
git push -f <仓库地址> gh-pages
```

网页版没有 Android 原生桥：Key 存在浏览器 `localStorage`，会话和设置存在 `localStorage` / IndexedDB；请求由浏览器直连模型接口，第三方网关必须允许 CORS。连续语音通话、原生录音、Keystore 和系统级能力只在 Android 壳里有效。浏览器端设置页直接复用完整设置菜单，根页带 `DeepSeek API Key` 快捷入口，接口、角色卡、记忆和拒答都有独立分区。

## 交接

0.8.66 之后不再负责往后的更新。编译、签名与分发由接手的人自行决定，并承担相应责任。这个包的价值是让下一个人不用从零猜请求怎么拼、角色怎么注入、记忆怎么隔离、通话怎么断句，而不是承诺一个长期维护的成品。后面的版本号、发布节奏和分发方式，由接手的人自己决定。
