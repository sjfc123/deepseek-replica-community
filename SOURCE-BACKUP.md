# 源码包与构建交付说明

本文档规定 DeepSaga 源码包的内容、构建输入、校验方式与交付边界。源码许可以 [LICENSE](LICENSE) 为准，来源与署名以 [NOTICE.md](NOTICE.md) 为准。

## 1. 版本标识

- 应用名：`DeepSaga`
- 版本：`0.9.9`
- versionCode：`152`
- 包名 / namespace：`io.github.sjfc123.deepsaga`
- 构建基线：Gradle 9.7.1、AGP 9.4.0、JDK 17 编译目标、minSdk 29、targetSdk 36、compileSdk 36

## 2. 包内容

源码包由仓库工作树导出，包含：

- 前端源码：`src/`、构建配置与 `package.json` / `pnpm-lock.yaml`
- Android 源码：`android/`，含 Gradle 配置、Java 源码、资源与图标
- 测试脚本：`scripts/`
- 文档：`README.md`、`NOTICE.md`、`DISCLAIMER.md`、`SOURCE-BACKUP.md`、`PERFORMANCE-AUDIT.md`、`SYSTEM-PROMPT-PIPELINE.md`、`FEATURE-GUIDE.md`
- 许可证：`LICENSE`、`licenses/MIT-DeepSeek.txt`
- 网页图标：`src/assets/favicon.png`、`src/assets/apple-touch-icon.png`、`src/assets/app-icon.png`
- 安卓图标：`mipmap-*` 多密度 PNG、自适应背景层与前景层、`mipmap-anydpi-v26/ic_launcher.xml`
- 内部插图：`src/assets/dafeiyu-icon.png`
- 内置角色头像：`src/assets/builtin-avatars/`
- 二创原图与署名：`assets/fanart/dafeiyu-eat.jpg`、`assets/fanart/whalegirl-full.jpg`、`assets/fanart/SOURCES.md`

包内文件清单以 ZIP 实际内容为准。源码包以 `package.json` 的版本号与 versionCode 标识来源，不写入构建机路径、提交号或签名信息。

## 3. 不包含内容

源码包不包含：

- `release.jks`、`debug.keystore`、任何签名文件或签名密码
- 预编译 APK、AAB、网页构建产物 `dist/`
- API Key、聊天记录、角色卡、世界书、记忆、诊断日志或用户数据
- `node_modules/`、Gradle 缓存、IDE 配置、`.env` 或本机路径配置
- 第三方网关凭据、CDN 凭据、发布令牌或自动部署密钥

接收者不得向源码包补入上述内容后再公开分发。

## 4. 构建输入

前端：

```bash
pnpm install
pnpm type
pnpm lint
pnpm build
```

- Node.js 与 pnpm 版本以 `package.json` 的依赖与本机环境为准。
- 构建产物输出到 `dist/`。
- 网页部署时，`dist/index.html`、`dist/static/js/main.*.js`、`dist/favicon.png` 必须来自同一次构建。

Android：

```bash
cd android
./gradlew assembleRelease
```

- JDK 21 用于本轮实际构建；`compileOptions` 的 Java 版本为 17。
- Android SDK 需包含与 `compileSdk` 对应的平台、minSdk 29 及对应 build-tools。
- 构建者必须自行提供签名配置。仓库中的示例路径和别名不构成发布凭据。
- 签名配置中的 `keyAlias 'dsreplica'` 是历史签名别名，不是应用品牌。更换别名会使既有签名链失效，是否更换由构建者自行决定。

## 5. 校验项目

发布或分发前，构建者应核对：

- `aapt2 dump badging`：包名 `io.github.sjfc123.deepsaga`、versionCode `152`、versionName `0.9.9`、application-label `DeepSaga`。
- 启动 Activity：`io.github.sjfc123.deepsaga.MainActivity`。
- APK 内 `ic_launcher.png` 为星空图标，不是上游蓝色鲸鱼。
- `dist/index.html` 标题为 `DeepSaga`。
- `pnpm type`、`pnpm lint`、`pnpm build` 通过。
- 回归脚本通过：`system`、`roleplay`、`story`、`auto-backup`、`data`、`import-attach`、`prompt`、`memory`、`memory-routing`、`memory-view`、`memory-layers`、`groups`、`suggestions`、`cache`、`balance`、`search-intent`、`theme`。
- APK 签名证书指纹与发布记录一致；不一致时不得作为同一应用的升级包分发。

校验结果只证明该次构建的输入与产物，不证明第三方修改版、转载包或非官方渠道产物。

## 6. 迁移与兼容

- 0.9.0 使用独立包名，旧版 `io.github.lijiahua1024.dsreplica` 的数据不会自动迁移。
- 迁移必须通过旧版导出所有历史对话，再在新版导入完成。
- API Key 不进入备份，迁移后必须重新填写。
- 历史对话 ZIP、单会话包、设定存档和记忆归档保持原格式标识。
- 内部 `replica:` 存储键保持不变，用于读取既有数据。
- 旧包字段缺失、ID 冲突或手工修改导致的格式异常，按单个会话排除并在界面列出标题与原因；其余会话继续导入，不因一个坏条目整体失败。
- 新导出的会话 JSON 带可选 `integrity` 字段：版本、算法、消息数量、内容摘要。导入时先比对消息数量再比对摘要；旧包没有该字段时不执行比对，不影响导入。
- 长期记忆新卡写入具体说话人名字；旧卡没有名字字段时按归属和当前玩家 / 角色名回退显示，数据格式没有新增必填迁移项。

## 7. 源码质量与交接边界

- 本仓库包含大量历史堆砌、重复条件、本地兜底和未完成抽象，不属于企业级重构样板。接手者必须先通读请求装配、状态持久化、角色卡、记忆、备份和设置链路。
- 接手方必须保留 GPL-3.0、MIT 与上游署名。
- 接手方必须重新生成并保管签名密钥，不得复用来源不明的签名。
- 接手方必须自行完成设备矩阵、接口网关、安装升级和数据迁移验证。
- 原仓库不承诺交接、不承诺转移发布渠道，也不对后继版本作背书。

## 8. 交付边界

- 本仓库只提供源代码，不提供预编译 APK、在线服务、代打包、部署指导或技术支持。
- 第三方构建产物由构建者、分发者独立负责。本仓库不为其完整性、签名来源、内置内容、隐私行为或平台合规作担保。
- 数据泄露、违规内容、账号封禁、法律纠纷和经济损失的责任，按构建者、分发者与使用者的实际行为分别归属，不转移给源码作者。
- 本仓库作者不提供任何形式的担保，不承担任何连带法律责任。
